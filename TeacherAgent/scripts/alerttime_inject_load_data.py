#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""向 AlertTime 手机库注入压测规模的学习记录，用于真机同步性能实验（论文表6）。

口径与 `scripts/sync-benchmark.py` 的 `build_snapshot_counts` 保持一致：
`快照实体总数 ≈ 科目 + 周目标 + 任务 + 会话`，其中任务:会话 = 4:20、周目标每天 1/7。
脚本按目标"快照实体总数"反算需要注入多少行，使真机测量结果可与表6 的 10,008 行直接对照。

所有注入行都带标记，便于一键清理：
  * `remote_id` 统一以 `10000000-0000-4000-8000-` 开头（合法 UUID 格式，可 LIKE 匹配）；
  * 会话/任务正文前缀 `【压测】`，会话 `note` 写入 `loadtest-<批次日期>`。

用法：
    python alerttime_inject_load_data.py --in <库副本> --out <注入后库> [--total 10008]
"""

import argparse
import random
import sqlite3
import sys
import time
import uuid
from datetime import datetime, time as clock_time, timedelta, timezone
from zoneinfo import ZoneInfo

# 手机端 `PlanRepository.startOfWeek` 用 ZoneId.systemDefault()（Asia/Shanghai），
# 周起算必须按同一时区对齐，否则「本周目标」按精确值查不到。
LOCAL_ZONE = ZoneInfo("Asia/Shanghai")

SEED = 20260911
MARKER_PREFIX = "【压测】"
NOTE_MARKER = "loadtest-20260911"
REMOTE_PREFIX = "10000000-0000-4000-8000-"
DAY_MS = 86_400_000
WEEK_MS = 7 * DAY_MS

SUBJECT_NAMES = ["未分类", "英语", "数学", "专业课", "阅读", "线性代数", "高等数学",
                 "概率论", "政治", "计算机组成原理", "计算机操作系统", "数据结构", "计算机网络"]
TASK_TITLES = ["真题一套", "错题复盘", "章节练习", "笔记整理", "背诵打卡",
               "公式推导", "教材精读", "模拟卷", "大题专项", "单词二轮"]


def remote_id(seq: int) -> str:
    """可识别的合法 UUID（固定前缀 + 序号）。"""
    return f"{REMOTE_PREFIX}{seq:012d}"


def week_start_ms(moment_ms: int) -> int:
    """对齐到自然周（本地时区的周一 00:00），与手机端 startOfWeek 同口径。"""
    dt = datetime.fromtimestamp(moment_ms / 1000, tz=LOCAL_ZONE)
    monday = dt - timedelta(days=dt.weekday())
    aligned = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(aligned.timestamp() * 1000)


def existing_counts(connection: sqlite3.Connection) -> dict:
    pick = lambda table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    return {
        "subjects": pick("subjects"),
        "weekly_goals": pick("weekly_goals"),
        "tasks": pick("tasks"),
        "study_sessions": pick("study_sessions"),
    }


def plan_injection(current: dict, total_entities: int) -> dict:
    """按 4:20:1/7 比例反算注入量，使 4 类实体合计命中目标总数。"""
    remaining = total_entities - sum(current.values())
    if remaining <= 0:
        return {"weekly_goals": 0, "tasks": 0, "study_sessions": 0, "shortfall": 0}
    unit = 4 + 20 + 1 / 7  # 每天
    days = max(1, round(remaining / unit))
    tasks = days * 4
    sessions = days * 20
    goals = max(1, round(days / 7))
    # 值班比例取整会与目标差几条，从任务池里找平，使实体总数精确命中
    overshoot = (tasks + sessions + goals) - remaining
    tasks = max(0, tasks - overshoot)
    return {"weekly_goals": goals, "tasks": tasks, "study_sessions": sessions,
            "days": days,
            "shortfall": remaining - (tasks + sessions + goals)}


def inject(connection: sqlite3.Connection, plan: dict, user_id: int, subject_ids: list) -> dict:
    rng = random.Random(SEED)
    now_ms = int(time.time() * 1000)
    span_ms = plan["days"] * DAY_MS
    sequence = [0]  # 共享序号，保证 remote_id 唯一

    def next_remote() -> str:
        sequence[0] += 1
        return remote_id(sequence[0])

    # ── 周目标：沿时间轴每 7 天一个 ────────────────────────────────
    goal_rows = []
    for index in range(plan["weekly_goals"]):
        start = week_start_ms(now_ms - (plan["weekly_goals"] - 1 - index) * WEEK_MS)
        goal_rows.append((
            next_remote(), user_id, start, f"{MARKER_PREFIX}第{index + 1}周目标",
            "完成 20 小时学习", 0 if index % 3 else 1,
            None, None, None, start, start, None, 0,
        ))
    connection.executemany(
        """INSERT INTO weekly_goals (remote_id, user_id, week_start, title, success_criteria,
             status, completed_at, deferred_to_week_start, exception_reason,
             created_at, updated_at, deleted_at, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        goal_rows,
    )

    # ── 任务：每人每天 4 条 ───────────────────────────────────────
    task_rows = []
    task_meta = []  # (remote_id, subject_id, start_ms) 供会话关联
    # 最新一天 = 昨天：避免生成未来时间戳（当前时刻可能是凌晨）
    local_today = datetime.fromtimestamp(now_ms / 1000, tz=LOCAL_ZONE).date()
    for index in range(plan["tasks"]):
        day = index // 4
        day_date = local_today - timedelta(days=plan["days"] - day)
        base = int(datetime.combine(day_date, clock_time(8, 0), tzinfo=LOCAL_ZONE).timestamp() * 1000)
        start = base + (index % 4) * 3_600_000
        subject_id = subject_ids[index % len(subject_ids)]
        title = f"{MARKER_PREFIX}{TASK_TITLES[index % len(TASK_TITLES)]} {index + 1}"
        rid = next_remote()
        status = 1 if rng.random() < 0.7 else 0
        task_rows.append((
            rid, user_id, subject_id, title, "压测数据，可安全删除", 1,
            rng.randint(0, 2), status,   # 协议限定 priority ∈ 0..2（0低/1中/2高）；曾误用 1..3 导致手机端自检拒绝
            rng.choice([1800, 2700, 3600]), start + 7200_000,
            start + 3600_000 if status else None, index, start, start, None, 0,
        ))
        task_meta.append((rid, subject_id, start))
    connection.executemany(
        """INSERT INTO tasks (remote_id, user_id, subject_id, title, content, type, priority,
             status, target_duration_seconds, due_at, completed_at, sort_order,
             created_at, updated_at, deleted_at, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        task_rows,
    )

    # ── 会话：每个任务 5 条，关联到该任务 ─────────────────────────
    session_rows = []
    for index in range(plan["study_sessions"]):
        task_remote, subject_id, task_start = task_meta[index % len(task_meta)]
        start = task_start + (index % 5) * 1_500_000
        duration = rng.choice([900, 1500, 1800, 2400, 3000, 3600])
        pause = rng.choice([0, 60, 120, 300])
        session_rows.append((
            next_remote(), user_id, subject_id, None,
            f"{MARKER_PREFIX}学习 {index + 1}", start, start + (duration + pause) * 1000,
            duration, pause, rng.randint(60, 98), NOTE_MARKER, 0,
            start, start, None, 0, 0,
        ))
    connection.executemany(
        """INSERT INTO study_sessions (remote_id, user_id, subject_id, task_id, title,
             start_time, end_time, duration_seconds, pause_seconds, focus_score, note,
             status, created_at, updated_at, deleted_at, sync_status, ai_help_seconds)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        session_rows,
    )
    connection.commit()
    return {"inserted_goals": len(goal_rows), "inserted_tasks": len(task_rows),
            "inserted_sessions": len(session_rows)}


