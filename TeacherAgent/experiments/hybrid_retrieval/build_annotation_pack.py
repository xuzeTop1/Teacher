#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 100 题人工标注包（TREC 式 pooling + 盲标网页）。

流程
----
1. 先确保查询向量与题集一致（不一致会 fail-fast）。
2. 调 `run_eval.py --reps 1 run` 取三配置（bm25/dense/hybrid）×两形态
   （template/bare）的 Top-5 —— 这一步会顺带产出一个归档目录，可留作记录。
3. 对每道题做 **pooling**：六份 Top-5 取并集去重（TREC 标准做法：
   相关性判断只需覆盖"任何系统可能返回的文档"）。
4. 生成**盲标网页**：不显示候选来自哪个配置、不显示分数、不显示机器 gold、
   不显示 target_term —— 泄露任何一项，标注即作废。
5. 两位评审各拿一份内容相同的 HTML（仅 localStorage 存档键不同），独立标注。

用法
----
    python build_annotation_pack.py                     # 生成标注包
    python build_annotation_pack.py --annotators 张三,李四
输出
----
    work/annotation/pack_annotator_<名字>.html   盲标网页（浏览器打开）
    work/annotation/pool.json                    候选池与正文（供复核/合并）
"""

import argparse
import html
import json
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(HERE, "work")
OUT_DIR = os.path.join(WORK_DIR, "annotation")
QA_PATH = os.path.join(WORK_DIR, "qa_100_human.jsonl")
RAW_FORMS = {"template": os.path.join(WORK_DIR, "hybrid_raw_template.jsonl"),
             "bare": os.path.join(WORK_DIR, "hybrid_raw_bare.jsonl")}
CONFIGS = ("bm25", "dense", "hybrid")
TOP_PER_LIST = 5
PYTHON = sys.executable


def read_jsonl(path):
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def run_harness() -> None:
    """跑一次 harness 取排名（--reps 1：标注不需要时延采样）。"""
    print("run: 调用 harness 取三配置 Top-5（--reps 1）…")
    result = subprocess.run(
        [PYTHON, "run_eval.py", "--qa", os.path.abspath(QA_PATH), "--reps", "1", "run"],
        cwd=HERE, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stdout[-3000:] + "\n" + result.stderr[-3000:])
        raise SystemExit("harness 运行失败；请先确认 embed 与题集一致")
    for form, path in RAW_FORMS.items():
        if not os.path.exists(path):
            raise SystemExit(f"harness 未产出 {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 100 题盲标包")
    parser.add_argument("--annotators", default="评审一,评审二",
                        help="逗号分隔的评审名（生成每人一份 HTML）")
    parser.add_argument("--skip-harness", action="store_true",
                        help="复用 work/ 里现成的 hybrid_raw_*.jsonl（题面未改时）")
    args = parser.parse_args()

    if not os.path.exists(QA_PATH):
        raise SystemExit(f"题集不存在：{QA_PATH}")

    if not args.skip_harness:
        run_harness()

    questions = {row["qid"]: row for row in read_jsonl(QA_PATH)}

    # ── 语料正文（只取标题与文本，绝不含机器 gold / target_term）──────────
    import sqlite3
    db = sqlite3.connect("file:" + os.path.join(WORK_DIR, "eval_corpus.sqlite3") + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    corpus = {}
    for row in db.execute(
        """SELECT kn.id, kn.title, kn.summary FROM knowledge_nodes kn"""
    ):
        corpus[f"knowledge_node:{row['id']}"] = {
            "title": row["title"] or "",
            "text": row["summary"] or "",
        }
    for row in db.execute(
        """SELECT c.id, c.heading, c.text
             FROM private_document_chunks c
             JOIN private_documents d ON d.id = c.document_id
            WHERE d.deleted_at IS NULL"""
    ):
        corpus[f"private_chunk:{row['id']}"] = {
            "title": row["heading"] or "",
            "text": row["text"] or "",
        }
    # 题目也是可检索实体（DENSE_ENTITY_TYPES 含 question，gold 可含题目），
    # 文本拼法与向量侧一致（seedEmbeddingService：`${title}: ${content}` + ` 答案: …`）。
    for row in db.execute(
        """SELECT id, title, content, answer FROM questions WHERE review_status = 'approved'"""
    ):
        text = f"{row['title'] or ''}: {row['content'] or ''}"
        if row["answer"]:
            text += f" 答案: {row['answer']}"
        corpus[f"question:{row['id']}"] = {"title": row["title"] or "", "text": text}
    db.close()

    # ── pooling：六份 Top-5 并集去重 ────────────────────────────────────
    pool = {}
    for form, path in RAW_FORMS.items():
        for row in read_jsonl(path):
            keys = [hit["key"] for hit in sorted(row["hits"], key=lambda h: h["rank"])]
            pool.setdefault(row["qid"], set()).update(keys[:TOP_PER_LIST])

    pack = []
    missing_corpus = 0
    for qid in sorted(questions):
        question = questions[qid]
        candidates = sorted(pool.get(qid, set()))          # 排序后按固定种子打乱
        rng = random.Random(f"{qid}:blind-pool")
        rng.shuffle(candidates)
        items = []
        for key in candidates:
            content = corpus.get(key)
            if content is None:
                missing_corpus += 1
                continue
            items.append({
                "key": key,
                "title": content["title"],
                "text": content["text"],
            })
        pack.append({
            "qid": qid,
            "category": question["category"],
            "query": question["query"],          # 只给题面；target_term 不给
            "candidates": items,
        })
    if missing_corpus:
        print(f"警告：{missing_corpus} 个池内候选不在当前语料中，已跳过")

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "pool.json"), "w", encoding="utf-8") as handle:
        json.dump({"seed": "blind-pool", "questions": pack}, handle, ensure_ascii=False, indent=2)

    for name in [n.strip() for n in args.annotators.split(",") if n.strip()]:
        page = render_html(pack, name)
        path = os.path.join(OUT_DIR, f"pack_annotator_{name}.html")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(page)
        total = sum(len(q["candidates"]) for q in pack)
        print(f"  {name}: {path}  （{len(pack)} 题 / {total} 个判定）")
    print(f"候选池： {os.path.join(OUT_DIR, 'pool.json')}")
    print("\n标注纪律：两位评审不交流、不互看结果；先各标 10 题做校准并算 kappa，再标完全部 100 题。")


def render_html(pack: list, annotator: str) -> str:
    payload = json.dumps(pack, ensure_ascii=False)

    # MathJax v3（SVG 输出，无需字体文件，可离线渲染 $...$ 公式）。
    # 优先内嵌本目录的 mathjax-tex-svg.js（npmmirror 下载，国内直连）；
    # 若文件内含 </script>（会被 HTML 解析器截断）则退化为外部引用。
    mathjax_path = os.path.join(OUT_DIR, "mathjax-tex-svg.js")
    if os.path.exists(mathjax_path):
        with open(mathjax_path, encoding="utf-8") as handle:
            mathjax_bundle = handle.read()
        if "</script" in mathjax_bundle.lower():
            mathjax_tag = '<script src="mathjax-tex-svg.js"></script>'
        else:
            mathjax_tag = "<script>" + mathjax_bundle + "</script>"
    else:
        mathjax_tag = ('<script src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js">'
                       '</script>')

    return """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>检索相关性盲标 — 评审：__ANNOTATOR__</title>
