#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""大规模 KT 评测（新脚本，不改动 run_eval.py）。

相对 run_eval.py 的改动：
  1) DKT 支持 mini-batch（原实现把整个训练集做成单个 batch，2 万用户时
     one-hot 张量约 1 GB，8 GB 显存有 OOM 风险）；
     另保留 --dkt-mode full 以便在 2,000u 队列上复现原脚本结果做一致性校验。
  2) DKT 实现分两档：
       --dkt-impl ref  —— 参考实现：CPU 上逐序列 eye[ids] 构 one-hot（历史行为，默认）
       --dkt-impl fast —— 优化实现：CPU 只传 skill 索引，GPU 端 zeros_()+scatter_() 生成 one-hot
     两者生成的特征张量数值完全相同，靠 --verify-dkt 逐点校验。
  3) FB-BKT 的临时 JSONL 放在按 label 隔离的子目录，避免固定文件名导致的并发覆盖
     （表现为「Rust 返回序列数 X 与请求 Y 不一致」）。
  4) 归档 summary 直接给出每折差分、95% CI 与精确置换检验（5 折 = 32 种符号组合全枚举）。

模型定义与指标完全沿用 run_eval.py：单层 LSTM、hidden=100、Adam lr=1e-3、
BCELoss(masked)、5 折学生级交叉验证、AUC/ACC/RMSE。
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BENCH_ROOT = os.path.join(REPO_ROOT, "benchmark-results")
sys.path.insert(0, HERE)

import run_eval as H  # noqa: E402


# ── 编码 ────────────────────────────────────────────────────────────────
def make_encoder(sequences):
    skills = sorted({str(skill) for sequence in sequences for skill in sequence["skill"]})
    return {skill: index for index, skill in enumerate(skills)}, len(skills)


def build_batch(selected, skill_index, n_skills):
    """参考实现：与 run_eval.py 的 to_batch 完全一致（CPU 逐序列 one-hot）。"""
    max_len = max(len(sequence["correct"]) for sequence in selected)
    size = len(selected)
    features = np.zeros((size, max_len, n_skills + 1), dtype=np.float32)
    targets = np.zeros((size, max_len), dtype=np.float32)
    mask = np.zeros((size, max_len), dtype=np.float32)
    eye = np.eye(n_skills, dtype=np.float32)
    for row, sequence in enumerate(selected):
        length = len(sequence["correct"])
        ids = [skill_index[str(skill)] for skill in sequence["skill"]]
        features[row, :length, :n_skills] = eye[ids]
        if length > 1:
            features[row, 1:length, n_skills] = sequence["correct"][:-1]
        targets[row, :length] = sequence["correct"]
        mask[row, :length] = 1.0
    return features, targets, mask


def prepare_sequences(sequences, skill_index):
    """一次性把每个序列转成 (skill 索引 int64, 正误 float32)，避免每步重算。"""
    prepared = []
    for sequence in sequences:
        ids = np.fromiter((skill_index[str(s)] for s in sequence["skill"]), dtype=np.int64,
                          count=len(sequence["skill"]))
        correct = np.asarray(sequence["correct"], dtype=np.float32)
        prepared.append((ids, correct))
    return prepared


def make_buckets(sequences, batch_size):
    """按长度分桶：减少 padding，且分桶结果在 epoch 之间固定。"""
    order = sorted(range(len(sequences)), key=lambda i: len(sequences[i]["correct"]))
    return [order[i:i + batch_size] for i in range(0, len(order), batch_size)]


