#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""等 AKT / DKVMN 全部五折任务落地后，自动执行 merge_kt_table.py 出论文用表。

理由：kt_deep_baselines.py 只在**全部任务跑完**时才写 summary.json，
而单个任务已按 (模型, 配置, 折) 落地成 JSON；本守护进程把「等」和「出表」
两件事自动化，长任务跑完即刻有结果，不需要人守着。

行为
  * 每 --interval 秒扫一次 tasks 目录，把进度追加到 --log；
  * 两个模型都达到 配置数 × 5 折 时，调用 merge_kt_table.py，输出并入同一日志；
  * 超过 --max-hours 仍未齐则记录并退出（不覆盖任何已有结果）。

用法
  python watch_and_merge.py                       # 默认 60s 轮询、最多等 10h
  python watch_and_merge.py --interval 30
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import merge_kt_table as M  # noqa: E402


def log(path, message):
    line = "[%s] %s" % (datetime.now().strftime("%H:%M:%S"), message)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")
        handle.flush()


def counts():
    """按正文口径的取数来源统计（DKT/DKVMN 走统一早停归档、AKT 走 akt-paper 归档）。"""
    out = {}
    for model, spec in M.SOURCES.items():
        rows, _ = M.load_deep(spec["tag"], spec["family"])
        out[model] = (len(rows), len(spec["grid"]) * M.N_FOLDS)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="等待任务齐备后自动并表")
    parser.add_argument("--interval", type=int, default=60)
    parser.add_argument("--max-hours", type=float, default=10.0)
    parser.add_argument("--log", default=os.path.join(HERE, "work", "_auto_merge.log"))
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.log), exist_ok=True)
    deadline = time.time() + args.max_hours * 3600
    log(args.log, "守护启动：等待 AKT/DKVMN 全部任务（最多 %.1f 小时）" % args.max_hours)
    last = None
    while True:
        current = counts()
        snapshot = tuple(sorted(current.items()))
        if snapshot != last:
            log(args.log, "进度 " + ", ".join("%s %d/%d" % (m, a, b) for m, (a, b) in current.items()))
            last = snapshot
        if all(done >= need for done, need in current.values()):
            log(args.log, "全部任务齐备，开始并表")
            proc = subprocess.run([sys.executable, os.path.join(HERE, "merge_kt_table.py")],
                                  cwd=HERE, capture_output=True, text=True, encoding="utf-8")
            log(args.log, "并表退出码 %s" % proc.returncode)
            for chunk in (proc.stdout or "", proc.stderr or ""):
                for line in chunk.splitlines():
                    log(args.log, "  " + line)
            return
        if time.time() > deadline:
            log(args.log, "超过 --max-hours 仍未齐，退出（已落地的单任务结果不受影响）")
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
