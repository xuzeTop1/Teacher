#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""私有资料库质量修复全面核查与检索过滤实测脚本。"""

import os
import sqlite3
import sys
from collections import Counter
from datetime import datetime

DESKTOP_DB = r"<APPDATA>\Roaming\com.teacheragent.app\teacher_agent.sqlite3"


def backup_database(src_path: str) -> str:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = f"{src_path}.backup-privdocs-{timestamp}"
    src = sqlite3.connect(src_path)
    dst = sqlite3.connect(backup_path)
    src.backup(dst)
    dst.close()
    src.close()
    return backup_path


def main():
    print("=== 私有资料库质量核验启动 ===")
    backup_file = backup_database(DESKTOP_DB)
    print(f"[+] 桌面库原子备份已创建: {backup_file}")

    con = sqlite3.connect(DESKTOP_DB)
    cur = con.cursor()

    # 1. 查询 7 篇私有文档状态
    cur.execute("""
        SELECT id, file_name, title, subject_code, chunk_count, created_at
        FROM private_documents
        ORDER BY created_at
    """)
    docs = cur.fetchall()
    print(f"\n[+] 当前私有文档总数: {len(docs)}")
    for d in docs:
        print(f"  - ID: {d[0]} | 学科: {d[3]} | 标题: {d[2]} | 文件名: {d[1]} | 分块: {d[4]}")

    # 2. 重复导入核查
    print("\n[+] 重复导入核查审计 (按设计只报告、不删除):")
    fn_counts = Counter(d[1] for d in docs)
    for fn, count in fn_counts.items():
        if count > 1:
            print(f"  * 重复文件: \"{fn}\" 共导入 {count} 次:")
            matching = [d for d in docs if d[1] == fn]
            for m in matching:
                print(f"      ID={m[0]}, 标题=\"{m[2]}\", 学科={m[3]}, 分片数={m[4]}, 时间={m[5]}")

    # 3. 实测 BM25 检索学科过滤 (复用 hybrid.rs execute_bm25_match SQL)
    bm25_sql = """
    SELECT c.id, d.title, d.subject_code, c.heading, bm25(private_document_chunks_fts, 1.0, 1.0) as score
    FROM private_document_chunks_fts f
    JOIN private_document_chunks c ON c.rowid = f.rowid
    JOIN private_documents d ON d.id = c.document_id
    WHERE private_document_chunks_fts MATCH ?1
      AND (?2 IS NULL OR d.subject_code = ?2)
      AND d.deleted_at IS NULL
    ORDER BY bm25(private_document_chunks_fts, 1.0, 1.0)
    LIMIT 5
    """

    print("\n[+] 执行学科过滤 BM25 检索实测:")
    
    # 政治测试
    cur.execute(bm25_sql, ('"思想政治理论"', "politics"))
    pol_hits = cur.fetchall()
    print(f"  1. 查询 '\"思想政治理论\"' + 学科 filter='politics' -> 命中数: {len(pol_hits)}")
    for h in pol_hits:
        print(f"     命中 chunk: {h[0]} (标题: {h[1]}, 学科: {h[2]}, 页面: {h[3]}, BM25: {h[4]:.4f})")

    # 政治隔离测试（用 math 过滤应无命中）
    cur.execute(bm25_sql, ('"思想政治理论"', "math"))
    iso_hits = cur.fetchall()
    print(f"  2. 查询 '\"思想政治理论\"' + 学科 filter='math' (隔离测试) -> 命中数: {len(iso_hits)} (预期: 0)")
    assert len(iso_hits) == 0, "学科过滤失效！"

    # 数学测试
    cur.execute(bm25_sql, ('"数学一大纲" OR "高等数学"', "math"))
    math_hits = cur.fetchall()
    print(f"  3. 查询 '\"数学一大纲\" OR \"高等数学\"' + 学科 filter='math' -> 命中数: {len(math_hits)}")
    for h in math_hits:
        print(f"     命中 chunk: {h[0]} (标题: {h[1]}, 学科: {h[2]}, 页面: {h[3]}, BM25: {h[4]:.4f})")

    # 物理测试
    cur.execute(bm25_sql, ('"普通物理"', "physics"))
    phy_hits = cur.fetchall()
    print(f"  4. 查询 '\"普通物理\"' + 学科 filter='physics' -> 命中数: {len(phy_hits)}")
    for h in phy_hits:
        print(f"     命中 chunk: {h[0]} (标题: {h[1]}, 学科: {h[2]}, 页面: {h[3]}, BM25: {h[4]:.4f})")

    # 物理隔离测试（用 politics 过滤应无命中）
    cur.execute(bm25_sql, ('"普通物理"', "politics"))
    phy_iso_hits = cur.fetchall()
    print(f"  5. 查询 '\"普通物理\"' + 学科 filter='politics' (隔离测试) -> 命中数: {len(phy_iso_hits)} (预期: 0)")
    assert len(phy_iso_hits) == 0, "学科过滤失效！"

    con.close()
    print("\n[+] 全部学科过滤检索实测通过！学科隔离严格生效。")


if __name__ == "__main__":
    main()
