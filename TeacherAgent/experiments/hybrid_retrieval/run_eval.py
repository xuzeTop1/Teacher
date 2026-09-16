#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""工作项 E：混合检索质量评测 CLI。

三配置（纯 BM25 / 纯稠密 / BM25+Dense+RRF）全部由 Rust 生产实现执行
（`src/rag/eval.rs` 的 `hybrid_retrieval_eval`），本脚本只负责：语料准备、
题集构造、查询向量生成（本地 Ollama bge-m3）、指标计算与归档。

    python run_eval.py prepare     # 复制运行时库为评测副本（不动线上库）
    python run_eval.py build-qa    # 从真实语料构造 100 题（机器标注）
    python run_eval.py embed       # 用 Ollama bge-m3 生成查询向量
    python run_eval.py run         # 调 Rust harness 出排名，算指标并归档
    python run_eval.py all         # 以上四步

⚠ 题集为**机器标注**：规格要求两位评审独立标注 gold set 取交集，本脚本无法替代；
这里用"包含目标词的全部语料实体"作为 gold，属于语料自洽的已知项检索任务，
指标系统性偏高，**不得作为检索质量结论引用**（见归档里的 run_manifest.json）。
"""

import argparse
import csv
import hashlib
import json
import math
import os
import random
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXPERIMENT_ROOT = os.path.join(REPO_ROOT, "experiments", "hybrid_retrieval")
WORK_DIR = os.path.join(EXPERIMENT_ROOT, "work")
ARCHIVE_ROOT = os.path.join(REPO_ROOT, "benchmark-results")
TAURI_ROOT = os.path.join(REPO_ROOT, "src-tauri")

DEFAULT_SOURCE_DB = r"C:\Users\Acer\AppData\Roaming\com.teacheragent.app\teacher_agent.sqlite3"
EVAL_DB = os.path.join(WORK_DIR, "eval_corpus.sqlite3")
QA_PATH = os.path.join(WORK_DIR, "qa_100.jsonl")
# 人工标注题集（正式评测口径）。build-qa 只产出机器题集，且当本文件存在时
# 拒绝重写，避免误跑一次把归档里的题集与向量错配。
HUMAN_QA_PATH = os.path.join(WORK_DIR, "qa_100_human.jsonl")
VECTOR_PATH = os.path.join(WORK_DIR, "query_vectors.jsonl")
RAW_PATH = os.path.join(WORK_DIR, "hybrid_raw.jsonl")

OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/embeddings"
EMBED_MODEL = "bge-m3"
EMBED_DIM = 1024

TOP_K = 5
SEED = 42

# 规格 E.1 的分类配额
CATEGORY_QUOTA = {"术语检索": 32, "概念理解": 38, "公式辨析": 30}
# 每个分类内按来源分配（尽量同时覆盖倒排通道与稠密通道），不足则回退另一来源
SOURCE_PREFERENCE = {
    "术语检索": [("knowledge_node", 20), ("private_chunk", 12)],
    "概念理解": [("knowledge_node", 26), ("private_chunk", 12)],
    "公式辨析": [("knowledge_node", 16), ("private_chunk", 14)],
}

CJK_RUN = re.compile(r"[\u4e00-\u9fff]{2,}")
LATIN_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9\-\./]{1,}")
LATEX_INLINE = re.compile(r"\$[^$]{1,80}\$")
FORMULA_CJK = re.compile(
    r"(模\s*2\s*除法|生成多项式|前缀长度|校验码|往返时延|拥塞窗口|滑动窗口|子网掩码|"
    r"路由聚合|单调有界准则|夹逼准则|曲率半径|夹逼|本征值|特征多项式|点估计|置信区间)"
)
# 标题里的连接词/体裁后缀，抽取术语时剔除
TITLE_NOISE = (
    "与", "和", "的", "及", "概述", "详解", "详细", "详细计算", "详细说明", "基本概念", "基本",
    "计算", "原理", "简介", "详细分析", "与实现", "概念", "介绍", "总结", "推导",
)
LATIN_STOPLIST = {"None", "True", "False", "Page", "NONE", "TODO"}
LEADING_STOP = set("的为是与和及在对可将其该此若则由从把被使设记即当如按以不也又还")
TRAILING_STOP = set("的为是与和及")
CLAUSE_SPLIT = re.compile(r"[，。；：、,.;:()（）\[\]【】\s]+")
# 概念词取"首个分句的起始中文串"，避免滑窗切出跨短语碎片
QUERY_TEMPLATE = {
    "术语检索": "{term}",
    "概念理解": "{term}是什么意思",
    "公式辨析": "{term}怎么算",
}


# ── 工具 ──────────────────────────────────────────────────────────────
QUERY_FORMS = {"template": "问句形态（{term}是什么意思 / {term}怎么算）",
               "bare": "裸词形态（仅目标词）"}


def query_text(question: dict, form: str) -> str:
    return question["query"] if form == "template" else question["target_term"]


def vectors_path(form: str) -> str:
    return os.path.join(WORK_DIR, f"query_vectors_{form}.jsonl")


def ensure_work_dir() -> None:
    os.makedirs(WORK_DIR, exist_ok=True)


def sha256_of(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def write_jsonl(path: str, rows) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def read_jsonl(path: str):
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_csv(path: str, fieldnames, rows) -> None:
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


# ── prepare ───────────────────────────────────────────────────────────
def command_prepare(args) -> None:
    ensure_work_dir()
    source = args.db
    if not os.path.exists(source):
        raise SystemExit(f"运行时数据库不存在：{source}")
    # 用 SQLite 在线备份 API 取一致副本（避免 -wal 未合并读到半截状态）
    with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as src, sqlite3.connect(EVAL_DB) as dst:
        src.backup(dst)
    meta = {
        "sourceDatabase": source,
        "sourceSha256": sha256_of(source),
        "evalCopy": EVAL_DB,
        "evalCopySha256": sha256_of(EVAL_DB),
        "copiedAt": datetime.now(timezone.utc).isoformat(),
        "note": "评测在副本上补齐迁移，线上库不被修改",
    }
    with open(os.path.join(WORK_DIR, "corpus_meta.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
    print(f"prepare: 已复制 {source} → {EVAL_DB}")
    print(f"         sha256 {meta['evalCopySha256'][:16]}…")


# ── 语料 ──────────────────────────────────────────────────────────────
def load_corpus(db_path: str):
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    chunks = []
    for row in connection.execute(
        """SELECT c.id, c.heading, c.text, d.subject_code
             FROM private_document_chunks c
             JOIN private_documents d ON d.id = c.document_id
            WHERE d.deleted_at IS NULL"""
    ):
        chunks.append(
            {
                "key": f"private_chunk:{row['id']}",
                "source": "private_chunk",
                "id": row["id"],
                "title": row["heading"] or "",
                "text": row["text"] or "",
                "subject": row["subject_code"] or "",
            }
        )
    nodes = []
    for row in connection.execute(
        """SELECT kn.id, kn.title, kn.summary
             FROM knowledge_nodes kn
             JOIN vector_embeddings v
               ON v.entity_type = 'knowledge_node' AND v.entity_id = kn.id
            WHERE v.embedding_model = ?
            GROUP BY kn.id"""
        ,
        (EMBED_MODEL,),
    ):
        nodes.append(
            {
                "key": f"knowledge_node:{row['id']}",
                "source": "knowledge_node",
                "id": row["id"],
                "title": row["title"] or "",
                "text": f"{row['title'] or ''}\n{row['summary'] or ''}",
                "subject": "",
            }
        )
    # 题库：稠密通道的 DENSE_ENTITY_TYPES 含 question，语料必须同样覆盖，
    # 否则题目向量会在 Top-K 里占据名额却永远不可能成为 gold（不可命中的噪声），
    # 从而系统性压低 dense / hybrid 的 Hit@3、MRR、NDCG@5。
    # 文本拼法与向量侧一致（seedEmbeddingService.ts：`${title}: ${content}` + ` 答案: …`）。
    questions = []
    for row in connection.execute(
        """SELECT q.id, q.title, q.content, q.answer
             FROM questions q
             JOIN vector_embeddings v
               ON v.entity_type = 'question' AND v.entity_id = q.id
            WHERE v.embedding_model = ?
              AND q.review_status = 'approved'
            GROUP BY q.id"""
        ,
        (EMBED_MODEL,),
    ):
        text = f"{row['title'] or ''}: {row['content'] or ''}"
        if row["answer"]:
            text += f" 答案: {row['answer']}"
        questions.append(
            {
                "key": f"question:{row['id']}",
                "source": "question",
                "id": row["id"],
                "title": row["title"] or "",
                "text": text,
                "subject": "",
            }
        )
    connection.close()
    for entity in chunks + nodes + questions:
        entity["search_text"] = entity["text"].lower()
    return chunks, nodes, questions


def clean_title(title: str):
    """从标题抽术语：去掉 LaTeX 包裹与体裁后缀，取长度 ≥3 的中文串或拉丁缩写。"""
    text = LATEX_INLINE.sub(" ", title)
    candidates = []
    for run in CJK_RUN.findall(text):
        term = run
        for noise in sorted(TITLE_NOISE, key=len, reverse=True):
            if term.endswith(noise) and len(term) - len(noise) >= 3:
                term = term[: -len(noise)]
            if term.startswith(noise) and len(term) - len(noise) >= 3:
                term = term[len(noise):]
        if len(term) >= 3:
            candidates.append(term)
    for token in LATIN_TOKEN.findall(text):
        if len(token) >= 2:
            candidates.append(token)
    candidates.sort(key=lambda value: (-len(value), value))
    return candidates


def formula_terms(entity):
    terms = []
    for token in LATIN_TOKEN.findall(entity["title"] + " " + entity["text"]):
        if len(token) >= 2 and not token.islower() and token not in LATIN_STOPLIST:
            terms.append(token)
    terms.extend(FORMULA_CJK.findall(entity["text"]))
    seen, unique = set(), []
    for term in terms:
        if term not in seen:
            seen.add(term)
            unique.append(term)
    return unique


def strip_edge_function_chars(term: str) -> str:
    """去掉分句起始串首尾的虚词，避免"的导数为"这类不像提问的碎片。"""
    while term and term[0] in LEADING_STOP:
        term = term[1:]
    # 只剥明确的后缀虚词：把"在/有/中"也当后缀会把"极限存在"削成"极限存"。
    while term and term[-1] in TRAILING_STOP:
        term = term[:-1]
    # 体裁后缀（"详细/概述/基本概念"）同样不是概念本体
    for noise in sorted(TITLE_NOISE, key=len, reverse=True):
        if term.endswith(noise) and len(term) - len(noise) >= 3:
            term = term[: -len(noise)]
    return term


def concept_terms(entity, document_frequency, limit_terms=4):
    """概念词：取正文分句起始处的中文串（3–12 字），再按语料文档频率粗筛。

    不用滑窗 n-gram —— 那会切出"等式两边关于"这类跨短语碎片，既不像真实提问，
    也让"概念"与"术语"两类的差异失真。
    """
    text = LATEX_INLINE.sub(" ", entity["text"])
    candidates, seen = [], set()
    for clause in CLAUSE_SPLIT.split(text):
        clause = clause.strip()
        if len(clause) < 3:
            continue
        run = CJK_RUN.match(clause)
        if run:
            term = strip_edge_function_chars(run.group(0))
            if 3 <= len(term) <= 12 and term not in seen:
                seen.add(term)
                candidates.append(term)
    for run in CJK_RUN.findall(entity["title"]):
        if 3 <= len(run) <= 12 and run not in seen:
            seen.add(run)
            candidates.append(run)
    return [term for term in candidates if document_frequency.get(term, 0) <= 25][:limit_terms]


def build_document_frequency(entities):
    """语料级文档频率：仅对出现在 ≥2 个实体中的候选串建表，控制规模。"""
    counts = {}
    for entity in entities:
        text = LATEX_INLINE.sub(" ", entity["text"])
        seen = set()
        for run in CJK_RUN.findall(text):
            for size in (4, 5, 6):
                for start in range(0, max(0, len(run) - size) + 1):
                    term = run[start:start + size]
                    if len(term) == size:
                        seen.add(term)
        for term in seen:
            counts[term] = counts.get(term, 0) + 1
    return counts


def gold_for(term: str, entities):
    needle = term.lower()
    return sorted(entity["key"] for entity in entities if needle in entity["search_text"])


def command_build_qa(args) -> None:
    ensure_work_dir()
    # 人工题集存在时拒绝重建机器题集：正式口径已切到人工题集，
    # 误跑一次会让归档里的题集与查询向量错配。
    if os.path.exists(HUMAN_QA_PATH) and not args.force:
        raise SystemExit(
            f"检测到人工题集 {HUMAN_QA_PATH}，build-qa 已停止。\n"
            "  正式评测请用： python run_eval.py --qa work/qa_100_human.jsonl embed\n"
            "                python run_eval.py --qa work/qa_100_human.jsonl run\n"
            "  确需重建机器题集请加 --force（不会改动人工题集）。"
        )
    db = args.db_copy if os.path.exists(args.db_copy) else args.db
    chunks, nodes, question_entities = load_corpus(db)
    # 语料 = 全部有向量的实体（私有片段 + 知识点 + 题目），与稠密通道的实体空间一致。
    # 出题的"目标实体池"仍只用 chunks + nodes；题目只作为候选/潜在相关文档参与判分。
    entities = chunks + nodes + question_entities
    if not entities:
        raise SystemExit("语料为空：请先运行 prepare 并确认私有片段/知识点向量已入库")
    document_frequency = build_document_frequency(entities)
    rng = random.Random(SEED)

    pools = {"knowledge_node": {"术语检索": [], "概念理解": [], "公式辨析": []},
             "private_chunk": {"术语检索": [], "概念理解": [], "公式辨析": []}}

    for entity in nodes:
        for term in clean_title(entity["title"])[:2]:
            pools["knowledge_node"]["术语检索"].append((term, entity))
        for term in concept_terms(entity, document_frequency):
            pools["knowledge_node"]["概念理解"].append((term, entity))
        for term in formula_terms(entity)[:3]:
            pools["knowledge_node"]["公式辨析"].append((term, entity))

    for entity in chunks:
        for term in clean_title(entity["title"])[:1]:
            pools["private_chunk"]["术语检索"].append((term, entity))
        for term in concept_terms(entity, document_frequency):
            pools["private_chunk"]["概念理解"].append((term, entity))
        for term in formula_terms(entity)[:3]:
            pools["private_chunk"]["公式辨析"].append((term, entity))

    for source in pools:
        for category in pools[source]:
            rng.shuffle(pools[source][category])

    questions = []
    used_terms = set()
    qid = 0
    for category, quota in CATEGORY_QUOTA.items():
        picked = []
        for source, share in SOURCE_PREFERENCE[category]:
            taken = 0
            pool = pools[source][category]
            while pool and taken < share and len(picked) < quota:
                term, entity = pool.pop()
                key = term.lower()
                if key in used_terms or len(gold_for(term, entities)) == 0:
                    continue
                used_terms.add(key)
                picked.append((term, entity, source))
                taken += 1
        # 配额未满时从另一来源补齐
        if len(picked) < quota:
            for source in ("knowledge_node", "private_chunk"):
                pool = pools[source][category]
                while pool and len(picked) < quota:
                    term, entity = pool.pop()
                    key = term.lower()
                    if key in used_terms or len(gold_for(term, entities)) == 0:
                        continue
                    used_terms.add(key)
                    picked.append((term, entity, source))
        for term, entity, source in picked:
            qid += 1
            gold = gold_for(term, entities)
            questions.append(
                {
                    "qid": f"q{qid:03d}",
                    "category": category,
                    "query": QUERY_TEMPLATE[category].format(term=term),
                    "target_term": term,
                    "target_source": source,
                    "source_key": entity["key"],
                    "gold_ids": gold,
                    "annotator_1": "machine",
                    "annotator_2": "machine",
                }
            )

    if len(questions) != 100:
        print(f"warning: 仅构造出 {len(questions)} 题（配额 {CATEGORY_QUOTA}）", file=sys.stderr)

    write_jsonl(QA_PATH, questions)
    meta = {
        "goldSet": "machine-labeled（包含目标词的全部语料实体，语料自洽的已知项检索）",
        "humanQaPath": os.path.abspath(HUMAN_QA_PATH),
        "humanQaExists": os.path.exists(HUMAN_QA_PATH),
        "humanAnnotators": 0,
        "requiredHumanAnnotators": 2,
        "corpus": {
            "privateChunks": len(chunks),
            "embeddedKnowledgeNodes": len(nodes),
            "database": db,
        },
        "construction": {
            "seed": SEED,
            "categoryQuota": CATEGORY_QUOTA,
            "sourcePreference": SOURCE_PREFERENCE,
            "queryTemplate": QUERY_TEMPLATE,
            "termExtraction": "术语=标题抽词（去 LaTeX/体裁后缀）；概念=正文分句起始中文串（3–12 字，文档频率≤25）；公式=拉丁缩写（去停用词）+ 固定公式术语表",
            "goldRule": "gold = 语料中正文包含目标词的实体集合（含源实体）",
        },
        "caveat": "机器标注、且目标词取自语料本身，指标系统性偏高，不得作为检索质量结论。",
    }
    with open(os.path.join(WORK_DIR, "qa_100_meta.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
    print(f"build-qa: {len(questions)} 题 → {QA_PATH}")
    for category in CATEGORY_QUOTA:
        subset = [q for q in questions if q["category"] == category]
        by_source = {}
        for row in subset:
            by_source[row["target_source"]] = by_source.get(row["target_source"], 0) + 1
        print(f"          {category}: {len(subset)} 题 {by_source}")


# ── embed ─────────────────────────────────────────────────────────────
def command_embed(args) -> None:
    ensure_work_dir()
    questions = read_jsonl(args.qa)
    print(f"embed: 题集 {os.path.abspath(args.qa)}（{len(questions)} 题）")
    forms = ["template", "bare"]
    summary = {}
    for form in forms:
        path = vectors_path(form)
        done = {}
        if os.path.exists(path) and not args.force:
            for row in read_jsonl(path):
                done[row["qid"]] = row
        rows = []
        started = time.time()
        for index, question in enumerate(questions, start=1):
            text = query_text(question, form)
            cached = done.get(question["qid"])
            # 缓存必须同时校验查询文本：人工改写题面后同一 qid 的文本会变，
            # 只比对维度会把旧向量当命中，静默用错查询。
            if cached and len(cached.get("vector") or []) == EMBED_DIM and cached.get("query") == text:
                rows.append(cached)
                continue
            payload = json.dumps({"model": EMBED_MODEL, "prompt": text}).encode()
            request = urllib.request.Request(
                args.endpoint, data=payload, headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                body = json.loads(response.read().decode())
            vector = body.get("embedding") or []
            if len(vector) != EMBED_DIM:
                raise SystemExit(f"{question['qid']}/{form} 向量维度异常：{len(vector)}")
            rows.append({"qid": question["qid"], "query": text, "vector": vector})
            if index % 25 == 0:
                print(f"          {form}: embedded {index}/{len(questions)}")
        write_jsonl(path, rows)
        summary[form] = {"queries": len(rows), "elapsedSeconds": round(time.time() - started, 2)}
        print(f"embed[{form}]: {len(rows)} 条 → {path}")
    meta = {
        "qaPath": os.path.abspath(args.qa),
        "qaSha256": sha256_of(args.qa),
        "endpoint": args.endpoint,
        "model": EMBED_MODEL,
        "dimension": EMBED_DIM,
        "forms": summary,
        "note": "本地 Ollama 回环推理；与库内语料向量同为 bge-m3/1024 维",
    }
    with open(os.path.join(WORK_DIR, "embed_meta.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)


# ── metrics ───────────────────────────────────────────────────────────
def gain_at(rank, gold, cutoff=TOP_K):
    """秩 → 命中；未命中返回 None。"""
    return rank if rank is not None and rank <= cutoff else None


def ndcg_at_k(hits, gold, cutoff=TOP_K):
    """集合相关性的 NDCG@k：DCG 按命中位置折损，IDCG 按 |gold| 与 k 的较小值计满折损。"""
    def discount(position: int) -> float:
        return 1.0 if position == 1 else math.log2(position + 1)

    relevant = [1 if key in gold else 0 for key in hits[:cutoff]]
    dcg = sum(rel / discount(position) for position, rel in enumerate(relevant, start=1))
    ideal = sum(1 / discount(position) for position in range(1, min(len(gold), cutoff) + 1))
    return dcg / ideal if ideal else 0.0


def first_rank(hits, gold):
    for position, key in enumerate(hits, start=1):
        if key in gold:
            return position
    return None


def assert_vectors_match_qa(vectors_file: str, questions: dict, form: str) -> None:
    """校验查询向量与当前题集一致（qid 集合 + 查询文本）。

    人工改写题面后若忘记重跑 embed，向量仍是旧文本算出来的，
    排名与指标会全部失真；这里 fail-fast，不给静默错误的机会。
    """
    rows = read_jsonl(vectors_file)
    if len(rows) != len(questions):
        raise SystemExit(
            f"{os.path.basename(vectors_file)} 有 {len(rows)} 条，题集有 {len(questions)} 题；请重跑 embed")
    for row in rows:
        question = questions.get(row["qid"])
        if question is None:
            raise SystemExit(f"{os.path.basename(vectors_file)} 含题集外的 qid {row['qid']}；请重跑 embed")
        expected = query_text(question, form)
        if row.get("query") != expected:
            raise SystemExit(
                f"{row['qid']}/{form} 查询文本与题集不一致\n"
                f"    向量: {str(row.get('query'))[:60]}\n"
                f"    题集: {expected[:60]}\n"
                "  题面已改，请重跑 embed（建议加 --force）")


def command_run(args) -> None:
    ensure_work_dir()
    questions = {row["qid"]: row for row in read_jsonl(args.qa)}
    print(f"run: 题集 {os.path.abspath(args.qa)}（{len(questions)} 题）")
    if not os.path.exists(VECTOR_PATH):
        raise SystemExit("缺少查询向量：请先运行 embed")

    forms = ["template", "bare"] if args.form == "both" else [args.form]
    per_query = {}
    latency = {}
    configs = set()
    for form in forms:
        source_vectors = vectors_path(form)
        if not os.path.exists(source_vectors):
            raise SystemExit(f"缺少 {form} 形态的查询向量：请先运行 embed")
        assert_vectors_match_qa(source_vectors, questions, form)
        raw_path = os.path.join(WORK_DIR, f"hybrid_raw_{form}.jsonl")
        environment = dict(os.environ)
        environment.update(
            {
                "HYBRID_EVAL_DB": os.path.abspath(args.db_copy),
                "HYBRID_EVAL_IN": os.path.abspath(source_vectors),
                "HYBRID_EVAL_OUT": os.path.abspath(raw_path),
                "HYBRID_EVAL_TOP": str(TOP_K),
                "HYBRID_EVAL_MODEL": EMBED_MODEL,
                "HYBRID_EVAL_REPS": str(args.reps),
            }
        )
        command = ["cargo", "test", "--lib", "hybrid_retrieval_eval", "--", "--ignored", "--nocapture"]
        if args.profile == "release":
            command.insert(2, "--release")
        print(f"run[{form}]:", " ".join(command))
        subprocess.run(command, cwd=TAURI_ROOT, env=environment, check=True)
        if not os.path.exists(raw_path):
            raise SystemExit(f"harness 未产出 {raw_path}")

        for row in read_jsonl(raw_path):
            question = questions[row["qid"]]
            gold = set(question["gold_ids"])
            hits = [hit["key"] for hit in sorted(row["hits"], key=lambda item: item["rank"])]
            rank = first_rank(hits, gold)
            per_query[(form, row["qid"], row["config"])] = {
                "category": question["category"],
                "target_source": question["target_source"],
                "hit@3": 1.0 if gain_at(rank, gold, 3) else 0.0,
                "hit@5": 1.0 if gain_at(rank, gold, 5) else 0.0,
                "mrr": (1.0 / rank) if rank else 0.0,
                "ndcg@5": ndcg_at_k(hits, gold),
                "rank": rank if rank else "",
            }
            latency.setdefault((form, row["config"]), []).extend(row["elapsedMicros"])
            configs.add(row["config"])

    configs = sorted(configs)
    def aggregate(predicate):
        rows = [value for key, value in per_query.items() if predicate(key)]
        if not rows:
            return None
        return {
            "queries": len(rows),
            "hit@3": round(sum(row["hit@3"] for row in rows) / len(rows), 4),
            "hit@5": round(sum(row["hit@5"] for row in rows) / len(rows), 4),
            "mrr": round(sum(row["mrr"] for row in rows) / len(rows), 4),
            "ndcg@5": round(sum(row["ndcg@5"] for row in rows) / len(rows), 4),
        }

    overall = []
    for form in forms:
        for config in configs:
            stats = aggregate(lambda key, f=form, c=config: key[0] == f and key[2] == c)
            if stats:
                overall.append({"queryForm": form, "config": config, **stats})

    by_category = []
    for form in forms:
        for category in CATEGORY_QUOTA:
            for config in configs:
                stats = aggregate(
                    lambda key, f=form, c=config, cat=category:
                    key[0] == f and key[2] == c and per_query[key]["category"] == cat
                )
                if stats:
                    by_category.append({"queryForm": form, "category": category, "config": config, **stats})

    by_source = []
    for form in forms:
        for source in ("knowledge_node", "private_chunk"):
            for config in configs:
                stats = aggregate(
                    lambda key, f=form, c=config, s=source:
                    key[0] == f and key[2] == c and per_query[key]["target_source"] == s
                )
                if stats:
                    by_source.append({"queryForm": form, "target_source": source, "config": config, **stats})

    latency_rows = []
    for (form, config), values in sorted(latency.items()):
        samples = sorted(values)
        if not samples:
            continue
        position = min(len(samples) - 1, int(round(0.95 * (len(samples) - 1))))
        latency_rows.append(
            {
                "queryForm": form,
                "config": config,
                "samples": len(samples),
                "meanMs": round(sum(samples) / len(samples) / 1000, 3),
                "p95Ms": round(samples[position] / 1000, 3),
                "maxMs": round(max(samples) / 1000, 3),
            }
        )

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(ARCHIVE_ROOT, f"{timestamp}-hybrid-retrieval-100q")
    os.makedirs(out_dir, exist_ok=True)
    write_csv(os.path.join(out_dir, "results_overall.csv"),
              ["queryForm", "config", "queries", "hit@3", "hit@5", "mrr", "ndcg@5"], overall)
    write_csv(os.path.join(out_dir, "results_by_category.csv"),
              ["queryForm", "category", "config", "queries", "hit@3", "hit@5", "mrr", "ndcg@5"], by_category)
    write_csv(os.path.join(out_dir, "results_by_source.csv"),
              ["queryForm", "target_source", "config", "queries", "hit@3", "hit@5", "mrr", "ndcg@5"], by_source)
    write_csv(os.path.join(out_dir, "latency.csv"),
              ["queryForm", "config", "samples", "meanMs", "p95Ms", "maxMs"], latency_rows)
    shutil.copy(args.qa, os.path.join(out_dir, os.path.basename(args.qa)))

    corpus_meta = {}
    corpus_meta_path = os.path.join(WORK_DIR, "corpus_meta.json")
    if os.path.exists(corpus_meta_path):
        with open(corpus_meta_path, encoding="utf-8") as handle:
            corpus_meta = json.load(handle)

    # 语料向量构成：使归档能自证稠密通道实际覆盖了哪些实体类型。
    # private_chunk 向量为评测副本内注入（build_chunk_vectors_eval.py），
    # 生产库与生产向量流程零写入。
    corpus_vectors = {}
    try:
        with sqlite3.connect(f"file:{args.db_copy}?mode=ro", uri=True) as vectors_connection:
            for entity_type, embedding_model, count in vectors_connection.execute(
                "SELECT entity_type, embedding_model, COUNT(*)"
                " FROM vector_embeddings GROUP BY 1, 2 ORDER BY 3 DESC"
            ):
                corpus_vectors[f"{entity_type}@{embedding_model}"] = count
    except sqlite3.Error as error:
        corpus_vectors = {"error": str(error)}

    annotators = sorted({str(q.get("annotator_1")) for q in questions.values()} |
                        {str(q.get("annotator_2")) for q in questions.values()})
    human_annotated = bool(annotators) and "machine" not in annotators
    caveats = []
    if human_annotated:
        caveats.append(
            f"gold set 为人工标注，标注者：{', '.join(annotators)}；"
            f"题集 {os.path.basename(os.path.abspath(args.qa))}（sha256 {sha256_of(args.qa)[:16]}…）。")
    else:
        caveats += [
            "gold set 为机器标注（目标词取自语料本身、gold=包含该词的全部实体），非规格要求的两位评审独立标注；",
            "该题集是语料自洽的已知项检索任务，指标系统性偏高；",
            "本目录数字仅用于验证评测链路可复现，不得作为论文的检索质量结论；",
        ]
    caveats.append(
        "稠密通道 DENSE_ENTITY_TYPES 已纳入 private_chunk（src-tauri/src/rag/hybrid.rs），"
        "切片向量为评测副本内注入（build_chunk_vectors_eval.py），生产库零写入；"
        "BM25 仍只检索 private_document_chunks_fts，知识节点/题目尚无倒排索引——即两通道"
        "在「切片侧」已可竞争，在「节点/题目侧」BM25 仍结构性缺席。")
    caveats.append(
        "问句形态（{term}是什么意思 / {term}怎么算）在 FTS5 trigram 下被 build_match_expression 当作整串短语，"
        "文档中不存在该整串时倒排通道返回空集，此时 hybrid 退化为纯纯稠密——两种形态的对照即用于量化该现象。"
        .replace("纯纯", "纯"))

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "workItem": "E 混合检索质量评测",
        "questions": len(questions),
        "topK": TOP_K,
        "configs": configs,
        "queryForms": {form: QUERY_FORMS[form] for form in forms},
        "parameters": {"k1": 1.2, "b": 0.75, "channelTopK": 20, "kRrf": 60, "tokenizer": "trigram"},
        "embedding": {"model": EMBED_MODEL, "dimension": EMBED_DIM, "endpoint": OLLAMA_ENDPOINT},
        "harness": {
            "rustEntry": "src-tauri/src/rag/eval.rs::hybrid_retrieval_eval",
            "profile": args.profile,
            "reps": args.reps,
            "note": "三配置均走 Rust 生产实现；BM25 为 retrieve_context(query_embedding=None)，稠密为 vector::search_similar",
        },
        "corpus": {**corpus_meta,
                   # 实际参与本次评测的副本（--db-copy）；preparedCopy 记录 prepare 阶段生成的默认副本。
                   # 修复：此前直接沿用 prepare 写入的 evalCopy，导致用 --db-copy 指向其它副本时
                   # （如 B 消融用的 eval_corpus_nochunkvec.sqlite3）manifest 记录与实际不符。
                   "evalCopy": os.path.abspath(args.db_copy),
                   "evalCopySha256": sha256_of(args.db_copy),
                   "preparedCopy": corpus_meta.get("evalCopy")},
        "corpusVectors": corpus_vectors,
        "qa": {
            "path": os.path.abspath(args.qa),
            "sha256": sha256_of(args.qa),
            "humanAnnotated": human_annotated,
            "annotators": annotators,
        },
        "caveats": caveats,
    }
    with open(os.path.join(out_dir, "run_manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)

    print(json.dumps(overall, ensure_ascii=False, indent=2))
    print("outputs:", out_dir)


def command_all(args) -> None:
    command_prepare(args)
    command_build_qa(args)
    command_embed(args)
    command_run(args)


def main() -> None:
    parser = argparse.ArgumentParser(description="工作项 E：混合检索质量评测 CLI")
    parser.add_argument("--db", default=DEFAULT_SOURCE_DB, help="运行时数据库（只读拷出副本）")
    parser.add_argument("--db-copy", default=EVAL_DB, help="评测副本路径")
    parser.add_argument("--reps", type=int, default=30, help="每查询每配置重复次数（时延统计）")
    parser.add_argument("--profile", choices=["release", "debug"], default="release")
    parser.add_argument("--endpoint", default=OLLAMA_ENDPOINT)
    parser.add_argument("--force", action="store_true",
                        help="忽略缓存重算全部查询向量；build-qa 时用于跳过人工题集保护")
    parser.add_argument("--qa", default=QA_PATH,
                        help=f"题集路径（默认机器题集 {os.path.basename(QA_PATH)}；"
                             f"正式评测用 {os.path.basename(HUMAN_QA_PATH)}）")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name, handler in (
        ("prepare", command_prepare),
        ("build-qa", command_build_qa),
        ("embed", command_embed),
        ("run", command_run),
        ("all", command_all),
    ):
        sub = subparsers.add_parser(name)
        sub.set_defaults(handler=handler)
        # 子命令也接受 --qa（默认 SUPPRESS，不覆盖主 parser 上已给的值）
        sub.add_argument("--qa", default=argparse.SUPPRESS, help="同全局 --qa")
        if name == "run":
            sub.add_argument("--form", choices=["both", "template", "bare"], default="both")
    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
