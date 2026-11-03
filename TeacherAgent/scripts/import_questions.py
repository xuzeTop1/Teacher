#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 approved 题库 seed 导入 `questions` 表（默认 dry-run，写库前自动全量备份）。

背景：`questions` 表由 `migrations/0001_initial.sql` 建好，但**全仓库没有任何写入方**
（无 `INSERT INTO questions`）。而向量侧已为 764 道 approved 题目生成了
`vector_embeddings(entity_type='question')`。结果是：

    vector_embeddings 里 764 条 question 向量  ←→  questions 表 0 行

运行时的对话检索不读这张表（题目正文由前端 packLoader 直接读 seed JSON），
所以聊天功能正常；但**评测/统计口径**需要这张表：`experiments/hybrid_retrieval/run_eval.py`
的 `load_corpus()` 只从 `private_document_chunks` + `knowledge_nodes` 取语料，
于是 764 条题目向量在稠密通道里是"永远不可能命中"的噪声，会系统性压低
dense / hybrid 的 Hit@3、MRR、NDCG@5。

本脚本以 `src/services/knowledge/packManifest.ts` 为权威清单（只取 status=approved），
按 `seed.rs::sync_approved_manifest` 的同一套字段映射写入 `questions`。

用法：
    # 1) 只看会写什么（不写库）
    python scripts/import_questions.py

    # 2) 真正执行（自动备份）
    python scripts/import_questions.py --apply

安全：
    * 默认 dry-run；必须显式 --apply 才写库
    * 写库前用 SQLite Backup API 做全量备份（WAL 下也安全）
    * 幂等：按 id upsert，重复执行结果一致
    * 只写 questions 表，不触碰其它表
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = r"<APPDATA>\Roaming\com.teacheragent.app\teacher_agent.sqlite3"
DEFAULT_MANIFEST = os.path.join(REPO_ROOT, "src", "services", "knowledge", "packManifest.ts")
DEFAULT_DATA_DIR = os.path.join(REPO_ROOT, "data", "questions")

# 与 Rust 侧 strftime('%Y-%m-%dT%H:%M:%fZ','now') 的形状对齐
def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"


# ── 清单解析 ──────────────────────────────────────────────────────────

def parse_manifest(path: str) -> list[dict]:
    """从 packManifest.ts 提取 pack 条目（字段级正则，避免依赖 TS 解析器）。"""
    text = open(path, encoding="utf-8").read()
    chunks = re.split(r"\n\s*\{\s*\n", text)[1:]
    packs: list[dict] = []
    for chunk in chunks:
        def s(key: str):
            m = re.search(rf'\b{key}:\s*"([^"]*)"', chunk)
            return m.group(1) if m else None

        def n(key: str):
            m = re.search(rf"\b{key}:\s*(\d+)", chunk)
            return int(m.group(1)) if m else None

        pid = s("id")
        if not pid:
            continue
        packs.append(
            {
                "id": pid,
                "subject": s("subject"),
                "status": s("status"),
                "expectedQuestionCount": n("expectedQuestionCount") or 0,
            }
        )
    return packs


# ── 题目 seed → 表行 ──────────────────────────────────────────────────

def build_rows(packs: list[dict], data_dir: str) -> tuple[list[dict], list[str]]:
    rows: list[dict] = []
    problems: list[str] = []
    for pack in packs:
        if pack["status"] != "approved":
            continue
        seed_path = os.path.join(data_dir, f"{pack['id']}.seed.json")
        if not os.path.exists(seed_path):
            problems.append(f"{pack['id']}: 缺少 seed 文件 {seed_path}")
            continue
        seed = json.load(open(seed_path, encoding="utf-8"))
        questions = seed.get("questions") or []
        if len(questions) != pack["expectedQuestionCount"]:
            problems.append(
                f"{pack['id']}: seed 题目 {len(questions)} != 清单预期 {pack['expectedQuestionCount']}"
            )
        if seed.get("status") != pack["status"]:
            problems.append(f"{pack['id']}: seed status={seed.get('status')} 与清单 {pack['status']} 不一致")
        subject_code = seed.get("subject") or pack["subject"]
        for q in questions:
            source = q.get("source") or {}
            rows.append(
                {
                    "id": q["id"],
                    "subject_id": f"subject-{subject_code}",
                    "title": q.get("title"),
                    "content": q.get("content") or "",
                    "question_type": q.get("type") or "concept_check",
                    "difficulty": int(q.get("difficulty") or 1),
                    "answer": q.get("answer"),
                    "solution_steps_json": json.dumps(q.get("solutionSteps") or [], ensure_ascii=False),
                    "hints_json": json.dumps(q.get("hints") or [], ensure_ascii=False),
                    "knowledge_node_ids_json": json.dumps(q.get("knowledgeNodeIds") or [], ensure_ascii=False),
                    "source_id": None,
                    "license_snapshot": json.dumps(
                        {
                            "title": source.get("title") or "TeacherAgent seed",
                            "license": source.get("license") or "original",
                            "url": source.get("url"),
                            "sourceType": source.get("sourceType") or "original",
                        },
                        ensure_ascii=False,
                    ),
                    "review_status": "approved",
                }
            )
    # 去重保护（同一 id 出现在多个 pack 时后者覆盖）
    seen: dict[str, dict] = {}
    dup = 0
    for row in rows:
        if row["id"] in seen:
            dup += 1
        seen[row["id"]] = row
    if dup:
        problems.append(f"发现 {dup} 个重复题目 id（已按最后一次出现去重）")
    return list(seen.values()), problems


