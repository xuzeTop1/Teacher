#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""EdNet-KT1 全量画像：只读 zip，不解压。

产出：
  * kt1_user_summary.csv  —— 每用户一行（作答数、时间跨度、题数、间隔统计）
  * kt1_dataset_stats.json —— 数据集级统计（含真实 Δt 天数分布、候选子集规模）
"""
import io
import json
import os
import sys
import time
import zipfile
from datetime import datetime, timezone

import numpy as np

# EdNet-KT1 原始压缩包路径。按需通过环境变量 EDNET_KT1_ZIP 覆盖。
ZIP = os.environ.get("EDNET_KT1_ZIP", os.path.join(os.path.expanduser("~"), "Downloads", "EdNet-KT1.zip"))
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
SUMMARY = os.path.join(OUT_DIR, "kt1_user_summary.csv")
STATS = os.path.join(OUT_DIR, "kt1_dataset_stats.json")

MS_PER_DAY = 86_400_000.0


def main() -> None:
    started = time.perf_counter()
    z = zipfile.ZipFile(ZIP)
    names = [n for n in z.namelist() if n.endswith(".csv")]
    total = len(names)
    print(f"users={total}", flush=True)

    all_gap_days = []
    n_users = 0
    n_rows = 0
    spans_days = []
    counts = []
    subset_hits = {"30-80": 0, "30-200": 0, "30-500": 0, ">=30": 0, ">=100": 0}
    eligible_names = []
    per_user_rows = []

    for index, name in enumerate(names):
        user_id = os.path.basename(name)[:-4]
        with z.open(name) as handle:
            text = io.TextIOWrapper(handle, encoding="utf-8")
            header = text.readline()
            timestamps = []
            questions = set()
            elapsed = []
            last_ts = None
            prev_ts = None
            for line in text:
                if not line or line[0] == "\n":
                    continue
                parts = line.rstrip("\n").split(",")
                if len(parts) < 5:
                    continue
                try:
                    ts = int(parts[0])
                except ValueError:
                    continue
                timestamps.append(ts)
                questions.add(parts[2])
                try:
                    el = int(parts[4])
                    if el >= 0:
                        elapsed.append(el)
                except ValueError:
                    pass
                if prev_ts is not None:
                    gap = (ts - prev_ts) / MS_PER_DAY
                    if gap > 0:
                        all_gap_days.append(gap)
                prev_ts = ts
                last_ts = ts
        n = len(timestamps)
        if n == 0:
            continue
        n_users += 1
        n_rows += n
        span = (last_ts - timestamps[0]) / MS_PER_DAY if n > 1 else 0.0
        spans_days.append(span)
        counts.append(n)
        per_user_rows.append((user_id, n, round(span, 4), len(questions), int(np.median(elapsed)) if elapsed else -1))
        if n >= 30:
            subset_hits[">=30"] += 1
            if n <= 80:
                subset_hits["30-80"] += 1
                eligible_names.append(user_id)
            if n <= 200:
                subset_hits["30-200"] += 1
            if n <= 500:
                subset_hits["30-500"] += 1
        if n >= 100:
            subset_hits[">=100"] += 1

        if (index + 1) % 20000 == 0:
            print(f"  scanned {index+1}/{total}  rows={n_rows}  elapsed={time.perf_counter()-started:.0f}s", flush=True)

    with open(SUMMARY, "w", encoding="utf-8") as handle:
        handle.write("user_id,n_responses,span_days,n_questions,median_elapsed_ms\n")
        for row in per_user_rows:
            handle.write("%s,%d,%s,%d,%d\n" % row)

    gaps = np.asarray(all_gap_days, dtype=np.float64)
    cnt = np.asarray(counts, dtype=np.float64)
    spans = np.asarray(spans_days, dtype=np.float64)
    stats = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceZip": ZIP,
        "usersWithData": n_users,
        "responses": n_rows,
        "responsesPerUser": {
            "min": int(cnt.min()), "p25": float(np.percentile(cnt, 25)), "median": float(np.median(cnt)),
            "p75": float(np.percentile(cnt, 75)), "p95": float(np.percentile(cnt, 95)), "max": int(cnt.max()),
        },
        "spanDaysPerUser": {
            "p25": float(np.percentile(spans, 25)), "median": float(np.median(spans)),
            "p75": float(np.percentile(spans, 75)), "p95": float(np.percentile(spans, 95)),
        },
        "consecutiveGapDays": {
            "n": int(gaps.size),
            "p25": float(np.percentile(gaps, 25)), "p50": float(np.percentile(gaps, 50)),
            "p75": float(np.percentile(gaps, 75)), "p90": float(np.percentile(gaps, 90)),
            "p99": float(np.percentile(gaps, 99)), "max": float(gaps.max()),
            "shareGe5min": float((gaps >= 5.0 / 1440.0).mean()),
            "shareGe1day": float((gaps >= 1.0).mean()),
            # λ=0.05 下的遗忘衰减因子（论文 FB-BKT 冷启动参数）
            "decayFactor_lambda0.05": {
                "p25": float(np.exp(-0.05 * np.percentile(gaps, 25))),
                "p50": float(np.exp(-0.05 * np.percentile(gaps, 50))),
                "p75": float(np.exp(-0.05 * np.percentile(gaps, 75))),
                "p90": float(np.exp(-0.05 * np.percentile(gaps, 90))),
                "p99": float(np.exp(-0.05 * np.percentile(gaps, 99))),
                "mean": float(np.exp(-0.05 * gaps).mean()),
            },
        },
        "candidateSubsets": subset_hits,
        "subsetUsersFile": "kt1_subset_users.csv",
        "scanSeconds": round(time.perf_counter() - started, 1),
    }
    with open(STATS, "w", encoding="utf-8") as handle:
        json.dump(stats, handle, ensure_ascii=False, indent=2)
    with open(os.path.join(OUT_DIR, "kt1_subset_users.csv"), "w", encoding="utf-8") as handle:
        handle.write("user_id\n")
        for uid in eligible_names:
            handle.write(uid + "\n")
    print(json.dumps(stats, ensure_ascii=False, indent=2), flush=True)
    print("outputs:", OUT_DIR, flush=True)


if __name__ == "__main__":
    sys.exit(main())
