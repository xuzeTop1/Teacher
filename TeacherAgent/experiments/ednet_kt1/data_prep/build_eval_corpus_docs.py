#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成混合检索评测用的私有文档语料（DOCX）。

来源：中文维基百科（CC BY-SA 4.0，允许再利用，需署名并以相同方式共享）。
每份文档含：来源与许可声明 + 条目正文（纯文本）+ 完整来源清单（条目名/URL/许可/获取日期）。

处理约定：
  * 逐条抓取（MediaWiki 的 prop=extracts 全文模式每次只返回 1 个条目）；
  * 丢弃 `{\\displaystyle ...}` LaTeX 源码块，只保留其前面的可读文本渲染，避免正文被公式源码噪声淹没；
  * 单条目截断到 MAX_CHARS_PER_ENTRY，避免个别长条目吃掉整份文档的切片预算；
  * 输出按 CHUNK_TARGET_CHARS=1500（App 侧切片粒度）估算切片数，目标每份 ~12-15 片。
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

API = "https://zh.wikipedia.org/w/api.php"
UA = "TeacherAgent-eval-corpus/1.0 (research use; CC BY-SA attribution preserved)"
LICENSE = "CC BY-SA 4.0"
ACCESSED = date.today().isoformat()
CHUNK_TARGET_CHARS = 1500
MAX_CHARS_PER_ENTRY = 2600

DOCS = {
    "高等数学核心概念与公式": [
        "极限 (数学)", "连续函数", "导数", "微分", "泰勒公式", "洛必达法则", "拉格朗日中值定理",
        "罗尔定理", "柯西中值定理", "夹逼定理", "单调有界定理", "定积分", "微积分基本定理",
        "分部积分法", "换元积分法", "无穷级数", "幂级数", "傅里叶级数", "偏导数", "全微分",
        "梯度", "二重积分", "曲线积分", "柯西-施瓦茨不等式", "一致连续",
    ],
    "线性代数与概率统计": [
        "矩阵 (数学)", "行列式", "特征值和特征向量", "特征多项式", "秩 (线性代数)", "线性无关",
        "向量空间", "正交矩阵", "二次型", "奇异值分解", "随机变量", "概率分布", "期望值 (概率论)",
        "方差", "协方差", "贝叶斯定理", "全概率公式", "大数定律", "中心极限定理", "最大似然估计",
        "置信区间", "假设检验", "正态分布", "二项分布", "泊松分布",
    ],
    "大学物理基本定律": [
        "牛顿运动定律", "动量守恒定律", "角动量", "机械能守恒定律", "功", "动能定理", "万有引力",
        "简谐运动", "热力学第一定律", "热力学第二定律", "熵", "理想气体状态方程", "麦克斯韦方程组",
        "库仑定律", "高斯定律", "安培定律", "电磁感应", "洛伦兹力", "折射定律", "全反射",
        "薄膜干涉", "衍射", "多普勒效应", "黑体辐射", "光电效应",
    ],
    "计算机网络与操作系统基础": [
        "传输控制协议", "用户数据报协议", "IP地址", "子网", "域名系统", "超文本传输协议",
        "超文本传输安全协议", "路由", "OSI模型", "以太网", "地址解析协议", "拥塞控制",
        "滑动窗口", "进程", "线程", "死锁", "调度 (计算机)", "虚拟内存", "页面置换算法",
        "信号量", "文件系统", "中断", "CPU缓存", "哈希表", "时间复杂度",
    ],
}

DISPLAY_TITLES = {"IP地址": "IP地址", "调度 (计算机)": "进程调度"}


