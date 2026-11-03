#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""复核知识包晋升报告里声称已修复的损坏模式，检查是否还有残留。"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(r"<LOCAL_REPO>")
BS = chr(92)  # 反斜杠，避免转义地狱

PATTERNS = {
    "伪分式（英文词被拆成 \\frac{x}{y}+字母）": re.compile(BS + BS + r"frac\{[a-zA-Z]\}\{[a-zA-Z]\}[a-zA-Z]"),
    "残留 \\hbar": re.compile(BS + BS + r"hbar"),
    "数字跨界拆分（数字紧跟 \\frac）": re.compile(r"\d" + BS + BS + r"frac\{\d"),
    "跨界括号（\\frac 分子含右括号）": re.compile(BS + BS + r"frac\{[^}]*\)\}"),
    "裸 Unicode ½ / √": re.compile(r"[½√]"),
    "连续四反斜杠（多重转义）": re.compile(BS * 4 + BS * 2),
    "未转义百分号（在 $ 内）": re.compile(r"\$[^$]*[^" + BS + r"]%[^$]*\$"),
}


def walk_texts(node):
    parts = []
    for key in ("title", "summary", "content", "answer", "explanation"):
        if isinstance(node.get(key), str):
            parts.append(node[key])
    for key in ("misconceptions", "socraticHints", "solutionSteps", "hints"):
        value = node.get(key)
        if isinstance(value, list):
            parts.extend(str(item) for item in value)
    return parts


def main() -> int:
    hits = {name: [] for name in PATTERNS}
    files = list((ROOT / "data/knowledge").glob("*.json")) + list((ROOT / "data/questions").glob("*.json"))
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        entities = (data.get("nodes") or []) + (data.get("questions") or [])
        for entity in entities:
            for text in walk_texts(entity):
                for name, pattern in PATTERNS.items():
                    if pattern.search(text):
                        hits[name].append(f"{path.stem}:{entity.get('id')}")

    print(f"扫描 {len(files)} 个 seed 文件\n")
    clean = True
    for name, found in hits.items():
        if found:
            clean = False
            print(f"  残留! {name}: {len(found)} 处 → {found[:4]}")
        else:
            print(f"  无残留  {name}")
    print("\n结论:", "报告声称的修复均已生效，未发现残留" if clean else "存在残留，需回到修复步骤")
    return 0


if __name__ == "__main__":
    sys.exit(main())
