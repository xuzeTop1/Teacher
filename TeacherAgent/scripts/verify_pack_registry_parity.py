#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pack 基线三方一致性校验（只读，不写任何文件/数据库）。

## 为什么需要它

approved 内容的权威源有两个，分属两种语言，且必须逐字一致：

    ① `src/services/knowledge/packManifest.ts`  —— 前端清单（向量生成、UI 统计、健康检查的"预期值"）
    ② `src-tauri/src/seed.rs::embedded_approved_knowledge_seeds()` —— Rust 内嵌清单（sync_approved_manifest 的唯一权威源）

"加包只改一边"是**已实际发生过的缺陷**：`civil-common-sense-scope`
（approved、2 节点 / 2 题）进了 ① 但没进 ②，于是：

    * 清单/向量：773 个知识点    库内：771 行
    * GUI「一键同步」报「新增 0，跳过 771」——**永远补不上**
    * 健康检查长期报「缺少 2 个节点」
    * 那 2 个向量悬挂（有向量、无正文行）

本脚本把这类不一致变成**一条命令可查**的守门检查。

## 检查项

1. approved pack 集合：manifest == seed.rs（集合相等，双向报差异）
2. 每个 pack 的 subject 三方一致（manifest / seed.rs / seed 文件）
3. 每个 pack 的节点数三方一致（manifest.expectedNodeCount / seed.rs 声明 / seed 文件实际）
4. approved 节点合计 == `--expect-nodes`（默认 773），题目合计 == `--expect-questions`（默认 764）
5. （可选 --db）库内 approved 节点/题目数 与基线一致，且向量零悬挂
6. （可选 --db）**draft pack 的节点/题目不得有向量**（治理要求：草稿不进 RAG）

## 用法

    python scripts/verify_pack_registry_parity.py
    python scripts/verify_pack_registry_parity.py --db                 # 连库一起查
    python scripts/verify_pack_registry_parity.py --expect-nodes 775   # 基线变更后

退出码：0 = 全部一致；1 = 存在不一致；2 = 输入文件缺失。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MANIFEST = os.path.join(REPO_ROOT, "src", "services", "knowledge", "packManifest.ts")
DEFAULT_SEED_RS = os.path.join(REPO_ROOT, "src-tauri", "src", "seed.rs")
DEFAULT_DB = r"<APPDATA>\Roaming\com.teacheragent.app\teacher_agent.sqlite3"

FAILURES: list[str] = []
WARNINGS: list[str] = []


def fail(message: str) -> None:
    FAILURES.append(message)


def warn(message: str) -> None:
    WARNINGS.append(message)


# ── 解析 ──────────────────────────────────────────────────────────────

def parse_manifest(path: str) -> list[dict]:
    text = open(path, encoding="utf-8").read()
    packs = []
    for chunk in re.split(r"\n\s*\{\s*\n", text)[1:]:
        def s(key: str):
            m = re.search(rf'\b{key}:\s*"([^"]*)"', chunk)
            return m.group(1) if m else None

        def n(key: str):
            m = re.search(rf"\b{key}:\s*(\d+)", chunk)
            return int(m.group(1)) if m else None

        pid = s("id")
        if pid:
            packs.append(
                {
                    "id": pid,
                    "subject": s("subject"),
                    "status": s("status"),
                    "nodes": n("expectedNodeCount"),
                    "questions": n("expectedQuestionCount"),
                }
            )
    return packs


def parse_seed_rs(path: str) -> list[dict]:
    """从 seed.rs 的内嵌 definitions 数组提取 (pack_id, subject, expected_node_count, json_path)。"""
    text = open(path, encoding="utf-8").read()
    start = text.index("fn embedded_approved_knowledge_seeds()")
    end = text.index("\n}", text.index(".collect()", start))
    body = text[start:end]
    pattern = re.compile(
        r'"([^"]+)",\s*\n\s*"([^"]+)",\s*\n\s*(\d+),\s*\n\s*include_str!\("([^"]+)"\)',
    )
    packs = []
    for pid, subject, count, rel in pattern.findall(body):
        packs.append(
            {
                "id": pid,
                "subject": subject,
                "declared_nodes": int(count),
                "json_rel": rel,
            }
        )
    declared = re.search(r"definitions:\s*\[\(&str,\s*&str,\s*usize,\s*&str\);\s*(\d+)\]", text)
    return packs, (int(declared.group(1)) if declared else None)


