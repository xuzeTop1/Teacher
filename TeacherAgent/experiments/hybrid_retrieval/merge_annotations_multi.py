#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""N 位评审多数决合并：Fleiss' kappa + 两两 Cohen's kappa + 多数决写回题集。

与 merge_annotations.py（两位评审版）互补；本脚本支持任意 ≥2 位评审。

输入
----
* N 份盲标网页导出的 JSON（--annos，逗号分隔）
* work/annotation/pool.json（判断矩阵全集）

多数决规则（--threshold，默认多数 = floor(N/2)+1）
--------------------------------------------------
* 票数 >= threshold 判 1，其余判 0。N=5 时 threshold=3，无平票。

输出
----
* 写回 work/qa_100_human.jsonl（先备份原文件为 qa_100_human.machine-gold.bak.jsonl）：
    gold_machine = 原机器 gold 留档；gold_ids = 多数决结果；
    gold_votes = {key: [5票]}；annotators = 评审名列表
* work/annotation/majority_votes.json      每候选票型明细
* work/annotation/multi_kappa_report.json  Fleiss' κ + 两两 Cohen's κ + 一致率

用法
----
    python merge_annotations_multi.py \
        --annos "annotations_评审一.json,annotations_评审二.json,评审三_annotations.json,annotations_评审四.json,annotations_评审五.json"
