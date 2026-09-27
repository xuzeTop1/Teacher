#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FB-BKT 消融 + 极限验证。

目的：
  1) 极限验证：λ=0 且 α=0 时，FB-BKT 必须**逐点精确复现** standard BKT（管线正确性证据）；
  2) 分离消融：只开遗忘衰减（α=0）／只开专注调节（λ=0）／两者全开，
     定位性能损害的来源；
  3) 在 EdNet-KT1 与 ASSISTments 两个数据集上同协议对照，
     验证「机制在 ASSISTments 上数值惰性、在 EdNet 上真实有害」的结论。

复用 run_eval.py 的 load_sequences / student_folds / run_standard_bkt /
run_fb_bkt_sequences / collect / metrics，协议完全一致，不重写任何公式。
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BENCH_ROOT = os.path.join(REPO_ROOT, "benchmark-results")
sys.path.insert(0, HERE)

import run_eval as H  # noqa: E402

CONFIGS = [
    # (名称, 说明, params)
    ("standard_bkt", "经典四参数 BKT（基线）", None),
    ("fb_none", "λ=0, α=0 —— 极限验证，应与基线逐点一致", dict(H.FB_DEFAULT, lambda_=0.0, alpha=0.0)),
    ("fb_decay_only", "只开遗忘衰减（α=0）", dict(H.FB_DEFAULT, alpha=0.0)),
    ("fb_focus_only", "只开专注调节（λ=0）", dict(H.FB_DEFAULT, lambda_=0.0)),
    ("fb_full", "两者全开（论文默认 λ=0.05, α=0.5, β=0.3）", dict(H.FB_DEFAULT)),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, help="数据集标签，用于归档命名")
    parser.add_argument("--features", required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()

    sequences = H.load_sequences(args.features)
    folds = H.student_folds(sequences)
    fold_indices = [[sequences.index(s) for s in fold] for fold in folds]
    n_folds = len(fold_indices)
    print(f"[{args.tag}] students={len(sequences)} responses={sum(len(s['correct']) for s in sequences)} folds={n_folds}", flush=True)

    rows = []
    equality = {}
    baseline_pred = None

    for name, note, params in CONFIGS:
        if params is None:
            per_fold = []
            for fold in range(n_folds):
                test_sequences = [sequences[i] for i in fold_indices[fold]]
                y_true, y_pred = H.run_standard_bkt(test_sequences)
                per_fold.append((y_true, y_pred))
        else:
            per_user, elapsed = H.run_fb_bkt_sequences(sequences, params=params)
            print(f"  {name}: rust batch {elapsed:.2f}s", flush=True)
            per_fold = [H.collect(per_user, [sequences[i] for i in fold_indices[fold]]) for fold in range(n_folds)]

        if name == "standard_bkt":
            baseline_pred = per_fold
        if name == "fb_none" and baseline_pred is not None:
            diffs = [float(np.max(np.abs(a[1] - b[1]))) for a, b in zip(per_fold, baseline_pred)]
            equality = {
                "maxAbsDiffPerFold": diffs,
                "maxAbsDiffOverall": max(diffs),
                "bitwiseIdentical": bool(max(diffs) == 0.0),
            }

        aucs = []
        for fold, (y_true, y_pred) in enumerate(per_fold):
            m = H.metrics(y_true, y_pred)
            aucs.append(m["auc"])
            rows.append({"tag": args.tag, "config": name, "fold": fold, "auc": m["auc"], "acc": m["acc"], "rmse": m["rmse"], "n": m["n"]})
        print("  %-16s AUC %.6f ± %.6f" % (name, float(np.mean(aucs)), float(np.std(aucs))), flush=True)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(BENCH_ROOT, f"{timestamp}-fb-bkt-{args.tag}-ablation")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "ablation.csv"), "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["tag", "config", "fold", "auc", "acc", "rmse", "n"])
        writer.writeheader()
        writer.writerows(rows)

    summary = {"tag": args.tag, "features": os.path.abspath(args.features), "students": len(sequences), "folds": n_folds}
    for name, note, _ in CONFIGS:
        sel = [r for r in rows if r["config"] == name]
        summary[name] = {
            "note": note,
            "aucMean": float(np.mean([r["auc"] for r in sel])),
            "aucStd": float(np.std([r["auc"] for r in sel])),
            "accMean": float(np.mean([r["acc"] for r in sel])),
            "rmseMean": float(np.mean([r["rmse"] for r in sel])),
        }
    base = [r["auc"] for r in rows if r["config"] == "standard_bkt"]
    for name, _, _ in CONFIGS:
        if name == "standard_bkt":
            continue
        sel = [r["auc"] for r in rows if r["config"] == name]
        summary[name]["deltaVsBaseline"] = float(np.mean(sel) - np.mean(base))
        summary[name]["foldWiseDelta"] = [round(a - b, 6) for a, b in zip(sel, base)]
    summary["equalityCheck"] = equality
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    print("outputs:", out_dir, flush=True)


if __name__ == "__main__":
    sys.exit(main())
