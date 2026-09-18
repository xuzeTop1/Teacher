#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""读回生成的 DOCX，做成品级质量检查（不信任中间产物）。

检查项：
  * 残留 LaTeX 垃圾字符率 `\\ { }`（阈值 < 0.05%）；
  * 单字符行占比（阈值 < 5%）；
  * 段落数与正文总字数（与切片预算对照，CHUNK_TARGET_CHARS=1500）；
  * 抽样打印含公式的段落（供人工肉眼确认）；
  * 检查是否残留 `[[`、`]]`、`displaystyle`、`zh-hans`、`<math` 等标记。
任一硬指标不过 → 退出码 1，避免把坏语料交付导入。
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sys

import docx

CHUNK_TARGET_CHARS = 1500
JUNK_RATIO_MAX = 0.0002
SHORT_LINE_MAX = 0.05
# 结构性残留标记：集合写法里的单个花括号是合法正文，不计入
STRUCTURAL_MARKERS = ["\\", "{{", "}}", "{|", "|}", "|-", "[[", "]]", "&nbsp;", "displaystyle",
                      "<math", "zh-hans", "\\frac"]
# 繁体判定：把全文过一遍 t2s 转换，统计**真的发生变化**的字符数。
# 不用手写字符集——里面必然混入简繁同形字（硬/程/量…），会把简体正文误判成繁体。
try:
    from zhconv import convert as _zh_convert
except Exception:  # noqa: BLE001
    _zh_convert = None
TRAD_RATIO_MAX = 0.005


def trad_ratio_of(text: str) -> float:
    if _zh_convert is None:
        return float("nan")
    converted = _zh_convert(text, "zh-cn")
    changed = sum(1 for a, b in zip(text, converted) if a != b)
    return changed / max(1, len(text))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "eval_corpus_docs"))
    parser.add_argument("--show", type=int, default=3, help="每份文档打印几条含公式的段落")
    args = parser.parse_args()

    files = sorted(glob.glob(os.path.join(args.dir, "*.docx")))
    if not files:
        print("未找到 DOCX:", args.dir)
        sys.exit(1)

    total_chars = 0
    total_chunks = 0
    failed = []
    print("=" * 92)
    print("%-30s %8s %8s %10s %10s %10s %9s" % ("文档", "段落", "字数", "估计切片", "垃圾率", "单字行率", "繁体率"))
    print("-" * 92)
    for path in files:
        document = docx.Document(path)
        paragraphs = [p.text.strip() for p in document.paragraphs if p.text.strip()]
        text = "\n".join(paragraphs)
        if not text:
            failed.append((os.path.basename(path), "空文档"))
            continue
        junk = sum(text.count(token) for token in STRUCTURAL_MARKERS)
        junk_ratio = junk / len(text)
        short = sum(1 for p in paragraphs if len(p) <= 2)
        short_ratio = short / len(paragraphs)
        trad_ratio = trad_ratio_of(text)
        chunks = max(1, round(len(text) / CHUNK_TARGET_CHARS))
        total_chars += len(text)
        total_chunks += chunks
        print("%-30s %8d %8d %10d %9.4f%% %9.2f%% %8.3f%%" % (
            os.path.basename(path)[:30], len(paragraphs), len(text), chunks, junk_ratio * 100,
            short_ratio * 100, trad_ratio * 100))

        problems = []
        if junk_ratio >= JUNK_RATIO_MAX:
            detail = {t: text.count(t) for t in STRUCTURAL_MARKERS if text.count(t)}
            problems.append(f"结构残留率 {junk_ratio*100:.4f}% ≥ {JUNK_RATIO_MAX*100}% 明细={detail}")
        if short_ratio >= SHORT_LINE_MAX:
            problems.append(f"单字行率 {short_ratio*100:.2f}% ≥ {SHORT_LINE_MAX*100}%")
        if trad_ratio != trad_ratio:  # nan：zhconv 缺失
            problems.append("未安装 zhconv，无法校验繁简统一")
        elif trad_ratio >= TRAD_RATIO_MAX:
            problems.append(f"繁体率 {trad_ratio*100:.3f}% ≥ {TRAD_RATIO_MAX*100}%（须为简体，否则漏召回）")
        if problems:
            failed.append((os.path.basename(path), "; ".join(problems)))

        if args.show:
            print("  含公式段落抽样：")
            shown = 0
            for paragraph in paragraphs:
                if re.search(r"[=<>≤≥∈∞εδλ∫Σ√∀∃→]", paragraph) and len(paragraph) > 40:
                    print("    ·", paragraph[:220])
                    shown += 1
                    if shown >= args.show:
                        break
        print()

    print("-" * 92)
    print("合计：%d 份文档，%d 字，估计切片 ~%d" % (len(files), total_chars, total_chunks))
    if failed:
        print("\n❌ 未通过检查：")
        for name, reason in failed:
            print(f"   - {name}: {reason}")
        sys.exit(1)
    print("\n✅ 全部通过质量闸门")


if __name__ == "__main__":
    main()