def main() -> int:
    parser = argparse.ArgumentParser(description="注入压测学习记录到 AlertTime 库副本")
    parser.add_argument("--in", dest="source", required=True)
    parser.add_argument("--out", dest="target", required=True)
    parser.add_argument("--total", type=int, default=10008, help="目标快照实体总数（论文表6 口径）")
    args = parser.parse_args()

    # 以备份 API 取一致副本，避免手工 cp 拷贝到半截状态
    source = sqlite3.connect(f"file:{args.source}?mode=ro", uri=True)
    connection = sqlite3.connect(args.target)
    source.backup(connection)
    source.close()

    before = existing_counts(connection)
    user_id = connection.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()[0]
    subject_ids = [row[0] for row in connection.execute("SELECT id FROM subjects ORDER BY id")]
    if not subject_ids:
        print("库中没有科目，无法关联外键；请先在 App 里建科目", file=sys.stderr)
        return 1

    plan = plan_injection(before, args.total)
    print("注入前:", before, "合计", sum(before.values()))
    print("注入计划:", plan)

    with connection:
        inserted = inject(connection, plan, user_id, subject_ids)
    connection.close()

    check = sqlite3.connect(f"file:{args.target}?mode=ro", uri=True)
    after = existing_counts(check)
    integrity = check.execute("PRAGMA integrity_check").fetchone()[0]
    marked = check.execute(
        "SELECT COUNT(*) FROM study_sessions WHERE note = ?", (NOTE_MARKER,)
    ).fetchone()[0]
    check.close()

    print("注入完成:", inserted)
    print("注入后:", after, "合计", sum(after.values()))
    print("integrity_check:", integrity)
    print(f"带标记会话数: {marked}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
