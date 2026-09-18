#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""工作项 D 步骤 3–4：三模型 5 折学生级交叉验证 + 网格搜索 + 归档。

模型：
  * standard_bkt —— 经典四参数 BKT（先观测后验、后学习转移，与 FB-BKT 同序，保证可比）；
  * fb_bkt       —— 论文 §4.3 实现，**通过 Rust 生产代码批量入口调用**（subprocess JSONL IPC，
                    禁止在 Python 侧重写公式）；
  * dkt          —— Piech 等 2015 的单层 LSTM（PyTorch，hidden=100，Adam lr=1e-3，50 epoch）。

用法：
  python run_eval.py --features work/features_assist_200.parquet
  python run_eval.py --features work/features_simulated_pipeline-smoke.parquet --smoke
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC_TAURI = os.path.join(REPO_ROOT, "src-tauri")
BENCH_ROOT = os.path.join(REPO_ROOT, "benchmark-results")

# 论文 §4.3 声明的冷启动参数与网格搜索范围（规格硬约束 5）
BKT_DEFAULT = dict(pL0=0.3, pT=0.1, pG=0.25, pS=0.1, masteryThreshold=0.8)
FB_DEFAULT = dict(**BKT_DEFAULT, lambda_=0.05, alpha=0.5, beta=0.3)
GRID_LAMBDA = [0.02, 0.05, 0.10, 0.20]
GRID_ALPHA = [0.25, 0.5, 0.75]
GRID_BETA = [0.1, 0.3, 0.5]
SENSITIVITY_SCALE = [0.5, 1.0, 2.0]  # Δt 标定系数稳健性检查
EPOCHS = 50
HIDDEN = 100
SEED = 42


# ── 数据 ────────────────────────────────────────────────────────────────
def load_sequences(path: str):
    import pandas as pd

    frame = pd.read_parquet(path)
    # 原始 2009-2010 数据没有绝对时间戳，时序由 orderId 定义（见 pipeline.py 的 Δt 代理说明）。
    frame = frame.sort_values(["user", "orderId"]).reset_index(drop=True)
    sequences = []
    for user, group in frame.groupby("user", sort=False):
        sequences.append(
            {
                "user": user,
                "skill": group["skill"].to_numpy(),
                "correct": group["correct"].to_numpy(dtype=np.float64),
                "deltaTDays": group["deltaTDays"].to_numpy(dtype=np.float64),
                "rFocus": group["rFocus"].to_numpy(dtype=np.float64),
                "nDistract": group["nDistract"].to_numpy(dtype=np.int64),
                "orderId": group["orderId"].to_numpy(dtype=np.float64),
            }
        )
    return sequences


def student_folds(sequences, k: int = 5, seed: int = SEED):
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(sequences))
    folds = [[] for _ in range(k)]
    for index, position in enumerate(order):
        folds[index % k].append(sequences[position])
    return folds


# ── 指标 ────────────────────────────────────────────────────────────────
def auc(y_true: np.ndarray, y_score: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=np.float64)
    y_score = np.asarray(y_score, dtype=np.float64)
    positives = y_true.sum()
    negatives = len(y_true) - positives
    if positives == 0 or negatives == 0:
        return float("nan")
    order = np.argsort(y_score, kind="mergesort")
    ranks = np.empty(len(y_score), dtype=np.float64)
    ranks[order] = np.arange(1, len(y_score) + 1)
    # 处理并列分数
    _, inverse, counts = np.unique(y_score, return_inverse=True, return_counts=True)
    for group, count in enumerate(counts):
        if count > 1:
            ranks[inverse == group] = ranks[inverse == group].mean()
    return float((ranks[y_true == 1].sum() - positives * (positives + 1) / 2) / (positives * negatives))


def metrics(y_true, y_pred) -> dict:
    y_true = np.asarray(y_true, dtype=np.float64)
    y_pred = np.asarray(y_pred, dtype=np.float64)
    return {
        "auc": auc(y_true, y_pred),
        "acc": float(((y_pred >= 0.5).astype(int) == y_true.astype(int)).mean()),
        "rmse": float(np.sqrt(((y_pred - y_true) ** 2).mean())),
        "n": int(len(y_true)),
    }


