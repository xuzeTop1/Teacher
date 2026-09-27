#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成混合检索评测用的私有文档语料（DOCX）—— v3：wikitext 源 + 质量闸门。

v1/v2 的失败教训：
  * `prop=extracts&explaintext=1` 对数学页面输出「一符号一行 + LaTeX 碎片」，不可用；
  * REST HTML 端点把公式嵌成内联 SVG，且标签属性里重复 LaTeX，正则剥标签会在属性内的 `>` 上崩。
  → v3 改用 **wikitext**（`action=parse&prop=wikitext`），公式就是干净的 `<math>` 块。

关键实现：**先占位、后剥标签、再回填**。公式转换结果里含 `<`/`>`（如 `|a_n-a| < ε`），
若先回填再剥标签，会被当成 HTML 标签把后续正文吃掉——这是 v2 输出里公式附近正文消失的原因。

质量闸门（任一不过就报错退出，不产出交付物）：
  * 残留垃圾字符率 `\\ { }` 必须 < 0.05%；
  * 单字符行占比 < 5%；
  * 单条目正文 ≥ 400 字；
  * 整体「公式占位符」回填率 100%（不允许丢失）。

来源：中文维基百科（CC BY-SA 4.0）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import date

import docx
from docx.shared import Pt

try:  # 繁简转换：可选依赖，缺失时降级为原样输出（并告警一次，避免静默降级）
    from zhconv import convert as _zh_convert
except Exception:  # noqa: BLE001
    _zh_convert = None
    print("!! 未安装 zhconv：语料将保留繁体字，会损害简体查询的召回；请 pip install zhconv", flush=True)

# 数据源：求闻百科（中文维基百科的合法分支，同为 CC BY-SA 4.0，国内可直连）。
# zh.wikipedia.org 在本机被墙且代理未运行，而求闻百科沿用 MediaWiki 接口、支持同样的
# action=parse&prop=wikitext，抓取协议与解析逻辑可原样复用。
API = "https://www.qiuwenbaike.cn/api.php"
SOURCE_NAME = "求闻百科"
SOURCE_HOST = "www.qiuwenbaike.cn"
SOURCE_PAGE = "https://www.qiuwenbaike.cn/wiki/"
UA = "TeacherAgent-eval-corpus/1.0 (research use; CC BY-SA attribution preserved)"
LICENSE = "CC BY-SA 4.0"
ACCESSED = date.today().isoformat()
CHUNK_TARGET_CHARS = 1500
# 清洗管线版本：只要改动了 clean_wikitext / tex_to_readable 的语义就必须递增。
# 缓存里存的是**清洗后**文本，若不校验版本，改了清洗逻辑却复用旧缓存，
# 会静默产出与修复前一样的坏语料（本项目已踩过一次）。
PIPELINE_VERSION = "v3.3"
# 是否接受上一轮缓存（缺 pipeline 字段者）。默认关闭；离线重建时用 CLI 显式开启。
ACCEPT_LEGACY_CACHE = False
MIN_ENTRY_CHARS = 400
MAX_ENTRY_CHARS = 4000
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "wiki_cache_wikitext")
PH = "\x00MATH%d\x00"

