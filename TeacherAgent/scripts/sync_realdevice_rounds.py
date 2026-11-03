#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""真机同步多轮测量（方案 A：不污染真实数据）。

两个子命令：
  cleanup  停 App → 拉库 → 删除测量窗口内产生的合成会话及其事件 → 推回 → 拉起 App
  run      每轮：停 App → 把一条【注入】任务的 updated_at 置为当前时间（只碰注入数据）
           → 拉起 App → 点「立即同步」→ 以手机 `sync ok` 日志做端到端计时 → 核对桌面落库

安全约定：
  * 所有点击先用 uiautomator 按 text/content-desc 定位，找不到就中止，绝不盲点坐标
    （「解除配对」与「立即同步」同行，误点会毁掉配对）。
  * 写手机库一律在 App 停止后进行；只改 remote_id 前缀为注入标记的行。
"""

import argparse
import csv
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime

PKG = "com.hxz.alerttime.app"
DESKTOP_DB = r"<APPDATA>\Roaming\com.teacheragent.app\teacher_agent.sqlite3"
INJECT_PREFIX = "10000000-0000-4000-8000-"
ENV = {**os.environ, "MSYS_NO_PATHCONV": "1"}
TMP = os.path.join(os.environ.get("TEMP", r"<APPDATA>\Local\Temp"), "at_dbwork")


def adb(*args):
    return subprocess.run(["adb", *args], capture_output=True, text=True, encoding="utf-8", errors="ignore", env=ENV)


def stop_app():
    adb("shell", "am", "force-stop", PKG)
    time.sleep(2)


def start_app():
    # 用 am start 而不是 monkey：monkey 在本机 MIUI 上有时起不来（会停在启动器），
    # 导致后续按控件文字查找全部失败（踩过两次）。
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    # 冷启动会先白屏数秒再渲染；必须等到首页控件真的出现（用户实测），
    # 否则白屏期间 uiautomator 取到的树里没有目标控件，查找必然失败。
    deadline = time.time() + 60
    while time.time() < deadline:
        if find_center("关于自律") or find_center("选择 Plan 开始"):
            time.sleep(1.0)
            return
        time.sleep(1.5)
    raise RuntimeError("冷启动 60s 内首页仍未渲染出来")


def pull_db() -> str:
    os.makedirs(TMP, exist_ok=True)
    for suffix in ("", "-wal"):
        # run-as 无法写 /data/local/tmp（目录对 others 只读执行），改用 cat 拉二进制
        result = subprocess.run(
            ["adb", "exec-out", "run-as", PKG, "cat", f"databases/alert_time.db{suffix}"],
            capture_output=True, env=ENV)
        with open(os.path.join(TMP, f"alert_time.db{suffix}"), "wb") as handle:
            handle.write(result.stdout)
    return os.path.join(TMP, "alert_time.db")


def push_db(path: str):
    # 只推主库：本地 sqlite3 关闭时已 checkpoint，若把本地 -wal 一起推回，
    # 远端会出现“主库已含改动 + 又回放旧 WAL”的重复应用，App 可能因此打不开库
    # （表现为冷启动后界面一直起不来，按控件文字查找全部失败）。
    wal = path + "-wal"
    if os.path.exists(wal) and os.path.getsize(wal) > 0:
        con = sqlite3.connect(path)
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        con.close()
    # 只推主库；-wal/-shm 一律不碰，并在推完后删掉远端这两个文件，
    # 避免“新主库 + 旧 WAL/SHM”导致 App 打不开库（界面起不来）。
    adb("push", path, "/data/local/tmp/y")
    adb("shell", f"run-as {PKG} cp /data/local/tmp/y databases/alert_time.db")
    adb("shell", f"run-as {PKG} chmod 660 databases/alert_time.db")
    adb("shell", "rm", "/data/local/tmp/y")
    adb("shell", f"run-as {PKG} rm -f databases/alert_time.db-wal databases/alert_time.db-shm")


def ui_dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/z.xml")
    return adb("exec-out", "cat", "/sdcard/z.xml").stdout or ""


def find_center(text: str):
    for node in re.findall(r"<node[^>]*/?>", ui_dump()):
        t = re.search(r'text="([^"]*)"', node)
        c = re.search(r'content-desc="([^"]*)"', node)
        t_val = t.group(1).strip() if t else ""
        c_val = c.group(1).strip() if c else ""
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if not bounds:
            continue
        if t_val == text or c_val == text:
            x1, y1, x2, y2 = map(int, bounds.groups())
            return (x1 + x2) // 2, (y1 + y2) // 2
    return None


def tap_text(text: str):
    center = find_center(text)
    if center is None:
        raise RuntimeError(f"找不到「{text}」，中止（不盲点）")
    adb("shell", "input", "tap", str(center[0]), str(center[1]))


def wait_for(text: str, timeout: float = 20.0):
    """轮询等待控件出现（App 冷启动要几秒，单次查找会误判“找不到”）。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        center = find_center(text)
        if center:
            return center
        time.sleep(1.0)
    return None


