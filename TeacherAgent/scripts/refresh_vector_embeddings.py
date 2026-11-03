#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""向量刷新脚本：为 TeacherAgent 正式知识库集合（Approved Packs）重新生成 1024 维 bge-m3 embedding。

严格遵循：
1. 动库前通过 SQLite Backup API 做全量在线冷备份；
2. 复刻 App 前端 seedEmbeddingService.ts 文本构造方式；
3. 使用本机 Ollama bge-m3（1024 维），model 统一写入 'bge-m3'；
4. 生产表结构 upsert（ON CONFLICT 更新 blob、dim、updated_at）；
5. 严禁为私有文档（private_document_chunks）生成 embedding；
6. 抽查新晋升实体检索可用性，记录详尽 benchmark 报告。
"""

import json
import os
import re
import struct
import sys
import time
import urllib.request
import sqlite3
from datetime import datetime, timezone

DESKTOP_DB = r"<APPDATA>\Roaming\com.teacheragent.app\teacher_agent.sqlite3"
REPO_ROOT = r"<REPO_ROOT>-alerttime-json"
OLLAMA_EMBEDDING_URL = "http://127.0.0.1:11434/v1/embeddings"
MODEL_NAME = "bge-m3"
EXPECTED_DIM = 1024
BATCH_SIZE = 32
MAX_TEXT_LENGTH = 8000


def backup_database(src_path: str) -> str:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = f"{src_path}.backup-pre-embedding-{timestamp}"
    print(f"[*] 执行 SQLite 在线备份: {src_path} -> {backup_path}")
    src = sqlite3.connect(src_path)
    dst = sqlite3.connect(backup_path)
    src.backup(dst)
    dst.close()
    src.close()
    print(f"[+] 备份完成，大小: {os.path.getsize(backup_path)} bytes")
    return backup_path


def load_manifest_approved_packs(manifest_path: str):
    with open(manifest_path, "r", encoding="utf-8") as f:
        content = f.read()

    entries = re.findall(
        r'\{\s*id:\s*"([^"]+)",[\s\S]*?knowledgePath:\s*"([^"]+)",[\s\S]*?questionPath:\s*"([^"]+)",[\s\S]*?status:\s*"(approved|draft)"',
        content
    )
    approved_packs = []
    draft_packs = []
    for pid, kpath, qpath, status in entries:
        k_full = os.path.normpath(os.path.join(os.path.dirname(manifest_path), kpath))
        q_full = os.path.normpath(os.path.join(os.path.dirname(manifest_path), qpath))
        item = {"id": pid, "kpath": k_full, "qpath": q_full, "status": status}
        if status == "approved":
            approved_packs.append(item)
        else:
            draft_packs.append(item)
    return approved_packs, draft_packs


def build_embedding_items(approved_packs):
    items = []
    knowledge_count = 0
    question_count = 0

    # 1. Knowledge nodes: `${title}: ${summary}`
    for pack in approved_packs:
        if os.path.exists(pack["kpath"]):
            with open(pack["kpath"], "r", encoding="utf-8") as f:
                data = json.load(f)
                for node in data.get("nodes", []):
                    title = node.get("title", "") or ""
                    summary = node.get("summary", "") or ""
                    text = f"{title}: {summary}"
                    if len(text) > MAX_TEXT_LENGTH:
                        text = text[:MAX_TEXT_LENGTH]
                    if text.strip():
                        items.append({
                            "id": node["id"],
                            "text": text,
                            "entityType": "knowledge_node",
                            "packId": pack["id"],
                            "title": title
                        })
                        knowledge_count += 1

    # 2. Questions: `${title}: ${content}` + ` 答案: ${answer}`
    for pack in approved_packs:
        if os.path.exists(pack["qpath"]):
            with open(pack["qpath"], "r", encoding="utf-8") as f:
                data = json.load(f)
                for q in data.get("questions", []):
                    title = q.get("title", "") or ""
                    content = q.get("content", "") or ""
                    answer = q.get("answer", "") or ""
                    text = f"{title}: {content}"
                    if answer:
                        text += f" 答案: {answer}"
                    if len(text) > MAX_TEXT_LENGTH:
                        text = text[:MAX_TEXT_LENGTH]
                    if text.strip():
                        items.append({
                            "id": q["id"],
                            "text": text,
                            "entityType": "question",
                            "packId": pack["id"],
                            "title": title
                        })
                        question_count += 1

    return items, knowledge_count, question_count


def request_embeddings(texts: list[str]) -> list[list[float]]:
    req_body = json.dumps({
        "model": MODEL_NAME,
        "input": texts
    }).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_EMBEDDING_URL,
        data=req_body,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status != 200:
            raise RuntimeError(f"Ollama API HTTP {resp.status}")
        data = json.loads(resp.read().decode("utf-8"))
        data_items = data.get("data", [])
        data_items.sort(key=lambda x: x["index"])
        embeddings = [item["embedding"] for item in data_items]
        return embeddings


def main():
    print(f"=== TeacherAgent 向量重算任务启动 ===")
    start_time = time.time()
    
    # 1. 备份数据库
    backup_file = backup_database(DESKTOP_DB)
    
    # 2. 解析 Manifest
    manifest_path = os.path.join(REPO_ROOT, "src", "services", "knowledge", "packManifest.ts")
    approved_packs, draft_packs = load_manifest_approved_packs(manifest_path)
    print(f"[+] Approved Packs: {len(approved_packs)}, Draft Packs: {len(draft_packs)}")
    
    # 3. 构造嵌入文本
    items, k_count, q_count = build_embedding_items(approved_packs)
    total_entities = len(items)
    print(f"[+] 构造待嵌入实体总数: {total_entities} (知识点: {k_count}, 题目: {q_count})")
    
    # 4. 分批生成并落库
    con = sqlite3.connect(DESKTOP_DB)
    cur = con.cursor()
    
    upsert_sql = """
    INSERT INTO vector_embeddings (
        id, entity_type, entity_id, embedding, embedding_model,
        embedding_dim, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_id, embedding_model) DO UPDATE SET
        embedding = excluded.embedding,
        embedding_dim = excluded.embedding_dim,
        updated_at = excluded.updated_at
    """
    
    stored_count = 0
    failed_items = []
    
    print(f"[*] 开始批量调用 Ollama 生成向量 (batch_size={BATCH_SIZE})...")
    batch_start = time.time()
    
    for i in range(0, total_entities, BATCH_SIZE):
        batch = items[i:i + BATCH_SIZE]
        texts = [b["text"] for b in batch]
        try:
            embs = request_embeddings(texts)
            if len(embs) != len(batch):
                raise RuntimeError(f"返回条数不一致: 预期 {len(batch)}, 实际 {len(embs)}")
            
            now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%fZ")
            
            for item, emb in zip(batch, embs):
                if len(emb) != EXPECTED_DIM:
                    raise RuntimeError(f"向量维度不匹配: 实体 {item['id']} 维度 {len(emb)} != {EXPECTED_DIM}")
                blob = struct.pack(f"<{len(emb)}f", *emb)
                entry_id = f"emb-{item['id']}"
                cur.execute(upsert_sql, (
                    entry_id,
                    item["entityType"],
                    item["id"],
                    blob,
                    MODEL_NAME,
                    EXPECTED_DIM,
                    now_iso,
                    now_iso
                ))
                stored_count += 1
                
            con.commit()
            elapsed_so_far = time.time() - batch_start
            print(f"  -> 已处理 {min(i + BATCH_SIZE, total_entities)}/{total_entities} (成功: {stored_count}, 耗时: {elapsed_so_far:.1f}s)")
        except Exception as e:
            print(f"  [!] 批次 {i} 失败: {e}")
            for item in batch:
                failed_items.append({"id": item["id"], "type": item["entityType"], "error": str(e)})
    
    # 5. 清理 draft 实体（如有）
    draft_nodes = []
    for dp in draft_packs:
        if os.path.exists(dp["kpath"]):
            with open(dp["kpath"], "r", encoding="utf-8") as f:
                for n in json.load(f).get("nodes", []):
                    draft_nodes.append(n["id"])
    if draft_nodes:
        placeholders = ",".join("?" * len(draft_nodes))
        cur.execute(f"DELETE FROM vector_embeddings WHERE embedding_model = ? AND entity_id IN ({placeholders})", [MODEL_NAME] + draft_nodes)
        deleted_drafts = cur.rowcount
        con.commit()
        print(f"[+] 清理旧 draft 向量: {deleted_drafts} 条")
    
    # 6. 最终计数核对
    cur.execute("SELECT entity_type, count(*) FROM vector_embeddings WHERE embedding_model = ? GROUP BY 1", (MODEL_NAME,))
    counts_by_type = dict(cur.fetchall())
    total_stored_in_db = sum(counts_by_type.values())
    print(f"\n[+] 数据库最终向量分布 (model={MODEL_NAME}): {counts_by_type}, 总计: {total_stored_in_db}")
    
    # 7. 稠密检索命中抽查
    print("\n[*] 执行新增知识点稠密检索命中抽查 (Cosine Similarity Top-3)...")
    spot_checks = [
        {"id": "xingce-sense-scope-distribution", "query": "常识判断考查范围与题量分布", "pack": "civil-common-sense-scope"},
        {"id": "xingce-sense-scope-competency", "query": "常识判断测查能力与题型特点", "pack": "civil-common-sense-scope"},
        {"id": "cs408-os-virtual-memory", "query": "虚拟内存与请求分页管理", "pack": "cs408-operating-systems"},
        {"id": "math-app-deriv-monotonicity", "query": "函数单调性的判定与驻点", "pack": "math-applications-of-derivatives"},
        {"id": "lawmaster-crim-intent", "query": "直接故意与间接故意的认定", "pack": "lawmaster-criminal"},
    ]
    
    cur.execute("SELECT entity_id, embedding FROM vector_embeddings WHERE entity_type = 'knowledge_node' AND embedding_model = ?", (MODEL_NAME,))
    all_nodes_embs = []
    for nid, blob in cur.fetchall():
        vec = struct.unpack(f"<{len(blob)//4}f", blob)
        all_nodes_embs.append((nid, vec))
        
    spot_check_results = []
    for sc in spot_checks:
        q_emb = request_embeddings([sc["query"]])[0]
        scores = []
        q_norm = sum(x * x for x in q_emb) ** 0.5
        for nid, nvec in all_nodes_embs:
            dot = sum(a * b for a, b in zip(q_emb, nvec))
            n_norm = sum(x * x for x in nvec) ** 0.5
            cos_sim = dot / (q_norm * n_norm) if q_norm and n_norm else 0.0
            scores.append((nid, cos_sim))
        scores.sort(key=lambda x: x[1], reverse=True)
        top3 = scores[:3]
        target_rank = None
        for rk, (nid, sim) in enumerate(scores, 1):
            if nid == sc["id"]:
                target_rank = rk
                break
        sc_res = {
            "query": sc["query"],
            "target_id": sc["id"],
            "target_rank": target_rank,
            "top3": [{"id": nid, "score": round(score, 4)} for nid, score in top3]
        }
        spot_check_results.append(sc_res)
        print(f"  查询: '{sc['query']}' -> 目标: {sc['id']} (Rank: #{target_rank}, Top-1: {top3[0][0]}, Score: {top3[0][1]:.4f})")
    
    total_elapsed = time.time() - start_time
    con.close()
    
    # 8. 输出归档文件
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    archive_dir = os.path.join(REPO_ROOT, "benchmark-results", f"{timestamp}-embedding-refresh")
    os.makedirs(archive_dir, exist_ok=True)
    
    report_data = {
        "timestamp": timestamp,
        "model": MODEL_NAME,
        "dimension": EXPECTED_DIM,
        "total_approved_packs": len(approved_packs),
        "total_entities_processed": total_entities,
        "knowledge_nodes_count": k_count,
        "questions_count": q_count,
        "stored_count": stored_count,
        "failed_count": len(failed_items),
        "failed_items": failed_items,
        "db_final_counts": counts_by_type,
        "total_elapsed_seconds": round(total_elapsed, 2),
        "backup_file": backup_file,
        "spot_checks": spot_check_results
    }
    
    report_json_path = os.path.join(archive_dir, "report.json")
    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(report_data, f, ensure_ascii=False, indent=2)
        
    summary_md_path = os.path.join(archive_dir, "summary.md")
    with open(summary_md_path, "w", encoding="utf-8") as f:
        f.write(f"# 向量全库重算报告 (Embedding Refresh)\n\n")
        f.write(f"- **时间**: {timestamp}\n")
        f.write(f"- **嵌入模型**: `{MODEL_NAME}` (维度: {EXPECTED_DIM})\n")
        f.write(f"- **备份路径**: `{backup_file}`\n")
        f.write(f"- **总耗时**: {total_elapsed:.2f} 秒 (实体生成吞吐: {total_entities / total_elapsed:.1f} 条/秒)\n")
        f.write(f"- **正式集合覆盖**: {len(approved_packs)} Approved Packs\n")
        f.write(f"  - `knowledge_node`: {counts_by_type.get('knowledge_node', 0)} / {k_count}\n")
        f.write(f"  - `question`: {counts_by_type.get('question', 0)} / {q_count}\n")
        f.write(f"  - **总向量条数**: {total_stored_in_db}\n")
        f.write(f"- **失败条数**: {len(failed_items)}\n\n")
        f.write(f"## 检索命中抽查结果\n\n")
        f.write(f"| 查询语句 | 目标实体 ID | 检索名次 | Top-1 命中实体 | 相似度分数 |\n")
        f.write(f"| :--- | :--- | :---: | :--- | :---: |\n")
        for sc in spot_check_results:
            f.write(f"| {sc['query']} | `{sc['target_id']}` | **#{sc['target_rank']}** | `{sc['top3'][0]['id']}` | {sc['top3'][0]['score']} |\n")

    print(f"\n[+] 报告生成完成: {report_json_path}")
    print(f"[+] 摘要生成完成: {summary_md_path}")
    print(f"[+] 向量重算任务顺利闭环！总耗时: {total_elapsed:.2f}s")


if __name__ == "__main__":
    main()
