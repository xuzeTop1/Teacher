#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DKT 超参扫描（边界收敛版）。

设计原则（先声明，后执行，避免"过度调参反客为主"）：
  * 只扫 **2 个**维度、各 2–3 个取值，共 6 组：
        hidden ∈ {64, 100, 200}     —— 覆盖 Piech 等 (2015) 200 与本系统参考值 100，
                                        并向小模型方向取 64 检验"模型是否过大"
        lr     ∈ {1e-3, 3e-3}       —— 1e-3 为参考默认；3e-3 为 KT 复现中常见的替代值
  * **固定不扫**：epochs=50、batch=128、seed=42、优化器/损失/编码方式均不变。
    不做早停、不做 dropout/权重衰减调参、不做网络结构搜索。
  * 6 组配置**全部报告**，不筛选不隐藏；标题结论仍取**先验配置**
    （hidden=100, lr=1e-3），best-of-grid 仅作为"上界"证据给出。
  * 对照公平性：FB-BKT 侧在此前评测中已获得 36 组网格搜索，故 DKT 的 6 组
    并不比对方更宽松；本扫描只用于回答"DKT 是否为未调参的弱基线"。

输出：dkt_scan.csv（配置×折）、summary.json（含每组均值/标准差、与标准 BKT 的
配对检验、以及先验配置与上界配置的并列值）。
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BENCH_ROOT = os.path.join(REPO_ROOT, "benchmark-results")
sys.path.insert(0, HERE)

import run_eval as H  # noqa: E402
import run_eval_batched_dkt as B  # noqa: E402

HIDDEN_VALUES = [64, 100, 200]
LR_VALUES = [1e-3, 3e-3]
HEADLINE = (100, 1e-3)


def main() -> None:
    parser = argparse.ArgumentParser(description="DKT 超参扫描（边界收敛）")
    parser.add_argument("--features", required=True)
    parser.add_argument("--label", default="ednet-kt1-dkt-scan")
    parser.add_argument("--epochs", type=int, default=H.EPOCHS)
    parser.add_argument("--batch-size", type=int, default=128)
    args = parser.parse_args()

    sequences = H.load_sequences(args.features)
    folds = H.student_folds(sequences)
    fold_indices = [[sequences.index(s) for s in fold] for fold in folds]
    all_indices = list(range(len(sequences)))
    n_folds = len(fold_indices)
    responses = sum(len(s["correct"]) for s in sequences)
    print(f"students={len(sequences)} responses={responses} folds={n_folds}", flush=True)

    # 标准 BKT 基线（确定性，与其它归档一致）
    baseline = []
    for fold in range(n_folds):
        y_true, y_pred = H.run_standard_bkt([sequences[i] for i in fold_indices[fold]])
        baseline.append(H.metrics(y_true, y_pred)["auc"])
    print("standard_bkt fold auc:", [round(x, 6) for x in baseline], flush=True)

    rows = []
    configs = []
    for hidden in HIDDEN_VALUES:
        for lr in LR_VALUES:
            aucs = []
            started = time.perf_counter()
            for fold in range(n_folds):
                test_index = fold_indices[fold]
                train_index = [i for i in all_indices if i not in set(test_index)]
                y_true, y_pred = B.run_dkt_fast(
                    sequences, train_index, test_index, args.epochs, hidden, "batched",
                    args.batch_size, lr=lr, use_cache=True, use_amp=False)
                metric = H.metrics(y_true, y_pred)
                aucs.append(metric["auc"])
                rows.append({"hidden": hidden, "lr": lr, "fold": fold, **metric})
            elapsed = round(time.perf_counter() - started, 1)
            configs.append({"hidden": hidden, "lr": lr, "aucMean": float(np.mean(aucs)),
                            "aucStd": float(np.std(aucs)), "foldAucs": [round(x, 6) for x in aucs],
                            "seconds": elapsed})
            print("  hidden=%-4d lr=%-6s auc=%.6f ± %.6f (%.0fs)" % (hidden, lr, np.mean(aucs), np.std(aucs), elapsed), flush=True)

    baseline_mean = float(np.mean(baseline))
    for config in configs:
        config["deltaVsStandardBkt"] = round(config["aucMean"] - baseline_mean, 6)
    best = max(configs, key=lambda c: c["aucMean"])
    headline = next(c for c in configs if (c["hidden"], c["lr"]) == HEADLINE)
    paired = B.paired(headline["foldAucs"], baseline)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(BENCH_ROOT, f"{timestamp}-{args.label}")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "dkt_scan.csv"), "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["hidden", "lr", "fold", "auc", "acc", "rmse", "n"])
        writer.writeheader()
        writer.writerows(rows)

    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "featuresFile": os.path.abspath(args.features),
        "students": len(sequences),
        "responses": int(responses),
        "folds": n_folds,
        "seed": H.SEED,
        "declaredGrid": {"hidden": HIDDEN_VALUES, "lr": LR_VALUES, "configs": len(configs),
                         "fixed": {"epochs": args.epochs, "batchSize": args.batch_size, "impl": "fast",
                                   "mode": "batched", "optimizer": "Adam", "loss": "BCELoss(masked)"},
                         "notSwept": ["epochs", "batch", "dropout", "weightDecay", "architecture", "earlyStopping"]},
        "standardBucktFoldAucs": [round(x, 6) for x in baseline],
        "standardBktAucMean": round(baseline_mean, 6),
        "configs": configs,
        "headlineConfig": {"note": "先验配置，用于论文正文引用", **headline, "pairedVsStandardBkt": paired},
        "bestOfGrid": {"note": "仅作为上界证据，不作为正文结论口径", "hidden": best["hidden"], "lr": best["lr"],
                       "aucMean": best["aucMean"], "deltaVsStandardBkt": best["deltaVsStandardBkt"],
                       "deltaVsHeadline": round(best["aucMean"] - headline["aucMean"], 6)},
        "fairnessNote": "FB-BKT 侧已获得 36 组 λ/α/β 网格搜索；本扫描仅 6 组且不扫结构/正则，因此对 DKT 并不更宽松。",
    }
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    print("outputs:", out_dir, flush=True)


if __name__ == "__main__":
    sys.exit(main())
