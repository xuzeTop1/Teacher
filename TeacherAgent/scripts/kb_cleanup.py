#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TeacherAgent 知识库清理脚本（默认 dry-run，写库前自动全量备份）。

背景：`src-tauri/src/conversation.rs` 的 ensure_subject 会在「为不存在的科目开
会话」时静默执行 `INSERT OR IGNORE INTO subjects`，于是没有任何 Pack 的 code
（如 accounting / law）会在科目表里留下永久空行，界面上表现为「Pack 列表为空」。

本脚本用于清理这类"空科目行"：连同它们的默认对话一起删除。

用法：
    # 1) 只看会删什么（不写库）
    python scripts/kb_cleanup.py --subject subject-law --subject subject-accounting

    # 2) 真正执行（自动备份）
    python scripts/kb_cleanup.py --subject subject-law --subject subject-accounting --apply

    # 3) 自动发现所有"0 节点、0 Pack"的空科目
    python scripts/kb_cleanup.py --auto-discover --apply

安全：
    * 默认 dry-run；必须显式 --apply 才写库
    * 写库前用 SQLite Backup API 做全量备份（不依赖文件拷贝，WAL 下也安全）
    * 只删 subjects 行与引用它的 conversations 行（连同会话的子数据）
    * 删完自动校验并打印结果
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime

DEFAULT_DB = r"<APPDATA>\Roaming\com.teacheragent.app\teacher_agent.sqlite3"

# 已知的"科目 → 默认会话"命名规则（conversation.rs 生成）
def default_conversation_id(subject_id: str) -> str:
    return f"local-default-conversation-{subject_id.removeprefix('subject-')}"


