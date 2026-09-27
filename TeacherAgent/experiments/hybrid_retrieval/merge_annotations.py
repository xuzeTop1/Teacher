#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""合并两位评审的盲标结果：Cohen's kappa + 分歧清单 + 仲裁写回题集。

输入
----
* 两份（或三份，含仲裁）由盲标网页「导出标注 JSON」产出的文件：
  {"annotator": "...", "judgments": {"q001": {"private_chunk:xxx": {"v":1,"edge":false}, ...}}}
* `work/annotation/pool.json`（候选池，定义判断矩阵的全集）

流程
----
1. 对两位评审**都判过**的 (qid, key) 计算 Cohen's kappa（二元：1=相关，0=不相关）。
2. 输出混淆矩阵与分歧清单（kappa < 0.6 时先回头改标注细则再继续）。
3. 合并策略（--policy）：
     intersection  两人都判 1 才算相关（保守，偏向 precision，默认）
     union         任一人判 1 即相关（宽松，偏向 recall）
     arbiter       分歧项以第三份仲裁文件为准；无仲裁文件的分歧项按 intersection
4. 写回 `work/qa_100_human.jsonl`：
     gold_a1 / gold_a2 = 两人各自的相关集合；gold_machine = 原机器 gold（留档）；
     gold_ids = 合并结果；annotator_1 / annotator_2 = 评审名
     （run_eval 归档的 manifest 据此自动变为 humanAnnotated=true）。
5. 校验：若某题合并后 gold 为空，题面不可答，列出待处理。

用法
----
    python merge_annotations.py --a1 annotations_张三.json --a2 annotations_李四.json
    python merge_annotations.py --a1 ... --a2 ... --arbiter annotations_导师.json --policy arbiter