DOCS = {
    "高等数学核心概念与公式": {
        "primary": ["极限 (数学)", "连续函数", "导数", "微分", "泰勒公式", "洛必达法则", "拉格朗日中值定理",
                    "罗尔定理", "柯西中值定理", "夹逼定理", "单调有界定理", "定积分", "微积分基本定理",
                    "分部积分法", "换元积分法", "无穷级数", "幂级数", "傅里叶级数", "偏导数", "全微分",
                    "梯度", "二重积分", "曲线积分", "柯西-施瓦茨不等式", "一致连续"],
        "backup": ["不定积分", "多元函数", "均值定理", "向量分析", "数列", "函数 (数学)"],
    },
    "线性代数与概率统计": {
        "primary": ["矩阵 (数学)", "行列式", "特征值和特征向量", "特征多项式", "秩 (线性代数)", "线性无关",
                    "向量空间", "正交矩阵", "二次型", "奇异值分解", "随机变量", "概率分布", "期望值 (概率论)",
                    "方差", "协方差", "贝叶斯定理", "全概率公式", "大数定律", "中心极限定理", "最大似然估计",
                    "置信区间", "假设检验", "正态分布", "二项分布", "泊松分布"],
        "backup": ["线性变换", "矩阵乘法", "逆矩阵", "概率论", "统计推断", "相关系数"],
    },
    "大学物理基本定律": {
        "primary": ["牛顿运动定律", "动量守恒定律", "角动量", "机械能守恒定律", "功", "动能定理", "万有引力",
                    "简谐运动", "热力学第一定律", "热力学第二定律", "熵", "理想气体状态方程", "麦克斯韦方程组",
                    "库仑定律", "高斯定律", "安培定律", "电磁感应", "洛伦兹力", "折射定律", "全反射",
                    "薄膜干涉", "衍射", "多普勒效应", "黑体辐射", "光电效应"],
        "backup": ["能量守恒定律", "电场", "磁场", "波动", "干涉 (物理学)", "热力学"],
    },
    "计算机网络与操作系统基础": {
        "primary": ["传输控制协议", "用户数据报协议", "IP地址", "子网", "域名系统", "超文本传输协议",
                    "超文本传输安全协议", "路由", "OSI模型", "以太网", "地址解析协议", "拥塞控制",
                    "滑动窗口", "进程", "线程", "死锁", "调度 (计算机)", "虚拟内存", "页面置换算法",
                    "信号量", "文件系统", "中断", "CPU缓存", "哈希表", "时间复杂度"],
        "backup": ["计算机网络", "互联网协议套件", "操作系统", "并发控制", "内存管理", "排序算法"],
    },
}
DISPLAY = {"极限 (数学)": "极限", "矩阵 (数学)": "矩阵", "秩 (线性代数)": "矩阵的秩",
           "期望值 (概率论)": "数学期望", "调度 (计算机)": "进程调度", "函数 (数学)": "函数"}
# 求闻百科对部分消歧义标题使用了不同命名（或不设消歧义页），逐个候选重试；
# 缓存键仍用原始标题，保证 --rebuild-only 的稳定性。
TITLE_ALIASES = {
    "极限 (数学)": ["极限"],
    "矩阵 (数学)": ["矩阵"],
    "秩 (线性代数)": ["秩"],
    "期望值 (概率论)": ["期望值", "数学期望"],
    "调度 (计算机)": ["调度"],
    "函数 (数学)": ["函数"],
    "干涉 (物理学)": ["干涉", "干涉 (物理)"],
    "简谐运动": ["简谐振动"],
    "折射定律": ["斯涅尔定律", "折射"],
    "单调有界定理": ["单调收敛定理"],
}
# 注：「页面置换算法」在求闻百科不存在，别名到「缺页中断」会被重定向到「页缺失」，
# 主题与题面不符（页缺失是缺页中断，不是 FIFO/LRU 置换算法）→ 不设别名，
# 由 backup 列表的「内存管理」补位，避免产出名不副实的条目。
TARGET_ENTRIES = 20
TEX_REPLACEMENTS = [
    (r"\\displaystyle\s*", ""), (r"\\!", ""), (r"\\;", " "), (r"\\,", " "),
    (r"\\quad|\\qquad", " "), (r"\\left|\\right", ""), (r"\\big|\\Big|\\bigg|\\Bigg", ""),
    (r"\\infty", "∞"), (r"\\varepsilon|\\epsilon", "ε"), (r"\\varphi|\\phi", "φ"), (r"\\delta", "δ"),
    (r"\\alpha", "α"), (r"\\beta", "β"), (r"\\gamma", "γ"), (r"\\theta", "θ"), (r"\\lambda", "λ"),
    (r"\\mu", "μ"), (r"\\nu", "ν"), (r"\\rho", "ρ"), (r"\\sigma", "σ"), (r"\\tau", "τ"),
    (r"\\omega", "ω"), (r"\\Delta", "Δ"), (r"\\Sigma", "Σ"), (r"\\Omega", "Ω"), (r"\\pi", "π"),
    (r"\\in\b", "∈"), (r"\\notin", "∉"), (r"\\subset", "⊂"), (r"\\cup", "∪"), (r"\\cap", "∩"),
    (r"\\leq|\\le\b", "≤"), (r"\\geq|\\ge\b", "≥"), (r"\\neq|\\ne\b", "≠"), (r"\\approx", "≈"),
    (r"\\equiv", "≡"), (r"\\times", "×"), (r"\\cdot", "·"), (r"\\div", "÷"), (r"\\pm", "±"),
    (r"\\to\b|\\rightarrow", "→"), (r"\\Rightarrow|\\implies", "⇒"), (r"\\Leftrightarrow", "⇔"),
    (r"\\forall", "∀"), (r"\\exists", "∃"), (r"\\partial", "∂"), (r"\\nabla", "∇"),
    (r"\\int", "∫"), (r"\\oint", "∮"), (r"\\sum", "Σ"), (r"\\prod", "∏"), (r"\\lim", "lim"),
    (r"\\infty", "∞"), (r"\\sqrt", "√"), (r"\\overline\{([^{}]*)\}", r"\1̄"),
    (r"\\mathbb\{R\}", "ℝ"), (r"\\mathbb\{N\}", "ℕ"), (r"\\mathbb\{Z\}", "ℤ"), (r"\\mathbb\{Q\}", "ℚ"),
    (r"\\mathbb\{C\}", "ℂ"), (r"\\(?:mathrm|text|mbox|operatorname)\{([^{}]*)\}", r"\1"),
    (r"\\mathbf\{([^{}]*)\}", r"\1"), (r"\\vec\{([^{}]*)\}", r"\1→"),
]


