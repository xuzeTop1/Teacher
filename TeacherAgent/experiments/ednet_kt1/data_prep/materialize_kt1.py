#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""EdNet-KT1 物化：从 zip 中抽取选定用户作答的原始行 → parquet。

只扫一遍 zip，之后所有采样/建模都读 parquet，避免重复解压 2.86 GB。
用户选择：每学生作答数 ∈ [min_responses, max_responses] 且时间跨度 ≥ min_span_days，
按固定种子确定性采样（可复现）。
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import zipfile
from datetime import datetime, timezone

import numpy as np
import pandas as pd

# EdNet-KT1 原始压缩包路径。按需通过环境变量 EDNET_KT1_ZIP 覆盖。
ZIP = os.environ.get("EDNET_KT1_ZIP", os.path.join(os.path.expanduser("~"), "Downloads", "EdNet-KT1.zip"))
HERE = os.path.dirname(os.path.abspath(__file__))
SUMMARY = os.path.join(HERE, "kt1_user_summary.csv")
OUT_DIR = os.path.join(HERE, "work")
SEED = 42


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-responses", type=int, default=30)
    parser.add_argument("--max-responses", type=int, default=80)
    parser.add_argument("--min-span-days", type=float, default=7.0)
    parser.add_argument("--users", type=int, default=20000, help="物化的用户数（后续可按需再抽样）")
    parser.add_argument("--tag", default="subA")
    args = parser.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    started = time.perf_counter()

    summary = pd.read_csv(SUMMARY)
    eligible = summary[
        (summary.n_responses >= args.min_responses)
        & (summary.n_responses <= args.max_responses)
        & (summary.span_days >= args.min_span_days)
    ]
    rng = np.random.default_rng(SEED)
    size = min(args.users, len(eligible))
    chosen = rng.choice(eligible.user_id.to_numpy(), size=size, replace=False)
    chosen_set = set(chosen.tolist())
    print(f"eligible={len(eligible)} materialize={size} tag={args.tag}", flush=True)

    z = zipfile.ZipFile(ZIP)
    names = {os.path.basename(n)[:-4]: n for n in z.namelist() if n.endswith(".csv")}
    missing = [u for u in chosen if u not in names]
    if missing:
        raise SystemExit(f"{len(missing)} 个选中用户不在 zip 中，例如 {missing[:5]}")

    frames = []
    for index, uid in enumerate(chosen):
        with z.open(names[uid]) as handle:
            text = io.TextIOWrapper(handle, encoding="utf-8")
            text.readline()  # header
            rows = []
            for line in text:
                parts = line.rstrip("\n").split(",")
                if len(parts) < 5:
                    continue
                try:
                    rows.append((int(parts[0]), int(parts[1]), parts[2], parts[3], int(parts[4])))
                except ValueError:
                    continue
        if rows:
            frames.append(pd.DataFrame(rows, columns=["timestamp", "solving_id", "question_id", "user_answer", "elapsed_ms"]).assign(user_id=uid))
        if (index + 1) % 2000 == 0:
            print(f"  {index+1}/{size}  {time.perf_counter()-started:.0f}s", flush=True)

    frame = pd.concat(frames, ignore_index=True)
    frame = frame[["user_id", "timestamp", "solving_id", "question_id", "user_answer", "elapsed_ms"]]
    frame = frame.sort_values(["user_id", "timestamp", "solving_id"]).reset_index(drop=True)
    out = os.path.join(OUT_DIR, f"kt1_raw_{args.tag}.parquet")
    frame.to_parquet(out, index=False)

    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceZip": ZIP,
        "filterRule": f"作答数∈[{args.min_responses},{args.max_responses}] 且 跨度≥{args.min_span_days}天",
        "eligibleUsers": int(len(eligible)),
        "materializedUsers": int(size),
        "rows": int(len(frame)),
        "responsesPerUser": {
            "min": int(frame.groupby("user_id").size().min()),
            "median": float(frame.groupby("user_id").size().median()),
            "max": int(frame.groupby("user_id").size().max()),
        },
        "samplingSeed": SEED,
        "outputParquet": out,
        "seconds": round(time.perf_counter() - started, 1),
    }
    with open(os.path.join(OUT_DIR, f"kt1_raw_{args.tag}_manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
    print(json.dumps(meta, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    sys.exit(main())
