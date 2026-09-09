# -*- coding: utf-8 -*-
"""把用户审定的「测试与验证」整章与「总结与展望」正文替换进论文附件（v2 输出，不动原件）。

锚点为 2026-09-09 01:52 版附件的 document.xml 偏移（脚本内按文本重新定位，不硬编码偏移）。
实测数字修正：Rust 281→297、Android 38+14 个用例→37+14 个测试文件（grep 实测）。
"""
import zipfile, re, html, os
from xml.sax.saxutils import escape

SRC = r"D:/新建文件夹/隐私优先的多端协同智能辅导系统设计与实现-含实验数据.docx"
DST = r"D:/新建文件夹/隐私优先的多端协同智能辅导系统设计与实现-含实验数据v2.docx"

zin = zipfile.ZipFile(SRC)
xml = zin.read("word/document.xml").decode("utf-8")
members = [(item, zin.read(item.filename)) for item in zin.infolist()]
zin.close()

RPR = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:szCs w:val="21"/></w:rPr>'
RPR_SMALL = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
RPR_H = ('<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:hint="eastAsia"/>'
         '<w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>')

def heading(text):
    return ('<w:p><w:pPr><w:pStyle w:val="a9"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>'
            '<w:outlineLvl w:val="2"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>'
            '<w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:pPr>'
            '<w:r>' + RPR_H + '<w:t>' + escape(text) + '</w:t></w:r></w:p>')

def body(text):
    return ('<w:p><w:pPr><w:ind w:firstLine="420"/>' + RPR + '</w:pPr><w:r>' + RPR +
            '<w:t>' + escape(text) + '</w:t></w:r></w:p>')

def caption(text):
    return ('<w:p><w:pPr><w:keepNext/><w:ind w:firstLine="420"/><w:jc w:val="center"/>' + RPR +
            '</w:pPr><w:r>' + RPR + '<w:t>' + escape(text) + '</w:t></w:r></w:p>')

def note(text):
    return ('<w:p><w:pPr><w:keepLines/><w:ind w:firstLine="420"/>' + RPR_SMALL +
            '</w:pPr><w:r>' + RPR_SMALL + '<w:t>' + escape(text) + '</w:t></w:r></w:p>')

def cell(text, width, borders):
    b = ''.join(f'<w:{s} w:val="{v}"' + (' w:sz="4" w:space="0" w:color="000000"' if v == "single" else '') + '/>'
                for s, v in borders.items())
    return ('<w:tc><w:tcPr><w:tcW w:w="' + str(width) + '" w:type="dxa"/><w:tcBorders>' + b +
            '</w:tcBorders><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:widowControl/><w:jc w:val="center"/>' +
            RPR + '</w:pPr><w:r>' + RPR + '<w:t>' + escape(text) + '</w:t></w:r></w:p></w:tc>')

def three_line_table(headers, rows, widths):
    total = sum(widths)
    widths = [int(w * 9334 / total) for w in widths]
    NIL = {s: "nil" for s in ("top", "left", "bottom", "right")}
    out = ['<w:tbl><w:tblPr><w:tblW w:w="9334" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>'
           '<w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/>'
           '<w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>'
           '<w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" '
           'w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/></w:tblPr>']
    out.append('<w:tr><w:trPr><w:tblHeader/><w:jc w:val="center"/></w:trPr>' +
               ''.join(cell(h, widths[i], {"top": "single", "bottom": "single", "left": "nil", "right": "nil"})
                       for i, h in enumerate(headers)) + '</w:tr>')
    last = len(rows) - 1
    for r, row in enumerate(rows):
        borders = dict(NIL)
        if r == last:
            borders["bottom"] = "single"
        out.append('<w:tr><w:trPr><w:jc w:val="center"/></w:trPr>' +
                   ''.join(cell(v, widths[i], borders) for i, v in enumerate(row)) + '</w:tr>')
    out.append('</w:tbl>')
    return ''.join(out)

t1 = three_line_table(
    ["层次", "测试载体", "用例/文件数量", "代表性覆盖内容"],
    [["前端展现层", "Vitest 单元/组件测试", "70 个测试文件", "知识包解析校验、状态缓存、看板指标计算"],
     ["桌面核心层", "Cargo Rust 单元测试", "297 个用例", "协议信封反序列化（40）、知识种子完整性（39）、命令路由（35）"],
     ["移动客户端", "JVM 单元测试 + 仪器测试", "37 + 14 个测试文件", "Room 事务隔离、快照白名单过滤、数据备份导入导出"]],
    [1.1, 1.5, 1.3, 2.6])
t2 = three_line_table(
    ["向量数量（N）", "平均检索耗时（ms）", "P95 耗时（ms）", "最大耗时（ms）"],
    [["1,000", "5.00", "6.09", "6.14"], ["2,000", "9.89", "10.60", "11.68"],
     ["3,000", "14.98", "16.91", "16.94"], ["10,000", "50.55", "55.10", "62.25"]],
    [1.2, 1.4, 1.1, 1.1])
