#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""工作项 D 步骤 1–2：ASSISTments 2009-2010 稀疏子集准备与端侧特征合成。

用法（真实数据）：
  python pipeline.py prepare  --raw raw/skill_builder_data.csv
  python pipeline.py features --subset work/sparse_assist_200.parquet

用法（管道自检，**不是论文数据**）：
  python pipeline.py smoke

数据事实（2026-09-10 实测 `skill_builder_data.csv`，525,534 行 / 4,217 生 / 123 技能）：
  * **数据集不含绝对时间戳**：`first_action` 取值仅 0–2（非时间），`ms_first_response` /
    `overlap_time` 是每题耗时（中位 20.8 s / 25.7 s）。唯一的时间信号是全局递增的
    `order_id`（20,224,085 → 38,310,202）。
  * 因此 Δt 由 **`order_id` 增量 × 标定系数** 推算；标定系数取 1.31 s/单位，
    推导：order_id 跨度 18,086,117 单位覆盖 2009-09→2010-06 约 275 个自然日
    （≈23.76M 秒）。`SENSITIVITY` 给出 ±2 倍系数的敏感性检查。
  * 官方页面提示原始文件含重复记录，已指向修正版；本脚本对 (user_id, order_id)
    去重（实测原文件 34.0% 行为重复），并在 meta 中记录去重计数。
  * rFocus / N_distract 按规格 D.1 规则由间隔合成（≥5 分钟视为一次中断）——
    这是**可复现的行为代理**，不是真实端侧观测；论文中必须如此表述。

引用要求（官方原文）：使用该数据集须在论文中给出精确 URL
  https://sites.google.com/site/assistmentsdata/home/2009-2010-assistment-data/skill-builder-data-2009-2010
  并引用 Feng, M., Heffernan, N.T., & Koedinger, K.R. (2009). Addressing the assessment
  challenge in an Intelligent Tutoring System that tutors as it assesses. UMUAI, 19, 243-266.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(HERE, "work")
RAW_DIR = os.path.join(HERE, "raw")

MIN_RESPONSES = 30
MAX_RESPONSES = 80
TARGET_STUDENTS = 200
FEATURE_GAP_MINUTES = 5.0
RFOCUS_CONTINUOUS = 0.85
RFOCUS_INTERRUPTED = 0.35

# order_id → 秒 的标定系数（见文件头推导）；SENSITIVITY 用于稳健性检查
SECONDS_PER_ORDER_UNIT = 1.31
SENSITIVITY = [0.655, 1.31, 2.62]

CITATION = {
    "datasetId": "ASSISTments 2009-2010 Skill Builder",
    "requiredUrl": "https://sites.google.com/site/assistmentsdata/home/2009-2010-assistment-data/skill-builder-data-2009-2010",
    "requiredCitation": "Feng, M., Heffernan, N.T., & Koedinger, K.R. (2009). Addressing the assessment challenge in an Intelligent Tutoring System that tutors as it assesses. User Modeling and User-Adapted Interaction, 19, 243-266.",
    "dktReference": "Piech, C., Bassen, J., Huang, J., et al. (2015). Deep Knowledge Tracing. NeurIPS 28, 505-513.",
}


def _pick(columns, candidates, required=True, what=""):
    lowered = {c.lower(): c for c in columns}
    for name in candidates:
        if name.lower() in lowered:
            return lowered[name.lower()]
    if required:
        raise SystemExit(f"缺少必需列 {what or candidates}；实际列：{sorted(columns)}")
    return None


def read_csv_any_encoding(path: str) -> pd.DataFrame:
    """官方 CSV 是 latin-1 编码（实测 UTF-8 解码在约 98 KB 处失败）。"""
    for encoding in ("utf-8", "latin-1"):
        try:
            return pd.read_csv(path, encoding=encoding, low_memory=False)
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"无法解码 {path}")


