#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成混合检索评测用的私有文档语料（DOCX）—— 带磁盘缓存版。

相比 v1 的改进：
  * **每条目单独缓存**（`wiki_cache/<title>.txt` + `.json`）：重跑只抓缺失项，
    不再因为限流失败就全部重来（v1 无缓存，重试代价 = 100 次请求）；
  * 限流后自动退避重试（1.2s 起步、指数退避、最多 4 次）；
  * 每份文档配**备用条目池**：主清单抓不到的用备用池补齐，保证覆盖面；
  * 从缓存离线重建 DOCX（`--rebuild-only`），改格式/排版不再依赖网络。

来源：中文维基百科（CC BY-SA 4.0）。每份文档含来源与许可声明 + 条目正文 + 来源清单。
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
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "wiki_cache")

DOCS = {
    "高等数学核心概念与公式": {
        "primary": [
            "极限 (数学)", "连续函数", "导数", "微分", "泰勒公式", "洛必达法则", "拉格朗日中值定理",
            "罗尔定理", "柯西中值定理", "夹逼定理", "单调有界定理", "定积分", "微积分基本定理",
            "分部积分法", "换元积分法", "无穷级数", "幂级数", "傅里叶级数", "偏导数", "全微分",
            "梯度", "二重积分", "曲线积分", "柯西-施瓦茨不等式", "一致连续",
        ],
        "backup": ["不定积分", "多元函数", "重积分", "级数 (数学)", "极限", "连续", "均值定理", "向量分析"],
    },
    "线性代数与概率统计": {
        "primary": [
            "矩阵 (数学)", "行列式", "特征值和特征向量", "特征多项式", "秩 (线性代数)", "线性无关",
            "向量空间", "正交矩阵", "二次型", "奇异值分解", "随机变量", "概率分布", "期望值 (概率论)",
            "方差", "协方差", "贝叶斯定理", "全概率公式", "大数定律", "中心极限定理", "最大似然估计",
            "置信区间", "假设检验", "正态分布", "二项分布", "泊松分布",
        ],
        "backup": ["线性变换", "矩阵乘法", "逆矩阵", "概率论", "统计推断", "随机过程", "相关系数", "抽样 (统计学)"],
    },
    "大学物理基本定律": {
        "primary": [
            "牛顿运动定律", "动量守恒定律", "角动量", "机械能守恒定律", "功", "动能定理", "万有引力",
            "简谐运动", "热力学第一定律", "热力学第二定律", "熵", "理想气体状态方程", "麦克斯韦方程组",
            "库仑定律", "高斯定律", "安培定律", "电磁感应", "洛伦兹力", "折射定律", "全反射",
            "薄膜干涉", "衍射", "多普勒效应", "黑体辐射", "光电效应",
        ],
        "backup": ["能量守恒定律", "牛顿万有引力定律", "电场", "磁场", "波动", "干涉 (物理学)", "热力学", "相对论"],
    },
    "计算机网络与操作系统基础": {
        "primary": [
            "传输控制协议", "用户数据报协议", "IP地址", "子网", "域名系统", "超文本传输协议",
            "超文本传输安全协议", "路由", "OSI模型", "以太网", "地址解析协议", "拥塞控制",
            "滑动窗口", "进程", "线程", "死锁", "调度 (计算机)", "虚拟内存", "页面置换算法",
            "信号量", "文件系统", "中断", "CPU缓存", "哈希表", "时间复杂度",
        ],
        "backup": ["计算机网络", "互联网协议套件", "操作系统", "并发控制", "内存管理", "二叉树", "排序算法", "数据库索引"],
    },
}

DISPLAY_TITLES = {"IP地址": "IP地址", "调度 (计算机)": "进程调度", "极限 (数学)": "极限",
                  "矩阵 (数学)": "矩阵", "秩 (线性代数)": "矩阵的秩", "期望值 (概率论)": "数学期望",
                  "方差": "方差", "排序算法": "排序算法"}
TARGET_ENTRIES = 20


