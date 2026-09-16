#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为**评测副本**内的私有文档切片生成 bge-m3 向量（roadmap 3b 的评测侧验证）。

为什么需要这个脚本
------------------
生产侧 `retrieve_context`（src-tauri/src/rag/hybrid.rs）的稠密通道只遍历
`DENSE_ENTITY_TYPES`，其原值为 ["knowledge_node", "question"] —— 私有切片
（private_chunk）不在其中；而 BM25（`execute_bm25_match`）只查
`private_document_chunks_fts`。于是两个通道的候选空间**完全不相交**：
BM25 只能召回私有切片，稠密只能召回知识节点/题目，二者从不竞争，
RRF 实际退化为「取并集 + 排序」。

本脚本配合 `DENSE_ENTITY_TYPES` 纳入 "private_chunk" 的改动使用：
在评测副本里为切片补向量后，切片侧变成真正的双通道竞争场景，
"融合是否有增益"才成为可测量的命题（而非通道覆盖率的产物）。

安全约束（硬性）
----------------
* 只允许写 `experiments/hybrid_retrieval/work/eval_corpus.sqlite3`，脚本会
  显式拒绝生产库路径与任何非 eval_corpus* 文件名。
* 不参与生产向量流程：`refresh_vector_embeddings.py` 只负责 Approved Packs，
  本脚本产出的切片向量**仅存在于评测副本**，线上库零写入。

用法
----
    python build_chunk_vectors_eval.py            # 生成（幂等，可重跑覆盖）
    python build_chunk_vectors_eval.py --verify   # 只校验已有向量，不写库
    python build_chunk_vectors_eval.py --limit 5  # 冒烟：只做前 5 片