"""

import argparse
import itertools
import json
import os
import shutil
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(HERE, "work")
POOL_PATH = os.path.join(WORK_DIR, "annotation", "pool.json")
QA_PATH = os.path.join(WORK_DIR, "qa_100_human.jsonl")
BAK_PATH = os.path.join(WORK_DIR, "qa_100_human.machine-gold.bak.jsonl")
VOTES_PATH = os.path.join(WORK_DIR, "annotation", "majority_votes.json")
REPORT_PATH = os.path.join(WORK_DIR, "annotation", "multi_kappa_report.json")


def load_annos(spec):
    annos = {}
    for path in [p.strip() for p in spec.split(",") if p.strip()]:
        full = path if os.path.isabs(path) else os.path.join(WORK_DIR, "annotation", path)
        d = json.load(open(full, encoding="utf-8"))
        annos[d["annotator"]] = d["judgments"]
    return annos


def cohen_kappa(pairs):
    n = len(pairs)
    agree = sum(1 for a, b in pairs if a == b)
    if n == 0 or agree == n:
        return 1.0 if agree == n and n else 0.0, agree / max(n, 1)
    n1 = sum(1 for a, b in pairs if a == 1)
    n2 = sum(1 for a, b in pairs if b == 1)
    po = agree / n
    pe = (n1 / n) * (n2 / n) + ((n - n1) / n) * ((n - n2) / n)
    return (po - pe) / (1 - pe), po


def fleiss_kappa(matrix, n_raters):
    """matrix: list of [n_votes_cat0, n_votes_cat1] per item."""
    N = n_raters
    n_items = len(matrix)
    if n_items == 0:
        return 0.0
    p_list = []
    cat_totals = [0, 0]
    for row in matrix:
        p_i = (sum(c * c for c in row) - N) / (N * (N - 1))
        p_list.append(p_i)
        for j in (0, 1):
            cat_totals[j] += row[j]
    p_bar = sum(p_list) / n_items
    total = n_items * N
    p_e = sum((t / total) ** 2 for t in cat_totals)
    return (p_bar - p_e) / (1 - p_e) if p_e < 1 else 1.0


def main():
    ap = argparse.ArgumentParser(description="N 评审多数决合并")
    ap.add_argument("--annos", required=True, help="逗号分隔的导出 JSON 文件名（相对 annotation/ 或绝对路径）")
    ap.add_argument("--threshold", type=int, default=None,
                    help="判相关的最少票数（默认 floor(N/2)+1）")
    args = ap.parse_args()

    annos = load_annos(args.annos)
    names = list(annos)
    N = len(names)
    threshold = args.threshold or N // 2 + 1
    print(f"评审 {N} 人: {names} | 多数决阈值: {threshold}/{N}")

    pool = json.load(open(POOL_PATH, encoding="utf-8"))
    qa = [json.loads(l) for l in open(QA_PATH, encoding="utf-8") if l.strip()]
    qa_by_qid = {r["qid"]: r for r in qa}

    votes_detail = {}
    fleiss_matrix = []
    pair_keys = list(itertools.combinations(names, 2))
    pair_pairs = {pk: [] for pk in pair_keys}
    agree_full = 0
    gold_counts = Counter()
    empty_gold, changed = [], []

    for q in pool["questions"]:
        qid = q["qid"]
        human_gold = []
        for c in q["candidates"]:
            key = c["key"]
            vs = [annos[a].get(qid, {}).get(key, {}).get("v") for a in names]
            if any(v is None for v in vs):
                raise SystemExit(f"缺票: {qid} {key} -> {vs}")
            votes = [int(v) for v in vs]
            rel_votes = sum(votes)
            is_rel = 1 if rel_votes >= threshold else 0
            fleiss_matrix.append([N - rel_votes, rel_votes])
            votes_detail.setdefault(qid, {})[key] = {
                "votes": votes, "rel": rel_votes, "gold": is_rel,
                "edge": sum(1 for a in names
                            if annos[a].get(qid, {}).get(key, {}).get("edge")),
            }
            for a, b in pair_keys:
                pair_pairs[(a, b)].append(
                    (annos[a][qid][key]["v"], annos[b][qid][key]["v"]))
            if len(set(votes)) == 1:
                agree_full += 1
            if is_rel:
                human_gold.append(key)
        gold_counts[len(human_gold)] += 1
        row = qa_by_qid.get(qid)
        if row is None:
            raise SystemExit(f"题集缺 {qid}")
        machine = set(row.get("gold_ids") or [])
        if not machine.issubset({c["key"] for c in q["candidates"]}):
            pass  # 机器 gold 可能含池外实体，照实留档
        if machine != set(human_gold):
            changed.append({
                "qid": qid, "query": row["query"],
                "machine_only": sorted(machine - set(human_gold)),
                "human_only": sorted(set(human_gold) - machine),
                "human_n": len(human_gold), "machine_n": len(machine),
            })
        row["gold_machine"] = sorted(machine)
        row["gold_ids"] = sorted(human_gold)
        row["gold_votes"] = votes_detail.get(qid, {})
        row["annotators"] = names
        if not human_gold:
            empty_gold.append(qid)

    # ── 报告 ────────────────────────────────────────────────────────────
    report = {
        "annotators": names, "n_items": len(fleiss_matrix), "threshold": threshold,
        "fleiss_kappa": fleiss_kappa(fleiss_matrix, N),
        "full_agreement": agree_full,
        "pairwise": {f"{a} vs {b}": {
            "kappa": cohen_kappa(pairs)[0], "raw_agreement": cohen_kappa(pairs)[1]}
            for (a, b), pairs in pair_pairs.items()},
        "gold_size_hist": dict(gold_counts),
        "empty_gold": empty_gold,
        "changed_vs_machine": changed,
    }
    json.dump(report, open(REPORT_PATH, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump(votes_detail, open(VOTES_PATH, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    print(f"\nFleiss' kappa = {report['fleiss_kappa']:.4f}")
    print(f"五方完全一致: {agree_full}/{len(fleiss_matrix)} "
          f"({agree_full/len(fleiss_matrix)*100:.1f}%)")
    for k, v in report["pairwise"].items():
        print(f"  {k}: kappa={v['kappa']:.4f} raw={v['raw_agreement']*100:.1f}%")
    print(f"gold 数分布: {dict(sorted(gold_counts.items()))}")
    if empty_gold:
        print(f"⚠ 空 gold 题（需人工裁决或剔除）: {empty_gold}")
    print(f"与机器 gold 有差异的题: {len(changed)}/100")
    for ch in changed[:10]:
        print(f"  {ch['qid']}: 机器{ch['machine_n']}项/人工{ch['human_n']}项"
              f" 机器独有{len(ch['machine_only'])} 人工新增{len(ch['human_only'])}")

    # ── 写回题集（先备份）───────────────────────────────────────────────
    if not os.path.exists(BAK_PATH):
        shutil.copy(QA_PATH, BAK_PATH)
        print(f"\n已备份原题集 -> {os.path.basename(BAK_PATH)}")
    with open(QA_PATH, "w", encoding="utf-8") as h:
        for row in qa:
            h.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"多数决 gold 已写回 {QA_PATH}")


if __name__ == "__main__":
    main()