def fetch_extract(title: str, retries: int = 3) -> tuple[str, str]:
    """返回 (摘要文本, 最终标题)。失败返回空串。"""
    params = {
        "action": "query", "prop": "extracts", "explaintext": "1", "exsectionformat": "plain",
        "format": "json", "formatversion": "2", "redirects": "1", "titles": title, "utf8": "1",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=60) as response:
                data = json.loads(response.read().decode())
            pages = data.get("query", {}).get("pages", [])
            if not pages:
                return "", title
            page = pages[0]
            return (page.get("extract") or ""), (page.get("title") or title)
        except Exception as error:  # noqa: BLE001
            if attempt == retries - 1:
                print(f"    ! 抓取失败 {title}: {type(error).__name__}")
                return "", title
            time.sleep(1.5 * (attempt + 1))
    return "", title


def clean(text: str) -> str:
    # 丢弃 LaTeX 源码块（前面已有可读渲染）
    text = re.sub(r"\{\\displaystyle\s+.*?\}", " ", text, flags=re.S)
    text = re.sub(r"\{\s*\\displaystyle\s+.*?\}", " ", text, flags=re.S)
    # 去掉剩余的 TeX 命令残渣与多余空白
    text = re.sub(r"\\[a-zA-Z]+", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [line.strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "eval_corpus_docs"))
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)

    report = []
    for doc_name, titles in DOCS.items():
        print(f"=== {doc_name} ===", flush=True)
        entries = []
        for index, title in enumerate(titles, start=1):
            text, final_title = fetch_extract(title)
            if not text.strip():
                print(f"  [{index:2d}] 空 → 跳过 {title}", flush=True)
                continue
            text = clean(text)
            truncated = len(text) > MAX_CHARS_PER_ENTRY
            if truncated:
                text = text[:MAX_CHARS_PER_ENTRY].rstrip() + "……"
            display = DISPLAY_TITLES.get(title, title)
            entries.append({"title": display, "source_title": final_title, "text": text})
            print(f"  [{index:2d}] {display}  {len(text)} 字{'（截断）' if truncated else ''}", flush=True)
            time.sleep(0.35)

        document = docx.Document()
        style = document.styles["Normal"]
        style.font.name = "宋体"
        style.font.size = Pt(11)

        document.add_heading(doc_name, level=0)
        document.add_paragraph(
            f"本文档为教学实验语料，内容摘编自中文维基百科（zh.wikipedia.org），"
            f"依据 {LICENSE} 许可使用。原文作者为维基百科贡献者，"
            f"获取日期 {ACCESSED}。完整来源条目与链接见文末“来源与许可”一节。"
        )
        for entry in entries:
            document.add_heading(entry["title"], level=1)
            for paragraph in entry["text"].split("\n"):
                if paragraph.strip():
                    document.add_paragraph(paragraph.strip())
        document.add_heading("来源与许可", level=1)
        document.add_paragraph(
            f"本文件依据知识共享 署名-相同方式共享 4.0 国际许可协议（{LICENSE}）使用以下内容，"
            f"获取日期 {ACCESSED}："
        )
        for entry in entries:
            url = "https://zh.wikipedia.org/wiki/" + urllib.parse.quote(entry["source_title"].replace(" ", "_"))
            document.add_paragraph(f"· {entry['source_title']} — {url}", style="List Bullet")

        path = os.path.join(args.out, f"{doc_name}.docx")
        document.save(path)
        chars = sum(len(e["text"]) for e in entries)
        estimated_chunks = max(1, round(chars / CHUNK_TARGET_CHARS))
        report.append({
            "file": os.path.basename(path), "entries": len(entries), "chars": chars,
            "estimatedChunks": estimated_chunks, "path": path,
        })
        print(f"  → {os.path.basename(path)}  条目 {len(entries)}  正文 {chars} 字  预估切片 ~{estimated_chunks}\n", flush=True)

    total_chunks = sum(r["estimatedChunks"] for r in report)
    print(json.dumps({"documents": report, "totalEstimatedChunks": total_chunks,
                      "license": LICENSE, "accessed": ACCESSED}, ensure_ascii=False, indent=2), flush=True)
    with open(os.path.join(args.out, "corpus_sources.json"), "w", encoding="utf-8") as handle:
        json.dump({"license": LICENSE, "accessed": ACCESSED, "documents": report}, handle,
                  ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