"""

import argparse
import hashlib
import json
import math
import os
import sqlite3
import struct
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

EXPERIMENT_ROOT = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(EXPERIMENT_ROOT, "work")
DEFAULT_EVAL_DB = os.path.join(WORK_DIR, "eval_corpus.sqlite3")
MANIFEST_PATH = os.path.join(WORK_DIR, "chunk_vectors_manifest.json")

PRODUCTION_DB = r"C:\Users\Acer\AppData\Roaming\com.teacheragent.app\teacher_agent.sqlite3"

DEFAULT_ENDPOINT = "http://127.0.0.1:11434/api/embeddings"
DEFAULT_MODEL = "bge-m3"
EXPECTED_DIM = 1024

ENTITY_TYPE = "private_chunk"
ID_PREFIX = "emb-private_chunk-"

# 与生产 embedding 一致：存侧做 L2 归一化（实测已存 knowledge_node 向量范数 = 1.000000）
NORMALIZE = True
# 切片 heading 是切片器生成的样板文字（"段落"、"段落（续1）"…），不含语义，
# 因此只嵌入正文。改动此处需同步更新 chunk_vectors_manifest.json 里的 textRecipe。
EMBED_HEADING = False


def now_iso() -> str:
    moment = datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def guard_target(path: str) -> str:
    """只允许写评测副本。任何生产库路径或非法文件名一律拒绝。"""
    target = os.path.abspath(path)
    if target == os.path.abspath(PRODUCTION_DB):
        raise SystemExit(f"拒绝执行：目标是生产库 {target}")
    if not os.path.basename(target).startswith("eval_corpus"):
        raise SystemExit(
            f"拒绝执行：目标文件名必须以 eval_corpus 开头（当前 {os.path.basename(target)}）")
    return target


def embed_text(endpoint: str, model: str, text: str, retries: int = 4) -> list:
    payload = json.dumps({"model": model, "prompt": text}).encode("utf-8")
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(
                endpoint, data=payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=120) as response:
                body = json.loads(response.read().decode("utf-8"))
            vector = body.get("embedding")
            if not vector:
                raise ValueError(f"响应缺少 embedding 字段：{str(body)[:160]}")
            return vector
        except Exception as error:  # noqa: BLE001 - 需要把各类网络/解析异常统一重试
            last_error = error
            if attempt < retries:
                time.sleep(1.5 * attempt)
    raise SystemExit(f"Ollama 调用失败（{retries} 次重试后）：{type(last_error).__name__}: {last_error}")


def l2_normalize(vector: list) -> list:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm <= 0:
        raise ValueError("零向量，无法归一化")
    return [value / norm for value in vector]


def to_blob(vector: list) -> bytes:
    return struct.pack("<%df" % len(vector), *vector)


def from_blob(blob: bytes) -> list:
    return list(struct.unpack("<%df" % (len(blob) // 4), blob))


def load_chunks(connection: sqlite3.Connection, limit: int | None):
    sql = """SELECT c.id, c.heading, c.text, d.subject_code
               FROM private_document_chunks c
               JOIN private_documents d ON d.id = c.document_id
              WHERE d.deleted_at IS NULL
              ORDER BY c.document_id, c.chunk_index"""
    rows = list(connection.execute(sql))
    return rows[:limit] if limit else rows


def build_text(heading: str, text: str) -> str:
    parts = []
    if EMBED_HEADING and (heading or "").strip():
        parts.append(heading.strip())
    if (text or "").strip():
        parts.append(text.strip())
    return "\n".join(parts)


def verify(connection: sqlite3.Connection, ids: list) -> int:
    """校验已写入的切片向量：维度、归一化、编解码往返一致。"""
    problems = 0
    checked = 0
    for chunk_id in ids:
        row = connection.execute(
            "SELECT embedding, embedding_dim, embedding_model FROM vector_embeddings"
            " WHERE entity_type = ? AND entity_id = ? AND embedding_model = ?",
            (ENTITY_TYPE, chunk_id, DEFAULT_MODEL),
        ).fetchone()
        if row is None:
            print(f"  [缺] {chunk_id}")
            problems += 1
            continue
        blob, dim, model = row
        vector = from_blob(blob)
        norm = math.sqrt(sum(value * value for value in vector))
        issues = []
        if len(vector) != EXPECTED_DIM:
            issues.append(f"维度 {len(vector)}")
        if int(dim) != EXPECTED_DIM:
            issues.append(f"embedding_dim {dim}")
        if abs(norm - 1.0) > 1e-4:
            issues.append(f"范数 {norm:.6f}")
        if model != DEFAULT_MODEL:
            issues.append(f"模型 {model}")
        if issues:
            print(f"  [异常] {chunk_id}: {', '.join(issues)}")
            problems += 1
        checked += 1
    print(f"  已校验 {checked} 条，异常 {problems} 条")
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description="为评测副本的私有切片生成 bge-m3 向量")
    parser.add_argument("--db", default=DEFAULT_EVAL_DB, help="评测副本路径")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--limit", type=int, help="冒烟：只处理前 N 片")
    parser.add_argument("--verify", action="store_true", help="只校验，不写库")
    parser.add_argument("--force", action="store_true", help="忽略已有向量强制重算")
    args = parser.parse_args()

    if args.model != DEFAULT_MODEL:
        raise SystemExit(f"模型必须是 {DEFAULT_MODEL}（与 harness 的 HYBRID_EVAL_MODEL 一致）")

    db_path = guard_target(args.db)
    if not os.path.exists(db_path):
        raise SystemExit(f"评测副本不存在：{db_path}\n  请先运行： python run_eval.py prepare")

    if args.verify:
        connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        rows = load_chunks(connection, args.limit)
        print(f"verify: {db_path}（{len(rows)} 片）")
        problems = verify(connection, [row[0] for row in rows])
        connection.close()
        sys.exit(1 if problems else 0)

    connection = sqlite3.connect(db_path)
    rows = load_chunks(connection, args.limit)
    if not rows:
        raise SystemExit("评测副本里没有存活的私有切片：请先在 App 中导入资料并重跑 prepare")

    existing = {
        row[0] for row in connection.execute(
            "SELECT entity_id FROM vector_embeddings WHERE entity_type = ? AND embedding_model = ?",
            (ENTITY_TYPE, args.model))
    }
    print(f"目标： {db_path}")
    print(f"切片： {len(rows)} 片（已有切片向量 {len(existing)} 条）")
    print(f"模型： {args.model} @ {args.endpoint}，维度 {EXPECTED_DIM}，存侧归一化 {NORMALIZE}")
    print()

    stamp = now_iso()
    written = 0
    skipped = 0
    digests = hashlib.sha256()
    width = len(str(len(rows)))

    for position, (chunk_id, heading, text, subject) in enumerate(rows, start=1):
        if chunk_id in existing and not args.force:
            skipped += 1
            continue
        content = build_text(heading or "", text or "")
        if not content:
            print(f"  [{position:>{width}}/{len(rows)}] 跳过（正文为空）{chunk_id}")
            skipped += 1
            continue

        vector = embed_text(args.endpoint, args.model, content)
        if len(vector) != EXPECTED_DIM:
            raise SystemExit(f"{chunk_id}: Ollama 返回维度 {len(vector)}，期望 {EXPECTED_DIM}")
        if NORMALIZE:
            vector = l2_normalize(vector)

        connection.execute(
            """INSERT INTO vector_embeddings
                   (id, entity_type, entity_id, embedding, embedding_model, embedding_dim, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(entity_type, entity_id, embedding_model) DO UPDATE SET
                   embedding = excluded.embedding,
                   embedding_dim = excluded.embedding_dim,
                   updated_at = excluded.updated_at""",
            (f"{ID_PREFIX}{chunk_id}", ENTITY_TYPE, chunk_id, to_blob(vector),
             args.model, EXPECTED_DIM, stamp, stamp),
        )
        digests.update(chunk_id.encode("utf-8"))
        digests.update(to_blob(vector))
        written += 1
        if position % 20 == 0 or position == len(rows):
            print(f"  [{position:>{width}}/{len(rows)}] 已写入 {written} 条（subject={subject}）")
            connection.commit()

    connection.commit()

    total = connection.execute(
        "SELECT COUNT(*) FROM vector_embeddings WHERE entity_type = ? AND embedding_model = ?",
        (ENTITY_TYPE, args.model)).fetchone()[0]

    print()
    print(f"完成：新写 {written} 条，跳过 {skipped} 条；副本内切片向量合计 {total} 条")
    print("校验：")
    problems = verify(connection, [row[0] for row in rows])

    if written:
        manifest = {
            "generatedAt": now_iso(),
            "scope": "EVAL-ONLY：仅写入评测副本，生产库与生产向量流程不受影响",
            "database": db_path,
            "entityType": ENTITY_TYPE,
            "embeddingModel": args.model,
            "embeddingDim": EXPECTED_DIM,
            "normalized": NORMALIZE,
            "textRecipe": "chunk.text（不含 heading：切片 heading 为切片器样板文字，无语义）",
            "chunksTotal": len(rows),
            "vectorsTotalInCopy": int(total),
            "vectorsDigestSha256": digests.hexdigest(),
            "endpoint": args.endpoint,
            "note": "配合 DENSE_ENTITY_TYPES 纳入 private_chunk 使用，使切片侧可被稠密通道召回",
        }
        with open(MANIFEST_PATH, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, ensure_ascii=False, indent=2)
        print(f"清单： {MANIFEST_PATH}")

    connection.close()
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