t3 = three_line_table(
    ["向量数量（N）", "暴力余弦平均耗时（ms）", "HNSW 平均耗时（ms）", "HNSW Recall@5"],
    [["1,000", "0.27", "0.48", "100.0%"], ["2,000", "0.32", "0.88", "98.5%"],
     ["3,000", "0.46", "1.29", "98.5%"], ["10,000", "1.35", "2.21", "65.2%"]],
    [1.2, 1.5, 1.4, 1.2])
t4 = three_line_table(
    ["数据规模（实体条数）", "快照体积（KB）", "平均上报耗时（ms）", "最大耗时（ms）", "同步成功率"],
    [["1,002", "505", "70.4", "94.0", "10/10（100%）"], ["1,992", "1,007", "95.3", "125.0", "10/10（100%）"],
     ["3,006", "1,521", "139.0", "171.0", "10/10（100%）"], ["10,008", "5,069", "442.3", "578.0", "10/10（100%）"]],
    [1.4, 1.1, 1.3, 1.1, 1.3])
t5 = three_line_table(
    ["测试类别", "用例数", "正确拒绝", "正确接受", "漏放数", "误拒数"],
    [["信封合法性与配对校验", "5", "5", "—", "0", "0"],
     ["鉴权状态与设备归属", "4", "4", "—", "0", "0"],
     ["载荷模式与体积配额", "4", "4", "—", "0", "0"],
     ["正常基线（健康检查、幂等重发）", "2", "—", "2", "0", "0"],
     ["合计", "15", "13", "2", "0", "0"]],
    [2.4, 0.8, 0.9, 0.9, 0.8, 0.8])

block_7 = (
    heading("测试套件与覆盖规模")
    + body("测试用例随系统特性开发同步编写，覆盖前端界面逻辑、Rust 核心网络与协议层，以及 Android 端持久化与数据转换模块。各层次的测试载体与用例分布如表 1 所示（统计截至 2026 年 9 月 9 日）。")
    + caption("表1 系统自动化测试套件统计表") + t1
    + heading("本地知识库检索性能验证")
    + body("为验证第 4 章「在千级文档片段规模下采用无索引暴力余弦检索」的架构合理性，本文开展了两组对比基准测试。表 2 评估了系统原生 Rust 实现（release 构建、1536 维单位化向量、执行 30 次取统计特征）在不同规模下的性能表现；表 3 在同一 Python 进程内对照了向量化暴力余弦与典型近邻图索引 FAISS HNSW（M=32、efSearch=128），以消除跨运行时调用的性能偏差。")
    + caption("表2 暴力余弦检索性能评测（系统 Rust 原生实现）") + t2
    + note("注：耗时随向量数量呈近似线性增长（约 5 ms/千向量）；debug 构建因未开启编译器向量化与内联优化，耗时约为 release 构建的 12 倍，生产环境按 release 构建发布。原始记录见 benchmark-results/rag-brute-cosine-release.csv。")
    + caption("表3 向量化暴力余弦与 FAISS HNSW 同进程基准对照") + t3
    + note("注：经独立复跑测试验证，两轮数据在噪声范围内完全一致（rag-index-comparison.csv 与 -run2.csv）。")
    + body("实验表明：在 1,000～10,000 向量区间内，暴力扫描耗时完全满足即时交互要求（万级数据下约 50 ms），且恒定保持 100% 精确 Top-K 召回；而在中小数据规模下，HNSW 图遍历的指针跳转和堆维护开销导致其检索延迟反超连续内存扫描，且 Recall@5 在万级规模退化至 65.2%。因此，本地千级知识片段场景下放弃引入复杂的外部向量索引，在精简系统依赖与部署包体积的同时保障了辅导问答的检索精度。")
    + heading("协议一致性验证")
    + body("协议层采用对偶测试保证双端对称性：桌面端以 40 个单元测试覆盖所有信封类型的合规与畸变边界，移动端复用同一测试夹具集验证反序列化一致性。所有畸变报文（字段缺失、类型错配、超长溢出、证书指纹不一致）均触发两端等价的拒绝判定。两端仓库的 JSON Schema、消息文档与测试夹具由自动化脚本执行 SHA-256 清单一致性校验，任何单侧修改均被持续集成管线阻断。")
    + heading("端到端性能与异常鲁棒性评测")
    + body("为量化局域网同步链路的真实系统开销，本文构建了合成客户端基准脚本：以真实客户端等价报文直接执行协议 v1 的配对、快照上报、建议稿拉取与决策回传流程。评测测得纯协议与系统落库耗时（含 TLS 1.3 握手），排除了界面渲染与人工点击的随机延迟；测量在与服务端同一主机经局域网接口回环完成。表 4 展示了系统在不同实体负载下的 10 轮重复上报表现。测试数据模拟了学生从单月日常（1,002 实体，约 505 KB）至多年累积（10,008 实体，约 5.07 MB）的真实行为结构。")
    + caption("表4 局域网快照同步性能实测表（各 10 轮）") + t4
    + note("注：上报耗时包含网络传输、信封完整性解构以及服务端的「全量快照原子替换事务」（单事务内完成历史归档与批量实体插入）。当前基线传输使用原始 JSON，若启用 gzip 压缩传输，网络载荷可缩减至原体积的约 10%。原始数据见 benchmark-results/20260909-005639/scale.csv。")
    + body("测试表明，快照上报落库耗时随实体增长保持平稳的线性关系（约 45 ms/千实体）；在面对超过万条记录的高压快照时，包含完整磁盘事务的耗时仍控制在 450 ms 以内，40 轮实测成功率达 100%。此外，在闭环交互中，建议稿增量拉取耗时 15.0 ms，决策写回耗时 32.0 ms，服务端状态更新检测时延仅 1.0 ms，实现了百毫秒级的近实时同步。")
    + caption("表5 同步协议异常输入鲁棒性与安全防护测试") + t5
    + note("注：15 项用例对应的 HTTP 状态码与判定日志归档于 benchmark-results/20260909-005747/robustness.csv。")
    + body("测试表明，服务端针对协议名篡改、非法版本、未认证访问、越权设备及超限大报文均能准确阻断（返回 400/401/403/404/413），漏放率与误拒率均为 0。针对因网络抖动导致的重复上报，服务端利用 snapshotId 执行幂等识别，返回实体计数与原快照完全一致，验证了信封纪律与幂等设计的有效性。"))