def load_seed_file(rel_from_seed_rs: str) -> dict:
    """seed.rs 里的 include_str! 路径是相对 src-tauri/src/ 的。"""
    abs_path = os.path.normpath(os.path.join(REPO_ROOT, "src-tauri", "src", rel_from_seed_rs))
    data = json.load(open(abs_path, encoding="utf-8"))
    return {"path": abs_path, "data": data, "nodes": data.get("nodes") or []}


def load_question_seed(pack_id: str) -> dict | None:
    path = os.path.join(REPO_ROOT, "data", "questions", f"{pack_id}.seed.json")
    if not os.path.exists(path):
        return None
    return json.load(open(path, encoding="utf-8"))


# ── 主流程 ────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="Pack 基线三方一致性校验（只读）")
    ap.add_argument("--manifest", default=DEFAULT_MANIFEST)
    ap.add_argument("--seed-rs", default=DEFAULT_SEED_RS)
    ap.add_argument("--db", nargs="?", const=DEFAULT_DB, default=None,
                    help="可选：连库校验；不带值则用默认库路径")
    ap.add_argument("--expect-nodes", type=int, default=773)
    ap.add_argument("--expect-questions", type=int, default=764)
    args = ap.parse_args()

    for path in (args.manifest, args.seed_rs):
        if not os.path.exists(path):
            print(f"[!] 缺少输入文件: {path}")
            return 2

    manifest = parse_manifest(args.manifest)
    seeds, declared_len = parse_seed_rs(args.seed_rs)

    if declared_len is not None and declared_len != len(seeds):
        fail(f"seed.rs 数组声明长度 {declared_len} != 实际解析到的条目数 {len(seeds)}")

    m_by_id = {p["id"]: p for p in manifest}
    s_by_id = {p["id"]: p for p in seeds}
    m_approved = {p["id"] for p in manifest if p["status"] == "approved"}
    s_ids = set(s_by_id)

    # ① approved 集合相等
    for pid in sorted(m_approved - s_ids):
        fail(f"manifest approved 但 seed.rs 未内嵌：{pid}")
    for pid in sorted(s_ids - m_approved):
        fail(f"seed.rs 内嵌但 manifest 非 approved：{pid}")

    # ②③ 逐包字段一致
    approved_nodes = approved_questions = 0
    for pid in sorted(m_approved & s_ids):
        m, s = m_by_id[pid], s_by_id[pid]
        seed = load_seed_file(s["json_rel"])
        if seed["data"].get("status") != "approved":
            fail(f"{pid}: seed 文件 status={seed['data'].get('status')}，Rust 内嵌清单要求 approved")
        if not (m["subject"] == s["subject"] == seed["data"].get("subject")):
            fail(f"{pid}: subject 不一致 manifest={m['subject']} seed.rs={s['subject']} file={seed['data'].get('subject')}")
        if not (m["nodes"] == s["declared_nodes"] == len(seed["nodes"])):
            fail(f"{pid}: 节点数不一致 manifest={m['nodes']} seed.rs={s['declared_nodes']} file={len(seed['nodes'])}")
        approved_nodes += len(seed["nodes"])

        q = load_question_seed(pid)
        if q is None:
            warn(f"{pid}: 无题库 seed 文件")
            continue
        if q.get("status") != "approved":
            fail(f"{pid}: 题库 seed status={q.get('status')}")
        if len(q.get("questions") or []) != m["questions"]:
            fail(f"{pid}: 题目数不一致 manifest={m['questions']} file={len(q.get('questions') or [])}")
        approved_questions += len(q.get("questions") or [])

    # ④ 合计
    if approved_nodes != args.expect_nodes:
        fail(f"approved 节点合计 {approved_nodes} != 基线 {args.expect_nodes}")
    if approved_questions != args.expect_questions:
        fail(f"approved 题目合计 {approved_questions} != 基线 {args.expect_questions}")

    print("清单 ↔ seed.rs ↔ seed 文件")
    print(f"  manifest: {len(manifest)} 包（approved {len(m_approved)}，draft {len(manifest) - len(m_approved)}）")
    print(f"  seed.rs : {len(seeds)} 包内嵌")
    print(f"  approved: {approved_nodes} 知识点 / {approved_questions} 题目（基线 {args.expect_nodes} / {args.expect_questions}）")

    # ── 可选：库校验 ──
    if args.db:
        if not os.path.exists(args.db):
            fail(f"数据库不存在: {args.db}")
        else:
            con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
            try:
                db_nodes = con.execute(
                    "SELECT COUNT(*) FROM knowledge_nodes WHERE review_status='approved'"
                ).fetchone()[0]
                db_questions = con.execute(
                    "SELECT COUNT(*) FROM questions WHERE review_status='approved'"
                ).fetchone()[0]
                orphan_node = con.execute(
                    """SELECT COUNT(*) FROM vector_embeddings v
                        WHERE v.entity_type='knowledge_node'
                          AND NOT EXISTS (SELECT 1 FROM knowledge_nodes k WHERE k.id=v.entity_id)"""
                ).fetchone()[0]
                orphan_question = con.execute(
                    """SELECT COUNT(*) FROM vector_embeddings v
                        WHERE v.entity_type='question'
                          AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.id=v.entity_id)"""
                ).fetchone()[0]

                print("\n库")
                print(f"  approved 节点 = {db_nodes}（基线 {args.expect_nodes}）")
                print(f"  approved 题目 = {db_questions}（基线 {args.expect_questions}）")
                print(f"  悬挂向量     = node {orphan_node} / question {orphan_question}")

                if db_nodes != args.expect_nodes:
                    fail(f"库内 approved 节点 {db_nodes} != 基线 {args.expect_nodes}（GUI 同步可能没跑或没补上）")
                if db_questions != args.expect_questions:
                    fail(f"库内 approved 题目 {db_questions} != 基线 {args.expect_questions}")
                if orphan_node or orphan_question:
                    fail(f"存在悬挂向量：node {orphan_node} / question {orphan_question}")

                # ⑥ draft 不得进 RAG（无向量）
                draft_ids = set()
                for p in manifest:
                    if p["status"] == "approved":
                        continue
                    kp = os.path.join(REPO_ROOT, "data", "knowledge", f"{p['id']}.seed.json")
                    if os.path.exists(kp):
                        d = json.load(open(kp, encoding="utf-8"))
                        draft_ids |= {n["id"] for n in (d.get("nodes") or [])}
                    qp = os.path.join(REPO_ROOT, "data", "questions", f"{p['id']}.seed.json")
                    if os.path.exists(qp):
                        d = json.load(open(qp, encoding="utf-8"))
                        draft_ids |= {q["id"] for q in (d.get("questions") or [])}
                if draft_ids:
                    leaked = con.execute(
                        f"""SELECT COUNT(*) FROM vector_embeddings
                             WHERE entity_id IN ({','.join('?' * len(draft_ids))})""",
                        tuple(draft_ids),
                    ).fetchone()[0]
                    print(f"  draft 实体 {len(draft_ids)} 个，其中带向量的 = {leaked}（治理要求 0）")
                    if leaked:
                        fail(f"draft pack 的 {leaked} 个实体被生成了向量，违反「草稿不进 RAG」")
            finally:
                con.close()

    print()
    if WARNINGS:
        print("提示：")
        for w in WARNINGS:
            print("  -", w)
    if FAILURES:
        print("不一致：")
        for f in FAILURES:
            print("  ✗", f)
        return 1
    print("✅ 全部一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
