#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把开发期诊断产物从 work/ 归入本地 internal_debug_archive/（不删除、不推 GitHub）。

原则（照搬已验证过的安全配方）：
  * 只 Move，绝不 Delete；
  * 逐文件移动 + 立即追加日志，便于中断后定位；
  * 导出归档清单 CSV（原名/大小/SHA-256/原路径/新路径）供回滚；
  * 收尾做数量守恒检查（移动前 == 归档数 + 保留数）。

只处理 experiments/ednet_kt1/work/ 下以 "_" 开头的条目，
以及 site-packages 里 pip 卸载 triton 残留的 ~riton 临时目录。
parquet 等数据文件与正在被实验引用的文件一律不碰。

用法：python tools/archive_debug_artifacts.py
"""
from __future__ import annotations

import csv
import hashlib
import os
import shutil
from datetime import datetime

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
WORK = os.path.join(REPO, "experiments", "ednet_kt1", "work")
DEST = os.path.join(REPO, "internal_debug_archive",
                    datetime.now().strftime("%Y-%m-%d") + "-kt-earlystop-and-optimization")
LOG = os.path.join(DEST, "_archive.log")
MANIFEST = os.path.join(DEST, "archive_manifest.csv")
TRITON_LEFTOVER = (r"<APPDATA>\Local\Programs\Python\Python312"
                   r"\Lib\site-packages\~riton")


def sha256(path, chunk=1 << 20):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def log(message):
    with open(LOG, "a", encoding="utf-8") as handle:
        handle.write("[%s] %s\n" % (datetime.now().strftime("%H:%M:%S"), message))


def main() -> None:
    os.makedirs(DEST, exist_ok=True)
    entries = sorted(name for name in os.listdir(WORK) if name.startswith("_"))
    total = len(os.listdir(WORK))
    log("开始归档：work/ 共 %d 项，其中 _ 前缀 %d 项" % (total, len(entries)))

    rows, moved, failed = [], 0, []
    for name in entries:
        src, dst = os.path.join(WORK, name), os.path.join(DEST, name)
        try:
            if os.path.isdir(src):
                size = sum(os.path.getsize(os.path.join(r, f))
                           for r, _, fs in os.walk(src) for f in fs)
                digest = "(directory)"
            else:
                size = os.path.getsize(src)
                digest = sha256(src)
            shutil.move(src, dst)
            moved += 1
            rows.append({"原文件名": name, "大小(字节)": size, "SHA256": digest,
                         "原路径": src, "新路径": dst})
            log("moved %s (%d B)" % (name, size))
        except Exception as error:
            failed.append((name, str(error)))
            log("FAILED %s : %s" % (name, error))

    # triton 卸载残留
    if os.path.isdir(TRITON_LEFTOVER):
        target = os.path.join(DEST, "_triton_uninstall_leftover_riton")
        try:
            shutil.move(TRITON_LEFTOVER, target)
            log("moved triton 残留 %s -> %s" % (TRITON_LEFTOVER, target))
        except Exception as error:
            log("FAILED triton 残留: %s" % error)

    with open(MANIFEST, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["原文件名", "大小(字节)", "SHA256",
                                                   "原路径", "新路径"])
        writer.writeheader()
        writer.writerows(rows)

    remaining = len(os.listdir(WORK))
    log("守恒检查：移动前 %d 项 = 保留 %d 项 + 归档 %d 项 (差值 %d)"
        % (total, remaining, moved, total - remaining - moved))
    if failed:
        log("失败 %d 项：%s" % (len(failed), failed))
    print("归档 %d 项 -> %s" % (moved, DEST))
    print("守恒检查：移动前 %d = 保留 %d + 归档 %d" % (total, remaining, moved))
    if failed:
        print("失败：", failed)


if __name__ == "__main__":
    main()
