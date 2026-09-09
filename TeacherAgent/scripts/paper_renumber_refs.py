# -*- coding: utf-8 -*-
"""按正文实际首现顺序（LLM→KT→RAG 小节）重排 GB/T 7714 顺序编码。

旧→新映射：6→1, 7→2, 1→3, 2→4, 3→5, 4→6, 9→7, 10→8, 5→9, 8→10
文献条目内容不变，仅重排编号与列表顺序。"""
import zipfile, re, html, os
from xml.sax.saxutils import escape

P = r"D:/新建文件夹/隐私优先的多端协同智能辅导系统设计与实现-含实验数据v2.docx"
z = zipfile.ZipFile(P)
members = [(i, z.read(i.filename)) for i in z.infolist()]
z.close()
xml = next(d for i, d in members if i.filename == "word/document.xml").decode("utf-8")

def segments():
    return [(m.start(), m.end()) for m in
            re.finditer(r'<w:p(?: [^>]*)?>.*?</w:p>|<w:tbl>.*?</w:tbl>', xml, re.S)]

def para_replace(idx, old, new):
    global xml
    s, e = segments()[idx]
    seg = xml[s:e]
    assert seg.count(old) == 1, f"para{idx}: {old!r} count={seg.count(old)}"
    xml = xml[:s] + seg.replace(old, new) + xml[e:]

def find_para(marker):
    for i, (s, e) in enumerate(segments()):
        t = html.unescape(re.sub(r'<[^>]+>', '', xml[s:e]))
        if marker in t:
            return i
    raise AssertionError(marker)

i_llm = find_para("全新机遇[6]")
i_kt = find_para("隐马尔可夫过程")
i_rag = find_para("缓解模型幻觉并注入领域知识")

# LLM 段：6→1, 7→2
para_replace(i_llm, "全新机遇[6]", "全新机遇[1]")
para_replace(i_llm, "（ITS）[7]", "（ITS）[2]")
# KT 段：[1][2] 是独立 run（<w:t>[1]</w:t>），[3][4]/[9][10] 是连续串
para_replace(i_kt, "[9][10]", "[7][8]")
para_replace(i_kt, "[3][4]", "[5][6]")
para_replace(i_kt, "<w:t>[1]</w:t>", "<w:t>[3]</w:t>")
para_replace(i_kt, "<w:t>[2]</w:t>", "<w:t>[4]</w:t>")
# RAG 段：[5] 是独立 run，[8] 在长 run 内
para_replace(i_rag, "<w:t>[5]</w:t>", "<w:t>[9]</w:t>")
para_replace(i_rag, "向量数据库[8]", "向量数据库[10]")

# 文献列表按新序重建
RPR_REF = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
entries = [
    "KASNECI E, SEßLER K, KÜCHEMANN S, et al. ChatGPT for good? On opportunities and challenges of large language models for education[J]. Learning and Individual Differences, 2023, 103: 102274.",
    "VANLEHN K. The relative effectiveness of human tutoring, intelligent tutoring systems, and other tutoring systems[J]. Educational Psychologist, 2011, 46(4): 197-221.",
    "CORBETT A T, ANDERSON J R. Knowledge tracing: Modeling the acquisition of procedural knowledge[J]. User Modeling and User-Adapted Interaction, 1994, 4(4): 253-278.",
    "PIECH C, BASSEN J, HUANG J, et al. Deep knowledge tracing[C]//Advances in Neural Information Processing Systems. 2015, 28: 505-513.",
    "刘淇, 沈双艾, 黄振亚, 等. 智慧教育中认知诊断与知识追踪综述[J]. 计算机学报, 2023, 46(8): 1599-1627.",
    "杜修平, 杨现民, 李新, 等. 智能教育环境中知识追踪的模型演进与应用框架构建[J]. 电化教育研究, 2021, 42(7): 69-76.",
    "郑勤华, 柴唤友, 魏顺平, 等. 智慧教育视角下的知识追踪模型研究[J]. 现代远程教育研究, 2020, 32(6): 95-103.",
    "祝智庭, 彭红超. 智慧教育视域下的精准教学模型与实践路径[J]. 中国电化教育, 2020(1): 1-8.",
    "LEWIS P, PEREZ E, PIKTUS A, et al. Retrieval-augmented generation for knowledge-intensive NLP tasks[C]//Advances in Neural Information Processing Systems. 2020, 33: 9459-9474.",
    "MALKOV Y A, YASHUNIN D A. Efficient and robust approximate nearest neighbor search using hierarchical navigable small world graphs[J]. IEEE Transactions on Pattern Analysis and Machine Intelligence, 2020, 42(4): 824-836.",
]
ref_block = ''.join('<w:p><w:pPr><w:jc w:val="left"/>' + RPR_REF + '</w:pPr><w:r>' + RPR_REF +
                    f'<w:t xml:space="preserve">[{n}] {escape(e)}</w:t></w:r></w:p>'
                    for n, e in enumerate(entries, 1))

# 替换现有文献段（"参考文献:" 之后到文档尾部表格/段之前的 10 个条目段）
segs = segments()
head_i = next(i for i, (s, e) in enumerate(segs)
              if html.unescape(re.sub(r'<[^>]+>', '', xml[s:e])).strip() == "参考文献:")
start = segs[head_i + 1][0]
end = head_i + 1
while end < len(segs):
    s, e = segs[end]
    t = html.unescape(re.sub(r'<[^>]+>', '', xml[s:e])).strip()
    if xml[s:e].startswith('<w:tbl>') or not re.match(r'^\[\d+\]', t):
        break
    end += 1
xml = xml[:start] + ref_block + xml[segs[end - 1][1]:]

with zipfile.ZipFile(P, "w", zipfile.ZIP_DEFLATED) as out:
    for item, data in members:
        if item.filename == "word/document.xml":
            data = xml.encode("utf-8")
        out.writestr(item, data)
print("OK", os.path.getsize(P))
