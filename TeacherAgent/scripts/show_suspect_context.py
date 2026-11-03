#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""逐条打印可疑命中处的真实上下文，用于区分真缺陷与正则误报。"""

import json
import pathlib
import sys

ROOT = pathlib.Path(r"<LOCAL_REPO>")
TARGETS = [
    ("data/questions/cs408-operating-systems.seed.json", "cs408-os-q-sync-001", "伪分式"),
    ("data/questions/physics-modern.seed.json", "physics-modern-q8", "hbar"),
    ("data/knowledge/cs408-data-structures.seed.json", "cs408-ds-array-matrix", "跨界括号"),
    ("data/knowledge/english-grammar.seed.json", "eng-grammar-005", "Unicode ½"),
]


def texts(node):
    out = []
    for key in ("title", "summary", "content", "answer", "explanation"):
        if isinstance(node.get(key), str):
            out.append((key, node[key]))
    for key in ("misconceptions", "socraticHints", "solutionSteps", "hints"):
        value = node.get(key)
        if isinstance(value, list):
            out.extend((key, str(item)) for item in value)
    return out


def main() -> int:
    for relative, entity_id, label in TARGETS:
        data = json.loads((ROOT / relative).read_text(encoding="utf-8"))
        entities = (data.get("nodes") or []) + (data.get("questions") or [])
        node = next((e for e in entities if e.get("id") == entity_id), None)
        print(f"=== [{label}] {entity_id} ({relative.split('/')[-1]})")
        if node is None:
            print("    未找到该实体")
            continue
        needles = {"伪分式": "frac", "hbar": "hbar", "跨界括号": "frac", "Unicode ½": "½"}
        needle = needles[label]
        shown = 0
        for key, text in texts(node):
            index = text.find(needle)
            if index >= 0:
                start = max(0, index - 60)
                print(f"    {key}: …{text[start:index + 70]}…")
                shown += 1
                if shown >= 2:
                    break
        if not shown:
            print("    该字段未见命中（可能命中的是别的字段）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
