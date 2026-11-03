#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「清单已 approved 但库内缺失」的知识节点补进 knowledge_nodes（默认 dry-run）。

背景：`src-tauri/src/seed.rs::embedded_approved_knowledge_seeds()` 是 Rust 侧
approved 内容的**唯一权威源**（它同时喂给 `ApprovedManifestRegistry` 与
`sync_approved_manifest`）。若某个 pack 在 `packManifest.ts` 里标了 approved、
前端也据此生成了向量，却**没被加进这个数组**，就会出现：

    清单/向量：773 个知识点     库内：771 行     → 健康检查报「缺少 2 个节点」

而 GUI 的「一键同步」也补不上（因为权威源里就没有这两条）。

本脚本是该情形的 CLI 补救路径：按 manifest + seed 计算"应入库但缺失"的节点，
以与 `sync_approved_manifest` **同一套字段映射**写入。修好 seed.rs 后，GUI 同步
与「同步跳过 N」的口径即与本脚本一致。

用法：
    python scripts/apply_missing_approved_nodes.py            # 只看缺什么
    python scripts/apply_missing_approved_nodes.py --apply    # 写入（自动备份）
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
DEFAULT_DATA_DIR = os.path.join(REPO_ROOT, "data", "knowledge")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"


def create_slug(value: str) -> str:
    """镜像 Rust `shared.rs::create_slug`。"""
    out = "".join(
        c.lower() if (c.isascii() and c.isalnum()) or c in "-_" else "-"
        for c in value
    )
    return out.strip("-")


def truncate(value: str, limit: int) -> str:
    """镜像 Rust `truncate_for_storage` 的字符数上限语义。"""
    return value[:limit]


def parse_manifest(path: str) -> list[dict]:
    text = open(path, encoding="utf-8").read()
    packs = []
    for chunk in re.split(r"\n\s*\{\s*\n", text)[1:]:
        def s(key: str):
            m = re.search(rf'\b{key}:\s*"([^"]*)"', chunk)
            return m.group(1) if m else None

        pid = s("id")
        if pid:
            packs.append({"id": pid, "subject": s("subject"), "status": s("status")})
    return packs


def build_rows(packs: list[dict], data_dir: str) -> list[dict]:
    rows = []
    for pack in packs:
        if pack["status"] != "approved":
            continue
        seed_path = os.path.join(data_dir, f"{pack['id']}.seed.json")
        if not os.path.exists(seed_path):
            continue
        seed = json.load(open(seed_path, encoding="utf-8"))
        if seed.get("status") != "approved":
            continue
        subject_id = f"subject-{seed.get('subject') or pack['subject']}"
        for node in seed.get("nodes", []):
            source = node.get("source") or {}
            rows.append(
                {
                    "id": node["id"],
                    "subject_id": subject_id,
                    "title": truncate(node.get("title") or node["id"], 160),
                    "slug": create_slug(node["id"]),
                    "summary": node.get("summary") or "",
                    "level": node.get("level") or "concept",
                    "difficulty": min(max(int(node.get("difficulty") or 1), 1), 3),
                    "prerequisites_json": json.dumps(node.get("prerequisites") or [], ensure_ascii=False),
                    "misconceptions_json": json.dumps(node.get("misconceptions") or [], ensure_ascii=False),
                    "socratic_hints_json": json.dumps(node.get("socraticHints") or [], ensure_ascii=False),
                    "license_snapshot": json.dumps(
                        {
                            "title": source.get("title") or "TeacherAgent seed",
                            "license": source.get("license") or "original",
                            "url": source.get("url"),
                            "sourceType": source.get("sourceType") or "original",
                        },
                        ensure_ascii=False,
                    ),
                }
            )
    return rows


INSERT = """
INSERT INTO knowledge_nodes (
    id, subject_id, title, slug, summary, level, difficulty,
    prerequisites_json, misconceptions_json, socratic_hints_json,
    source_id, license_snapshot, review_status, created_at, updated_at
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, 'approved', ?12, ?12)
"""


def backup_database(src_path: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dst = f"{src_path}.backup-pre-nodes-{stamp}"
    src = sqlite3.connect(src_path)
    out = sqlite3.connect(dst)
    try:
        src.backup(out)
    finally:
        out.close()
        src.close()
    print(f"[+] 备份完成: {dst}  ({os.path.getsize(dst)} bytes)")
    return dst


def main() -> int:
    ap = argparse.ArgumentParser(description="补齐清单已 approved 但库内缺失的知识节点")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--manifest", default=DEFAULT_MANIFEST)
    ap.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    packs = parse_manifest(args.manifest)
    rows = build_rows(packs, args.data_dir)
    approved_total = len(rows)
    print(f"清单 approved 节点总数: {approved_total}")

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    try:
        existing = {r[0] for r in con.execute("SELECT id FROM knowledge_nodes")}
        missing = [r for r in rows if r["id"] not in existing]
        print(f"库内节点总数: {len(existing)}")
        print(f"缺失节点: {len(missing)}")
        for r in missing:
            print(f"    - {r['id']}  ({r['subject_id']})  {r['title']}")

        # 悬挂向量提示（有向量但没有正文行）
        orphan_vec = con.execute(
            """SELECT COUNT(*) FROM vector_embeddings v
                WHERE v.entity_type='knowledge_node'
                  AND NOT EXISTS (SELECT 1 FROM knowledge_nodes k WHERE k.id=v.entity_id)"""
        ).fetchone()[0]
        print(f"当前悬挂的 knowledge_node 向量: {orphan_vec}")

        if not missing:
            print("\n无需补齐。")
            return 0
        if not args.apply:
            print("\n[DRY-RUN] 未写库。加 --apply 执行。")
            return 0

        backup_database(args.db)
        stamp = now_iso()
        with con:
            for r in missing:
                con.execute(
                    INSERT,
                    (r["id"], r["subject_id"], r["title"], r["slug"], r["summary"],
                     r["level"], r["difficulty"], r["prerequisites_json"],
                     r["misconceptions_json"], r["socratic_hints_json"],
                     r["license_snapshot"], stamp),
                )
        print(f"[+] 已写入 {len(missing)} 条")

        after_total = con.execute("SELECT COUNT(*) FROM knowledge_nodes").fetchone()[0]
        after_approved = con.execute(
            "SELECT COUNT(*) FROM knowledge_nodes WHERE review_status='approved'"
        ).fetchone()[0]
        after_orphan = con.execute(
            """SELECT COUNT(*) FROM vector_embeddings v
                WHERE v.entity_type='knowledge_node'
                  AND NOT EXISTS (SELECT 1 FROM knowledge_nodes k WHERE k.id=v.entity_id)"""
        ).fetchone()[0]
        print(f"    库内节点总数 = {after_total}（清单 {approved_total}）")
        print(f"    approved 节点 = {after_approved}")
        print(f"    悬挂 knowledge_node 向量 = {after_orphan}")

        ok = after_orphan == 0 and after_approved == approved_total
        print("\n一致性:", "✅ 通过" if ok else "⚠️ 未完全对齐")
        return 0 if ok else 3
    finally:
        con.close()


if __name__ == "__main__":
    sys.exit(main())
