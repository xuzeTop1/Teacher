#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""知识包准入门禁：对 data/knowledge 与 data/questions 下的包做逐项结构验收。

检查项（对应 docs/knowledge-base-governance.md §4.3 与先例
docs/knowledge-review/2026-07-27-approved-pack-promotion.md 的准入核验）：
  1. status 字段存在且 knowledge 与 questions 两侧一致；
  2. 节点/题目 id 唯一；
  3. 题目 knowledgeNodeIds 均指向同 Pack 内存在的节点（跨包引用要单独标记）；
  4. 每个实体具备来源字段（source.sourceType / license 之类）；
  5. 必填字段非空（title/summary、题目 content/answer/difficulty）；
  6. 裸 TeX / 公式损坏模式扫描（与论文 §4.1 的七类损坏对应）；
  7. 先决关系 prerequisites 指向的节点在同 Pack 内存在。

注意：本脚本只做**结构与文本层面**的验收，不构成学科内容正确性的专家认证。
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(r"<LOCAL_REPO>")

# 与论文 §4.1 完整性校验对应的损坏模式
BARE_TEX = re.compile(r"(?<!\$)\\[a-zA-Z]{2,}")
BROKEN_DELIM = re.compile(r"\$\$[^$]*$|\$[^$\n]{200,}")
CMD_JUNK = re.compile(r"\\[a-zA-Z]+\{[^}]*$")
PLACEHOLDER = re.compile(r"(TODO|TBD|待补|占位|xxx|XXX|原题略)")
# 治理文档 §4.3 明令不得在补充权威来源前晋升的类别
BARRED = {"civil-common-sense"}


def source_ok(entity: dict) -> bool:
    source = entity.get("source")
    if isinstance(source, dict):
        return bool(source.get("sourceType") or source.get("type")) and bool(
            source.get("license") or source.get("licenseSnapshot")
        )
    return False


def scan_text(value: str) -> list:
    hits = []
    for name, pattern in (("裸TeX", BARE_TEX), ("定界符断裂", BROKEN_DELIM),
                          ("命令截断", CMD_JUNK), ("占位符", PLACEHOLDER)):
        if pattern.search(value or ""):
            hits.append(name)
    return hits


def walk_text(entity: dict) -> list:
    """收集实体里所有用户可见文本，用于公式门禁扫描。"""
    parts = []
    for key in ("title", "summary", "content", "answer", "explanation"):
        if isinstance(entity.get(key), str):
            parts.append(entity[key])
    for key in ("misconceptions", "socraticHints", "solutionSteps", "hints"):
        value = entity.get(key)
        if isinstance(value, list):
            parts.extend(str(item) for item in value)
    return parts


def review(pack: pathlib.Path, questions_pack: pathlib.Path | None) -> dict:
    data = json.loads(pack.read_text(encoding="utf-8"))
    nodes = data.get("nodes") or []
    issues = []

    if not data.get("status"):
        issues.append("缺少 status 字段")
    ids = [node.get("id") for node in nodes]
    if len(ids) != len(set(ids)):
        issues.append("节点 id 重复")
    known = set(ids)

    for node in nodes:
        if not node.get("title"):
            issues.append(f"{node.get('id')}: 缺 title")
        if not source_ok(node):
            issues.append(f"{node.get('id')}: 来源/许可证字段不完整")
        for prerequisite in node.get("prerequisites") or []:
            if prerequisite not in known:
                issues.append(f"{node.get('id')}: 先决节点 {prerequisite} 不在本包内")
        hits = [hit for text in walk_text(node) for hit in scan_text(text)]
        if hits:
            issues.append(f"{node.get('id')}: 文本门禁 {sorted(set(hits))}")

    question_count = 0
    question_status = None
    if questions_pack and questions_pack.exists():
        question_data = json.loads(questions_pack.read_text(encoding="utf-8"))
        question_status = question_data.get("status")
        questions = question_data.get("questions") or []
        question_count = len(questions)
        if question_status != data.get("status"):
            issues.append(f"两侧 status 不一致: {data.get('status')} vs {question_status}")
        qids = [q.get("id") for q in questions]
        if len(qids) != len(set(qids)):
            issues.append("题目 id 重复")
        for question in questions:
            for node_id in question.get("knowledgeNodeIds") or []:
                if node_id not in known:
                    issues.append(f"{question.get('id')}: 关联节点 {node_id} 不在本包 knowledge 内")
            if not source_ok(question):
                issues.append(f"{question.get('id')}: 来源/许可证字段不完整")
            for required in ("content", "answer"):
                if not question.get(required):
                    issues.append(f"{question.get('id')}: 缺 {required}")
            if question.get("difficulty") is None:
                issues.append(f"{question.get('id')}: 缺 difficulty")
            hits = [hit for text in walk_text(question) for hit in scan_text(text)]
            if hits:
                issues.append(f"{question.get('id')}: 文本门禁 {sorted(set(hits))}")

    return {
        "pack": pack.stem.replace(".seed", ""),
        "subject": data.get("subject"),
        "status": data.get("status"),
        "questionStatus": question_status,
        "nodes": len(nodes),
        "questions": question_count,
        "issues": issues,
        "barred": pack.stem.replace(".seed", "") in BARRED,
    }


def main() -> int:
    knowledge_dir = ROOT / "data/knowledge"
    question_dir = ROOT / "data/questions"
    rows = []
    for pack in sorted(knowledge_dir.glob("*.json")):
        name = pack.stem.replace(".seed", "")
        rows.append(review(pack, question_dir / f"{name}.seed.json"))

    drafts = [row for row in rows if row["status"] == "draft"]
    clean = [row for row in drafts if not row["issues"] and not row["barred"]]
    barred = [row for row in drafts if row["barred"]]
    dirty = [row for row in drafts if row["issues"] and not row["barred"]]

    print(f"共 {len(rows)} 个包：approved {len(rows) - len(drafts)}，draft {len(drafts)}")
    print(f"  draft 中：无问题 {len(clean)}，有结构问题 {len(dirty)}，被规则禁止晋升 {len(barred)}")
    print(f"  draft 节点合计 {sum(row['nodes'] for row in drafts)}，题目合计 {sum(row['questions'] for row in drafts)}")

    if dirty:
        print("\n=== 有结构问题的 draft 包 ===")
        for row in dirty:
            print(f"  [{row['pack']}] {row['subject']} 节点{row['nodes']} 题{row['questions']} 问题 {len(row['issues'])} 条")
            for issue in row["issues"][:4]:
                print("      -", issue)
            if len(row["issues"]) > 4:
                print(f"      … 另有 {len(row['issues']) - 4} 条")
    if barred:
        print("\n=== 被治理规则禁止晋升（需补权威来源或人工复核记录）===")
        for row in barred:
            print(f"  [{row['pack']}] 节点{row['nodes']} 题{row['questions']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