def dkt_model(n_skills, hidden):
    import torch
    import torch.nn as nn

    class Dkt(nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(input_size=n_skills + 1, hidden_size=hidden, batch_first=True)
            self.out = nn.Linear(hidden, 1)

        def forward(self, x):
            output, _ = self.lstm(x)
            return torch.sigmoid(self.out(output)).squeeze(-1)

    return Dkt()


def _cpu_batch_tensors(prepared, index_list, n_skills):
    """CPU 侧只产出索引/正误/掩码（很小），不产出 one-hot。"""
    import torch

    lengths = [prepared[i][0].shape[0] for i in index_list]
    max_len = max(lengths)
    size = len(index_list)
    idx = torch.zeros((size, max_len), dtype=torch.long)
    correct = torch.zeros((size, max_len), dtype=torch.float32)
    mask = torch.zeros((size, max_len), dtype=torch.float32)
    for row, i in enumerate(index_list):
        ids, corr = prepared[i]
        length = ids.shape[0]
        idx[row, :length] = torch.from_numpy(ids)
        correct[row, :length] = torch.from_numpy(corr)
        mask[row, :length] = 1.0
    return idx, correct, mask


def gpu_batch(prepared, index_list, n_skills, device, reuse=None, non_blocking=False, cache=False):
    """优化实现：one-hot 在 GPU 上生成，CPU→GPU 只传索引。

    cache=True 时对同一批复用已构建的张量（分桶固定 ⇒ 每 epoch 内容相同），
    彻底免掉重复构建；显存开销 = 训练集总量 × (n_skills+1) × 4B。
    """
    import torch

    if cache and reuse is not None:
        return reuse
    idx, correct, mask = _cpu_batch_tensors(prepared, index_list, n_skills)
    if non_blocking:
        idx = idx.pin_memory(); correct = correct.pin_memory(); mask = mask.pin_memory()
    idx = idx.to(device, non_blocking=non_blocking)
    correct = correct.to(device, non_blocking=non_blocking)
    mask = mask.to(device, non_blocking=non_blocking)
    size, max_len = correct.shape
    features = torch.zeros((size, max_len, n_skills + 1), device=device)
    features.scatter_(2, idx.unsqueeze(-1), 1.0)
    if max_len > 1:
        features[:, 1:, n_skills] = correct[:, :-1]
    if cache:
        return features, correct, mask
    return features, correct, mask


# ── DKT 训练／评测 ──────────────────────────────────────────────────────
def run_dkt_ref(sequences, train_index, test_index, epochs, hidden, mode, batch_size, lr=1e-3):
    """参考实现（历史行为，与 run_dkt_batched_dkt.py 早期版本一致）。"""
    import torch
    import torch.nn as nn

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    skill_index, n_skills = make_encoder(sequences)
    torch.manual_seed(H.SEED)
    model = dkt_model(n_skills, hidden).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.BCELoss(reduction="none")

    train_sequences = [sequences[i] for i in train_index]
    if mode == "full":
        if train_sequences:
            features, targets, mask = build_batch(train_sequences, skill_index, n_skills)
            f = torch.from_numpy(features).to(device)
            t = torch.from_numpy(targets).to(device)
            m = torch.from_numpy(mask).to(device)
            for _ in range(epochs):
                optimizer.zero_grad()
                loss = (loss_fn(model(f), t) * m).sum() / m.sum()
                loss.backward()
                optimizer.step()
    else:
        batches = make_buckets(train_sequences, batch_size)
        generator = torch.Generator().manual_seed(H.SEED)
        for _ in range(epochs):
            permutation = torch.randperm(len(batches), generator=generator).tolist()
            for batch_index in permutation:
                selected = [train_sequences[i] for i in batches[batch_index]]
                features, targets, mask = build_batch(selected, skill_index, n_skills)
                f = torch.from_numpy(features).to(device)
                t = torch.from_numpy(targets).to(device)
                m = torch.from_numpy(mask).to(device)
                optimizer.zero_grad()
                loss = (loss_fn(model(f), t) * m).sum() / m.sum()
                loss.backward()
                optimizer.step()

    test_sequences = [sequences[i] for i in test_index]
    if not test_sequences:
        return np.array([]), np.array([])
    model.eval()
    step = batch_size if mode == "batched" else len(test_sequences)
    predictions, targets_all = [], []
    with torch.no_grad():
        order = sorted(range(len(test_sequences)), key=lambda i: len(test_sequences[i]["correct"]))
        for start in range(0, len(order), step):
            selected = [test_sequences[i] for i in order[start:start + step]]
            features, targets, mask = build_batch(selected, skill_index, n_skills)
            prediction = model(torch.from_numpy(features).to(device)).cpu().numpy()
            keep = mask.astype(bool)
            predictions.append(prediction[keep])
            targets_all.append(targets[keep])
    return np.concatenate(targets_all), np.concatenate(predictions)


def run_dkt_fast(sequences, train_index, test_index, epochs, hidden, mode, batch_size,
                 lr=1e-3, use_cache=True, use_amp=False):
    """优化实现：GPU 端 scatter_ 构 one-hot；可选跨 epoch 缓存已构建批次。"""
    import torch
    import torch.nn as nn

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        torch.backends.cudnn.benchmark = True
    skill_index, n_skills = make_encoder(sequences)
    prepared = prepare_sequences(sequences, skill_index)

    torch.manual_seed(H.SEED)
    model = dkt_model(n_skills, hidden).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.BCELoss(reduction="none")

    train_index = list(train_index)
    if mode == "full":
        train_batches = [train_index]
    else:
        train_batches = make_buckets([sequences[i] for i in train_index], batch_size)
        train_batches = [[train_index[i] for i in bucket] for bucket in train_batches]

    batch_cache = [None] * len(train_batches)
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp and device.type == "cuda")
    generator = torch.Generator().manual_seed(H.SEED)
    for _ in range(epochs):
        permutation = torch.randperm(len(train_batches), generator=generator).tolist()
        for batch_index in permutation:
            index_list = train_batches[batch_index]
            if use_cache and batch_cache[batch_index] is not None:
                features, targets, mask = batch_cache[batch_index]
            else:
                features, targets, mask = gpu_batch(prepared, index_list, n_skills, device)
                if use_cache:
                    batch_cache[batch_index] = (features, targets, mask)
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=scaler.is_enabled()):
                prediction = model(features)
                loss = (loss_fn(prediction.float(), targets) * mask).sum() / mask.sum()
            if scaler.is_enabled():
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
            else:
                loss.backward()
                optimizer.step()

    model.eval()
    predictions, targets_all = [], []
    step = batch_size if mode == "batched" else len(test_index)
    order = sorted(test_index, key=lambda i: len(sequences[i]["correct"]))
    with torch.no_grad():
        for start in range(0, len(order), step):
            index_list = order[start:start + step]
            features, targets, mask = gpu_batch(prepared, index_list, n_skills, device)
            prediction = model(features).cpu().numpy()
            keep = mask.cpu().numpy().astype(bool)
            predictions.append(prediction[keep])
            targets_all.append(targets.cpu().numpy()[keep])
    return np.concatenate(targets_all), np.concatenate(predictions)