<style>
 body{font-family:"Microsoft YaHei",system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1c2733}
 header{position:sticky;top:0;background:#fff;border-bottom:1px solid #dde3ea;padding:10px 18px;z-index:5;
        display:flex;gap:14px;align-items:center;box-shadow:0 1px 4px rgba(0,0,0,.06)}
 header b{font-size:15px}
 #progress{font-size:13px;color:#5a6b7d}
 main{max-width:860px;margin:18px auto 80px;padding:0 14px}
 .q{background:#fff;border:1px solid #dde3ea;border-radius:10px;padding:14px 16px;margin-bottom:18px}
 .q h3{margin:0 0 4px;font-size:15px}
 .q .meta{font-size:12px;color:#7b8a99;margin-bottom:8px}
 .q .query{font-size:16px;font-weight:600;background:#eef4ff;border-left:4px solid #3b82f6;
           padding:8px 12px;border-radius:6px;margin-bottom:12px}
 .cand{border:1px solid #e3e8ee;border-radius:8px;padding:10px 12px;margin-bottom:10px;background:#fbfcfe}
 .cand.needv{border:2px solid #f59e0b;background:#fffbeb}
 .cand .t{font-weight:600;font-size:13.5px;margin-bottom:6px}
 .cand .x{font-size:13.5px;line-height:1.8;white-space:pre-wrap;max-height:260px;overflow:auto}
 .cand .x svg{max-width:100%}
 .judge{margin-top:8px;display:flex;gap:8px;align-items:center}
 button{border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:5px 14px;cursor:pointer;font-size:13px}
 button.on1{background:#16a34a;color:#fff;border-color:#16a34a}
 button.on0{background:#dc2626;color:#fff;border-color:#dc2626}
 label.edge{font-size:12.5px;color:#5a6b7d;display:flex;gap:4px;align-items:center;margin-left:6px}
 footer{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #dde3ea;
        padding:10px 18px;display:flex;gap:12px;align-items:center;z-index:5}
 footer button.primary{background:#2563eb;color:#fff;border-color:#2563eb;padding:8px 18px}
 #hint{font-size:12.5px;color:#5a6b7d}
</style></head><body>
<header><b>检索相关性盲标</b><span>评审：__ANNOTATOR__</span><span id="progress"></span>
<span id="mjstate"></span></header>
<main>
<details style="background:#fff;border:1px solid #dde3ea;border-radius:10px;padding:10px 16px;margin-bottom:18px;font-size:13.5px;line-height:1.9">
<summary style="cursor:pointer;font-weight:600">判据速查（点开/收起）—— 核心只看一条：候选能否直接支撑回答该问题</summary>
<div style="margin-top:8px">
 · <b>术语检索</b>（“X 的性质/怎么算”）：讲 <b>X 本身</b>的定义、性质、公式 = 1；只讲上位概念、应用场景、相邻概念 = 0<br>
 · <b>概念理解</b>（“X 是什么意思”）：<b>解释了 X 的含义或原理</b> = 1；提到 X 但没解释、只给例子没原理 = 0<br>
 · <b>公式辨析</b>（“X 公式/条件/与 Y 的区别”）：给出该公式表达式、适用条件或区别 = 1；只有结论没有条件 = 0<br>
 · <b>题库题目实体</b>（形如“……则此循环是： 答案: A”的裸题）：无解析内容的裸题 = 0（答案字母不构成解释）；仅当题面+解析完整讲清了查询概念才 = 1<br>
 · <b>长文档切片</b>：正文很长时，只要其中某一段能回答该问题 = 1<br>
 · 讲相邻概念、能对比着理解 → 0 并勾「边界」；标题对但正文讲别的 → 按正文判 = 0；正文截断看不清 → 勾「边界」<br>
 · 一题允许多个相关（候选之间独立判，互不影响）
</div>
</details>
<div id="list"></div>
</main>
<footer><button class="primary" onclick="exportJson()">导出标注 JSON</button>
<button onclick="nextTodo()">跳到下一个未完成</button>
<span id="hint">快捷键：↑↓ 切换题目 · 1=相关 · 0=不相关 · B=边界 · 空格=下一个未完成 · 自动保存于本机</span></footer>
<script>
window.MathJax = {
  startup: { typeset: false },
  tex: { inlineMath: [["$","$"],["\\\\(","\\\\)"]],
         displayMath: [["$$","$$"],["\\\\[","\\\\]"]] },
  svg: { fontCache: "global", scale: 1.05 },
  options: { enableMenu: false }
};
</script>
__MATHJAX__
<script>
const DATA = __PAYLOAD__;
const KEY = "blind_annotation___ANNOTATOR_KEY__";
let state = JSON.parse(localStorage.getItem(KEY) || "null") || {};
const list = document.getElementById("list");

function judgeOf(qid, key){ const s = state[qid] || {}; return s[key] || null; }
function save(){
  localStorage.setItem(KEY, JSON.stringify(state));
  let done = 0, total = 0;
  DATA.forEach(q => q.candidates.forEach(c => { total++; const j = judgeOf(q.qid, c.key); if (j && j.v !== null) done++; }));
  document.getElementById("progress").textContent = `进度 ${done}/${total}`;
}
function setJudge(qid, key, value){
  state[qid] = state[qid] || {}; state[qid][key] = value;
  save();
  document.querySelectorAll(`div.cand[data-qid="${qid}"]`).forEach(node => {
    if (node.dataset.ckey !== key) return;
    node.querySelector("button[data-v='1']").className = value.v === 1 ? "on1" : "";
    node.querySelector("button[data-v='0']").className = value.v === 0 ? "on0" : "";
    node.querySelector("input[type=checkbox]").checked = !!value.edge;
    const needv = value.v === null && value.edge;
    node.className = "cand" + (needv ? " needv" : "");
    node.querySelector(".needvmsg").style.display = needv ? "" : "none";
  });
}
function isDone(qid, key){ const j = judgeOf(qid, key); return !!(j && j.v !== null); }
function build(){
  DATA.forEach((q, qi) => {
    const div = document.createElement("div"); div.className = "q";
    const judged = q.candidates.filter(c => isDone(q.qid, c.key)).length;
    div.innerHTML = `<h3>${qi+1}. [${q.category}] ${q.qid}</h3>
      <div class="meta">已判 ${judged}/${q.candidates.length}</div><div class="query"></div>`;
    div.querySelector(".query").textContent = q.query;
    q.candidates.forEach((c, ci) => {
      const v = judgeOf(q.qid, c.key) || {v:null, edge:false};
      const needv = v.v === null && v.edge;
      const d = document.createElement("div");
      d.className = "cand" + (needv ? " needv" : ""); d.dataset.qid = q.qid; d.dataset.ckey = c.key;
      d.innerHTML = `<div class="t"></div><div class="x"></div>
        <div class="judge">
          <button data-v="1" class="${v.v===1?'on1':''}">相关 (1)</button>
          <button data-v="0" class="${v.v===0?'on0':''}">不相关 (0)</button>
          <label class="edge"><input type="checkbox" ${v.edge?'checked':''}> 边界（犹豫就勾上）</label>
          <span class="needvmsg" style="display:${needv?'':'none'};color:#b45309;font-size:12px">⚠ 只勾了边界，还没选相关/不相关</span>
        </div>`;
      d.querySelector(".t").textContent = (ci+1) + ". " + (c.title || "（无标题）");
      d.querySelector(".x").textContent = c.text || "（无正文）";
      d.querySelector("button[data-v='1']").onclick = () =>
        setJudge(q.qid, c.key, {v:1, edge:v.edge});
      d.querySelector("button[data-v='0']").onclick = () =>
        setJudge(q.qid, c.key, {v:0, edge:v.edge});
      d.querySelector("input[type=checkbox]").onchange = (e) => {
        const cur = judgeOf(q.qid, c.key) || {v:null};
        setJudge(q.qid, c.key, {v:cur.v, edge:e.target.checked});
      };
      div.appendChild(d);
    });
    list.appendChild(div);
  });
}
let cursor = 0;
function nextTodo(){
  for (let k = 1; k <= DATA.length; k++){
    const idxQ = (cursor + k) % DATA.length;
    const q = DATA[idxQ];
    const ci = q.candidates.findIndex(c => !isDone(q.qid, c.key));
    if (ci >= 0){
      cursor = idxQ;
      const nodes = list.children[cursor].querySelectorAll("div.cand");
      if (nodes[ci]) nodes[ci].scrollIntoView({behavior:"smooth", block:"center"});
      return;
    }
  }
  alert("全部 100 题判定完成，点「导出标注 JSON」导出即可！");
}
document.onkeydown = (e) => {
  if (e.code === "Space" && e.target === document.body){ e.preventDefault(); nextTodo(); return; }
  if (e.key === "ArrowDown" || e.key === "ArrowUp"){
    cursor = Math.max(0, Math.min(DATA.length-1, cursor + (e.key === "ArrowDown" ? 1 : -1)));
    const node = list.children[cursor];
    if (node) node.scrollIntoView({behavior:"smooth"});
  }
  if (e.key === "1" || e.key === "0"){
    const q = DATA[cursor]; if (!q) return;
    const target = q.candidates.find(c => judgeOf(q.qid, c.key) === null);
    if (target) setJudge(q.qid, target.key, {v: Number(e.key), edge:false});
  }
  if (e.key === "b" || e.key === "B"){
    const q = DATA[cursor]; if (!q) return;
    const target = q.candidates.find(c => { const v = judgeOf(q.qid, c.key); return v && v.v !== null && !v.edge; });
    if (target){ const v = judgeOf(q.qid, target.key); setJudge(q.qid, target.key, {v:v.v, edge:true}); }
  }
};
function exportJson(){
  const blob = new Blob([JSON.stringify({annotator:"__ANNOTATOR__", exportedAt:new Date().toISOString(), judgments:state}, null, 2)],
                        {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "annotations___ANNOTATOR_KEY__.json";
  a.click();
}
build();
save();
if (window.MathJax && MathJax.startup && MathJax.startup.promise){
  document.getElementById("mjstate").textContent = "公式渲染中…";
  MathJax.startup.promise.then(() => MathJax.typesetPromise())
    .then(() => { document.getElementById("mjstate").textContent = "公式渲染完成"; })
    .catch(() => { document.getElementById("mjstate").textContent = "公式渲染失败（以原文显示）"; });
} else {
  document.getElementById("mjstate").textContent = "（MathJax 未加载，公式以原文显示）";
}
</script></body></html>""".replace("__PAYLOAD__", payload) \
        .replace("__MATHJAX__", mathjax_tag) \
        .replace("__ANNOTATOR__", html.escape(annotator)) \
        .replace("__ANNOTATOR_KEY__", annotator.replace(" ", "_"))


if __name__ == "__main__":
    main()
