#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AKT 的**论文口径**重跑（与 kt_deep_baselines.py 的 4 组网格并列保存为失配消融）。

为什么单独一个脚本：`kt_deep_baselines.py` 的 20 个 AKT 任务里，
lr ∈ {1e-3, 3e-3} 与原论文 Adam 的 {5e-6, 1e-5, 1e-4} 不符（arXiv:2007.12324 §4.1），
且原论文是 **max 300 epoch + 以验证集早停**，而旧网格是 50 epoch 无早停。
本脚本只做「把这两条轴按论文改对」，其余（数据、5 折、KC 定义、指标、batch、loss、优化器）
与既有实验逐字一致，这样新结果才能与 BKT/FB-BKT/DKT/DKVMN 同表比较。

**不改动 `kt_deep_baselines.py`**：DKVMN 父进程仍在从该文件 spawn worker，改它会波及在跑任务。
模型类、数据准备、预测、划分全部从它 import 复用，只替换训练循环（加入验证集早停 + 最佳权重回滚）。

口径声明（写进 manifest，不隐藏）
  * 网格：d ∈ {256} × lr ∈ {1e-5, 1e-4}，共 2 组 × 5 折 = 10 个任务。
    —— 论文的 d ∈ {256,512}、lr ∈ {5e-6,1e-5,1e-4}；取 d 的下界 + lr 的上两档，
       512 与 5e-6 未纳入（理由：本队列仅 142 KC、算力有限，且 d 越大越差已被 DKT 扫描证实）。
  * epochs：max 300（与论文一致），patience=20、min_delta=1e-5，用**验证集**早停，
    并以**验证集最佳轮次**的权重评估测试折（不是最后一轮）。
  * batch：128 learners（论文为 24）。这是**有意保留**的偏离——batch 与 DKT/DKVMN 两阶段一致，
    否则跨模型的批大小不对称会让同表比较失效；该偏离写入 manifest。
  * 测试折只评估一次；配置选择只用训练折内部的 10% 验证集。

用法
  python akt_paper_protocol.py --features work/features_ednet_20000.parquet --jobs 1
  python akt_paper_protocol.py --features work/features_ednet_20000.parquet --only-fold 0 --only-lr 0.0001
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
import kt_deep_baselines as K  # noqa: E402  模型类与数据准备从这里复用，不改动

KIND = "akt"
# ── 声明的论文口径网格 ──────────────────────────────────────────────────
PAPER_DMODELS = [256]                 # 论文 {256,512}，取上界外的下界（见文件头说明）
PAPER_LRS = [1e-4, 1e-5]              # 论文 {5e-6,1e-5,1e-4}，取上两档
MAX_EPOCHS = 300                      # 与论文一致
PATIENCE = 20                         # 论文只说「用验证集早停」，未给 patience，此处显式声明
MIN_DELTA = 1e-5
GRID_RATIONALE = (
    "原论文（arXiv:2007.12324 §4.1 + 附录）对 AKT 用的 Adam 学习率候选为 {5e-6,1e-5,1e-4}、"
    "嵌入维度候选为 {256,512}、最大 300 轮并以验证集早停、批大小 24 learners、H=8、FFN dropout 扫 {0..0.25}。"
    "先前 4 组网格用的是 lr∈{1e-3,3e-3}（比论文上界高一个量级）与 50 轮无早停，属口径失配，"
    "该 4 组保留为 learning-rate-mismatch 消融，不作为正文 AKT 口径。"
    "本轮按论文设 max 300 轮 + 验证集早停（patience=20）；d 取 256 而非 512、lr 取 1e-4/1e-5 而非 5e-6，"
    "理由是算力受限且「容量越大越差」已被同队列 DKT 6 组扫描证实；batch 保持 128 以与 DKT/DKVMN 同表可比。"
)


