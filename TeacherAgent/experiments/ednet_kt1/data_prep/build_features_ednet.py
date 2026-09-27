#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""EdNet-KT1 特征构建（向量化版）：产出 run_eval.py 契约的 features parquet。

契约列：user, skill, correct, deltaTDays, rFocus, nDistract, orderId
附加列：gapAnySkillDays, elapsedMs, timestamp, tagCount

知识点定义 --kc-mode：
  first_tag  —— tags 的首个（主口径，与论文已有设定一致）
  single_tag —— **只保留单标签题**，skill = 该唯一标签（剔除多标签歧义）
  part       —— skill = TOEIC part(1..7)，粗粒度对照

Δt 语义：**同一知识点上次作答**的间隔（真实时间戳），符合 fb_bkt.rs 的模型定义。
筛选发生在计算间隔之前，因此剔除行后重新计算的间隔才是正确的。
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
QUESTIONS = os.path.join(HERE, "contents", "questions.csv")
MS_PER_DAY = 86_400_000.0
FEATURE_GAP_SECONDS = 300.0
RFOCUS_CONTINUOUS = 0.85
RFOCUS_INTERRUPTED = 0.35


def load_questions() -> pd.DataFrame:
    q = pd.read_csv(QUESTIONS)
    q = q[["question_id", "correct_answer", "tags", "part"]].copy()
    q["firstTag"] = q["tags"].fillna("").astype(str).apply(lambda s: (s.split(";")[0].strip() or "0"))
    q["tagCount"] = q["tags"].fillna("").astype(str).apply(lambda s: len([t for t in s.split(";") if t.strip()]))
    return q[["question_id", "correct_answer", "firstTag", "tags", "part", "tagCount"]]


def build(raw: pd.DataFrame, questions: pd.DataFrame, kc_mode: str) -> tuple[pd.DataFrame, dict]:
    frame = raw.merge(questions, on="question_id", how="left")
    unmapped = int(frame["correct_answer"].isna().sum())
    frame = frame[frame["correct_answer"].notna()].copy()
    dropped_multi = 0
    if kc_mode == "single_tag":
        before = len(frame)
        frame = frame[frame["tagCount"] == 1].copy()
        dropped_multi = before - len(frame)

    frame["correct"] = (
        frame["user_answer"].astype(str).str.strip() == frame["correct_answer"].astype(str).str.strip()
    ).astype(int)

    if kc_mode == "part":
        frame["skill"] = frame["part"].astype(str)
    elif kc_mode == "single_tag":
        frame["skill"] = frame["tags"].astype(str).str.strip()
    else:
        frame["skill"] = frame["firstTag"].astype(str)

    frame = frame.sort_values(["user_id", "timestamp", "solving_id"]).reset_index(drop=True)

    # 上一条任意作答的间隔（参照量，对应 ASSISTments 原来用的口径）
    prev_any = frame.groupby("user_id", sort=False)["timestamp"].shift(1)
    frame["gapAnySkillDays"] = ((frame["timestamp"] - prev_any) / MS_PER_DAY).fillna(0.0).clip(lower=0.0)
    # 同一知识点上次作答的间隔（模型要求的口径）
    prev_skill = frame.groupby(["user_id", "skill"], sort=False)["timestamp"].shift(1)
    frame["deltaTDays"] = ((frame["timestamp"] - prev_skill) / MS_PER_DAY).fillna(0.0).clip(lower=0.0)
    # 首次作答某知识点时 Δt=0（状态从 P_L0 起，不做衰减）
    frame.loc[prev_skill.isna(), "deltaTDays"] = 0.0

    interrupted = frame["gapAnySkillDays"].to_numpy() * 86_400.0 >= FEATURE_GAP_SECONDS
    frame["rFocus"] = np.where(interrupted, RFOCUS_INTERRUPTED, RFOCUS_CONTINUOUS)
    frame["nDistract"] = interrupted.astype(int)
    frame["orderId"] = frame.groupby("user_id", sort=False).cumcount()

    out = frame[[
        "user_id", "skill", "correct", "deltaTDays", "rFocus", "nDistract", "orderId",
        "gapAnySkillDays", "elapsed_ms", "timestamp", "tagCount",
    ]].rename(columns={"user_id": "user", "elapsed_ms": "elapsedMs"})
    return out, {"unmappedQuestions": unmapped, "droppedMultiTagRows": int(dropped_multi)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", required=True)
    parser.add_argument("--users", type=int, default=20000)
    parser.add_argument("--min-responses", type=int, default=30)
    parser.add_argument("--kc-mode", default="first_tag", choices=["first_tag", "single_tag", "part"])
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()

    raw = pd.read_parquet(args.raw)
    questions = load_questions()
    features, meta = build(raw, questions, args.kc_mode)
    print(f"[{args.kc_mode}] rows after filter={len(features)}", flush=True)

    counts = features.groupby("user").size()
    eligible = counts[counts >= args.min_responses]
    rng = np.random.default_rng(args.seed)
    size = min(args.users, len(eligible))
    chosen = set(rng.choice(eligible.index.to_numpy(), size=size, replace=False).tolist())
    features = features[features["user"].isin(chosen)].reset_index(drop=True)

    same = features["deltaTDays"].to_numpy()
    same_nz = same[same > 0]
    anyg = features["gapAnySkillDays"].to_numpy()
    anyg_nz = anyg[anyg > 0]
    stats = {
        "tag": args.tag,
        "kcMode": args.kc_mode,
        "rawParquet": os.path.abspath(args.raw),
        "students": int(features["user"].nunique()),
        "responses": int(len(features)),
        "skills": int(features["skill"].nunique()),
        "eligibleUsers": int(len(eligible)),
        "samplingSeed": args.seed,
        "minResponsesIfUser": args.min_responses,
        **meta,
        "responsesPerUser": {
            "min": int(features.groupby("user").size().min()),
            "median": float(features.groupby("user").size().median()),
            "max": int(features.groupby("user").size().max()),
        },
        "sameSkillGapDays": {
            "revisitCoverage": float((same > 0).mean()),
            "p50": float(np.percentile(same_nz, 50)), "p75": float(np.percentile(same_nz, 75)),
            "p90": float(np.percentile(same_nz, 90)), "p99": float(np.percentile(same_nz, 99)),
        },
        "sameSkillDecayFactor_lambda0.05": {
            "p50": float(np.exp(-0.05 * np.percentile(same_nz, 50))),
            "p90": float(np.exp(-0.05 * np.percentile(same_nz, 90))),
            "mean": float(np.exp(-0.05 * same_nz).mean()),
        },
        "anySkillGapDays": {"p50": float(np.percentile(anyg_nz, 50)), "p90": float(np.percentile(anyg_nz, 90))},
        "rFocusHistogram": {str(k): int(v) for k, v in features["rFocus"].value_counts().items()},
        "nDistractHistogram": {str(k): int(v) for k, v in features["nDistract"].value_counts().items()},
    }
    os.makedirs(WORK, exist_ok=True)
    out = os.path.join(WORK, f"features_{args.tag}.parquet")
    features.to_parquet(out, index=False)
    with open(os.path.join(WORK, f"features_{args.tag}_stats.json"), "w", encoding="utf-8") as handle:
        json.dump(stats, handle, ensure_ascii=False, indent=2)
    print(json.dumps(stats, ensure_ascii=False, indent=2), flush=True)
    print("features:", out, flush=True)


if __name__ == "__main__":
    sys.exit(main())
