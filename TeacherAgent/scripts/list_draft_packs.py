#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""列出 data/drafts 下所有知识包的审核状态与规模，供人工审核验收。

输出每包的：文件相对路径、状态字段、科目、节点数、题目数、标题，并给出汇总。
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(r"<LOCAL_REPO>")


def pack_summary(path: pathlib.Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:  # 解析失败要显式暴露，不能静默跳过
        return {"path": path, "error": str(error)}

    def count(key):
        value = data.get(key)
        return len(value) if isinstance(value, list) else 0

    return {
        "path": path,
        "status": data.get("status") or data.get("reviewStatus") or "?",
        "subject": data.get("subject") or data.get("subjectCode") or "?",
        "title": (data.get("title") or data.get("name") or "")[:28],
        "nodes": count("nodes") or count("knowledgeNodes"),
        "questions": count("questions"),
        "packId": data.get("packId") or data.get("id") or "",
    }


def main() -> int:
    files = sorted(ROOT.glob("data/drafts/**/*.json"))
    if not files:
        print("data/drafts 下没有 JSON 包")
        return 1

    rows = [pack_summary(path) for path in files]
    broken = [row for row in rows if "error" in row]
    ok = [row for row in rows if "error" not in row]

    print(f"共 {len(ok)} 个包（解析失败 {len(broken)} 个）\n")
    print(f"{'状态':<9}{'科目':<12}{'节点':>5}{'题目':>5}  文件")
    for row in ok:
        relative = row["path"].relative_to(ROOT).as_posix()
        print(f"{row['status']:<9}{row['subject']:<12}{row['nodes']:>5}{row['questions']:>5}  {relative}")

    statuses = {}
    for row in ok:
        statuses[row["status"]] = statuses.get(row["status"], 0) + 1
    print("\n状态分布:", statuses)
    print("节点合计:", sum(row["nodes"] for row in ok), "题目合计:", sum(row["questions"] for row in ok))
    for row in broken:
        print("解析失败:", row["path"], row["error"][:80])
    return 0


if __name__ == "__main__":
    sys.exit(main())
