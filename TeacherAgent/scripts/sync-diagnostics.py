#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TeacherAgent / AlertTime 局域网同步诊断脚本

分析 TeacherAgent 桌面端 SQLite 库（teacher_agent.sqlite3），统计：
  1. 同步耗时：按 sync_snapshots.received_at_ms 时间序列计算相邻同步间隔、
     单次同步数据量(请求间隔)、学习分析生成趋势。
  2. 系统开销：DB 文件大小、同步数据量、并发轮询时桌面进程 CPU/内存占用。
  3. 实时模式：--live 轮询 TeacherAgent 进程资源占用 + 同步服务 8787 端口连通性。

用法：
  python sync-diagnostics.py                 # 只分析已有 DB + 打印系统概览
  python sync-diagnostics.py --db <path>     # 指定 DB 路径
  python sync-diagnostics.py --live [N]      # 每秒采样 N 次(默认 10)系统开销 + 端口探测
  python sync-diagnostics.py --csv out.csv   # 同步耗时明细导出到 CSV
  python sync-diagnostics.py --json out.json # 结果导出 JSON

仅依赖 Python 3.8+ 标准库；如需进程资源采样请安装 psutil（可选，缺失时跳过）。
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import socket
import subprocess
import sys
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone

# 统一 UTF-8 输出，避免 Windows GBK 控制台中文乱码
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
if os.name == "nt":
    try:
        os.system("")
    except Exception:
        pass

DEFAULT_DB = r"C:\Users\Acer\AppData\Roaming\com.teacheragent.app\teacher_agent.sqlite3"
SYNC_PORT = 8787
PROCESS_NAMES = ("TeacherAgent", "teacher-agent", "teacheragent")

try:
    import psutil  # type: ignore
    _HAS_PSUTIL = True
except Exception:  # pragma: no cover
    _HAS_PSUTIL = False


# ---------------------------------------------------------------------------
# 时间解析/格式化工具
# ---------------------------------------------------------------------------

def _parse_ms(epoch_ms) -> str:
    """把毫秒时间戳转成可读本地字符串；非法输入返回空串。"""
    if epoch_ms is None:
        return ""
    try:
        return datetime.fromtimestamp(int(epoch_ms) / 1000.0).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""


def _parse_iso(iso: str):
    """解析 ISO-8601（含 Z 后缀），返回 epoch 毫秒；失败返回 None。"""
    if not iso:
        return None
    try:
        s = iso if iso.endswith("Z") else iso
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception:
        try:
            return int(iso)
        except Exception:
            return None


def _fmt_bytes(n) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024.0:
            return f"{n:.1f}{unit}"
        n /= 1024.0
    return f"{n:.1f}TB"


def _fmt_sec(sec: float) -> str:
    if sec < 1:
        return f"{sec * 1000:.0f}ms"
    if sec < 90:
        return f"{sec:.1f}s"
    return f"{sec / 60:.1f}m"


# ---------------------------------------------------------------------------
# 数据读取
# ---------------------------------------------------------------------------

@dataclass
class DbAnalysis:
    db_path: str = ""
    exists: bool = False
    db_size_bytes: int = 0
    tables: dict = field(default_factory=dict)
    snapshots: list = field(default_factory=list)
    devices: list = field(default_factory=list)
    analyses: list = field(default_factory=list)
    llm_generator_total: int = 0
    llm_fallback_total: int = 0
    subject_mapping_count: int = 0
    error: str = ""


