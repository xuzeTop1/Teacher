#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只为「跨数据集对照表」补齐其余切片的 DKT 先验配置（统一早停协议）。

动机：论文的 EdNet 跨数据集对照表每个切片只报一个 DKT 值（先验配置 hidden=100、
lr=1e-3）。首轮这些值是固定 50 轮、无早停的旧协议，与统一协议下的
first_tag-20000u 数字不可混排。本脚本按统一协议只重跑**先验配置**，
4 个切片 × 5 折 = 20 个任务，约 10 分钟即可对齐全部口径。

用法：python run_dkt_slices_unified.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PYTHON = sys.executable
LOG = os.path.join(HERE, "work", "_dkt_slices.log")

# (features 相对本目录的路径, 归档 label, 说明)
SLICES = [
    ("work/features_ednet_2000.parquet", "ednet-kt1-firsttag-2000u-dkt-unified",
     "EdNet first_tag 2000 用户"),
    ("work/features_ednet_singletag.parquet", "ednet-kt1-singletag-10000u-dkt-unified",
     "EdNet single_tag 10000 用户"),
    ("work/features_ednet_20000_part.parquet", "ednet-kt1-part-20000u-dkt-unified",
     "EdNet part 20000 用户"),
    ("../assistments/work/features_assist_200.parquet", "assistments-200-dkt-unified",
     "ASSISTments 稀疏子集 200 用户"),
]


def log(message):
    line = "[%s] %s" % (time.strftime("%H:%M:%S"), message)
    with open(LOG, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")
        handle.flush()
    print(line, flush=True)


def main() -> None:
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    log("开始补跑 DKT 先验配置（统一早停协议），共 %d 个切片" % len(SLICES))
    for features, label, note in SLICES:
        if not os.path.exists(os.path.join(HERE, features)):
            log("跳过 %s：features 不存在 (%s)" % (note, features))
            continue
        command = [PYTHON, os.path.join(HERE, "kt_unified_earlystop.py"),
                   "--features", features, "--models", "dkt",
                   "--configs", "100,0.001", "--jobs", "3", "--label", label]
        log("起跑 %s -> %s" % (note, label))
        started = time.perf_counter()
        with open(os.path.join(HERE, "work", "_dkt_slices_%s.log" % label), "w",
                  encoding="utf-8") as handle:
            code = subprocess.call(command, cwd=HERE, stdout=handle, stderr=subprocess.STDOUT)
        log("  %s 结束 exit=%s (%.0fs)" % (label, code, time.perf_counter() - started))
    log("全部结束")


if __name__ == "__main__":
    main()
