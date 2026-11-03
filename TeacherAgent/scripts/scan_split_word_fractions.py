#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""专项扫描：英文词被自动化脚本按 “/” 拆显成分式的损坏。

特征：`\\frac{单字母}{单字母}` 嵌在单词内部——即 `\\frac` 紧前面是拉丁字母，
或闭括号后紧跟着拉丁字母。合法的数学用法（如 `i\\frac{(i+1)}{2}`、
`2\\frac{1}{2}`、`\\frac{\\hbar}{2}`）不会命中，因为分子/分母不是单字母，
或者前后没有紧邻字母。

只读扫描，不改内容；命中处打印上下文供人工判断。
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(r"D:\TeacherAgent-alerttime-json")
BS = chr(92)
FRACTION = re.compile(BS + BS + r"frac\{([^{}]{1,3})\}\{([^{}]{1,3})\}")


def is_wordy(part: str) -> bool:
    """分子/分母是否为"像被拆开的一个词片段"：1–2 个拉丁字母。"""
    return bool(re.fullmatch(r"[A-Za-z]{1}", part.strip()))


def contexts(text: str):
    for match in FRACTION.finditer(text):
        numerator, denominator = match.group(1), match.group(2)
        if not (is_wordy(numerator) and is_wordy(denominator)):
            continue
        before = text[match.start() - 1] if match.start() > 0 else ""
        after = text[match.end()] if match.end() < len(text) else ""
        # 单词内部：紧邻字母
        # 收紧：分子分母必须各只有 1 个字母；前面是 ≥2 个字母构成的"词片段"
        # 且该片段不是 LaTeX 命令名（命令前有反斜杠）；闭括号后紧跟字母。
        if len(numerator.strip()) != 1 or len(denominator.strip()) != 1:
            continue
        fragment = re.search(r"([A-Za-z]{2,})$", text[: match.start()])
        if not fragment:
            continue
        head_index = fragment.start()
        if head_index > 0 and text[head_index - 1] == BS:
            continue  # 是 \cdot / \lambda 这类命令名，不是被拆的单词
        if not re.fullmatch(r"[A-Za-z]", after or ""):
            continue
        start = max(0, match.start() - 40)
        yield text[start:match.end() + 30], match.group(0)


def strings(value):
    """递归取出结构里所有字符串叶子。

    不能用 str(dict)/str(list)：repr 会把 rac 变成 \frac，导致下文的
    "命令名"判断把真阳性也滤掉（踩过这个坑）。
    """
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


def walk(node):
    for key in ("title", "summary", "content", "answer", "explanation",
                "misconceptions", "socraticHints", "solutionSteps", "hints"):
        for text in strings(node.get(key)):
            yield key, text


def main() -> int:
    found = []
    files = list((ROOT / "data/knowledge").glob("*.json")) + list((ROOT / "data/questions").glob("*.json"))
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for entity in (data.get("nodes") or []) + (data.get("questions") or []):
            for key, text in walk(entity):
                for snippet, raw in contexts(text):
                    found.append((path.stem, entity.get("id"), key, raw, snippet))

    print(f"扫描 {len(files)} 个 seed 文件，命中 {len(found)} 处\n")
    for pack, entity_id, key, raw, snippet in found:
        print(f"[{pack}] {entity_id} ({key})  {raw}")
        print(f"    …{snippet}…")
    if not found:
        print("未发现单词被拆成分式的损坏。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