# ── DB ────────────────────────────────────────────────────────────────

def backup_database(src_path: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dst_path = f"{src_path}.backup-pre-questions-{stamp}"
    src = sqlite3.connect(src_path)
    dst = sqlite3.connect(dst_path)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    print(f"[+] 备份完成: {dst_path}  ({os.path.getsize(dst_path)} bytes)")
    return dst_path


UPSERT = """
INSERT INTO questions (
    id, subject_id, title, content, question_type, difficulty, answer,
    solution_steps_json, hints_json, knowledge_node_ids_json,
    source_id, license_snapshot, review_status, created_at, updated_at
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
ON CONFLICT(id) DO UPDATE SET
    subject_id = excluded.subject_id,
    title = excluded.title,
    content = excluded.content,
    question_type = excluded.question_type,
    difficulty = excluded.difficulty,
    answer = excluded.answer,
    solution_steps_json = excluded.solution_steps_json,
    hints_json = excluded.hints_json,
    knowledge_node_ids_json = excluded.knowledge_node_ids_json,
    source_id = excluded.source_id,
    license_snapshot = excluded.license_snapshot,
    review_status = excluded.review_status,
    updated_at = excluded.updated_at
"""


def report(con: sqlite3.Connection, rows: list[dict]) -> dict:
    stats: dict = {}
    stats["questions_rows"] = con.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    stats["questions_approved"] = con.execute(
        "SELECT COUNT(*) FROM questions WHERE review_status='approved'"
    ).fetchone()[0]
    stats["question_vectors"] = con.execute(
        "SELECT COUNT(*) FROM vector_embeddings WHERE entity_type='question'"
    ).fetchone()[0]
    stats["vectors_without_row"] = con.execute(
        """SELECT COUNT(*) FROM vector_embeddings v
            WHERE v.entity_type='question'
              AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = v.entity_id)"""
    ).fetchone()[0]
    stats["rows_without_vector"] = con.execute(
        """SELECT COUNT(*) FROM questions q
            WHERE NOT EXISTS (
                SELECT 1 FROM vector_embeddings v
                 WHERE v.entity_type='question' AND v.entity_id = q.id)"""
    ).fetchone()[0]
    missing_subjects = sorted(
        {r["subject_id"] for r in rows
         if not con.execute("SELECT 1 FROM subjects WHERE id=?1", (r["subject_id"],)).fetchone()}
    )
    stats["missing_subjects"] = missing_subjects
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description="把 approved 题库 seed 导入 questions 表")
    ap.add_argument("--db", default=DEFAULT_DB, help="目标 SQLite 路径")
    ap.add_argument("--manifest", default=DEFAULT_MANIFEST, help="packManifest.ts 路径")
    ap.add_argument("--data-dir", default=DEFAULT_DATA_DIR, help="data/questions 目录")
    ap.add_argument("--apply", action="store_true", help="真正写库（默认只演练）")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print(f"[!] 数据库不存在: {args.db}")
        return 1

    packs = parse_manifest(args.manifest)
    approved = [p for p in packs if p["status"] == "approved"]
    rows, problems = build_rows(packs, args.data_dir)

    print(f"清单 pack: {len(packs)}（approved {len(approved)}，draft {len(packs) - len(approved)}）")
    print(f"待写入题目: {len(rows)}")
    if problems:
        print("\n[!] 发现问题：")
        for p in problems:
            print("    -", p)
    if rows:
        print("\n样例（首条）：")
        sample = dict(rows[0])
        sample["solution_steps_json"] = sample["solution_steps_json"][:60] + "…"
        sample["hints_json"] = sample["hints_json"][:60] + "…"
        print("   ", json.dumps(sample, ensure_ascii=False)[:400])

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    try:
        print("\n写入前：")
        before = report(con, rows)
        for k, v in before.items():
            print(f"    {k} = {v}")
        if before["missing_subjects"]:
            print("\n[!] 以下科目在 subjects 表中不存在，写入会被外键/语义拒绝：")
            for s in before["missing_subjects"]:
                print("    -", s)
            print("    → 请先让 App 建好这些科目，或补 subjects 行后再执行。")
            return 2

        if not args.apply:
            print("\n[DRY-RUN] 未写库。加 --apply 执行。")
            return 0

        backup_database(args.db)
        stamp = now_iso()
        with con:
            for row in rows:
                con.execute(
                    UPSERT,
                    (
                        row["id"], row["subject_id"], row["title"], row["content"],
                        row["question_type"], row["difficulty"], row["answer"],
                        row["solution_steps_json"], row["hints_json"],
                        row["knowledge_node_ids_json"], row["source_id"],
                        row["license_snapshot"], row["review_status"], stamp,
                    ),
                )
        print(f"[+] 已写入 {len(rows)} 条（upsert）")

        print("\n写入后：")
        after = report(con, rows)
        for k, v in after.items():
            print(f"    {k} = {v}")

        ok = (
            after["questions_approved"] == len(rows)
            and after["vectors_without_row"] == 0
        )
        print("\n一致性:", "✅ 通过（764 条向量均有正文行）" if ok else "⚠️ 未完全对齐，请检查上面计数")
        return 0 if ok else 3
    finally:
        con.close()


if __name__ == "__main__":
    sys.exit(main())
