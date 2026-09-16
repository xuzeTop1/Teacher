#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量抓取中文维基 wikitext 灌入缓存（网络段）。

为什么用它：
  * `prop=extracts` 全文模式**每次只返回 1 个条目**，78 条 = 78 次请求 → 慢且容易被限流；
  * `prop=revisions&rvslots=main` 支持**一次多个条目**（本脚本每批 25 条），78 条只需 4 次请求。
缓存键 = 请求时的标题（与 build_corpus_docs_v3.py 的 DOCS 清单一致），
因此后续 `build_corpus_docs_v3.py --rebuild-only` 可完全离线生成 DOCX。
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_corpus_docs_v3 import CACHE, DOCS, API, UA, clean_wikitext, MIN_ENTRY_CHARS  # noqa: E402

BATCH = 25


def cache_file(title: str) -> str:
    return os.path.join(CACHE, re.sub(r"[^\w\u4e00-\u9fff-]", "_", title) + ".json")


def main() -> None:
    os.makedirs(CACHE, exist_ok=True)
    wanted: list[str] = []
    for spec in DOCS.values():
        for title in spec["primary"] + spec["backup"]:
            if title not in wanted:
                wanted.append(title)
    pending = [t for t in wanted if not os.path.exists(cache_file(t))]
    print(f"目标条目 {len(wanted)}，待抓取 {len(pending)}")

    for start in range(0, len(pending), BATCH):
        chunk = pending[start:start + BATCH]
        params = {"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                  "format": "json", "formatversion": "2", "redirects": "1", "titles": "|".join(chunk)}
        url = API + "?" + urllib.parse.urlencode(params)
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=120) as response:
                data = json.loads(response.read().decode())
        except Exception as error:  # noqa: BLE001
            print(f"  批次 {start//BATCH+1} 失败：{type(error).__name__} {error}")
            continue

        query = data.get("query", {})
        mapping = {}
        for item in query.get("normalized", []):
            mapping[item["from"]] = item["to"]
        for item in query.get("redirects", []):
            mapping[item["from"]] = item["to"]

        pages = {page.get("title"): page for page in query.get("pages", [])}
        saved = 0
        for requested in chunk:
            resolved = requested
            for _ in range(3):  # 跟随规范化/重定向链
                if resolved in mapping:
                    resolved = mapping[resolved]
                else:
                    break
            page = pages.get(resolved) or pages.get(requested)
            if not page or "revisions" not in page:
                print(f"  · 无内容：{requested}")
                continue
            raw = page.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "")
            if not raw:
                print(f"  · 空正文：{requested}")
                continue
            text, formulas, restored = clean_wikitext(raw)
            if len(text) > 4000:
                text = text[:4000].rstrip() + "……"
            if len(text) < MIN_ENTRY_CHARS:
                print(f"  · 过短丢弃：{requested}（{len(text)} 字）")
                continue
            payload = {"title": requested, "sourceTitle": page.get("title", requested),
                       "text": text, "formulas": formulas, "chars": len(text)}
            with open(cache_file(requested), "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False)
            saved += 1
        print(f"  批次 {start//BATCH+1}: 请求 {len(chunk)} 条，缓存 {saved} 条")
        time.sleep(0.6)

    have = sum(1 for t in wanted if os.path.exists(cache_file(t)))
    print(f"\n缓存完成：{have}/{len(wanted)}")
    missing = [t for t in wanted if not os.path.exists(cache_file(t))]
    if missing:
        print("未获取：", "、".join(missing[:20]), ("…" if len(missing) > 20 else ""))


if __name__ == "__main__":
    main()