"""

import argparse
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(HERE, "work")
POOL_PATH = os.path.join(WORK_DIR, "annotation", "pool.json")
QA_PATH = os.path.join(WORK_DIR, "qa_100_human.jsonl")
REPORT_PATH = os.path.join(WORK_DIR, "annotation", "kappa_report.json")


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_jsonl(path):
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def kappa(pairs):
    """pairs: [(v1, v2)]，值为 0/1。返回 (po, pe, kappa, 混淆矩阵)。"""
    if not pairs:
        return 0.0, 0.0, 0.0, {}
    both1 = sum(1 for a, b in pairs if a == 1 and b == 1)
    both0 = sum(1 for a, b in pairs if a == 0 and b == 0)
    a1_only = sum(1 for a, b in pairs if a == 1 and b == 0)
    a2_only = sum(1 for a, b in pairs if a == 0 and b == 1)
    n = len(pairs)
    po = (both1 + both0) / n
    p1 = (both1 + a1_only) / n          # 评审一判 1 的比例
    p2 = (both1 + a2_only) / n          # 评审二判 1 的比例
    pe = p1 * p2 + (1 - p1) * (1 - p2)
    kappa_value = (po - pe) / (1 - pe) if pe < 1 else 1.0
    matrix = {"both_1": both1, "both_0": both0, "only_a1_1": a1_only, "only_a2_1": a2_only, "n": n}
    return po, pe, kappa_value, matrix


def main() -> None:
    parser = argparse.ArgumentParser(description="合并盲标并写回题集")
    parser.add_argument("--a1", required=True, help="评审一导出的 JSON")
    parser.add_argument("--a2", required=True, help="评审二导出的 JSON")
    parser.add_argument("--arbiter", help="仲裁人导出的 JSON（--policy arbiter 时用于分歧项）")
    parser.add_argument("--policy", choices=["intersection", "union", "arbiter"],
                        default="intersection")
    parser.add_argument("--dry-run", action="store_true", help="只出报告，不写回题集")
    args = parser.parse_args()

    pool = load(POOL_PATH)
    questions = {q["qid"]: q for q in pool["questions"]}
    a1 = load(args.a1)
    a2 = load(args.a2)
    arbiter = load(args.arbiter) if args.arbiter else None
    name1 = a1.get("annotator", os.path.basename(args.a1))
    name2 = a2.get("annotator", os.path.basename(args.a2))
    j1, j2 = a1["judgments"], a2["judgments"]
    ja = (arbiter or {}).get("judgments", {})

    both, disagreements = [], []
    for qid, question in sorted(questions.items()):
        for candidate in question["candidates"]:
            key = candidate["key"]
            v1 = (j1.get(qid, {}).get(key) or {}).get("v")
            v2 = (j2.get(qid, {}).get(key) or {}).get("v")
            if v1 is None or v2 is None:
                continue                       # 未双判的候选不进 kappa
            v1, v2 = int(v1), int(v2)
            both.append((qid, key, v1, v2))
            if v1 != v2:
                va = (ja.get(qid, {}).get(key) or {}).get("v")
                disagreements.append({
                    "qid": qid, "key": key, "a1": v1, "a2": v2,
                    "arbiter": (int(va) if va is not None else None),
                    "title": candidate["title"][:40],
                })

    po, pe, kappa_value, matrix = kappa([(v1, v2) for _, _, v1, v2 in both])
    print(f"双判样本： {matrix['n']}  一致率 po = {po:.4f}  期望一致 pe = {pe:.4f}")
    print(f"Cohen's kappa = {kappa_value:.4f}   （>0.6 可用，>0.8 良好；<0.4 建议回头改细则）")
    print(f"分歧项： {len(disagreements)} 条")
    for item in disagreements[:12]:
        print("   %s  %s  a1=%d a2=%d%s" % (
            item["qid"], item["key"][:44], item["a1"], item["a2"],
            f" → 仲裁 {item['arbiter']}" if item["arbiter"] is not None else ""))

    # ── 合并 gold ────────────────────────────────────────────────────────
    qa_rows = load_jsonl(QA_PATH) if os.path.exists(QA_PATH) else []
    qa_by_qid = {row["qid"]: row for row in qa_rows}
    updated, empty_gold = 0, []
    for qid, question in sorted(questions.items()):
        row = qa_by_qid.get(qid)
        if row is None:
            continue
        gold_a1, gold_a2, gold_final = [], [], []
        for candidate in question["candidates"]:
            key = candidate["key"]
            v1 = (j1.get(qid, {}).get(key) or {}).get("v")
            v2 = (j2.get(qid, {}).get(key) or {}).get("v")
            if v1 is None and v2 is None:
                continue                   # 完全未判的候选不进 gold
            v1 = int(v1) if v1 is not None else v2
            v2 = int(v2) if v2 is not None else v1
            if v1 == 1:
                gold_a1.append(key)
            if v2 == 1:
                gold_a2.append(key)
            if v1 == 1 and v2 == 1:
                gold_final.append(key)
            elif v1 != v2:
                chosen = None
                if args.policy == "union":
                    chosen = 1 if (v1 == 1 or v2 == 1) else 0
                elif args.policy == "arbiter":
                    chosen = (ja.get(qid, {}).get(key) or {}).get("v")
                    if chosen is None:
                        chosen = 1 if (v1 == 1 and v2 == 1) else 0
                else:  # intersection
                    chosen = 1 if (v1 == 1 and v2 == 1) else 0
                if int(chosen) == 1:
                    gold_final.append(key)
        if not gold_final:
            empty_gold.append(qid)
        row["gold_machine"] = row.get("gold_ids", [])       # 机器 gold 留档
        row["gold_a1"] = gold_a1
        row["gold_a2"] = gold_a2
        row["gold_ids"] = gold_final
        row["annotator_1"] = name1
        row["annotator_2"] = name2
        updated += 1

    print(f"\n合并策略： {args.policy}   更新题数： {updated}")
    if empty_gold:
        print(f"⚠ {len(empty_gold)} 题合并后 gold 为空（不可答），需人工处理：")
        for qid in empty_gold[:10]:
            print("   ", qid, qa_by_qid[qid]["query"])

    report = {
        "annotators": [name1, name2],
        "policy": args.policy,
        "judgedPairs": matrix,
        "po": po, "pe": pe, "kappa": kappa_value,
        "disagreements": disagreements,
        "emptyGoldQuestions": empty_gold,
        "updatedQuestions": updated,
    }
    with open(REPORT_PATH, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(f"报告： {REPORT_PATH}")

    if args.dry_run:
        print("（--dry-run：未写回题集）")
        return

    with open(QA_PATH, "w", encoding="utf-8") as handle:
        for row in qa_rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"已写回： {QA_PATH}")
    print("下一步： python run_eval.py --qa work/qa_100_human.jsonl embed && run")
    print("（归档 manifest 将自动变为 humanAnnotated=true）")


if __name__ == "__main__":
    main()