def cache_path(title: str) -> str:
    safe = re.sub(r"[^\w\u4e00-\u9fff-]", "_", title)
    return os.path.join(CACHE, safe + ".txt")


def fetch_extract(title: str, retries: int = 4) -> tuple[str, str]:
    params = {
        "action": "query", "prop": "extracts", "explaintext": "1", "exsectionformat": "plain",
        "format": "json", "formatversion": "2", "redirects": "1", "titles": title, "utf8": "1",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    delay = 1.2
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
                print(f"      ! {title}: {type(error).__name__}", flush=True)
                return "", title
            time.sleep(delay)
            delay *= 1.8
    return "", title


def clean(text: str) -> str:
    text = re.sub(r"\{\s*\\displaystyle\s+.*?\}", " ", text, flags=re.S)
    text = re.sub(r"\\[a-zA-Z]+", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return "\n".join(line.strip() for line in text.split("\n") if line.strip())


def get_entry(title: str, rebuild_only: bool) -> tuple[str, str] | None:
    path = cache_path(title)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
        return payload["text"], payload["sourceTitle"]
    if rebuild_only:
        return None
    text, source_title = fetch_extract(title)
    if not text.strip():
        return None
    text = clean(text)
    if len(text) > MAX_CHARS_PER_ENTRY:
        text = text[:MAX_CHARS_PER_ENTRY].rstrip() + "……"
    os.makedirs(CACHE, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"title": title, "sourceTitle": source_title, "text": text}, handle, ensure_ascii=False)
    return text, source_title


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(HERE, "eval_corpus_docs"))
    parser.add_argument("--rebuild-only", action="store_true", help="只用缓存离线重建 DOCX")
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)

    report = []
    for doc_name, spec in DOCS.items():
        print(f"=== {doc_name} ===", flush=True)
        entries, seen = [], set()
        for title in spec["primary"] + spec["backup"]:
            if len(entries) >= TARGET_ENTRIES:
                break
            if title in seen:
                continue
            seen.add(title)
            got = get_entry(title, args.rebuild_only)
            if got is None:
                print(f"  - 无内容，跳过 {title}", flush=True)
                continue
            text, source_title = got
            display = DISPLAY_TITLES.get(title, title)
            entries.append({"title": display, "sourceTitle": source_title, "text": text})
            print(f"  + {display}  {len(text)} 字", flush=True)

        document = docx.Document()
        document.styles["Normal"].font.name = "宋体"
        document.styles["Normal"].font.size = Pt(11)
        document.add_heading(doc_name, level=0)
        document.add_paragraph(
            f"本文档为教学实验语料（非知识库内容），摘编自中文维基百科（zh.wikipedia.org），"
            f"依据 {LICENSE} 许可使用；原文作者为维基百科贡献者，获取日期 {ACCESSED}。"
            f"完整来源条目与链接见文末“来源与许可”。"
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
            url = "https://zh.wikipedia.org/wiki/" + urllib.parse.quote(entry["sourceTitle"].replace(" ", "_"))
            document.add_paragraph(f"· {entry['sourceTitle']} — {url}", style="List Bullet")

        path = os.path.join(args.out, f"{doc_name}.docx")
        document.save(path)
        chars = sum(len(e["text"]) for e in entries)
        report.append({"file": os.path.basename(path), "entries": len(entries), "chars": chars,
                       "estimatedChunks": max(1, round(chars / CHUNK_TARGET_CHARS)), "path": path})
        print(f"  → {os.path.basename(path)}  {len(entries)} 条  {chars} 字  ~{report[-1]['estimatedChunks']} 片\n", flush=True)

    summary = {"documents": report, "totalEstimatedChunks": sum(r["estimatedChunks"] for r in report),
               "totalEntries": sum(r["entries"] for r in report),
               "totalChars": sum(r["chars"] for r in report),
               "license": LICENSE, "accessed": ACCESSED,
               "source": "zh.wikipedia.org（CC BY-SA 4.0）"}
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    with open(os.path.join(args.out, "corpus_sources.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