def http_get(url: str, retries: int = 4) -> str:
    delay = 1.0
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read().decode()
        except Exception as error:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            time.sleep(delay)
            delay *= 1.8
    return ""


def tex_to_readable(tex: str) -> str:
    s = tex
    # LaTeX 环境（矩阵/方程组/分段函数）：朴素的“删命令”只会留下
    # `a & b \\ c & d`，垃圾率直接超标 → 整体改写为可读形式。
    def _environment(match: re.Match) -> str:
        name = match.group(1)
        body = re.sub(r"\\\\(?:\[[^\]]*\])?", " ; ", match.group(2))
        body = body.replace("&", " , ")
        body = re.sub(r"\s+", " ", body).strip()
        left, right = {
            "pmatrix": ("(", ")"), "bmatrix": ("[", "]"), "vmatrix": ("|", "|"),
            "Bmatrix": ("{", "}"), "matrix": ("[", "]"), "smallmatrix": ("[", "]"),
            "cases": ("{", "}"), "dcases": ("{", "}"), "array": ("[", "]"),
        }.get(name, ("", ""))
        return f" {left}{body}{right} " if body else " "

    for _ in range(3):
        s = re.sub(r"\\begin\{([a-zA-Z*]+)\}(.*?)\\end\{\1\}", _environment, s, flags=re.S)
    # 未闭合的环境（源文被截断时常见）整体丢弃，避免残留 \begin{...}
    s = re.sub(r"\\begin\{[a-zA-Z*]+\}.*$", " ", s, flags=re.S)
    s = re.sub(r"\\(?:end|begin)\{[a-zA-Z*]+\}", " ", s)
    for _ in range(4):
        s = re.sub(r"\\[tdc]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r"(\1)/(\2)", s)
    for _ in range(3):
        s = re.sub(r"\\sqrt\s*\{([^{}]*)\}", r"√(\1)", s)
    for _ in range(3):
        s = re.sub(r"\\sum_\{([^{}]*)\}\^\{([^{}]*)\}", r"Σ(\1→\2)", s)
        s = re.sub(r"\\int_\{([^{}]*)\}\^\{([^{}]*)\}", r"∫(\1→\2)", s)
    s = re.sub(r"_\{([^{}]*)\}", r"_\1", s)
    s = re.sub(r"\^\{([^{}]*)\}", r"^\1", s)
    for pattern, replacement in TEX_REPLACEMENTS:
        s = re.sub(pattern, replacement, s)
    s = re.sub(r"\\[a-zA-Z]+", "", s)
    s = s.replace("{", "").replace("}", "").replace("\\", "")
    s = re.sub(r"\s*([=<>≤≥≠≈+\-×·/])\s*", r" \1 ", s)
    return re.sub(r"[ \t]{2,}", " ", s).strip()


def to_simplified(text: str) -> str:
    """统一转为简体中文。

    求闻百科与中文维基同源，不少条目（尤其物理/工程类）本身以繁体撰写：
    实测全文繁体字占比 9.8%，物理文档 14.9%，单条最高 27.7%（麦克斯韦方程组）。
    检索侧查询是简体，而 FTS5 用的是字符级 trigram 匹配，繁简不通用会直接漏召回，
    因此语料必须统一为简体——这属于影响评测有效性的问题，不是排版洁癖。
    """
    if _zh_convert is None:
        return text
    return _zh_convert(text, "zh-cn")


def strip_templates(text: str) -> str:
    """按花括号配对整体删除 {{...}}（支持嵌套、跨行）。

    正则 `\\{\\{[^{}]*\\}\\}` 处理不了嵌套/跨行模板，会留下 `}}` 或
    `quote|width=70%` 这类碎片（结构残留检查会直接判不合格）。
    若全文括号不配对（源文被截断），退化为只删除成对出现的字面标记，
    避免把后面的正常正文整段吃掉。
    """
    if text.count("{{") != text.count("}}"):
        return re.sub(r"\{\{|\}\}", "", text)
    out: list[str] = []
    depth = 0
    index = 0
    while index < len(text):
        pair = text[index:index + 2]
        if pair == "{{":
            depth += 1
            index += 2
            continue
        if pair == "}}":
            depth = max(0, depth - 1)
            index += 2
            continue
        if not depth:
            out.append(text[index])
        index += 1
    return "".join(out)


def clean_wikitext(raw: str) -> tuple[str, int, int]:
    """返回 (清洗文本, 公式个数, 回填成功数)。"""
    formulas: list[str] = []

    def stash(match: re.Match) -> str:
        formulas.append(tex_to_readable(match.group(1)))
        return PH % (len(formulas) - 1)

    s = re.sub(r"<math[^>]*>(.*?)</math>", stash, raw, flags=re.S)
    s = re.sub(r"<ref[^>/]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", "", s)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = strip_templates(s)
    # 文件/分类链接常带嵌套链接（如参数里再写 [[条目]]），逐字符类匹配会失配 → 删到行尾
    s = re.sub(r"\[\[(?:File|Image|文件|图像|Category|分类):[^\n]*", "", s, flags=re.I)
    s = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", s)
    s = re.sub(r"\[https?://\S+\]", "", s)
    s = re.sub(r"'{2,5}", "", s)
    for _ in range(3):
        # -{zh-hans:简体;zh-hant:繁體}- 取简体；-{zh-hans:行}- 这种**无分隔符**形式也必须取词，
        # 否则会被下一条整段删除（曾导致“横向的元素组称为“”，”这种空引号丢字）。
        s = re.sub(r"-\{\s*(?:zh-hans|zh-cn|zh-sg|zh-my|zh)\s*:\s*([^;|}]*)[;|][^}]*\}-", r"\1", s)
        s = re.sub(r"-\{\s*(?:zh-hans|zh-cn|zh-sg|zh-my|zh)\s*:\s*([^;|}]*)\}-", r"\1", s)
        # 裸形式 -{行}- ：只表示“该词不参与繁简转换”，必须保留词本身（曾经被下面一条整段删掉）
        s = re.sub(r"-\{\s*([^{}|:;]+?)\s*\}-", r"\1", s)
    s = re.sub(r"-\{[^}]*\}-", "", s)
    s = s.replace("[[", "").replace("]]", "")
    s = re.sub(r"<[^>]*>", "", s)
    # 表格：{|\n ... \n|} 常带前导冒号（:{|），单元格以 | / |- / ! 开头
    s = re.sub(r"^:?\{\|.*?^\|\}", "", s, flags=re.S | re.M)
    s = re.sub(r"^\s*\|[-+]{1,}\s*.*$", "", s, flags=re.M)
    s = re.sub(r"^\s*[|!]\s*", "", s, flags=re.M)
    s = re.sub(r"\n\s*\|", "\n", s)
    s = s.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&nbsp;", " ")
    # 繁简统一（放在公式回填之前，避免转换器触碰公式文本）
    s = to_simplified(s)
    restored = 0
    for index, value in enumerate(formulas):
        token = PH % index
        if token in s:
            s = s.replace(token, value)
            restored += 1
    s = re.sub(r"^[=]{2,}\s*(.*?)\s*[=]{2,}\s*$", r"\n## \1\n", s, flags=re.M)
    s = re.sub(r"^\*+\s*", "· ", s, flags=re.M)
    s = re.sub(r"^#+\s*", "· ", s, flags=re.M)
    s = re.sub(r"\n{3,}", "\n\n", s)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in s.split("\n")]
    lines = [line for line in lines if line]
    text = "\n".join(lines)
    # 尾部纯清单段落（参见/参考/外部链接）截断
    text = re.split(r"\n## (?:参见|參考|参考|外部链接|注釋|注释|参考文献)", text)[0]
    return text.strip(), len(formulas), restored


