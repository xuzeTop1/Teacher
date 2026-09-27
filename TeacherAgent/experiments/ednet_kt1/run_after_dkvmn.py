#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""等 DKVMN 五折全部落地后，自动启动 AKT 论文口径重跑（两者不重叠，压低内存峰值）。

背景：DKVMN 用 --jobs 3，3 个 worker 各自要付一份「torch 导入(~0.46GB) + 队列数据(~0.39GB)
+ CUDA context(~0.5GB)」≈ 1.5GB，合计约 4.5GB（任务管理器会把它们归并成一行 "Python"）。
AKT 论文协议再叠一个父进程 + 一个 worker 会再加约 2.4GB。串行执行可以把峰值压在单作业水平。

本脚本刻意**不 import torch / merge_kt_table**（那会白付 0.46GB），只用 stdlib 数 JSON 文件，
常驻内存约 30MB。

用法
  python run_after_dkvmn.py --interval 60 --max-hours 6
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BENCH_ROOT = os.path.join(REPO_ROOT, "benchmark-results")
PYTHON = sys.executable

DKVMN_GLOB = os.path.join(BENCH_ROOT, "*-ednet-kt1-firsttag-20000u-dkvmn-5fold", "tasks")
DKVMN_NEEDED = 20
FEATURES = "work/features_ednet_20000.parquet"
AKT_LABEL = "ednet-kt1-firsttag-20000u-akt-paper-5fold"
# 并发度：实测（work/_conc_probe.py）单进程 133.8 ms/step、两份真重叠各约 178 ms/step
# → 总吞吐 1.53x。AKT 单步里只有约 36% 的时间在真正执行 kernel，其余是 kernel 启动开销，
# 所以和 DKVMN 一样是 launch-bound，靠多进程并发压时间。每个任务独立播种（H.SEED），
# 并发不改变任何数值结果。
AKT_JOBS = 2


def log(path, message):
    line = "[%s] %s" % (datetime.now().strftime("%H:%M:%S"), message)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")
        handle.flush()
    print(line, flush=True)


def dkvmn_done():
    done = set()
    for task_dir in glob.glob(DKVMN_GLOB):
        for path in glob.glob(os.path.join(task_dir, "*.json")):
            try:
                row = json.load(open(path, encoding="utf-8"))
            except Exception:
                continue
            done.add((row.get("model"), row.get("config"), int(row.get("fold", -1))))
    return len(done)


def akt_emit_dir():
    """给 AKT 固定一个 emit 目录，让 10 个任务也能断点续跑。

    否则 akt_paper_protocol.py 每次都会新建一个带时间戳的目录、从零重算——
    5 小时的任务一旦被打断就全丢。这里复用**最早**那个 *-akt-paper-5fold 归档的
    tasks/（merge_kt_table.load_deep 正好按这个通配取数），没有就新建一个。
    """
    found = sorted(glob.glob(os.path.join(
        BENCH_ROOT, "*-ednet-kt1-firsttag-20000u-akt-paper-5fold")))
    if found:
        target = os.path.join(found[0], "tasks")
    else:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        target = os.path.join(BENCH_ROOT,
                              "%s-ednet-kt1-firsttag-20000u-akt-paper-5fold" % stamp, "tasks")
    os.makedirs(target, exist_ok=True)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description="DKVMN 跑完后自动启动 AKT 论文口径重跑")
    parser.add_argument("--interval", type=int, default=60)
    parser.add_argument("--max-hours", type=float, default=6.0)
    parser.add_argument("--log", default=os.path.join(HERE, "work", "_chain.log"))
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.log), exist_ok=True)
    deadline = time.time() + args.max_hours * 3600
    log(args.log, "链式守护启动：等 DKVMN %d/20 后自动起 AKT 论文口径（最多等 %.1f h）"
                  % (DKVMN_NEEDED, args.max_hours))
    last = None
    while True:
        done = dkvmn_done()
        if done != last:
            log(args.log, "DKVMN 进度 %d/%d" % (done, DKVMN_NEEDED))
            last = done
        if done >= DKVMN_NEEDED:
            emit = akt_emit_dir()
            command = [PYTHON, os.path.join(HERE, "akt_paper_protocol.py"),
                       "--features", FEATURES, "--jobs", str(AKT_JOBS), "--label", AKT_LABEL,
                       "--emit-dir", emit]
            log(args.log, "DKVMN 已齐备，启动 AKT 论文口径重跑（jobs=%d 并发，可断点续跑）" % AKT_JOBS)
            log(args.log, "  emit-dir = %s" % emit)
            log(args.log, "  命令 = %s" % " ".join(command))
            akt_log = open(os.path.join(HERE, "work", "_akt_paper_run.log"), "a",
                           encoding="utf-8")
            process = subprocess.Popen(command, cwd=HERE, stdout=akt_log, stderr=subprocess.STDOUT)
            log(args.log, "AKT 已启动 pid=%d，日志 work/_akt_paper_run.log" % process.pid)
            # 关键：必须等子进程跑完再退出。
            # 若本进程立刻 return，调用方的进程树收尾会把刚拉起的 AKT 一起杀掉
            # （实测：AKT 还在 import torch 就被带走，一个字都没打进日志）。
            code = process.wait()
            log(args.log, "AKT 子进程已结束，退出码 %s" % code)
            return
        if time.time() > deadline:
            log(args.log, "超过 --max-hours 仍未齐备，退出（不启动 AKT）")
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