def paired_permutation_test(left: list[float], right: list[float], permutations: int = 10000) -> dict:
    """配对置换检验：H0 = 两组每折差异均值为 0（不依赖 scipy）。"""
    diff = np.asarray(left, dtype=np.float64) - np.asarray(right, dtype=np.float64)
    observed = diff.mean()
    rng = np.random.default_rng(SEED)
    signs = rng.choice([-1.0, 1.0], size=(permutations, len(diff)))
    null = (signs * diff).mean(axis=1)
    p_value = float((np.abs(null) >= abs(observed)).mean())
    return {"meanDiff": float(observed), "pValue": p_value, "permutations": permutations, "folds": len(diff)}


# ── 模型 ────────────────────────────────────────────────────────────────
def run_standard_bkt(sequences, params=BKT_DEFAULT):
    y_true, y_pred = [], []
    for sequence in sequences:
        state = {}
        for skill, correct in zip(sequence["skill"], sequence["correct"]):
            previous = state.get(skill, params["pL0"])
            p_correct = previous * (1 - params["pS"]) + (1 - previous) * params["pG"]
            y_true.append(correct)
            y_pred.append(p_correct)
            post = (
                previous * (1 - params["pS"]) / p_correct
                if correct > 0
                else previous * params["pS"] / max(1e-12, 1 - p_correct)
            )
            state[skill] = post + (1 - post) * params["pT"]
    return np.array(y_true), np.array(y_pred)


def run_fb_bkt_sequences(sequences, params=None, delta_scale: float = 1.0, work_dir: str | None = None):
    """调用 Rust 生产实现（序列模式）：一次 IPC 评估全部序列，返回 {user: (y_true, y_pred)}。"""
    params = params or FB_DEFAULT
    work_dir = work_dir or os.path.join(HERE, "work")
    os.makedirs(work_dir, exist_ok=True)
    in_path = os.path.join(work_dir, "_fb_bkt_eval_in.jsonl")
    out_path = os.path.join(work_dir, "_fb_bkt_eval_out.jsonl")

    with open(in_path, "w", encoding="utf-8") as handle:
        for sequence in sequences:
            steps = [
                {
                    "skill": str(skill),
                    "obs": bool(correct > 0),
                    "deltaTDays": float(delta) * delta_scale,
                    "rFocus": float(rfocus),
                    "nDistract": int(ndistract),
                }
                for skill, correct, delta, rfocus, ndistract in zip(
                    sequence["skill"], sequence["correct"], sequence["deltaTDays"],
                    sequence["rFocus"], sequence["nDistract"],
                )
            ]
            handle.write(json.dumps({
                "params": {
                    "pL0": params["pL0"], "pT": params["pT"], "pG": params["pG"], "pS": params["pS"],
                    "lambda": params["lambda_"], "alpha": params["alpha"], "beta": params["beta"],
                    "masteryThreshold": params["masteryThreshold"],
                },
                "steps": steps,
            }) + "\n")

    env = dict(os.environ, FB_BKT_EVAL_IN=in_path, FB_BKT_EVAL_OUT=out_path)
    started = time.perf_counter()
    completed = subprocess.run(
        ["cargo", "test", "--release", "batch_evaluate_fb_bkt", "--", "--ignored", "--nocapture"],
        cwd=SRC_TAURI, env=env, capture_output=True, text=True,
    )
    elapsed = time.perf_counter() - started
    if completed.returncode != 0:
        raise SystemExit(f"Rust FB-BKT 批量评测失败：\n{completed.stdout[-2000:]}\n{completed.stderr[-2000:]}")

    results = [json.loads(line) for line in open(out_path, encoding="utf-8") if line.strip()]
    if len(results) != len(sequences):
        raise SystemExit(f"Rust 返回序列数 {len(results)} 与请求 {len(sequences)} 不一致")

    per_user = {}
    for sequence, result in zip(sequences, results):
        predictions = result["pPred"]
        if len(predictions) != len(sequence["correct"]):
            raise SystemExit(f"序列长度不一致: {sequence['user']}")
        per_user[sequence["user"]] = (
            np.asarray(sequence["correct"], dtype=np.float64),
            np.asarray(predictions, dtype=np.float64),
        )
    return per_user, elapsed