def _open_db(db_path: str):
    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def analyze_db(db_path: str) -> DbAnalysis:
    res = DbAnalysis(db_path=db_path)
    if not os.path.isfile(db_path):
        res.error = f"数据库不存在: {db_path}"
        return res
    res.exists = True
    res.db_size_bytes = os.path.getsize(db_path)
    try:
        conn = _open_db(db_path)
        try:
            tables = {
                r["name"]: r["sql"]
                for r in conn.execute(
                    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            }
            res.tables = tables

            counts = {}
            for t in tables.keys():
                try:
                    counts[t] = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
                except Exception:
                    counts[t] = -1
            res.tables["__counts__"] = counts

            res.snapshots = [dict(r) for r in conn.execute(
                "SELECT id, device_id, received_at, status, subject_count, goal_count, "
                "task_count, session_count, received_at_ms FROM sync_snapshots "
                "WHERE received_at_ms IS NOT NULL ORDER BY received_at_ms"
            )]

            res.devices = [dict(r) for r in conn.execute(
                "SELECT id, display_name, paired_at, last_sync_at, owner_identity "
                "FROM sync_devices ORDER BY COALESCE(last_sync_at, paired_at)"
            )]

            res.analyses = [dict(r) for r in conn.execute(
                "SELECT analysis_id, device_id, snapshot_id, generated_at, generator "
                "FROM sync_learning_analyses ORDER BY generated_at"
            )]

            res.llm_generator_total = sum(
                1 for a in res.analyses if a.get("generator") == "android_llm"
            )
            res.llm_fallback_total = sum(
                1 for a in res.analyses if a.get("generator") != "android_llm"
            )

            res.subject_mapping_count = counts.get("subject_mappings", 0)
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        res.error = f"读取数据库出错: {e}"
    return res


# ---------------------------------------------------------------------------
# 同步耗时分析
# ---------------------------------------------------------------------------

@dataclass
class SyncTimingStats:
    total_snapshots: int = 0
    first_at_ms: int = 0
    last_at_ms: int = 0
    span_hours: float = 0.0
    intervals_sec: list = field(default_factory=list)
    max_interval_sec: float = 0.0
    min_interval_sec: float = 0.0
    avg_interval_sec: float = 0.0
    max_entity_bundle: int = 0
    pair_first_sync_sec: list = field(default_factory=list)


def sync_timing(analysis: DbAnalysis) -> SyncTimingStats:
    st = SyncTimingStats()
    snaps = analysis.snapshots
    st.total_snapshots = len(snaps)
    if not snaps:
        return st
    st.first_at_ms = snaps[0]["received_at_ms"]
    st.last_at_ms = snaps[-1]["received_at_ms"]
    st.span_hours = (st.last_at_ms - st.first_at_ms) / 3_600_000.0 if st.first_at_ms else 0.0

    intervals = []
    for a, b in zip(snaps, snaps[1:]):
        d = (b["received_at_ms"] - a["received_at_ms"]) / 1000.0
        if d > 0:
            intervals.append(d)
    st.intervals_sec = intervals
    if intervals:
        st.max_interval_sec = max(intervals)
        st.min_interval_sec = min(intervals)
        st.avg_interval_sec = sum(intervals) / len(intervals)

    for s in snaps:
        st.max_entity_bundle = max(
            st.max_entity_bundle,
            (s.get("subject_count") or 0)
            + (s.get("task_count") or 0)
            + (s.get("session_count") or 0)
            + (s.get("goal_count") or 0),
        )

    # 配对 -> 首次同步耗时
    for d in analysis.devices:
        paired = _parse_iso(d.get("paired_at"))
        last = _parse_iso(d.get("last_sync_at"))
        if paired and last and last >= paired:
            st.pair_first_sync_sec.append((last - paired) / 1000.0)
    return st


# ---------------------------------------------------------------------------
# 系统开销
# ---------------------------------------------------------------------------

@dataclass
class SysCost:
    proc_matched: bool = False
    proc_name: str = ""
    cpu_percent: float = 0.0
    mem_rss_bytes: int = 0
    mem_percent: float = 0.0
    db_size_bytes: int = 0
    db_size_delta: int = 0
    port_reachable: bool = False
    note: str = ""


def _find_teacher_processes():
    if not _HAS_PSUTIL:
        return [], "psutil 不可用，跳过进程资源采样（pip install psutil 可启用）"
    matches = []
    seen = set()
    for proc in psutil.process_iter(["pid", "name", "exe"]):
        name = (proc.info.get("name") or "").lower()
        exe = (proc.info.get("exe") or "").lower()
        if any(k in name or k in exe for k in PROCESS_NAMES):
            if proc.pid in seen:
                continue
            seen.add(proc.pid)
            matches.append(proc)
    return matches, ""


def sample_proc_cost(db_path: str, prev_db_size: int = 0) -> SysCost:
    cost = SysCost()
    matches, note = _find_teacher_processes()
    cost.note = note
    if matches:
        try:
            p = matches[0]
            cost.proc_matched = True
            cost.proc_name = p.info.get("name") or f"pid={p.pid}"
            cost.cpu_percent = p.cpu_percent(interval=None)
            mem = p.memory_info()
            cost.mem_rss_bytes = getattr(mem, "rss", 0)
            cost.mem_percent = p.memory_percent()
        except Exception as e:  # noqa: BLE001
            cost.note = f"进程采样失败: {e}"
    if os.path.isfile(db_path):
        cost.db_size_bytes = os.path.getsize(db_path)
        cost.db_size_delta = cost.db_size_bytes - prev_db_size if prev_db_size else 0
    cost.port_reachable = probe_port("127.0.0.1", SYNC_PORT)
    return cost


def probe_port(host: str, port: int, timeout: float = 0.6) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------

def _pad(s, w):
    s = str(s)
    return s + " " * max(0, w - len(s))


def print_system_overview(a: DbAnalysis, st: SyncTimingStats, cost: SysCost):
    print("=" * 72)
    print("TeacherAgent / AlertTime 同步诊断")
    print("=" * 72)
    print(f"数据库: {a.db_path}")
    print(f"  库大小: {_fmt_bytes(a.db_size_bytes)}  存在: {'是' if a.exists else '否'}")
    if a.error:
        print(f"  ! {a.error}")
        return
    counts = a.tables.get("__counts__", {})
    print("\n-- 业务数据量 --")
    for key, label in [
        ("sync_snapshots", "同步快照"),
        ("sync_study_sessions", "同步学习会话"),
        ("sync_tasks", "同步任务"),
        ("sync_subjects", "同步科目"),
        ("sync_learning_analyses", "同步学习分析"),
        ("sync_devices", "配对设备"),
        ("subject_mappings", "科目映射"),
        ("vector_embeddings", "向量(嵌入)"),
        ("knowledge_nodes", "知识节点"),
        ("long_term_memories", "长期记忆"),
        ("messages", "消息"),
    ]:
        n = counts.get(key, -1)
        print(f"  {_pad(key, 26)} {n:>6}  {label}")

    print("\n-- 同步耗时 --")
    print(f"  快照总数: {st.total_snapshots}")
    if st.total_snapshots:
        print(f"  首次同步: {_parse_ms(st.first_at_ms)}")
        print(f"  末次同步: {_parse_ms(st.last_at_ms)}")
        print(f"  跨度:     {st.span_hours:.2f} 小时")
        if st.intervals_sec:
            print(f"  相邻同步间隔  平均 {_fmt_sec(st.avg_interval_sec)}  "
                  f"最慢 {_fmt_sec(st.max_interval_sec)} 最快 {_fmt_sec(st.min_interval_sec)}")
        print(f"  单次快照最大实体打包: {st.max_entity_bundle} 条")
    if st.pair_first_sync_sec:
        vals = sorted(st.pair_first_sync_sec)
        print(f"  配对→首次同步耗时: 最短 {_fmt_sec(vals[0])} / 最长 {_fmt_sec(vals[-1])} "
              f"({len(vals)} 台设备)")

    print("\n-- LLM 学习分析 --")
    print(f"  总分析: {len(a.analyses)}    Android-LLM 生成: {a.llm_generator_total}    "
          f"确定性降级(回退): {a.llm_fallback_total}")
    if a.llm_fallback_total:
        print("  ! 存在 LLM 降级回退——同步期 Provider 曾超时/失败，改用确定性生成器")

    print("\n-- 实时系统开销（单次采样）--")
    if not _HAS_PSUTIL:
        print(f"  ! {cost.note}")
    elif cost.proc_matched:
        print(f"  进程: {cost.proc_name}    CPU: {cost.cpu_percent:.1f}%    "
              f"内存: {_fmt_bytes(cost.mem_rss_bytes)} ({cost.mem_percent:.1f}%)")
    else:
        print("  ! 未发现 TeacherAgent 进程（可能未启动，或名称未匹配）")
    print(f"  同步服务 127.0.0.1:{SYNC_PORT}: {'可达' if cost.port_reachable else '不可达'}")
    if cost.db_size_delta:
        print(f"  DB 增长(自上次采样): {_fmt_bytes(cost.db_size_delta)}")
    print("=" * 72)


def print_snapshot_table(a: DbAnalysis):
    if not a.snapshots:
        print("（无快照数据）")
        return
    print(f"\n-- 同步快照时间线（{len(a.snapshots)} 条，倒序）--")
    print(f"{_pad('时间', 20)} {_pad('状态', 8)} {_pad('科目', 5)} {_pad('任务', 5)} {_pad('会话', 6)} {_pad('设备', 12)}")
    snapshots = sorted(a.snapshots, key=lambda s: s["received_at_ms"], reverse=True)
    for i, s in enumerate(snapshots[:40]):
        print(
            f"{_pad(_parse_ms(s['received_at_ms']), 20)} "
            f"{_pad(s.get('status') or '', 8)} "
            f"{_pad(s.get('subject_count') or 0, 5)} "
            f"{_pad(s.get('task_count') or 0, 5)} "
            f"{_pad(s.get('session_count') or 0, 6)} "
            f"{_pad((s.get('device_id') or '')[:12], 12)}"
        )
    if len(snapshots) > 40:
        print(f"  … 共 {len(snapshots)} 条，仅显示最近 40 条")


def export_csv(a: DbAnalysis, path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["time_local", "status", "subjects", "goals", "tasks", "sessions", "device_id"])
        for s in a.snapshots:
            w.writerow([
                _parse_ms(s["received_at_ms"]),
                s.get("status"),
                s.get("subject_count"),
                s.get("goal_count"),
                s.get("task_count"),
                s.get("session_count"),
                s.get("device_id"),
            ])
    print(f"\n已导出同步时间线到: {path}")


def export_json(a: DbAnalysis, st: SyncTimingStats, cost: SysCost, path: str) -> None:
    counts = a.tables.get("__counts__", {})
    payload = {
        "db_path": a.db_path,
        "db_size_bytes": a.db_size_bytes,
        "exists": a.exists,
        "error": a.error or None,
        "table_counts": counts,
        "sync": {
            "total_snapshots": st.total_snapshots,
            "first_at_ms": st.first_at_ms,
            "last_at_ms": st.last_at_ms,
            "span_hours": round(st.span_hours, 3),
            "avg_interval_sec": round(st.avg_interval_sec, 2),
            "max_interval_sec": round(st.max_interval_sec, 2),
            "min_interval_sec": round(st.min_interval_sec, 2),
            "max_entity_bundle": st.max_entity_bundle,
            "pair_first_sync_sec": [round(x, 2) for x in st.pair_first_sync_sec],
        },
        "llm_analyses": {"total": len(a.analyses), "llm": a.llm_generator_total, "fallback": a.llm_fallback_total},
        "system": {
            "proc_matched": cost.proc_matched,
            "proc_name": cost.proc_name,
            "cpu_percent": round(cost.cpu_percent, 2),
            "mem_rss_bytes": cost.mem_rss_bytes,
            "mem_percent": round(cost.mem_percent, 2),
            "port_reachable": cost.port_reachable,
            "note": cost.note or None,
        },
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(f"\n已导出 JSON 到: {path}")


def run_live(db_path: str, samples: int) -> None:
    print(f"实时采样 {samples} 次，每秒 1 次。Ctrl+C 停止。")
    db_size = 0
    for i in range(samples):
        cost = sample_proc_cost(db_path, db_size)
        db_size = cost.db_size_bytes
        stamp = datetime.now().strftime("%H:%M:%S")
        proc = (
            f"{cost.proc_name} cpu={cost.cpu_percent:.1f}% mem={_fmt_bytes(cost.mem_rss_bytes)}"
            if cost.proc_matched
            else "进程未匹配"
        )
        db = f"{_fmt_bytes(cost.db_size_bytes)}" + (f"  ({_fmt_bytes(cost.db_size_delta)}/s)" if cost.db_size_delta else "")
        port = "同步端口可达" if cost.port_reachable else "同步端口不可达"
        print(f"[{stamp}] {proc}  |  DB {db}  |  {port}")
        time.sleep(1)


def _db_watch_markers(db_path):
    """返回 (快照数, 最新 last_sync_at 毫秒, 最新快照 received_at_ms)。库不可读返回 None。"""
    import sqlite3

    try:
        conn = sqlite3.connect(db_path, timeout=4)
        try:
            s = conn.execute("SELECT COUNT(*) FROM sync_snapshots").fetchone()[0]
            last = conn.execute(
                "SELECT MAX(received_at_ms) FROM sync_snapshots"
            ).fetchone()[0]
            sync_at = conn.execute(
                "SELECT MAX(CASE WHEN last_sync_at IS NOT NULL THEN 1 ELSE 0 END) FROM sync_devices"
            ).fetchone()[0]
            last_sync = None
            if sync_at:
                last_sync = conn.execute(
                    "SELECT COALESCE(MAX(CASE WHEN last_sync_at LIKE '%.%' THEN "
                    "CAST((julianday(last_sync_at)-2440587.5)*86400000 AS INTEGER) END), 0) "
                    "FROM sync_devices"
                ).fetchone()[0]
            return (s, last_sync, last)
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        return None


def _fmt_dt(epoch_ms):
    return datetime.fromtimestamp(epoch_ms / 1000.0).strftime("%H:%M:%S.%f")[:-3]


def run_watch(db_path: str, timeout_sec: int) -> None:
    """
    实时监测从「现在」开始的每一次新同步（默认记录最近 10 次）。
    每次手机在桌面端落库一条新快照即为一次同步完成；脚本实时报出该次同步
    的落库时刻、实体量、相较上一次的耗时间隔，并在全程采样 teacher-agent.exe
    的 CPU/内存与 DB 增长峰值。桌面端同步服务需保持运行。
    """
    base = _db_watch_markers(db_path)
    if base is None:
        print("! 无法读取数据库，请先确认 TeacherAgent 已运行并初始化 DB")
        return
    base_snap, base_last_sync, base_received = base
    print("=" * 72)
    print("同步实时监测（从现在开始，记录接下来每次同步，默认最近 10 次）")
    print(f"当前基线: 快照 {base_snap} 条  最近落库 {_fmt_dt(base_received) if base_received else '--'}")
    print("桌面端保持运行；在手机上每次点「同步」，这里就会实时打出该次记录。Ctrl+C 停止。")
    print("=" * 72)

    prev_snap = base_snap
    prev_received = base_received
    prev_db = 0
    global_peak_cpu = 0.0
    global_peak_mem = 0
    global_peak_db_growth = 0
    records = []
    deadline = time.time() + timeout_sec if timeout_sec else None

    def summary(mark, counts_label, dur_label):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] ✓ 检测到一次同步完成")
        print(f"    落库时刻: {mark}")
        print(f"    实体量:   {counts_label}")
        print(f"    与上一次同步间隔: {dur_label}")
        print(f"    当前全程峰值 CPU/内存: {global_peak_cpu:.1f}% / {_fmt_bytes(global_peak_mem)}"
              f"   峰值 DB 增长: {_fmt_bytes(global_peak_db_growth)}/s")
        print("    --------------------------------------------")

    try:
        while True:
            if deadline and time.time() > deadline:
                print("\n! 到达 --watch-timeout，停止等待。")
                break

            cost = sample_proc_cost(db_path, prev_db)
            prev_db = cost.db_size_bytes
            global_peak_cpu = max(global_peak_cpu, cost.cpu_percent)
            global_peak_mem = max(global_peak_mem, cost.mem_rss_bytes)
            global_peak_db_growth = max(global_peak_db_growth, cost.db_size_delta)

            from sqlite3 import connect as _conn
            try:
                c = _conn(db_path, timeout=4)
                r = c.execute(
                    "SELECT COUNT(*), MAX(received_at_ms) FROM sync_snapshots"
                ).fetchone()
                c.close()
                snap, received = r[0], r[1]
            except Exception:  # noqa: BLE001
                snap, received = prev_snap, prev_received

            if snap > prev_snap:
                dur = None
                if prev_received and received:
                    dur = (received - prev_received) / 1000.0
                counts = ""
                try:
                    c = _conn(db_path, timeout=4)
                    row = c.execute(
                        "SELECT subject_count, goal_count, task_count, session_count "
                        "FROM sync_snapshots WHERE received_at_ms=?",
                        (received,),
                    ).fetchone()
                    c.close()
                    if row:
                        counts = (f"科目 {row[0]} 目标 {row[1]} 任务 {row[2]} 会话 {row[3]}")
                except Exception:  # noqa: BLE001
                    pass
                summary(
                    _parse_ms(received),
                    counts or "未知",
                    _fmt_sec(dur) if dur is not None else "首次(无先前基线)",
                )
                records.append({"received_at_ms": received, "counts": counts, "interval_sec": dur})
                prev_snap = snap
                prev_received = received

            time.sleep(1)
    except KeyboardInterrupt:
        print("\n已停止监测。")

    if records:
        print("\n本次监测共记录 {} 次同步：".format(len(records)))
        for i, rec in enumerate(records[-10:], 1):
            print(f"  {i:>2}. {_parse_ms(rec['received_at_ms'])}  {rec['counts'] or ''}  "
                  f"间隔 {_fmt_sec(rec['interval_sec']) if rec['interval_sec'] is not None else '—'}")
        print(f"\n整体峰值 CPU {global_peak_cpu:.1f}% | 峰值内存 {_fmt_bytes(global_peak_mem)} | "
              f"峰值 DB 增长 {_fmt_bytes(global_peak_db_growth)}/s")
    else:
        print("\n等待期间未检测到任何新同步。")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(description="TeacherAgent / AlertTime 同步耗时与系统开销诊断")
    parser.add_argument("--db", default=DEFAULT_DB, help="TeacherAgent SQLite 库路径")
    parser.add_argument("--live", nargs="?", const=10, type=int, help="实时采样 N 次(默认 10)")
    parser.add_argument("--watch", action="store_true",
                        help="实时监测下一次同步：等待新快照，记录同步耗时与系统开销峰值")
    parser.add_argument("--watch-timeout", type=int, default=0,
                        help="--watch 最长等待秒数(0=不限，默认)")
    parser.add_argument("--csv", help="导出同步时间线到 CSV")
    parser.add_argument("--json", help="导出结果到 JSON")
    parser.add_argument("--table", action="store_true", help="打印同步快照时间线表格")
    args = parser.parse_args(argv)

    if args.watch:
        run_watch(args.db, args.watch_timeout)
        return

    a = analyze_db(args.db)
    st = sync_timing(a)
    cost = sample_proc_cost(args.db)

    print_system_overview(a, st, cost)
    if args.table:
        print_snapshot_table(a)
    if args.csv:
        export_csv(a, args.csv)
    if args.json:
        export_json(a, st, cost, args.json)

    if args.live is not None:
        print()
        run_live(args.db, args.live)

    if not a.exists and not a.error:
        sys.exit(2)
    if a.error and not a.exists:
        sys.exit(1)


if __name__ == "__main__":
    main()
