#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Recompute hybrid-retrieval metrics on all 100 template-generated queries.

No model, embedding endpoint, annotation process, or Rust harness is called.
The final 93-query rankings are reused from the immutable opt_B cache, which
was verified to match the archived 93-query rankings byte-for-byte in hit keys.
The seven questions with no majority-relevant candidate are retained as
zero-gain queries in the 100-query denominator.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# 仓库根目录：由本文件位置推导（experiments/submission_audit/ -> 仓库根）。
# 按需通过环境变量 TEACHER_AGENT_ROOT 覆盖。
ROOT = Path(os.environ.get("TEACHER_AGENT_ROOT", Path(__file__).resolve().parents[2]))
WORK = ROOT / "experiments" / "hybrid_retrieval" / "work"
ARCHIVE = ROOT / "benchmark-results"
SOURCE_ARCHIVE = ARCHIVE / "20260915-213052-hybrid-retrieval-100q"
TOP_K = 5
FORMS = ("template", "bare")
CONFIGS = ("bm25", "dense", "hybrid")


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def first_rank(hits, gold):
    for position, key in enumerate(hits, start=1):
        if key in gold:
            return position
    return None


def ndcg_at_k(hits, gold, cutoff=TOP_K):
    def discount(position):
        return 1.0 if position == 1 else math.log2(position + 1)

    relevant = [1 if key in gold else 0 for key in hits[:cutoff]]
    dcg = sum(rel / discount(position) for position, rel in enumerate(relevant, start=1))
    ideal = sum(1 / discount(position) for position in range(1, min(len(gold), cutoff) + 1))
    return dcg / ideal if ideal else 0.0


def row_metrics(hits, gold):
    rank = first_rank(hits, gold)
    return {
        "hit@3": 1.0 if rank is not None and rank <= 3 else 0.0,
        "hit@5": 1.0 if rank is not None and rank <= 5 else 0.0,
        "mrr": 1.0 / rank if rank else 0.0,
        "ndcg@5": ndcg_at_k(hits, gold),
        "rank": rank if rank else "",
    }


def aggregate(rows):
    if not rows:
        return None
    return {
        "queries": len(rows),
        "hit@3": round(sum(row["hit@3"] for row in rows) / len(rows), 4),
        "hit@5": round(sum(row["hit@5"] for row in rows) / len(rows), 4),
        "mrr": round(sum(row["mrr"] for row in rows) / len(rows), 4),
        "ndcg@5": round(sum(row["ndcg@5"] for row in rows) / len(rows), 4),
    }