# ── 统计 ────────────────────────────────────────────────────────────────
def paired(a, b):
    diff = np.asarray(a, dtype=np.float64) - np.asarray(b, dtype=np.float64)
    n = len(diff)
    nulls = np.array([np.mean(diff * np.array(signs)) for signs in itertools.product([-1.0, 1.0], repeat=n)])
    sd = diff.std(ddof=1) if n > 1 else 0.0
    se = sd / math.sqrt(n) if n > 1 else 0.0
    tcrit = {4: 2.776, 3: 3.182, 2: 4.303}.get(n - 1, 1.96)
    return {
        "meanDiff": float(diff.mean()),
        "ci95": [float(diff.mean() - tcrit * se), float(diff.mean() + tcrit * se)],
        "tStatistic": float(diff.mean() / se) if se > 0 else None,
        "degreesOfFreedom": n - 1,
        "foldDeltas": [round(float(x), 6) for x in diff],
        "foldsSameDirection": int(max((diff < 0).sum(), (diff > 0).sum())),
        "permutationsExact": int(2 ** n),
        "permutationPExact": float((np.abs(nulls) >= abs(diff.mean()) - 1e-12).mean()),
        "permutationPMinAchievable": float(2.0 / (2 ** n)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="大规模 KT 评测")
    parser.add_argument("--features", required=True)
    parser.add_argument("--label", default="ednet-kt1-batched")
    parser.add_argument("--dkt-mode", default="batched", choices=["batched", "full"])
    parser.add_argument("--dkt-impl", default="ref", choices=["ref", "fast"])
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--epochs", type=int, default=H.EPOCHS)
    parser.add_argument("--no-cache-batches", action="store_true", help="fast 实现关闭跨 epoch 批次缓存")
    parser.add_argument("--amp", action="store_true", help="fast 实现启用 fp16 混合精度（会改变数值，勿用于校验）")
    parser.add_argument("--hidden", type=int, default=H.HIDDEN)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--skip-dkt", action="store_true")
    parser.add_argument("--skip-grid", action="store_true")
    parser.add_argument("--skip-sensitivity", action="store_true")
    parser.add_argument("--verify-dkt", action="store_true", help="仅在折 0 上对拍 ref/fast 两种实现后退出")
    args = parser.parse_args()

    sequences = H.load_sequences(args.features)
    responses = sum(len(s["correct"]) for s in sequences)
    print(f"students={len(sequences)} responses={responses} dktImpl={args.dkt_impl}", flush=True)

    folds = H.student_folds(sequences)
    fold_indices = [[sequences.index(s) for s in fold] for fold in folds]
    all_indices = list(range(len(sequences)))
    n_folds = len(fold_indices)

    if args.verify_dkt:
        import time
        import torch
        test_index = fold_indices[0]
        train_index = [i for i in all_indices if i not in set(test_index)]
        predictions = {}
        timings = {}
        for impl in ("ref", "fast"):
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            started = time.perf_counter()
            if impl == "ref":
                y_true, y_pred = run_dkt_ref(sequences, train_index, test_index, args.epochs,
                                             args.hidden, args.dkt_mode, args.batch_size, lr=args.lr)
            else:
                y_true, y_pred = run_dkt_fast(sequences, train_index, test_index, args.epochs,
                                              args.hidden, args.dkt_mode, args.batch_size, lr=args.lr,
                                              use_cache=not args.no_cache_batches, use_amp=args.amp)
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            timings[impl] = round(time.perf_counter() - started, 2)
            predictions[impl] = y_pred
            print("  %-5s auc=%.8f  time=%.1fs" % (impl, H.metrics(y_true, y_pred)["auc"], timings[impl]), flush=True)
        diff = float(np.max(np.abs(predictions["ref"] - predictions["fast"])))
        report = {
            "fold": 0, "epochs": args.epochs, "hidden": args.hidden, "batchSize": args.batch_size,
            "lr": args.lr, "cacheBatches": not args.no_cache_batches, "amp": args.amp,
            "maxAbsPredDiff": diff, "identical": bool(diff == 0.0),
            "secondsRef": timings["ref"], "secondsFast": timings["fast"],
            "speedup": round(timings["ref"] / timings["fast"], 2) if timings["fast"] else None,
        }
        print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
        out_dir = os.path.join(BENCH_ROOT, f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-dkt-impl-verify")
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "verify_dkt_impl.json"), "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
        print("outputs:", out_dir, flush=True)
        return

    work_dir = os.path.join(HERE, "work", f"ipc_{args.label}")
    os.makedirs(work_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(BENCH_ROOT, f"{timestamp}-{args.label}")
    os.makedirs(out_dir, exist_ok=True)

    fb_per_user, fb_elapsed = H.run_fb_bkt_sequences(sequences, work_dir=work_dir)
    print(f"fb_bkt rust batch: {fb_elapsed:.2f}s", flush=True)

    dkt_runner = run_dkt_fast if args.dkt_impl == "fast" else run_dkt_ref
    rows = []
    for fold in range(n_folds):
        test_index = fold_indices[fold]
        train_index = [i for i in all_indices if i not in set(test_index)]
        test_sequences = [sequences[i] for i in test_index]

        y_true, y_pred = H.run_standard_bkt(test_sequences)
        rows.append({"fold": fold, "model": "standard_bkt", **H.metrics(y_true, y_pred)})

        y_true, y_pred = H.collect(fb_per_user, test_sequences)
        rows.append({"fold": fold, "model": "fb_bkt", **H.metrics(y_true, y_pred)})

        if not args.skip_dkt:
            import time
            import torch
            started = time.perf_counter()
            if args.dkt_impl == "fast":
                y_true, y_pred = dkt_runner(sequences, train_index, test_index, args.epochs, args.hidden,
                                            args.dkt_mode, args.batch_size, lr=args.lr,
                                            use_cache=not args.no_cache_batches, use_amp=args.amp)
            else:
                y_true, y_pred = dkt_runner(sequences, train_index, test_index, args.epochs, args.hidden,
                                            args.dkt_mode, args.batch_size, lr=args.lr)
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            fold_seconds = time.perf_counter() - started
            rows.append({"fold": fold, "model": "dkt", **H.metrics(y_true, y_pred)})
            print(f"  fold {fold} dkt auc={rows[-1]['auc']:.6f} ({fold_seconds:.1f}s)", flush=True)

    with open(os.path.join(out_dir, "results.csv"), "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["fold", "model", "auc", "acc", "rmse", "n"])
        writer.writeheader()
        writer.writerows(rows)

    summary = {}
    for model in {row["model"] for row in rows}:
        selected = [row for row in rows if row["model"] == model]
        summary[model] = {
            "aucMean": float(np.mean([row["auc"] for row in selected])),
            "aucStd": float(np.std([row["auc"] for row in selected])),
            "accMean": float(np.mean([row["acc"] for row in selected])),
            "rmseMean": float(np.mean([row["rmse"] for row in selected])),
            "folds": len(selected),
        }
    if "fb_bkt" in summary and "standard_bkt" in summary:
        summary["pairedTestFbVsStandard"] = paired(
            [row["auc"] for row in rows if row["model"] == "fb_bkt"],
            [row["auc"] for row in rows if row["model"] == "standard_bkt"])
    if "dkt" in summary and "standard_bkt" in summary:
        summary["pairedTestDktVsStandard"] = paired(
            [row["auc"] for row in rows if row["model"] == "dkt"],
            [row["auc"] for row in rows if row["model"] == "standard_bkt"])

    if not args.skip_grid:
        grid_rows = []
        for lambda_ in H.GRID_LAMBDA:
            for alpha in H.GRID_ALPHA:
                for beta in H.GRID_BETA:
                    params = dict(H.FB_DEFAULT, lambda_=lambda_, alpha=alpha, beta=beta)
                    per_user, _ = H.run_fb_bkt_sequences(sequences, params=params, work_dir=work_dir)
                    fold_aucs = [H.metrics(*H.collect(per_user, [sequences[i] for i in fold_indices[f]]))["auc"]
                                 for f in range(n_folds)]
                    grid_rows.append({"lambda": lambda_, "alpha": alpha, "beta": beta, "aucMean": float(np.mean(fold_aucs))})
        with open(os.path.join(out_dir, "grid_search.csv"), "w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["lambda", "alpha", "beta", "aucMean"])
            writer.writeheader()
            writer.writerows(grid_rows)
        best = max(grid_rows, key=lambda row: row["aucMean"])
        summary["gridSearch"] = {"configs": len(grid_rows), "best": best,
                                 "baselineAuc": summary["standard_bkt"]["aucMean"],
                                 "bestMinusBaseline": float(best["aucMean"] - summary["standard_bkt"]["aucMean"])}

    if not args.skip_sensitivity:
        sensitivity = []
        for scale in H.SENSITIVITY_SCALE:
            per_user, _ = H.run_fb_bkt_sequences(sequences, delta_scale=scale, work_dir=work_dir)
            fold_aucs = [H.metrics(*H.collect(per_user, [sequences[i] for i in fold_indices[f]]))["auc"]
                         for f in range(n_folds)]
            sensitivity.append({"deltaScale": scale, "aucMean": float(np.mean(fold_aucs))})
        with open(os.path.join(out_dir, "sensitivity.csv"), "w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["deltaScale", "aucMean"])
            writer.writeheader()
            writer.writerows(sensitivity)
        summary["deltaCalibrationSensitivity"] = sensitivity

    summary["rustBatchSeconds"] = round(fb_elapsed, 3)
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "script": os.path.basename(__file__),
        "featuresFile": os.path.abspath(args.features),
        "dataSource": f"EdNet-KT1 | features={os.path.basename(args.features)}",
        "students": len(sequences),
        "responses": int(responses),
        "folds": n_folds,
        "seed": H.SEED,
        "params": {
            "bkt": H.BKT_DEFAULT,
            "fbBkt": H.FB_DEFAULT,
            "dkt": {"epochs": args.epochs, "hidden": args.hidden, "lr": args.lr, "mode": args.dkt_mode,
                    "batchSize": args.batch_size, "impl": args.dkt_impl,
                    "batchCache": (not args.no_cache_batches) if args.dkt_impl == "fast" else None,
                    "amp": args.amp if args.dkt_impl == "fast" else None},
        },
        "environment": {"python": sys.version.split()[0], "numpy": np.__version__,
                        "torch": "skipped" if args.skip_dkt else __import__("torch").__version__},
    }
    with open(os.path.join(out_dir, "run_manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)

    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    print("outputs:", out_dir, flush=True)


if __name__ == "__main__":
    sys.exit(main())