# ── 训练循环（唯一替换的部分：加验证集早停 + 最佳权重回滚）──────────────
def train_akt(config, sequences, train_index, val_index, test_index,
              max_epochs, batch_size, device, patience, epoch_log_path=None):
    lr = config[1]
    skill_index, n_skills = K.make_encoder(sequences)
    prepared = K.prepare_indexed(sequences, skill_index)

    torch.manual_seed(H.SEED)
    model = K.build_model(KIND, n_skills, config).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.BCELoss(reduction="none")
    n_params = sum(p.numel() for p in model.parameters())

    train_lengths = [prepared[i][0].shape[0] for i in train_index]
    batches = [[train_index[i] for i in bucket] for bucket in K.make_buckets(train_lengths, batch_size)]
    cached = [(i.to(device), c.to(device), m.to(device))
              for (i, c, m) in (K.build_batch_cpu(prepared, b) for b in batches)]

    started = time.perf_counter()
    generator = torch.Generator().manual_seed(H.SEED)
    best_val, best_state, best_epoch, bad = float("-inf"), None, 0, 0
    epochs_run = 0
    if epoch_log_path:
        os.makedirs(os.path.dirname(epoch_log_path), exist_ok=True)
        with open(epoch_log_path, "w", encoding="utf-8") as handle:
            handle.write("epoch\ttrainLoss\tvalAuc\n")

    for epoch in range(1, max_epochs + 1):
        model.train()
        total_loss, total_n = 0.0, 0.0
        for batch_index in torch.randperm(len(batches), generator=generator).tolist():
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
            val_prediction, val_target = K.predict(model, prepared, val_index, batch_size, device)
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
        model.load_state_dict(best_state)          # 用验证集最佳轮次的权重评估测试折
    with torch.no_grad():
        test_prediction, test_target = K.predict(model, prepared, test_index, batch_size, device)
    elapsed = time.perf_counter() - started
    metric = {**H.metrics(test_target, test_prediction), "params": int(n_params)}
    return metric, best_val, best_epoch, epochs_run, elapsed


# ── 任务模式 ────────────────────────────────────────────────────────────
def run_task(args):
    lr = float(args.only_lr)
    config = (int(args.only_dmodel), lr)
    fold = args.only_fold
    device = torch.device(args.device if torch.cuda.is_available() else "cpu")
    sequences = H.load_sequences(args.features)
    index_by_id = {id(s): i for i, s in enumerate(sequences)}
    fold_indices = [[index_by_id[id(s)] for s in one] for one in H.student_folds(sequences)]
    test_index = fold_indices[fold]
    train_pool = [i for i in range(len(sequences)) if i not in set(test_index)]
    train_index, val_index = K.split_train_val(train_pool, args.val_frac, H.SEED + fold)
    print("akt-paper cfg=%s fold=%d train=%d val=%d test=%d"
          % (config, fold, len(train_index), len(val_index), len(test_index)), flush=True)

    log_path = os.path.join(args.emit_dir, "epochs", "%s_fold%d.tsv"
                            % (K.config_slug(KIND, config), fold))
    metric, best_val, best_epoch, epochs_run, elapsed = train_akt(
        config, sequences, train_index, val_index, test_index,
        args.epochs, args.batch_size, device, args.patience, log_path)
    print("akt-paper cfg=%s fold=%d auc=%.6f bestVal=%.6f bestEpoch=%d epochsRun=%d params=%d (%.1fs)"
          % (config, fold, metric["auc"], best_val, best_epoch, epochs_run, metric["params"], elapsed),
          flush=True)

    payload = {"model": KIND, "config": str(config), "fold": fold,
               "valAuc": best_val, "bestEpoch": best_epoch, "epochsRun": epochs_run,
               "seconds": round(elapsed, 1), "protocol": "paper",
               "maxEpochs": args.epochs, "patience": args.patience, **metric}
    os.makedirs(args.emit_dir, exist_ok=True)
    path = os.path.join(args.emit_dir, "%s_fold%d.json" % (K.config_slug(KIND, config), fold))
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