def main():
    qa_path = WORK / "qa_100_human.jsonl"
    questions = {row["qid"]: row for row in read_jsonl(qa_path)}
    excluded = sorted(qid for qid, row in questions.items() if not row.get("gold_ids"))
    conditional = sorted(set(questions) - set(excluded))
    assert len(questions) == 100 and len(conditional) == 93 and len(excluded) == 7

    per_query = []
    source_cache = {}
    for form in FORMS:
        raw_path = WORK / f"opt_B_{form}.jsonl"
        raw = {(row["qid"], row["config"]): row for row in read_jsonl(raw_path)}
        assert len(raw) == 100 * len(CONFIGS)
        source_cache[form] = raw
        for scope, qids in (("overall_100", sorted(questions)), ("conditional_93", conditional)):
            for qid in qids:
                for config in CONFIGS:
                    result = raw[(qid, config)]
                    hits = [hit["key"] for hit in sorted(result["hits"], key=lambda item: item["rank"])]
                    metrics = row_metrics(hits, set(questions[qid].get("gold_ids", [])))
                    per_query.append({
                        "scope": scope,
                        "queryForm": form,
                        "qid": qid,
                        "category": questions[qid]["category"],
                        "target_source": questions[qid]["target_source"],
                        "config": config,
                        **metrics,
                    })

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = ARCHIVE / f"{timestamp}-hybrid-retrieval-100q-overall"
    out.mkdir(parents=True, exist_ok=False)

    def write_csv(name, fields, rows):
        with (out / name).open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader(); writer.writerows(rows)

    overall = []
    for scope, qids in (("overall_100", set(questions)), ("conditional_93", set(conditional))):
        for form in FORMS:
            for config in CONFIGS:
                rows = [r for r in per_query if r["scope"] == scope and r["queryForm"] == form and r["config"] == config]
                overall.append({"scope": scope, "queryForm": form, "config": config, **aggregate(rows)})
    write_csv("results_overall.csv", ["scope", "queryForm", "config", "queries", "hit@3", "hit@5", "mrr", "ndcg@5"], overall)

    categories = sorted({row["category"] for row in questions.values()})
    by_category = []
    for scope, qids in (("overall_100", set(questions)), ("conditional_93", set(conditional))):
        for form in FORMS:
            for category in categories:
                for config in CONFIGS:
                    rows = [r for r in per_query if r["scope"] == scope and r["queryForm"] == form and r["category"] == category and r["config"] == config]
                    by_category.append({"scope": scope, "queryForm": form, "category": category, "config": config, **aggregate(rows)})
    write_csv("results_by_category.csv", ["scope", "queryForm", "category", "config", "queries", "hit@3", "hit@5", "mrr", "ndcg@5"], by_category)

    sources = ("knowledge_node", "private_chunk")
    by_source = []
    for scope, qids in (("overall_100", set(questions)), ("conditional_93", set(conditional))):
        for form in FORMS:
            for source in sources:
                for config in CONFIGS:
                    rows = [r for r in per_query if r["scope"] == scope and r["queryForm"] == form and r["target_source"] == source and r["config"] == config]
                    if rows:
                        by_source.append({"scope": scope, "queryForm": form, "target_source": source, "config": config, **aggregate(rows)})
    write_csv("results_by_source.csv", ["scope", "queryForm", "target_source", "config", "queries", "hit@3", "hit@5", "mrr", "ndcg@5"], by_source)
    write_csv("per_query_metrics.csv", ["scope", "queryForm", "qid", "category", "target_source", "config", "rank", "hit@3", "hit@5", "mrr", "ndcg@5"], per_query)

    comparison = []
    old_rows = list(csv.DictReader((SOURCE_ARCHIVE / "results_overall.csv").open(encoding="utf-8-sig")))
    for old in old_rows:
        current = next(r for r in overall if r["scope"] == "conditional_93" and r["queryForm"] == old["queryForm"] and r["config"] == old["config"])
        comparison.append({"queryForm": old["queryForm"], "config": old["config"], "oldHit3": old["hit@3"], "newHit3": current["hit@3"], "oldHit5": old["hit@5"], "newHit5": current["hit@5"], "oldMrr": old["mrr"], "newMrr": current["mrr"], "oldNdcg5": old["ndcg@5"], "newNdcg5": current["ndcg@5"], "same": all(old[k] == str(current[n]) for k, n in (("hit@3", "hit@3"), ("hit@5", "hit@5"), ("mrr", "mrr"), ("ndcg@5", "ndcg@5")))} )
    write_csv("comparison_with_archived_93.csv", list(comparison[0]), comparison)

    coverage = {
        "totalQueries": 100,
        "candidatePoolCoveredQueries": len(conditional),
        "candidatePoolCoverage": len(conditional) / 100,
        "noMajorityRelevantCandidateQueries": len(excluded),
        "excludedQids": excluded,
        "conditionalScope": "only the 93 queries with at least one majority-relevant candidate",
        "overallScope": "all 100 questions; excluded seven contribute zero Hit/MRR/NDCG",
        "rankingSource": {form: f"experiments/hybrid_retrieval/work/opt_B_{form}.jsonl" for form in FORMS},
        "rankingConsistency": "opt_B rankings for the 93 retained qids exactly match the archived hybrid_raw_{form}.jsonl hit keys",
    }
    (out / "coverage.json").write_text(json.dumps(coverage, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "workItem": "submission fix 2: 100-query unconditional retrieval metrics",
        "sourceQa": "experiments/hybrid_retrieval/work/qa_100_human.jsonl",
        "sourceQaSha256": sha256(qa_path),
        "sourceRankingCache": "experiments/hybrid_retrieval/work/opt_B_{template,bare}.jsonl",
        "sourceRankingCacheSha256": {form: sha256(WORK / f"opt_B_{form}.jsonl") for form in FORMS},
        "totalQueries": 100,
        "conditionalQueries": 93,
        "excludedQids": excluded,
        "coverageRate": 0.93,
        "metrics": ["Hit@3", "Hit@5", "MRR", "NDCG@5"],
        "scopes": {
            "conditional_93": "93 questions with at least one majority-relevant candidate",
            "overall_100": "all 100 questions; the seven no-candidate questions are counted as misses",
        },
        "annotation": "2 human + 3 LLM annotators, equal-weight majority vote; template-generated questions; not a pure human gold standard",
        "privateVectors": "159 private-chunk vectors exist only in the evaluation copy, not the default deployment database",
        "notes": ["No model or embedding endpoint was called; this is a deterministic re-aggregation of existing rankings.", "The seven excluded queries are coverage failures, not silently dropped from the overall denominator."],
    }
    (out / "run_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "README.md").write_text(
        "# Hybrid retrieval: 100-query overall re-aggregation\n\n"
        "This archive reuses the existing opt_B ranking caches and the 100-question\n"
        "two-human/three-LLM majority-vote QA. No model or embedding service was\n"
        "called. The 93-query conditional scope is retained for comparability.\n"
        "The seven queries with no majority-relevant candidate are retained in the\n"
        "overall_100 scope as zero Hit@3/Hit@5/MRR/NDCG@5 values.\n\n"
        "Candidate-pool coverage is therefore 93/100 = 93%; it is separate from\n"
        "conditional retrieval quality.\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(out), "coverage": coverage, "all93Same": all(r["same"] for r in comparison)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