def fetch_entry(title: str, rebuild_only: bool) -> dict | None:
    safe = re.sub(r"[^\w\u4e00-\u9fff-]", "_", title)
    path = os.path.join(CACHE, safe + ".json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            cached = json.load(handle)
        if cached.get("pipeline") == PIPELINE_VERSION:
            return cached
        # 兼容上一轮缓存：清洗逻辑与本版相同、仅缺最后的繁简统一步骤。
        # 必须用 --accept-legacy-cache 显式开启（离线重建时用），不静默接受来源不明的缓存。
        if ACCEPT_LEGACY_CACHE and "pipeline" not in cached:
            cached["text"] = to_simplified(cached["text"])
            cached["pipeline"] = PIPELINE_VERSION + "+legacy-cache"
            return cached
        # 版本不匹配 → 旧缓存无效，重新抓取并在原路径覆盖（不删文件，避免批量删除风控）
    if rebuild_only:
        return None
    parse = None
    for candidate in [title] + TITLE_ALIASES.get(title, []):
        params = {"action": "parse", "page": candidate, "prop": "wikitext", "format": "json",
                  "formatversion": "2", "redirects": "1"}
        data = json.loads(http_get(API + "?" + urllib.parse.urlencode(params)))
        parse = data.get("parse")
        if parse and parse.get("wikitext"):
            if candidate != title:
                print(f"      ~ {title}: 命中别名「{candidate}」", flush=True)
            break
        parse = None
    if not parse:
        return None
    text, formulas, restored = clean_wikitext(parse["wikitext"])
    if len(text) > MAX_ENTRY_CHARS:
        text = text[:MAX_ENTRY_CHARS].rstrip() + "……"
    if len(text) < MIN_ENTRY_CHARS:
        print(f"      · {title}: 正文仅 {len(text)} 字（< {MIN_ENTRY_CHARS}），丢弃", flush=True)
        return None
    if formulas and restored != formulas:
        print(f"      ! {title}: 公式回填 {restored}/{formulas}，疑似丢失", flush=True)
    payload = {"pipeline": PIPELINE_VERSION, "title": title, "sourceTitle": parse.get("title", title),
               "text": text, "formulas": formulas, "chars": len(text)}
    os.makedirs(CACHE, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
    return payload


STRUCTURAL_MARKERS = ["\\", "{{", "}}", "{|", "|}", "|-", "[[", "]]", "&nbsp;", "displaystyle",
                      "<math", "zh-hans", "\\frac", "\\displaystyle"]


def quality(text: str) -> dict:
    """垃圾判定按**结构标记**计，而不是数字符。

    集合写法（如 `S = { 正，反正 }`）里的花括号是合法正文，不能算垃圾；
    真正的残留是模板/表格/链接/LaTeX 标记。
    """
    hits = {token: text.count(token) for token in STRUCTURAL_MARKERS}
    marker = sum(hits.values())
    lines = [line for line in text.split("\n") if line.strip()]
    short = sum(1 for line in lines if len(line.strip()) <= 2)
    return {"chars": len(text), "junkRatio": marker / max(1, len(text)), "markers": hits,
            "shortLineRatio": short / max(1, len(lines)), "lines": len(lines)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(HERE, "eval_corpus_docs"))
    parser.add_argument("--rebuild-only", action="store_true")
    parser.add_argument("--accept-legacy-cache", action="store_true",
                        help="接受上一轮缓存（缺 pipeline 字段）：清洗逻辑相同、仅补做繁简统一。"
                             "数据源被 WAF 拦截时用于离线重建，会打印使用条数。")
    parser.add_argument("--sample", nargs="*", help="只抽样查看指定条目正文，不产出 DOCX")
    args = parser.parse_args()

    global ACCEPT_LEGACY_CACHE
    ACCEPT_LEGACY_CACHE = args.accept_legacy_cache
    if ACCEPT_LEGACY_CACHE:
        print("注意：已开启 --accept-legacy-cache，将复用上一轮缓存并补做繁简统一。", flush=True)

    if args.sample:
        for title in args.sample:
            payload = fetch_entry(title, args.rebuild_only)
            if not payload:
                print(f"!! {title} 抓取失败/过短"); continue
            stats = quality(payload["text"])
            print("=" * 78)
            print(f"{payload['sourceTitle']}  正文 {stats['chars']} 字  公式 {payload['formulas']} 个  "
                  f"垃圾率 {stats['junkRatio']*100:.4f}%  单字行 {stats['shortLineRatio']*100:.2f}%")
            for line in payload["text"].split("\n"):
                if len(line) > 40:
                    print("   •", line[:300])
        return

    os.makedirs(args.out, exist_ok=True)
    report, failures = [], []
    for doc_name, spec in DOCS.items():
        print(f"=== {doc_name} ===", flush=True)
        entries = []
        for title in spec["primary"] + spec["backup"]:
            if len(entries) >= TARGET_ENTRIES:
                break
            try:
                payload = fetch_entry(title, args.rebuild_only)
            except Exception as error:  # noqa: BLE001
                print(f"      ! {title}: {type(error).__name__}", flush=True)
                failures.append(title)
                continue
            if not payload:
                failures.append(title)
                continue
            entries.append(payload)
            print(f"  + {DISPLAY.get(title, title)}  {payload['chars']} 字 / 公式 {payload['formulas']}", flush=True)

        blob = "\n".join(e["text"] for e in entries)
        stats = quality(blob)
        top = {k: v for k, v in sorted(stats["markers"].items(), key=lambda kv: -kv[1]) if v}
        if stats["junkRatio"] >= 0.0002:
            raise SystemExit(f"❌ {doc_name} 结构残留率 {stats['junkRatio']*100:.4f}% 超阈值（0.02%）；"
                             f"残留标记明细：{top}")
        if stats["shortLineRatio"] >= 0.05:
            raise SystemExit(f"❌ {doc_name} 单字行占比 {stats['shortLineRatio']*100:.2f}% 超阈值（5%）")

        document = docx.Document()
        document.styles["Normal"].font.name = "宋体"
        document.styles["Normal"].font.size = Pt(11)
        document.add_heading(doc_name, level=0)
        document.add_paragraph(
            f"本文档为教学实验语料（非知识库内容），摘编自{SOURCE_NAME}（{SOURCE_HOST}），"
            f"依据 {LICENSE} 许可使用；原文作者为{SOURCE_NAME}贡献者，获取日期 {ACCESSED}。"
            f"数学公式已转换为可读文本表示。完整来源条目与链接见文末“来源与许可”。"
        )
        for entry in entries:
            document.add_heading(DISPLAY.get(entry["title"], entry["title"]), level=1)
            for line in entry["text"].split("\n"):
                line = line.strip()
                if not line:
                    continue
                # wikitext 行首的 ":" / ";" 是缩进与定义列表标记，不是正文
                if line[0] in ":;":
                    line = line.lstrip(":; ").strip()
                    if not line:
                        continue
                if line.startswith("## "):
                    document.add_heading(line[3:].strip(), level=2)
                else:
                    document.add_paragraph(line)
        document.add_heading("来源与许可", level=1)
        document.add_paragraph(
            f"本文件依据知识共享 署名-相同方式共享 4.0 国际许可协议（{LICENSE}）使用以下内容，获取日期 {ACCESSED}：")
        for entry in entries:
            url = SOURCE_PAGE + urllib.parse.quote(entry["sourceTitle"].replace(" ", "_"))
            document.add_paragraph(f"· {entry['sourceTitle']} — {url}", style="List Bullet")
        path = os.path.join(args.out, f"{doc_name}.docx")
        document.save(path)

        chars = sum(e["chars"] for e in entries)
        report.append({"file": os.path.basename(path), "entries": len(entries), "chars": chars,
                       "formulas": sum(e["formulas"] for e in entries),
                       "estimatedChunks": max(1, round(chars / CHUNK_TARGET_CHARS)),
                       "junkRatio": round(stats["junkRatio"], 6), "path": path})
        print(f"  → {os.path.basename(path)}  {len(entries)} 条  {chars} 字  ~{report[-1]['estimatedChunks']} 片  "
              f"垃圾率 {stats['junkRatio']*100:.4f}%\n", flush=True)

    summary = {"documents": report,
               "totalEntries": sum(r["entries"] for r in report),
               "totalChars": sum(r["chars"] for r in report),
               "totalFormulas": sum(r["formulas"] for r in report),
               "totalEstimatedChunks": sum(r["estimatedChunks"] for r in report),
               "license": LICENSE, "accessed": ACCESSED,
               "source": f"{SOURCE_NAME}（{SOURCE_HOST}，CC BY-SA 4.0）",
               "failedTitles": failures}
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    with open(os.path.join(args.out, "corpus_sources.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