def backup_database(src_path: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dst_path = f"{src_path}.backup-pre-cleanup-{stamp}"
    src = sqlite3.connect(src_path)
    dst = sqlite3.connect(dst_path)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    print(f"[+] 备份完成: {dst_path}  ({os.path.getsize(dst_path)} bytes)")
    return dst_path


def discover_empty_subjects(con: sqlite3.Connection) -> list[tuple[str, str, int, int]]:
    """返回 (subject_id, name, 会话数, 节点数)，仅含 0 节点者。"""
    sql = """
        SELECT s.id, s.name,
               (SELECT COUNT(*) FROM conversations c WHERE c.subject_id = s.id),
               (SELECT COUNT(*) FROM knowledge_nodes k WHERE k.subject_id = s.id)
        FROM subjects s
        ORDER BY s.id
    """
    return [r for r in con.execute(sql) if r[3] == 0]


def collect_conversations(con: sqlite3.Connection, subject_ids: list[str]) -> list[str]:
    marks = ",".join("?" * len(subject_ids))
    rows = con.execute(
        f"SELECT id FROM conversations WHERE subject_id IN ({marks})", subject_ids
    ).fetchall()
    return [r[0] for r in rows]


def child_tables_of_conversation(con: sqlite3.Connection) -> list[str]:
    tabs = []
    for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type='table'"):
        if name.startswith("sqlite_"):
            continue
        cols = [r[1] for r in con.execute(f"PRAGMA table_info({name})")]
        if "conversation_id" in cols:
            tabs.append(name)
    return tabs


def main() -> int:
    ap = argparse.ArgumentParser(description="清理 TeacherAgent 空科目行")
    ap.add_argument("--db", default=DEFAULT_DB, help="数据库路径")
    ap.add_argument("--subject", action="append", default=[],
                    help="要删除的 subject_id，可重复指定")
    ap.add_argument("--auto-discover", action="store_true",
                    help="自动把 0 节点科目全部纳入删除范围")
    ap.add_argument("--apply", action="store_true", help="真正写库（默认只演练）")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print(f"[!] 数据库不存在: {args.db}")
        return 2

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row

    print("=" * 68)
    print("  科目表现状")
    print("=" * 68)
    for sid, name, convs, nodes in discover_empty_subjects(con) or []:
        print(f"   {sid:24} {name:8} 会话={convs:<3} 节点={nodes}   ← 0 节点")
    total_nodes = con.execute(
        "SELECT COUNT(*) FROM knowledge_nodes"
    ).fetchone()[0]
    print(f"   （有内容的科目未列出；knowledge_nodes 共 {total_nodes} 行）")

    targets = list(dict.fromkeys(args.subject))
    if args.auto_discover:
        targets += [r[0] for r in discover_empty_subjects(con)]
        targets = list(dict.fromkeys(targets))

    if not targets:
        print("\n[!] 没有指定要删除的科目（用 --subject，或 --auto-discover）")
        con.close()
        return 1

    # 安全闸：只允许删 0 节点的科目
    print("\n" + "=" * 68)
    print("  删除范围")
    print("=" * 68)
    safe_targets, refused = [], []
    for sid in targets:
        row = con.execute("SELECT id, name FROM subjects WHERE id=?", (sid,)).fetchone()
        if row is None:
            print(f"   [跳过] {sid} —— 科目不存在")
            continue
        nodes = con.execute(
            "SELECT COUNT(*) FROM knowledge_nodes WHERE subject_id=?", (sid,)
        ).fetchone()[0]
        if nodes > 0:
            refused.append((sid, row["name"], nodes))
            print(f"   [拒绝] {sid} ({row['name']}) —— 有 {nodes} 个知识节点，不允许删")
            continue
        safe_targets.append((sid, row["name"]))

    if not safe_targets:
        print("\n[!] 没有可安全删除的目标")
        con.close()
        return 1

    convs = collect_conversations(con, [s for s, _ in safe_targets])
    print(f"\n   待删科目 ({len(safe_targets)}):")
    for sid, name in safe_targets:
        print(f"      - {sid}  ({name})")
    print(f"\n   待删会话 ({len(convs)}):")
    for cid in convs:
        n = con.execute(
            "SELECT COUNT(*) FROM messages WHERE conversation_id=?", (cid,)
        ).fetchone()[0]
        if n:
            print(f"      - {cid}   ⚠ 含 {n} 条消息！")
        else:
            print(f"      - {cid}   (0 条消息)")

    # 会话子数据统计
    child_tabs = child_tables_of_conversation(con)
    child_counts = {}
    for t in child_tabs:
        if not convs:
            break
        marks = ",".join("?" * len(convs))
        try:
            n = con.execute(
                f"SELECT COUNT(*) FROM {t} WHERE conversation_id IN ({marks})", convs
            ).fetchone()[0]
        except sqlite3.Error:
            continue
        if n:
            child_counts[t] = n
    if child_counts:
        print("\n   会话子数据:")
        for t, n in child_counts.items():
            print(f"      - {t}: {n} 行")

    if not args.apply:
        print("\n" + "=" * 68)
        print("  [dry-run] 未写库。加 --apply 才真正执行。")
        print("=" * 68)
        con.close()
        return 0

    # ---- 写库 ----
    con.close()
    backup_database(args.db)

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    try:
        con.execute("BEGIN")
        deleted_children = {}
        for t, _ in child_counts.items():
            marks = ",".join("?" * len(convs))
            cur = con.execute(
                f"DELETE FROM {t} WHERE conversation_id IN ({marks})", convs
            )
            deleted_children[t] = cur.rowcount
        marks = ",".join("?" * len(convs))
        cur = con.execute(f"DELETE FROM conversations WHERE id IN ({marks})", convs)
        deleted_convs = cur.rowcount
        marks = ",".join("?" * len(safe_targets))
        cur = con.execute(
            f"DELETE FROM subjects WHERE id IN ({marks})", [s for s, _ in safe_targets]
        )
        deleted_subjects = cur.rowcount
        con.commit()
    except Exception as exc:  # noqa: BLE001
        con.rollback()
        print(f"[!] 失败已回滚: {exc}")
        con.close()
        return 3

    print(f"\n[+] 删除完成：subjects {deleted_subjects} 行，conversations {deleted_convs} 行"
          + (f"，子数据 {deleted_children}" if deleted_children else ""))

    print("\n" + "=" * 68)
    print("  校验")
    print("=" * 68)
    left = [s for s, _ in safe_targets
            if con.execute("SELECT 1 FROM subjects WHERE id=?", (s,)).fetchone()]
    print(f"   残留目标科目: {left or '无 ✓'}")
    print(f"   subjects 剩余 {con.execute('SELECT COUNT(*) FROM subjects').fetchone()[0]} 行")
    print(f"   knowledge_nodes 仍为 {con.execute('SELECT COUNT(*) FROM knowledge_nodes').fetchone()[0]} 行（不应变化）")
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    print(f"   integrity_check: {integrity}")
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