def tap_wait(text: str, timeout: float = 20.0):
    center = wait_for(text, timeout)
    if center is None:
        raise RuntimeError(f"等待「{text}」超时，中止（不盲点）")
    adb("shell", "input", "tap", str(center[0]), str(center[1]))
    time.sleep(1.2)


def open_sync_dialog():
    """打开同步对话框：首页 →「关于自律」→「Teacher 同步」（AboutDialog 里的按钮）。

    App 每轮被重启，所以不能假设对话框已开；入口路径由代码确认（HomeScreen onOpenTeacherSync）。
    """
    if wait_for("立即同步", 3):
        return
    tap_wait("关于自律", 25)
    tap_wait("Teacher 同步", 15)
    if not wait_for("立即同步", 10):
        raise RuntimeError("未能打开同步对话框（关于自律 → Teacher 同步）")


def sync_ok_count() -> int:
    return (adb("logcat", "-d", "-s", "AlertTimeSync:I").stdout or "").count("sync ok")


def desktop_row():
    con = sqlite3.connect(f"file:{DESKTOP_DB}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT received_at_ms, subject_count, goal_count, task_count, session_count "
        "FROM sync_snapshots ORDER BY received_at_ms DESC LIMIT 1").fetchall()
    con.close()
    return rows[0] if rows else None


def cleanup(window_start_ms: int):
    stop_app()
    path = pull_db()
    con = sqlite3.connect(path)
    ids = [r[0] for r in con.execute(
        "SELECT id FROM study_sessions WHERE created_at >= ? AND duration_seconds <= 30",
        (window_start_ms,)).fetchall()]
    if ids:
        marks = ",".join("?" * len(ids))
        con.execute(f"DELETE FROM study_session_events WHERE session_id IN ({marks})", ids)
        con.execute(f"DELETE FROM study_sessions WHERE id IN ({marks})", ids)
        con.commit()
    con.close()
    push_db(path)
    print(f"cleanup：删除合成会话 {len(ids)} 条（created_at >= {window_start_ms} 且时长<=30s）")
    start_app()


def bump_injected_task():
    stop_app()
    path = pull_db()
    con = sqlite3.connect(path)
    now = int(time.time() * 1000)
    # Python 自带 sqlite3 未启用 UPDATE...LIMIT，改用子查询定位一行
    cur = con.execute(
        "UPDATE tasks SET updated_at = ? WHERE id = "
        "(SELECT id FROM tasks WHERE remote_id LIKE ? ORDER BY id LIMIT 1)",
        (now, INJECT_PREFIX + "%"))
    con.commit()
    affected = cur.rowcount
    con.close()
    push_db(path)
    start_app()
    return affected


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["cleanup", "run"])
    parser.add_argument("--rounds", type=int, default=10)
    parser.add_argument("--window-start", default="2026-09-11 23:20",
                        help="cleanup 的时间窗起点（本地时间）")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    if args.mode == "cleanup":
        start_ms = int(datetime.strptime(args.window_start, "%Y-%m-%d %H:%M").timestamp() * 1000)
        cleanup(start_ms)
        return 0

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = args.out or rf"<REPO_ROOT>-alerttime-json\benchmark-results\{stamp}-sync-realdevice"
    os.makedirs(out_dir, exist_ok=True)
    adb("shell", "settings", "put", "system", "screen_off_timeout", "1800000")
    adb("shell", "svc", "power", "stayon", "true")
    adb("logcat", "-c")

    rows = []
    for index in range(1, args.rounds + 1):
        print(f"=== 第 {index}/{args.rounds} 轮 ===", flush=True)
        affected = bump_injected_task()
        if affected != 1:
            print(f"  未能改到注入任务（rowcount={affected}），中止")
            break
        open_sync_dialog()
        before = sync_ok_count()
        started = time.time()
        tap_wait("立即同步", 10)
        ok_at = None
        while time.time() < started + 120:
            time.sleep(1.0)
            if sync_ok_count() > before:
                ok_at = time.time()
                break
        if ok_at is None:
            print("  超时未见 sync ok，中止")
            break
        latest = desktop_row()
        duration = ok_at - started
        print(f"  端到端 {duration:.2f}s；桌面 {latest}", flush=True)
        rows.append({"round": index, "e2e_seconds": round(duration, 3),
                     "received_at_ms": latest[0] if latest else "",
                     "subjects": latest[1] if latest else "", "goals": latest[2] if latest else "",
                     "tasks": latest[3] if latest else "", "sessions": latest[4] if latest else ""})

    csv_path = os.path.join(out_dir, "rounds.csv")
    if rows:
        with open(csv_path, "w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        durations = [r["e2e_seconds"] for r in rows]
        print(f"\n{len(rows)} 轮：均值 {sum(durations)/len(durations):.2f}s 最大 {max(durations):.2f}s")
    print("CSV:", csv_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