block_limit = body("本系统当前聚焦于单用户双设备的私有协同，辅导效果的验证仍基于个案长期跟踪，尚未开展大样本群体实证研究。在网络拓扑方面，系统依赖二层广播与单播互通环境；在开启客户端隔离（Client Isolation）的园区网络（如高校校园网、公共热点）或跨 NAT 的移动蜂窝网络中，需借助热点直连或物理共享链路完成同步，系统在协议层面不对此类受限拓扑提供穿透承诺。")

block_concl = (
    body("本文设计并实现了一个隐私优先的多端协同智能学习辅导系统：桌面端利用本地知识管线、私有文档 RAG 与 BKT 模型提供透明的认知状态评估；移动端负责专注行为采集与端侧轻量分析；两端基于证书指纹绑定的安全局域网协议构建闭环。自动化测试套件（前端 70 个测试文件、桌面端 297 个单元测试、移动端 37 + 14 个测试文件）与基准实验（万级实体落库小于 450 ms、检索耗时约 5 ms/千向量）验证了系统在保障数据不出本地的前提下具备优秀的工程可用性与交互流畅度。")
    + body("未来工作将围绕以下四个方向展开：一是利用端侧积累的学生真实作答序列拟合 BKT 转移与先验参数，替代当前的预设常数；二是在保持全量快照容灾能力的同时引入增量同步机制（Delta Sync），进一步压缩万级实体的网络带宽开销；三是在真实学龄群体中实施对照实验，量化多端闭环建议对学生专注时长与错题纠正率的干预成效；四是探索将端侧轻量小语言模型（SLM）与量化技术融入移动端，增强完全断网环境下的即时离线辅导能力。"))

paras = list(re.finditer(r'<w:p(?: [^>]*)?>.*?</w:p>|<w:tbl>.*?</w:tbl>', xml, re.S))

def para_text(seg):
    return html.unescape(re.sub(r'<[^>]+>', '', seg)).strip()

start7 = end7 = startLimit = endLimit = startConcl = endConcl = None
for i, m in enumerate(paras):
    seg = m.group(0)
    if seg.startswith('<w:tbl>'):
        continue
    t = para_text(seg)
    if t == "测试规模":
        start7 = m.start()
    if start7 is not None and end7 is None and "为量化同步链路的实际开销" in t:
        pass  # 旧测量段在范围内，无需单独定位
    if t == "已知局限":
        startLimit = paras[i + 1].start()
        endLimit = paras[i + 2].start()
    if t == "总结与展望":
        startConcl = paras[i + 1].start()
        endConcl = paras[i + 3].start()  # 162,163 两段正文 + 之后空段前

# 7 章范围：从「测试规模」标题到「已知局限」标题段起点
for i, m in enumerate(paras):
    if not m.group(0).startswith('<w:tbl>') and para_text(m.group(0)) == "已知局限":
        end7 = m.start()
        break
assert None not in (start7, end7, startLimit, endLimit, startConcl, endConcl), (start7, end7, startLimit, endLimit, startConcl, endConcl)
assert start7 < end7 < startLimit < endLimit < startConcl < endConcl

xml = xml[:startConcl] + block_concl + xml[endConcl:]
xml = xml[:startLimit] + block_limit + xml[endLimit:]
xml = xml[:start7] + block_7 + xml[end7:]

with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as out:
    for item, data in members:
        if item.filename == "word/document.xml":
            data = xml.encode("utf-8")
        out.writestr(item, data)
print("WROTE", DST, os.path.getsize(DST))
