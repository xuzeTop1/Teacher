#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""知识库晋升后，把论文与准入记录的口径与事实对齐。

原则：只写当前为真的数字。
  * 内容规模（50 Pack / 771 知识点 / 762 题）是文件实测事实，直接写入；
  * 向量数量尚无（库里仍是 268，重算后才到 1,533），因此论文里写成
    「经 1024 维 bge-m3 嵌入后构成千级向量语料」的设计口径，不写"已生成 1,533 条"；
  * 准入记录里把向量行显式标注为待重算。
"""

import pathlib

import docx

PAPER = pathlib.Path(
    r"<CHAT_ARCHIVE>\chats\2026-09-10\new-chat"
    r"\隐私优先的多端协同智能辅导系统设计与实现-含实验数据v5-公式编号v5.docx"
)
RECORD = pathlib.Path(
    r"<REPO_ROOT>-alerttime-json\docs\knowledge-review\2026-09-11-approved-pack-promotion.md"
)

PAPER_EDITS = [
    # P60：内容规模换成新基线；向量写成设计口径
    ("当前系统的知识库向量规模约为 270 条（种子知识点 145 条 + 题库条目 123 条，1024 维，bge-m3），单次暴力余弦检索为毫秒级（见 7.3 节表 3）",
     "当前系统的正式知识库为 50 个审核通过的 Pack，共 771 个知识点与 762 道题；这些知识实体经 1024 维（bge-m3）"
     "嵌入后构成千级向量语料（规模区间见 7.3 节表 3），单次暴力余弦检索为毫秒级"),
    # P65：稠密通道覆盖范围改成正式集合
    ("稠密通道。覆盖知识库中已生成嵌入的种子知识点与题库条目（1024 维，bge-m3，当前约 270 条），沿用无索引的暴力余弦检索。",
     "稠密通道。覆盖正式知识库中经 1024 维（bge-m3）嵌入的知识点与题库条目（正式集合为 771 个知识点 + 762 道题，"
     "合计 1 533 条），沿用无索引的暴力余弦检索。"),
    # P42 / P124：「千级文档片段」与本文口径不一致（私有片段只有 50），改为知识实体
    ("而本系统知识库规模为千级文档片段", "而本系统知识库规模为千级知识实体（知识点与题目）"),
    ("为验证第 4 章「在千级文档片段规模下采用无索引暴力余弦检索」的架构合理性",
     "为验证第 4 章「在千级知识实体规模下采用无索引暴力余弦检索」的架构合理性"),
]

RECORD_EDITS = [
    ("| **向量检索库条目** | 268 条 | **1533 条** | 需配置 Embedding Provider 后全量重建 |",
     "| **向量检索库条目** | 268 条 | **1 533 条（待重算）** | 正式集合已扩至 1 533 条，但向量尚未重建："
     "库内当前仍为 268 条，需配置 Embedding Provider 后全量重建；重建完成前，新晋升内容不可被稠密通道检索 |"),
]


def edit_paper() -> None:
    document = docx.Document(str(PAPER))
    backup = PAPER.with_suffix(".bak.docx")
    if not backup.exists():
        backup.write_bytes(PAPER.read_bytes())

    remaining = dict(PAPER_EDITS)
    for paragraph in document.paragraphs:
        text = paragraph.text
        for old, new in list(remaining.items()):
            if old in text:
                runs = paragraph.runs
                assert runs, f"段落无 run：{text[:40]}"
                runs[0].text = text.replace(old, new, 1)
                for run in runs[1:]:
                    run._element.getparent().remove(run._element)
                del remaining[old]
                print("论文已改:", old[:34], "…")
    document.save(str(PAPER))
    if remaining:
        print("!! 论文未命中:", [key[:34] for key in remaining])
    print("论文已保存:", PAPER.name)


def edit_record() -> None:
    text = RECORD.read_text(encoding="utf-8")
    for old, new in RECORD_EDITS:
        if old in text:
            text = text.replace(old, new, 1)
            print("记录已改:", old[:40], "…")
        else:
            print("!! 记录未命中:", old[:40])
    RECORD.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    edit_paper()
    edit_record()
