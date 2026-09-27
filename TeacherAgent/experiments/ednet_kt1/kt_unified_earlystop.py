#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 DKT / DKVMN 统一到与 AKT 相同的「验证集早停」框架下重跑。

动机（审稿人视角的口径对称性）
  旧结果里 DKT / DKVMN 是**固定 50 轮、无早停**，且报的是第 50 轮的 checkpoint；
  而 AKT 是按原论文口径「max 300 轮 + 以验证集早停 + 用验证集最佳轮次权重评估测试折」。
  两者放在同一张表里比较，构成训练预算不对称。本脚本消除这一不对称：

统一后的训练协议（三个神经模型完全一致）
  * 划分：H.student_folds(seed=42) 学生级 5 折；每折的训练池再切 10% 作验证集，
    切法与 AKT 逐字相同（K.split_train_val(train_pool, 0.1, H.SEED + fold)）；
  * 停止准则：每个 epoch 在验证集上算 AUC，patience=20、min_delta=1e-5，
    连续 20 轮无提升即停；**若某轮更优则保存该轮权重**；
  * 测试折：只用「验证集最佳轮次」的权重评估**一次**；
  * 不变量：batch=128、Adam、BCELoss(masked)、长度分桶、每任务独立播种 H.SEED。

允许的差异（并写入 summary，不做隐藏）
  * 最大 epoch 上限按模型设（收敛速度本就不同）：DKT / DKVMN 默认 300，与 AKT 一致；
  * 各自的超参网格沿用既有「先声明后执行」的那一套，不因本次改动而变。

**不改动** run_eval.py / run_eval_batched_dkt.py / kt_deep_baselines.py：
DKT 与 DKVMN 的模型类、批构造、划分、指标全部 import 复用，只替换训练循环。

用法
  python kt_unified_earlystop.py --features work/features_ednet_20000.parquet --jobs 3
  python kt_unified_earlystop.py --features work/features_ednet_20000.parquet \
      --only-model dkvmn --only-config 50,0.001 --only-fold 0 --emit-dir <dir>
