# -*- coding: utf-8 -*-
"""v2 附件：隐私表述两句收窄 + 正文引用重编号 + 文末模板表格替换为 10 条 GB/T 7714 文献。

GB/T 顺序编码制合规微调（超出用户字面文本之处，均有依据）：
1) 段22 将 [6]（LLM 教育机遇）置于 [7]（ITS）之前，保证正文首次出现顺序递增；
2) 段27 为 [9][10] 补了正文引用（否则文末列表存在未引用条目，违反顺序编码制）。
"""
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

def para_text(idx):
    s, e = segments()[idx]
    return html.unescape(re.sub(r'<[^>]+>', '', xml[s:e])).strip()

def para_replace(idx, old, new):
    """按段索引替换（每次重算偏移；替换不增删段落，索引稳定）。"""
    global xml
    s, e = segments()[idx]
    seg = xml[s:e]
    assert seg.count(old) == 1, f"para{idx}: {old!r} count={seg.count(old)}"
    xml = xml[:s] + seg.replace(old, new) + xml[e:]

# —— 1) 总结（段162）隐私表述
para_replace(162, "验证了系统在保障数据不出本地的前提下具备",
             "验证了系统在数据默认不出本地、跨设备传输仅限私有局域网的约束下具备")
# —— 2) 引言（段15）隐私表述
para_replace(15, "数据在闭环中始终不离开用户的私有网络",
             "数据交换在闭环中始终限定于用户的私有局域网")
# —— 3) RAG（段47）：[3]→[5]，补 HNSW [8]
para_replace(47, "[3]", "[5]")
para_replace(47, "。主流实现依赖向量数据库，而本系统",
             "。主流实现依赖基于图遍历等近似近邻索引（如 HNSW）的向量数据库[8]，而本系统")
# —— 4) 知识追踪（段27）：[9][10]→[3][4]，并为 [9][10] 补正文引用
para_replace(27, "[9][10]", "[3][4]")
para_replace(27, "。本系统面向单用户本地场景",
             "，相关研究也将知识追踪与精准教学能力纳入智慧教育整体框架下考察[9][10]。本系统面向单用户本地场景")
# —— 5) LLM/ITS（段22）：补 [6][7]，[6] 在前
para_replace(22, "所属的系列模型展示出来的讲解、追问与批改能力，使它们的模型",
             "所属的系列模型展示出来的讲解、追问与批改能力，为大规模个性化辅导带来了全新机遇[6]，也使生成式大模型")
para_replace(22, "智能辅导系统的", "智能辅导系统（ITS）[7]的")

# —— 6) 文末：删除两个模板表格及其间空段，替换为 10 条文献
refs = [
    "[1] CORBETT A T, ANDERSON J R. Knowledge tracing: Modeling the acquisition of procedural knowledge[J]. User Modeling and User-Adapted Interaction, 1994, 4(4): 253-278.",
    "[2] PIECH C, BASSEN J, HUANG J, et al. Deep knowledge tracing[C]//Advances in Neural Information Processing Systems. 2015, 28: 505-513.",
    "[3] 刘淇, 沈双艾, 黄振亚, 等. 智慧教育中认知诊断与知识追踪综述[J]. 计算机学报, 2023, 46(8): 1599-1627.",
    "[4] 杜修平, 杨现民, 李新, 等. 智能教育环境中知识追踪的模型演进与应用框架构建[J]. 电化教育研究, 2021, 42(7): 69-76.",
    "[5] LEWIS P, PEREZ E, PIKTUS A, et al. Retrieval-augmented generation for knowledge-intensive NLP tasks[C]//Advances in Neural Information Processing Systems. 2020, 33: 9459-9474.",
    "[6] KASNECI E, SEßLER K, KÜCHEMANN S, et al. ChatGPT for good? On opportunities and challenges of large language models for education[J]. Learning and Individual Differences, 2023, 103: 102274.",
    "[7] VANLEHN K. The relative effectiveness of human tutoring, intelligent tutoring systems, and other tutoring systems[J]. Educational Psychologist, 2011, 46(4): 197-221.",
    "[8] MALKOV Y A, YASHUNIN D A. Efficient and robust approximate nearest neighbor search using hierarchical navigable small world graphs[J]. IEEE Transactions on Pattern Analysis and Machine Intelligence, 2020, 42(4): 824-836.",
    "[9] 郑勤华, 柴唤友, 魏顺平, 等. 智慧教育视角下的知识追踪模型研究[J]. 现代远程教育研究, 2020, 32(6): 95-103.",
    "[10] 祝智庭, 彭红超. 智慧教育视域下的精准教学模型与实践路径[J]. 中国电化教育, 2020(1): 1-8.",
]
RPR_REF = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
ref_block = ''.join('<w:p><w:pPr><w:jc w:val="left"/>' + RPR_REF + '</w:pPr><w:r>' + RPR_REF +
                    '<w:t xml:space="preserve">' + escape(r) + '</w:t></w:r></w:p>' for r in refs)

segs = segments()
head_i = next(i for i in range(len(segs)) if para_text(i) == "参考文献:")
start = segs[head_i + 1][0]
tbl_count, end = 0, head_i + 1
while end < len(segs):
    s, e = segs[end]
    if xml[s:e].startswith('<w:tbl>'):
        tbl_count += 1
        if tbl_count == 2:
            break
    end += 1
assert tbl_count == 2
xml = xml[:start] + ref_block + xml[segs[end][1]:]

with zipfile.ZipFile(P, "w", zipfile.ZIP_DEFLATED) as out:
    for item, data in members:
        if item.filename == "word/document.xml":
            data = xml.encode("utf-8")
        out.writestr(item, data)
print("OK", os.path.getsize(P))