def collect(per_user, sequences):
    y_true, y_pred = [], []
    for sequence in sequences:
        truth, prediction = per_user[sequence["user"]]
        y_true.extend(truth.tolist())
        y_pred.extend(prediction.tolist())
    return np.array(y_true), np.array(y_pred)


def run_dkt(sequences, train_index, test_index, epochs=EPOCHS, hidden=HIDDEN):
    """DKT 基线（Piech 等 2015）：单层 LSTM，批处理 + padding/mask 训练。

    批处理让 GPU 真正参与（逐序列前向在 8G 显存上几乎全是 kernel 启动开销）。
    """
    import torch
    import torch.nn as nn

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    torch.manual_seed(SEED)
    skills = sorted({str(skill) for sequence in sequences for skill in sequence["skill"]})
    skill_index = {skill: index for index, skill in enumerate(skills)}
    n_skills = len(skills)

    def to_batch(selected):
        if not selected:
            return None
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
        return (
            torch.from_numpy(features).to(device),
            torch.from_numpy(targets).to(device),
            torch.from_numpy(mask).to(device),
        )

    class Dkt(nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(input_size=n_skills + 1, hidden_size=hidden, batch_first=True)
            self.out = nn.Linear(hidden, 1)

        def forward(self, x):
            output, _ = self.lstm(x)
            return torch.sigmoid(self.out(output)).squeeze(-1)

    torch.manual_seed(SEED)
    model = Dkt().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.BCELoss(reduction="none")

    train_batch = to_batch([sequences[i] for i in train_index])
    if train_batch is not None:
        features, targets, mask = train_batch
        for _ in range(epochs):
            optimizer.zero_grad()
            prediction = model(features)
            loss = (loss_fn(prediction, targets) * mask).sum() / mask.sum()
            loss.backward()
            optimizer.step()

    test_batch = to_batch([sequences[i] for i in test_index])
    if test_batch is None:
        return np.array([]), np.array([])
    features, targets, mask = test_batch
    model.eval()
    with torch.no_grad():
        prediction = model(features).cpu().numpy()
    keep = mask.cpu().numpy().astype(bool)
    return targets.cpu().numpy()[keep], prediction[keep]


def main() -> None:
    parser = argparse.ArgumentParser(description="FB-BKT 预测精度评测")
    parser.add_argument("--features", required=True)
    parser.add_argument("--smoke", action="store_true", help="管道自检：仅跑 1 折、少量 epoch、无网格搜索")
    parser.add_argument("--skip-dkt", action="store_true")
    parser.add_argument("--label", default="fb-bkt-ednet-kt1", help="归档目录后缀，用于区分队列/知识点口径")
    args = parser.parse_args()

    sequences = load_sequences(args.features)
    folds = student_folds(sequences)
    fold_indices = [[sequences.index(sequence) for sequence in fold] for fold in folds]
    all_indices = list(range(len(sequences)))

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = "-pipeline-smoke" if args.smoke else ""
    out_dir = os.path.join(BENCH_ROOT, f"{timestamp}-{args.label}{suffix}")
    os.makedirs(out_dir, exist_ok=True)

    epochs = 3 if args.smoke else EPOCHS
    fold_count = 1 if args.smoke else len(fold_indices)
    rows, fb_times = [], []

    # FB-BKT 逐序列独立推进状态，与折划分无关：一次 IPC 评估全量序列后按折切片。
    fb_per_user, fb_elapsed = run_fb_bkt_sequences(sequences)
    fb_times.append(fb_elapsed)

    for fold in range(fold_count):
        test_index = fold_indices[fold]
        train_index = [index for index in all_indices if index not in set(test_index)]
        test_sequences = [sequences[i] for i in test_index]

        y_true, y_pred = run_standard_bkt(test_sequences)
        rows.append({"fold": fold, "model": "standard_bkt", **metrics(y_true, y_pred)})

        y_true, y_pred = collect(fb_per_user, test_sequences)
        rows.append({"fold": fold, "model": "fb_bkt", **metrics(y_true, y_pred)})

        if not args.skip_dkt:
            y_true, y_pred = run_dkt(sequences, train_index, test_index, epochs=epochs)
            rows.append({"fold": fold, "model": "dkt", **metrics(y_true, y_pred)})

    import csv

    results_path = os.path.join(out_dir, "results.csv")
    with open(results_path, "w", encoding="utf-8-sig", newline="") as handle:
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
    if "standard_bkt" in summary and "fb_bkt" in summary and fold_count > 1:
        summary["pairedTestFbVsStandard"] = paired_permutation_test(
            [row["auc"] for row in rows if row["model"] == "fb_bkt"],
            [row["auc"] for row in rows if row["model"] == "standard_bkt"],
        )

    # 网格搜索（λ/α/β 共 36 组）；smoke 模式跳过
    if not args.smoke:
        grid_rows = []
        for lambda_ in GRID_LAMBDA:
            for alpha in GRID_ALPHA:
                for beta in GRID_BETA:
                    params = dict(FB_DEFAULT, lambda_=lambda_, alpha=alpha, beta=beta)
                    per_user, _ = run_fb_bkt_sequences(sequences, params=params)
                    fold_aucs = [
                        metrics(*collect(per_user, [sequences[i] for i in fold_indices[fold]]))["auc"]
                        for fold in range(fold_count)
                    ]
                    grid_rows.append({
                        "lambda": lambda_, "alpha": alpha, "beta": beta,
                        "aucMean": float(np.mean(fold_aucs)),
                    })
        with open(os.path.join(out_dir, "grid_search.csv"), "w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["lambda", "alpha", "beta", "aucMean"])
            writer.writeheader()
            writer.writerows(grid_rows)
        summary["gridSearch"] = {
            "configs": len(grid_rows),
            "best": max(grid_rows, key=lambda row: row["aucMean"]) if grid_rows else None,
        }

    # Δt 标定系数敏感性：×0.5 / ×1 / ×2（数据集无绝对时间戳，Δt 由 order_id 代理）
    if not args.smoke:
        sensitivity = []
        for scale in SENSITIVITY_SCALE:
            per_user, _ = run_fb_bkt_sequences(sequences, delta_scale=scale)
            fold_aucs = [
                metrics(*collect(per_user, [sequences[i] for i in fold_indices[fold]]))["auc"]
                for fold in range(fold_count)
            ]
            sensitivity.append({"deltaScale": scale, "aucMean": float(np.mean(fold_aucs))})
        with open(os.path.join(out_dir, "sensitivity.csv"), "w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["deltaScale", "aucMean"])
            writer.writeheader()
            writer.writerows(sensitivity)
        summary["deltaCalibrationSensitivity"] = sensitivity

    summary["rustBatchSecondsPerFold"] = [round(value, 3) for value in fb_times]
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "featuresFile": os.path.abspath(args.features),
        "students": len(sequences),
        "responses": int(sum(len(sequence["correct"]) for sequence in sequences)),
        "folds": fold_count,
        "seed": SEED,
        "smoke": args.smoke,
        "params": {"bkt": BKT_DEFAULT, "fbBkt": FB_DEFAULT, "dkt": {"epochs": epochs, "hidden": HIDDEN, "lr": 1e-3}},
        "environment": {
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "torch": __import__("torch").__version__ if not args.skip_dkt else "skipped",
        },
        "dataSource": "SIMULATED (pipeline smoke)" if args.smoke else f"EdNet-KT1 | features={os.path.basename(args.features)} | real timestamps, same-skill Delta-t",
    }
    with open(os.path.join(out_dir, "run_manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("outputs:", out_dir)


if __name__ == "__main__":
    sys.exit(main())