def load_raw(path: str) -> tuple[pd.DataFrame, dict]:
    """载入原始 CSV → 归一化长表；去重、丢弃非法时长行，并记录全部处理计数。"""
    frame = read_csv_any_encoding(path)
    user = _pick(frame.columns, ["user_id", "userid", "student_id", "user"], what="user_id")
    skill = _pick(frame.columns, ["skill_id", "skill", "skill_name", "kc_id", "kc"], what="skill")
    correct = _pick(frame.columns, ["correct", "is_correct", "score"], what="correct")
    order = _pick(frame.columns, ["order_id", "sequence_id", "row_id"], what="order_id")
    original = _pick(frame.columns, ["original", "is_original"], required=False)
    duration = _pick(frame.columns, ["overlap_time", "ms_first_response"], required=False)
    timestamp = _pick(frame.columns, ["start_time", "timestamp", "action_time"], required=False)

    keep = [c for c in [user, skill, correct, order, original, duration, timestamp] if c]
    frame = frame[keep].copy()
    rename = {user: "user", skill: "skill", correct: "correct", order: "orderId"}
    if original:
        rename[original] = "original"
    if duration:
        rename[duration] = "durationMs"
    if timestamp:
        rename[timestamp] = "timestamp"
    frame = frame.rename(columns=rename)

    counts = {"rawRows": int(len(frame))}
    if "original" in frame.columns:
        before = len(frame)
        frame = frame[frame["original"].fillna(1).astype(float) != 0]
        counts["droppedNonOriginal"] = int(before - len(frame))
    if "durationMs" in frame.columns:
        before = len(frame)
        frame = frame[pd.to_numeric(frame["durationMs"], errors="coerce").fillna(0) >= 0]
        counts["droppedNegativeDuration"] = int(before - len(frame))
    before = len(frame)
    frame = frame.drop_duplicates(subset=["user", "orderId"])
    counts["droppedDuplicateUserOrder"] = int(before - len(frame))
    counts["keptRows"] = int(len(frame))

    frame["correct"] = (pd.to_numeric(frame["correct"], errors="coerce") > 0).astype(int)
    frame["orderId"] = pd.to_numeric(frame["orderId"], errors="coerce")
    frame = frame.dropna(subset=["user", "skill", "correct", "orderId"])
    frame = frame.sort_values(["user", "orderId"]).reset_index(drop=True)
    frame["skill"] = frame["skill"].astype(str)
    counts["timeSource"] = "absolute_timestamp" if "timestamp" in frame.columns else "order_id_proxy"
    counts["secondsPerOrderUnit"] = SECONDS_PER_ORDER_UNIT
    return frame, counts