"""
from __future__ import annotations

import argparse
import copy
import csv
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import numpy as np
import torch
import torch.nn as nn

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BENCH_ROOT = os.path.join(REPO_ROOT, "benchmark-results")
sys.path.insert(0, HERE)

import run_eval as H  # noqa: E402
import run_eval_batched_dkt as B  # noqa: E402
import kt_deep_baselines as K  # noqa: E402

# ── 声明的网格（沿用既有那套，不因本次改动而变）─────────────────────────
DKT_HIDDENS = [64, 100, 200]
DKT_LRS = [1e-3, 3e-3]
DKT_HEADLINE = (100, 1e-3)
DKVMN_MEMS = [50, 200]
DKVMN_LRS = [1e-3, 3e-3]
DKVMN_HEADLINE = (50, 1e-3)

MAX_EPOCHS = 300
PATIENCE = 20
MIN_DELTA = 1e-5
PROTOCOL_NOTE = (
    "统一早停协议：学生级 5 折（seed=42）；训练池内 10% 作验证集（seed=H.SEED+fold）；"
    "逐轮计算验证集 AUC，patience=20、min_delta=1e-5；保存验证集最佳轮次权重；"
    "测试折只用该权重评估一次。max epochs 上限按模型设（DKT/DKVMN/AKT 均为 300），"
    "但「是否停止」一律由验证集决定，不存在固定轮次 checkpoint。"
)


def config_slug(kind, config):
    if kind == "dkt":
        return "dkt_d%d_lr%s" % (config[0], ("%g" % config[1]).replace(".", "p"))
    return "dkvmn_d%d_lr%s" % (config[0], ("%g" % config[1]).replace(".", "p"))


# ── DKT：复用 B 的 one-hot 批构造 + 模型，只换成带早停的训练循环 ────────
def run_dkt(config, sequences, train_index, val_index, test_index,
            max_epochs, batch_size, device, patience, epoch_log_path=None):
    hidden, lr = config
    skill_index, n_skills = B.make_encoder(sequences)
    prepared = B.prepare_sequences(sequences, skill_index)

    torch.manual_seed(H.SEED)
    model = B.dkt_model(n_skills, hidden).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.BCELoss(reduction="none")
    n_params = sum(p.numel() for p in model.parameters())

    buckets = B.make_buckets([sequences[i] for i in train_index], batch_size)
    train_batches = [[train_index[i] for i in bucket] for bucket in buckets]
    batch_cache = [None] * len(train_batches)

    def evaluate(index_list):
        model.eval()
        order = sorted(index_list, key=lambda i: len(sequences[i]["correct"]))
        predictions, targets_all = [], []
        with torch.no_grad():
            for start in range(0, len(order), batch_size):
                chunk = order[start:start + batch_size]
                features, targets, mask = B.gpu_batch(prepared, chunk, n_skills, device)
                output = model(features).cpu().numpy()
                keep = mask.cpu().numpy().astype(bool)
                predictions.append(output[keep])
                targets_all.append(targets.cpu().numpy()[keep])
        return np.concatenate(predictions), np.concatenate(targets_all)

    began = time.perf_counter()
    generator = torch.Generator().manual_seed(H.SEED)
    best_val, best_state, best_epoch, bad, epochs_run = float("-inf"), None, 0, 0, 0
    if epoch_log_path:
        os.makedirs(os.path.dirname(epoch_log_path), exist_ok=True)
        with open(epoch_log_path, "w", encoding="utf-8") as handle:
            handle.write("epoch\ttrainLoss\tvalAuc\n")

    for epoch in range(1, max_epochs + 1):
        model.train()
        total_loss, total_n = 0.0, 0.0
        for batch_index in torch.randperm(len(train_batches), generator=generator).tolist():
            index_list = train_batches[batch_index]
            if batch_cache[batch_index] is None:
                batch_cache[batch_index] = B.gpu_batch(prepared, index_list, n_skills, device)
            features, targets, mask = batch_cache[batch_index]
            optimizer.zero_grad(set_to_none=True)
            prediction = model(features)
            loss = (loss_fn(prediction, targets) * mask).sum() / mask.sum()
            loss.backward()
            optimizer.step()
            total_loss += float(loss.detach()) * float(mask.sum())
            total_n += float(mask.sum())
        epochs_run = epoch

        val_prediction, val_target = evaluate(val_index)
        val_auc = H.metrics(val_target, val_prediction)["auc"]
        if epoch_log_path:
            with open(epoch_log_path, "a", encoding="utf-8") as handle:
                handle.write("%d\t%.6f\t%.6f\n" % (epoch, total_loss / max(total_n, 1.0), val_auc))

        if val_auc > best_val + MIN_DELTA:
            best_val, best_epoch, bad = val_auc, epoch, 0
            best_state = copy.deepcopy(model.state_dict())
        else:
            bad += 1
            if bad >= patience:
                break

    if best_state is not None:
        model.load_state_dict(best_state)
    prediction, target = evaluate(test_index)
    metric = {**H.metrics(target, prediction), "params": int(n_params)}
    return metric, best_val, best_epoch, epochs_run, time.perf_counter() - began


# ── DKVMN：复用 K 的模型与索引批，同样换成带早停的循环 ─────────────────
def run_dkvmn(config, sequences, train_index, val_index, test_index,
              max_epochs, batch_size, device, patience, epoch_log_path=None):
    memory, lr = config
    skill_index, n_skills = K.make_encoder(sequences)
    prepared = K.prepare_indexed(sequences, skill_index)

    torch.manual_seed(H.SEED)
    model = K.build_model("dkvmn", n_skills, config).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.BCELoss(reduction="none")
    n_params = sum(p.numel() for p in model.parameters())

    lengths = [prepared[i][0].shape[0] for i in train_index]
    buckets = K.make_buckets(lengths, batch_size)
    cached = [(i.to(device), c.to(device), m.to(device))
              for (i, c, m) in (K.build_batch_cpu(prepared, [train_index[j] for j in bucket])
                                for bucket in buckets)]

    def evaluate(index_list):
        prediction, target = K.predict(model, prepared, index_list, batch_size, device)
        return prediction, target

    began = time.perf_counter()
    generator = torch.Generator().manual_seed(H.SEED)
    best_val, best_state, best_epoch, bad, epochs_run = float("-inf"), None, 0, 0, 0
    if epoch_log_path:
        os.makedirs(os.path.dirname(epoch_log_path), exist_ok=True)
        with open(epoch_log_path, "w", encoding="utf-8") as handle:
            handle.write("epoch\ttrainLoss\tvalAuc\n")

    for epoch in range(1, max_epochs + 1):
        model.train()
        total_loss, total_n = 0.0, 0.0
        for batch_index in torch.randperm(len(cached), generator=generator).tolist():
            idx, correct, mask = cached[batch_index]
            optimizer.zero_grad(set_to_none=True)
            prediction = model(idx, correct, mask)
            loss = (loss_fn(prediction, correct) * mask).sum() / mask.sum()
            loss.backward()
            optimizer.step()
            total_loss += float(loss.detach()) * float(mask.sum())
            total_n += float(mask.sum())
        epochs_run = epoch

        with torch.no_grad():
            val_prediction, val_target = evaluate(val_index)
        val_auc = H.metrics(val_target, val_prediction)["auc"]
        if epoch_log_path:
            with open(epoch_log_path, "a", encoding="utf-8") as handle:
                handle.write("%d\t%.6f\t%.6f\n" % (epoch, total_loss / max(total_n, 1.0), val_auc))

        if val_auc > best_val + MIN_DELTA:
            best_val, best_epoch, bad = val_auc, epoch, 0
            best_state = copy.deepcopy(model.state_dict())
        else:
            bad += 1
            if bad >= patience:
                break

    if best_state is not None:
        model.load_state_dict(best_state)
    with torch.no_grad():
        prediction, target = evaluate(test_index)
    metric = {**H.metrics(target, prediction), "params": int(n_params)}
    return metric, best_val, best_epoch, epochs_run, time.perf_counter() - began


RUNNERS = {"dkt": run_dkt, "dkvmn": run_dkvmn}
GRIDS = {
    "dkt": [(h, lr) for h in DKT_HIDDENS for lr in DKT_LRS],
    "dkvmn": [(m, lr) for m in DKVMN_MEMS for lr in DKVMN_LRS],
}


# ── 任务模式 ────────────────────────────────────────────────────────────
def run_task(args):
    config = tuple(int(float(x)) if float(x).is_integer() else float(x)
                   for x in args.only_config.split(","))
    kind, fold = args.only_model, args.only_fold
    device = torch.device(args.device if torch.cuda.is_available() else "cpu")
    sequences = H.load_sequences(args.features)
    index_by_id = {id(s): i for i, s in enumerate(sequences)}
    fold_indices = [[index_by_id[id(s)] for s in one] for one in H.student_folds(sequences)]

    test_index = fold_indices[fold]
    train_pool = [i for i in range(len(sequences)) if i not in set(test_index)]
    train_index, val_index = K.split_train_val(train_pool, args.val_frac, H.SEED + fold)
    print("%s-u cfg=%s fold=%d train=%d val=%d test=%d"
          % (kind, config, fold, len(train_index), len(val_index), len(test_index)), flush=True)

    log_path = os.path.join(args.emit_dir, "epochs", "%s_fold%d.tsv"
                            % (config_slug(kind, config), fold))
    metric, best_val, best_epoch, epochs_run, elapsed = RUNNERS[kind](
        config, sequences, train_index, val_index, test_index,
        args.epochs, args.batch_size, device, args.patience, log_path)
    print("%s-u cfg=%s fold=%d auc=%.6f bestVal=%.6f bestEpoch=%d epochsRun=%d params=%d (%.1fs)"
          % (kind, config, fold, metric["auc"], best_val, best_epoch, epochs_run,
             metric["params"], elapsed), flush=True)

    payload = {"model": kind, "config": str(config), "fold": fold,
               "valAuc": best_val, "bestEpoch": best_epoch, "epochsRun": epochs_run,
               "seconds": round(elapsed, 1), "protocol": "unified-earlystop",
               "maxEpochs": args.epochs, "patience": args.patience, **metric}
    os.makedirs(args.emit_dir, exist_ok=True)
    path = os.path.join(args.emit_dir, "%s_fold%d.json" % (config_slug(kind, config), fold))
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


# ── 调度模式 ────────────────────────────────────────────────────────────
def run_scheduled(args, kinds):
    device = torch.device(args.device if torch.cuda.is_available() else "cpu")
    sequences = H.load_sequences(args.features)
    responses = sum(len(s["correct"]) for s in sequences)
    index_by_id = {id(s): i for i, s in enumerate(sequences)}
    fold_indices = [[index_by_id[id(s)] for s in one] for one in H.student_folds(sequences)]
    n_folds = len(fold_indices)
    print("students=%d responses=%d skills=%d folds=%d device=%s"
          % (len(sequences), responses,
             len({str(s) for seq in sequences for s in seq["skill"]}), n_folds, device), flush=True)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(BENCH_ROOT, f"{timestamp}-{args.label}")
    os.makedirs(out_dir, exist_ok=True)
    emit_dir = args.emit_dir or os.path.join(out_dir, "tasks")
    os.makedirs(emit_dir, exist_ok=True)
    log_path = os.path.join(out_dir, "worker.log")

    tasks = [(kind, config, fold) for kind in kinds for config in GRIDS[kind]
             for fold in range(n_folds)]
    for kind in kinds:
        print("%s declared grid: %s" % (kind, [str(c) for c in GRIDS[kind]]), flush=True)
    pending = []
    for kind, config, fold in tasks:
        path = os.path.join(emit_dir, "%s_fold%d.json" % (config_slug(kind, config), fold))
        if not os.path.exists(path):
            pending.append((kind, config, fold))
    print("maxEpochs=%d patience=%d tasks=%d pending=%d jobs=%d"
          % (args.epochs, args.patience, len(tasks), len(pending), args.jobs), flush=True)

    running: list = []
    with open(log_path, "a", encoding="utf-8") as log:
        while pending or running:
            while pending and len(running) < args.jobs:
                kind, config, fold = pending.pop(0)
                command = [sys.executable, os.path.abspath(__file__),
                           "--features", args.features, "--only-model", kind,
                           "--only-config", "%g,%g" % config, "--only-fold", str(fold),
                           "--emit-dir", emit_dir, "--epochs", str(args.epochs),
                           "--patience", str(args.patience), "--batch-size", str(args.batch_size),
                           "--val-frac", str(args.val_frac), "--device", args.device]
                process = subprocess.Popen(command, cwd=HERE, stdout=log, stderr=subprocess.STDOUT)
                running.append((process, (kind, config, fold), time.perf_counter()))
                print("start %s cfg=%s fold=%d" % (kind, config, fold), flush=True)
            time.sleep(2)
            for entry in running:
                process, (kind, config, fold), began = entry
                if process.poll() is not None:
                    running.remove(entry)
                    print("%s cfg=%s fold=%d exit=%s (%.0fs)"
                          % (kind, config, fold, process.returncode, time.perf_counter() - began),
                          flush=True)

    rows = []
    for kind, config, fold in tasks:
        path = os.path.join(emit_dir, "%s_fold%d.json" % (config_slug(kind, config), fold))
        if not os.path.exists(path):
            raise SystemExit("缺少任务结果：%s" % path)
        rows.append(json.load(open(path, encoding="utf-8")))

    with open(os.path.join(out_dir, "unified_earlystop_scan.csv"), "w",
              encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, extrasaction="ignore",
                                fieldnames=["model", "config", "fold", "auc", "acc", "rmse",
                                            "n", "params", "valAuc", "bestEpoch", "epochsRun",
                                            "seconds", "protocol", "maxEpochs", "patience"])
        writer.writeheader()
        writer.writerows(rows)

    bkt_fold_aucs = [H.metrics(*H.run_standard_bkt([sequences[i] for i in fold_indices[f]]))["auc"]
                     for f in range(n_folds)]
    configs = {}
    for kind in kinds:
        entries = []
        for config in GRIDS[kind]:
            key = str(config)
            selected = [r for r in rows if r["model"] == kind and r["config"] == key]
            aucs = [r["auc"] for r in selected]
            entries.append({
                "config": key,
                "aucMean": round(float(np.mean(aucs)), 6), "aucStd": round(float(np.std(aucs)), 6),
                "accMean": round(float(np.mean([r["acc"] for r in selected])), 6),
                "rmseMean": round(float(np.mean([r["rmse"] for r in selected])), 6),
                "params": selected[0]["params"],
                "foldAucs": [round(x, 6) for x in aucs],
                "valAucMean": round(float(np.mean([r["valAuc"] for r in selected])), 6),
                "bestEpochs": [r["bestEpoch"] for r in selected],
                "epochsRun": [r["epochsRun"] for r in selected],
                "seconds": round(sum(r["seconds"] for r in selected), 1),
                "deltaVsStandardBkt": round(float(np.mean(aucs)) - float(np.mean(bkt_fold_aucs)), 6),
                "pairedVsStandardBkt": B.paired(aucs, bkt_fold_aucs[:len(aucs)]),
            })
        configs[kind] = entries

    headline = {"dkt": DKT_HEADLINE, "dkvmn": DKVMN_HEADLINE}
    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "protocol": "unified early-stopping (DKT / DKVMN re-run to match AKT)",
        "featuresFile": os.path.abspath(args.features),
        "students": len(sequences), "responses": int(responses), "folds": n_folds, "seed": H.SEED,
        "declaredGrid": {k: [str(c) for c in GRIDS[k]] for k in kinds},
        "trainingProtocol": {"maxEpochs": args.epochs, "patience": args.patience,
                             "minDelta": MIN_DELTA, "batchSize": args.batch_size,
                             "valFrac": args.val_frac, "optimizer": "Adam",
                             "loss": "BCELoss(masked)", "lengthBucketing": True,
                             "earlyStopOn": "validation AUC (10% of train fold, seed=H.SEED+fold)",
                             "testEvaluation": "single pass, best-validation-epoch weights"},
        "protocolNote": PROTOCOL_NOTE,
        "standardBktFoldAucs": [round(x, 6) for x in bkt_fold_aucs],
        "standardBktAucMean": round(float(np.mean(bkt_fold_aucs)), 6),
        "configs": configs,
        "headline": {k: next((e for e in configs[k] if e["config"] == str(headline[k])),
                             configs[k][0]) for k in kinds},
        "environment": {"python": sys.version.split()[0], "numpy": np.__version__,
                        "torch": torch.__version__, "device": str(device),
                        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None},
    }
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    # 注意：summary["headline"] 的每个值本身就是该模型的 headline 配置条目，
    # 不能再取一次 v["headline"]（曾因此在 50 个任务全部算完、summary.json 已落盘之后
    # 抛 KeyError 并以非 0 退出码结束，被误读成"训练失败"）。
    print(json.dumps({k: {kk: vv for kk, vv in v.items()
                          if kk in ("config", "aucMean", "aucStd", "accMean", "rmseMean",
                                    "params", "bestEpochs")}
                      for k, v in summary["headline"].items()},
                     ensure_ascii=False, indent=2), flush=True)
    print("outputs:", out_dir, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="DKT/DKVMN 统一到 AKT 的早停协议重跑")
    parser.add_argument("--features", required=True)
    parser.add_argument("--label", default="ednet-kt1-firsttag-20000u-ktsym-earlystop")
    parser.add_argument("--models", default="dkt,dkvmn")
    parser.add_argument("--epochs", type=int, default=MAX_EPOCHS)
    parser.add_argument("--patience", type=int, default=PATIENCE)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--val-frac", type=float, default=0.1)
    parser.add_argument("--jobs", type=int, default=3)
    parser.add_argument("--emit-dir", default="")
    parser.add_argument("--only-model", default="")
    parser.add_argument("--only-config", default="")
    parser.add_argument("--only-fold", type=int, default=-1)
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()

    if args.only_model and args.only_config:
        run_task(args)
        return
    kinds = [k.strip() for k in args.models.split(",") if k.strip()]
    run_scheduled(args, kinds)


if __name__ == "__main__":
    sys.exit(main())