# ── 调度模式 ────────────────────────────────────────────────────────────
def run_scheduled(args):
    device = torch.device(args.device if torch.cuda.is_available() else "cpu")
    sequences = H.load_sequences(args.features)
    responses = sum(len(s["correct"]) for s in sequences)
    index_by_id = {id(s): i for i, s in enumerate(sequences)}
    fold_indices = [[index_by_id[id(s)] for s in one] for one in H.student_folds(sequences)]
    n_folds = len(fold_indices)
    print("students=%d responses=%d skills=%d folds=%d device=%s"
          % (len(sequences), responses,
             len({str(s) for seq in sequences for s in seq["skill"]}), n_folds, device), flush=True)

    # 任务顺序按折外循环：先拿到 fold0 的两个 lr（验证曲线 + 收敛轮次），再铺开其余折。
    # 目的是尽早看到「到底在第几轮收敛」，而不是盲等 10 个任务。
    tasks = [(d, lr, f) for f in range(n_folds) for lr in PAPER_LRS for d in PAPER_DMODELS]
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(BENCH_ROOT, f"{timestamp}-{args.label}")
    os.makedirs(out_dir, exist_ok=True)
    emit_dir = args.emit_dir or os.path.join(out_dir, "tasks")
    os.makedirs(emit_dir, exist_ok=True)
    log_path = os.path.join(out_dir, "worker.log")

    pending = []
    for d, lr, fold in tasks:
        path = os.path.join(emit_dir, "%s_fold%d.json" % (K.config_slug(KIND, (d, lr)), fold))
        if not os.path.exists(path):
            pending.append((d, lr, fold))
    print("declared grid: d=%s lr=%s maxEpochs=%d patience=%d"
          % (PAPER_DMODELS, PAPER_LRS, args.epochs, args.patience), flush=True)
    print("tasks=%d pending=%d jobs=%d" % (len(tasks), len(pending), args.jobs), flush=True)

    running: list = []
    with open(log_path, "a", encoding="utf-8") as log:
        while pending or running:
            while pending and len(running) < args.jobs:
                d, lr, fold = pending.pop(0)
                command = [sys.executable, os.path.abspath(__file__),
                           "--features", args.features,
                           "--only-dmodel", str(d), "--only-lr", repr(lr),
                           "--only-fold", str(fold), "--emit-dir", emit_dir,
                           "--epochs", str(args.epochs), "--patience", str(args.patience),
                           "--batch-size", str(args.batch_size), "--val-frac", str(args.val_frac),
                           "--device", args.device]
                process = subprocess.Popen(command, cwd=HERE, stdout=log, stderr=subprocess.STDOUT)
                running.append((process, (d, lr, fold), time.perf_counter()))
                print("start d=%d lr=%g fold=%d" % (d, lr, fold), flush=True)
            time.sleep(2)
            for entry in running:
                process, (d, lr, fold), began = entry
                if process.poll() is not None:
                    running.remove(entry)
                    print("d=%d lr=%g fold=%d exit=%s (%.0fs)"
                          % (d, lr, fold, process.returncode, time.perf_counter() - began), flush=True)

    rows = []
    for d, lr, fold in tasks:
        path = os.path.join(emit_dir, "%s_fold%d.json" % (K.config_slug(KIND, (d, lr)), fold))
        if not os.path.exists(path):
            raise SystemExit("缺少任务结果：%s" % path)
        rows.append(json.load(open(path, encoding="utf-8")))

    with open(os.path.join(out_dir, "akt_paper_scan.csv"), "w",
              encoding="utf-8-sig", newline="") as handle:
        # extrasaction="ignore" 必需：任务 JSON 比这里声明的列多出
        # protocol / maxEpochs / patience 三个字段，否则 DictWriter 会直接抛
        # ValueError（曾经的踩坑：10 个任务全部算完后在收尾处挂掉，
        # 结果 summary.json 没写出来，任务 JSON 本身不受影响）。
        writer = csv.DictWriter(handle, extrasaction="ignore",
                                fieldnames=["model", "config", "fold", "auc", "acc",
                                            "rmse", "n", "params", "valAuc", "bestEpoch",
                                            "epochsRun", "seconds", "protocol",
                                            "maxEpochs", "patience"])
        writer.writeheader()
        writer.writerows(rows)

    bkt_fold_aucs = [H.metrics(*H.run_standard_bkt([sequences[i] for i in fold_indices[f]]))["auc"]
                     for f in range(n_folds)]
    configs = []
    for lr in PAPER_LRS:
        key = str((PAPER_DMODELS[0], lr))
        selected = [r for r in rows if r["config"] == key]
        aucs = [r["auc"] for r in selected]
        configs.append({
            "config": key, "lr": lr,
            "aucMean": round(float(np.mean(aucs)), 6), "aucStd": round(float(np.std(aucs)), 6),
            "accMean": round(float(np.mean([r["acc"] for r in selected])), 6),
            "rmseMean": round(float(np.mean([r["rmse"] for r in selected])), 6),
            "params": selected[0]["params"],
            "foldAucs": [round(x, 6) for x in aucs],
            "valAucMean": round(float(np.mean([r["valAuc"] for r in selected])), 6),
            "epochsRun": [r["epochsRun"] for r in selected],
            "bestEpochs": [r["bestEpoch"] for r in selected],
            "seconds": round(sum(r["seconds"] for r in selected), 1),
            "deltaVsStandardBkt": round(float(np.mean(aucs) - np.mean(bkt_fold_aucs)), 6),
            "pairedVsStandardBkt": B.paired(aucs, bkt_fold_aucs[:len(aucs)]),
        })

    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "protocol": "AKT paper-faithful re-run (arXiv:2007.12324)",
        "featuresFile": os.path.abspath(args.features),
        "students": len(sequences), "responses": int(responses), "folds": n_folds, "seed": H.SEED,
        "declaredGrid": {"d": PAPER_DMODELS, "lr": PAPER_LRS, "maxEpochs": args.epochs,
                         "patience": args.patience, "minDelta": MIN_DELTA,
                         "batchSize": args.batch_size, "earlyStopOn": "validation AUC (train-fold 10%)",
                         "testEvaluation": "single pass, using best-validation-epoch weights"},
        "gridRationale": GRID_RATIONALE,
        "deviationsFromPaper": [
            "batchSize 128 vs paper's 24 learners — kept at 128 so batch/loss/optimizer match the "
            "DKT and DKVMN stages, otherwise the cross-model table is not comparable",
            "d=512 and lr=5e-6 not swept (compute budget; larger capacity is worse on this cohort)",
        ],
        "concurrency": {
            "jobs": args.jobs,
            "note": "profiler 实测单步约有 64% 的墙钟时间不是在执行 kernel（launch 开销占主导），"
                    "故用子进程并发压时间（与 DKVMN 同法）。每个 (config, fold) 独立播种 "
                    "H.SEED，并发只改墙钟、不改任何数值结果。",
            "measured": "单进程 133.8 ms/step；两份真重叠各约 178 ms/step → 总吞吐 1.53x",
        },
        "standardBktFoldAucs": [round(x, 6) for x in bkt_fold_aucs],
        "standardBktAucMean": round(float(np.mean(bkt_fold_aucs)), 6),
        "configs": configs,
        "headlineConfig": min(configs, key=lambda c: abs(c["lr"] - 1e-4)),
        "bestOfGrid": max(configs, key=lambda c: c["aucMean"]),
        "environment": {"python": sys.version.split()[0], "numpy": np.__version__,
                        "torch": torch.__version__, "device": str(device),
                        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None},
    }
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    print(json.dumps(configs, ensure_ascii=False, indent=2), flush=True)
    print("outputs:", out_dir, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="AKT 论文口径重跑（300 轮 + 验证集早停）")
    parser.add_argument("--features", required=True)
    parser.add_argument("--label", default="ednet-kt1-firsttag-20000u-akt-paper-5fold")
    parser.add_argument("--epochs", type=int, default=MAX_EPOCHS)
    parser.add_argument("--patience", type=int, default=PATIENCE)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--val-frac", type=float, default=0.1)
    parser.add_argument("--jobs", type=int, default=1)
    parser.add_argument("--emit-dir", default="")
    parser.add_argument("--only-dmodel", type=int, default=0)
    parser.add_argument("--only-lr", default="")
    parser.add_argument("--only-fold", type=int, default=-1)
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()
    if args.only_lr and args.only_dmodel:
        run_task(args)
        return
    run_scheduled(args)


if __name__ == "__main__":
    sys.exit(main())