def select_sparse(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    counts = frame.groupby("user").size()
    eligible = counts[(counts >= MIN_RESPONSES) & (counts <= MAX_RESPONSES)]
    rng = np.random.default_rng(42)
    size = min(TARGET_STUDENTS, len(eligible))
    chosen = sorted(rng.choice(eligible.index.to_numpy(), size=size, replace=False))
    subset = frame[frame["user"].isin(chosen)].reset_index(drop=True)
    meta = {
        "filterRule": f"每名学生作答数 ∈ [{MIN_RESPONSES}, {MAX_RESPONSES}]",
        "targetStudents": TARGET_STUDENTS,
        "eligibleStudents": int(len(eligible)),
        "selectedStudents": int(len(chosen)),
        "totalResponses": int(len(subset)),
        "totalSkills": int(subset["skill"].nunique()),
        "medianSkillsPerStudent": int(subset.groupby("user")["skill"].nunique().median()),
        "samplingSeed": 42,
        "responsesPerStudent": {
            "min": int(subset.groupby("user").size().min()),
            "max": int(subset.groupby("user").size().max()),
            "mean": float(subset.groupby("user").size().mean()),
        },
    }
    return subset, meta


def synthesize_features(subset: pd.DataFrame, seconds_per_unit: float = SECONDS_PER_ORDER_UNIT) -> pd.DataFrame:
    """由作答间隔合成 Δt / R_focus / N_distract（规格 D.1 规则，间隔来自 order_id 代理）。"""
    rows = []
    for user, group in subset.groupby("user", sort=False):
        group = group.sort_values("orderId")
        previous_order = None
        if "timestamp" in group.columns:
            previous_seconds = None
        for row in group.itertuples(index=False):
            order_value = float(row.orderId)
            if "timestamp" in group.columns:
                current_seconds = float(getattr(row, "timestamp")) / 1000.0
                gap_seconds = 0.0 if previous_seconds is None else max(0.0, current_seconds - previous_seconds)
                previous_seconds = current_seconds
            else:
                gap_seconds = 0.0 if previous_order is None else max(0.0, (order_value - previous_order) * seconds_per_unit)
            previous_order = order_value

            interrupted = previous_order is not None and gap_seconds >= FEATURE_GAP_MINUTES * 60.0
            rows.append(
                {
                    "user": row.user,
                    "skill": row.skill,
                    "correct": int(row.correct),
                    "orderId": order_value,
                    "gapSeconds": gap_seconds,
                    "deltaTDays": gap_seconds / 86_400.0,
                    "rFocus": RFOCUS_INTERRUPTED if interrupted else RFOCUS_CONTINUOUS,
                    "nDistract": 1 if interrupted else 0,
                }
            )
    return pd.DataFrame(rows)


def simulate_dataset(students: int = 200, responses_per_student: int = 50, skills: int = 20, seed: int = 7):
    """管道自检用的合成作答序列（非论文数据）。"""
    rng = np.random.default_rng(seed)
    rows = []
    order = 20_000_000
    for user in range(students):
        mastery = rng.uniform(0.1, 0.6, size=skills)
        for _ in range(responses_per_student):
            skill = int(rng.integers(0, skills))
            learned = mastery[skill]
            correct = int(rng.random() < min(0.97, learned + 0.25))
            mastery[skill] = min(0.97, learned + (0.06 if correct else 0.01))
            order += int(rng.choice([20, 40, 700, 1400]))
            rows.append({"user": f"sim-{user}", "skill": f"skill-{skill}", "correct": correct, "orderId": order})
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="ASSISTments 稀疏子集与端侧特征合成")
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare", help="从原始 CSV 抽出稀疏子集")
    prepare.add_argument("--raw", required=True)
    features = sub.add_parser("features", help="由作答间隔合成 FB-BKT 输入特征")
    features.add_argument("--subset", required=True)
    sub.add_parser("smoke", help="合成数据跑通全链路（非论文数据）")
    args = parser.parse_args()

    os.makedirs(WORK_DIR, exist_ok=True)

    if args.command == "smoke":
        frame = simulate_dataset()
        subset, meta = select_sparse(frame)
        meta.update({"dataSource": "SIMULATED — pipeline self-test only, NOT paper data"})
        subset.to_parquet(os.path.join(WORK_DIR, "sparse_simulated_pipeline-smoke.parquet"), index=False)
        enriched = synthesize_features(subset)
        enriched.to_parquet(os.path.join(WORK_DIR, "features_simulated_pipeline-smoke.parquet"), index=False)
        with open(os.path.join(WORK_DIR, "sparse_simulated_pipeline-smoke_meta.json"), "w", encoding="utf-8") as handle:
            json.dump(meta, handle, ensure_ascii=False, indent=2)
        print(json.dumps(meta, ensure_ascii=False, indent=2))
        return

    if args.command == "prepare":
        frame, processing = load_raw(args.raw)
        subset, meta = select_sparse(frame)
        meta.update(processing)
        meta.update({
            "rawFile": os.path.basename(args.raw),
            "dataSource": "ASSISTments 2009-2010 Skill Builder (official release)",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "citation": CITATION,
        })
        subset_path = os.path.join(WORK_DIR, "sparse_assist_200.parquet")
        subset.to_parquet(subset_path, index=False)
        with open(os.path.join(WORK_DIR, "sparse_assist_200_meta.json"), "w", encoding="utf-8") as handle:
            json.dump(meta, handle, ensure_ascii=False, indent=2)
        print(json.dumps(meta, ensure_ascii=False, indent=2))
        print("subset:", subset_path)
        return

    subset = pd.read_parquet(args.subset)
    enriched = synthesize_features(subset)
    enriched.to_parquet(os.path.join(WORK_DIR, "features_assist_200.parquet"), index=False)
    gaps = enriched["gapSeconds"]
    distribution = {
        "rows": int(len(enriched)),
        "gapSecondsQuantiles": {str(q): float(gaps.quantile(q)) for q in (0.25, 0.5, 0.75, 0.9, 0.99)},
        "gapOver5MinShare": float((gaps >= FEATURE_GAP_MINUTES * 60.0).mean()),
        "rFocusHistogram": {str(k): int(v) for k, v in enriched["rFocus"].value_counts().items()},
        "nDistractHistogram": {str(k): int(v) for k, v in enriched["nDistract"].value_counts().items()},
        "deltaTDaysQuantiles": {str(q): float(enriched["deltaTDays"].quantile(q)) for q in (0.5, 0.9, 0.99)},
        "timeSource": "order_id proxy × %.3f s/unit" % SECONDS_PER_ORDER_UNIT,
        "sensitivityCoefficients": SENSITIVITY,
    }
    with open(os.path.join(WORK_DIR, "feature_distribution.json"), "w", encoding="utf-8") as handle:
        json.dump(distribution, handle, ensure_ascii=False, indent=2)
    print(json.dumps(distribution, ensure_ascii=False, indent=2))
    print("features:", os.path.join(WORK_DIR, "features_assist_200.parquet"))


if __name__ == "__main__":
    sys.exit(main())
