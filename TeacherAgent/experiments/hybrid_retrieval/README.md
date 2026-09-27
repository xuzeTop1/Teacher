# 工作项 E：混合检索质量评测

对应规格 `论文v3-待实现工作交付规格.md` 工作项 E（100 题混合检索质量评测）。

## 用法

```bash
cd experiments/hybrid_retrieval

python run_eval.py prepare     # 用 SQLite 备份 API 复制运行时库为评测副本（不动线上库）
python run_eval.py build-qa    # 从真实语料构造 100 题（机器标注）
python run_eval.py embed       # 本地 Ollama bge-m3 生成查询向量（问句 + 裸词两种形态）
python run_eval.py run         # 调 Rust harness 出排名，算 Hit@3/5、MRR、NDCG@5 与时延，归档
python run_eval.py all         # 以上四步

# 常用开关
python run_eval.py --profile debug --reps 1 run     # 快速自检（不建 release）
python run_eval.py run --form bare                  # 只跑裸词形态
```

产出归档到 `benchmark-results/<timestamp>-hybrid-retrieval-100q/`：
`results_overall.csv`、`results_by_category.csv`、`results_by_source.csv`、
`latency.csv`、`qa_100.jsonl`、`run_manifest.json`。

## 三配置如何执行

排名全部来自 **Rust 生产实现**（`src-tauri/src/rag/eval.rs` 的 `hybrid_retrieval_eval`），
Python 侧不重写 BM25 / 余弦 / RRF：

| 配置 | 生产调用 |
|:---|:---|
| `bm25` | `retrieve_context(..., query_embedding = None)`，即倒排通道退化态 |
| `dense` | `vector::search_similar` 对 `DENSE_ENTITY_TYPES` 逐类召回后按余弦归并 |
| `hybrid` | `retrieve_context(..., query_embedding = Some(vec))`，RRF 融合 |

参数与论文 §4.2 一致：FTS5 内建 BM25 的 k1=1.2 / b=0.75（不可在调用处覆盖）、
双通道各取 Top-20、k_RRF=60；评测取 Top-5。查询向量为**本地 Ollama 回环**的
bge-m3（1024 维），与库内语料向量同模型同维度。

## ⚠ 这套数字不能当论文结论

规格 E.1 要求"两位评审独立标注 gold set 取交集"。本 harness **做不到**这一点：

- gold set 是**机器标注**——目标词取自语料本身，gold = 语料中包含该词的全部实体；
- 因此这是"语料自洽的已知项检索"任务，指标系统性偏高；
- 题面也有机器痕迹（个别概念词仍是短语碎片）。

`run_manifest.json` 的 `caveats` 明确记录了这两点。本目录的产出用于验证**评测链路
可复现**与暴露实现缺陷，**不得**作为论文的检索质量数字；要写入论文必须换成人工标注的
100 题 gold set（把 `qa_100.jsonl` 的 `annotator_1/annotator_2` 换成真实评审即可复用全链）。

## 人工题集工作流（正式评测口径）

机器题集只用于验证链路；正式评测必须换成人工标注题集。切换只需把题集放到
`work/qa_100_human.jsonl`，然后：

```bash
python run_eval.py --qa work/qa_100_human.jsonl embed   # 题面改动后必须重算查询向量
python run_eval.py --qa work/qa_100_human.jsonl run     # 出排名与指标并归档
```

> ⚠ `--qa` / `--reps` / `--profile` 都是**全局参数**，必须写在子命令**之前**。

三道防护（2026-09-15 加入，实现见 `run_eval.py`）：

1. **build-qa 覆盖保护**：`work/qa_100_human.jsonl` 存在时 `build-qa` 直接停止并给出正确命令，
   避免误跑一次把正式题集冲掉；确需重建机器题集加 `--force`（不会改动人工题集）。
2. **向量/题集一致性守卫**：`run` 在调 Rust 之前校验 `query_vectors_{form}.jsonl` 的 qid 集合与
   查询文本是否与当前题集逐一对应；**题面改了却忘了重跑 embed 会 fail-fast**，不会静默用旧向量出排名。
   注意两形态校验对象不同：`template` 比对 `query`，`bare` 比对 `target_term`。
3. **embed 缓存改为文本级**：同一 qid 的查询文本变了就不再命中缓存（原先只比对向量维度）。

归档留痕：`run` 把**实际使用的题集**按原名复制进归档，并在 `run_manifest.json` 写入
`qa.path` / `qa.sha256` / `qa.humanAnnotated` / `qa.annotators`；`caveats` 按标注来源自适应——
`annotator_1` 与 `annotator_2` 都填了真实标注者姓名时，警示语自动切换为"人工标注"版本，
不再输出机器标注的三条免责声明。

### 人工题集字段约定

| 字段 | 说明 |
|:---|:---|
| `qid` | 与机器题集一致（`q001`…），查询向量与排名按 qid 对齐 |
| `category` | 术语检索 / 概念理解 / 公式辨析（决定分表统计，配额 32/38/30） |
| `query` | **问句形态**的题面，人工重写目标（真实学生问法） |
| `target_term` | **裸词形态**的检索词，保持干净核心词即可，无需改成问句 |
| `gold_ids` | 仲裁后的 gold 集合（`knowledge_node:<id>` / `private_chunk:<id>` / `question:<id>`） |
| `gold_a1` / `gold_a2` | 两位评审的**独立**标注（建议保留，便于复核与重算一致性） |
| `annotator_1` / `annotator_2` | 填真实标注者姓名；两者都非 `machine` 时才判定为人工标注 |

改类别时不要破坏配额：`IPv4怎么算`（CS 概念题被 `FORMULA_CJK` 误归入公式辨析）这类应**替换**而非
挪走，保持 32/38/30 与论文 §4.2 的三类覆盖表述一致。

### 已知的机器题面缺陷（人工改写时的重点）

- `category` 由"哪个抽取函数产出该词"决定，**不判断内容真实类型**；`FORMULA_CJK` 把
  `子网掩码|路由聚合|前缀长度|往返时延|拥塞窗口` 等**网络类词**也算公式特征 → CS 概念题被归入
  "公式辨析"（例：`IPv4怎么算`）。
- `concept_terms` 取"首个分句的起始中文串"，不保证是完整概念词，会产出碎片
  （例：`本质是一个极限是什么意思`）。
- 因此 68 道问句形态题面需人工重写；32 道名词短语题（术语检索）一般可直接沿用。
- 彻底修复上述两个抽取函数属**独立改动**，尚未实施（会改变机器题集，需重跑全链）。

## 已暴露并修复的三个实现问题

跑这条链路时发现了三处真实缺陷，均已于 2026-09-11 修复；实测前后对照见
`docs/decisions/2026-09-11-hybrid-retrieval-optimization.md`「实施结果」，归档
`benchmark-results/20260911-004802-hybrid-retrieval-100q/`（修复前 `-000900-`）。

1. **FTS5 外部内容表不索引迁移前的既有行**（已修，迁移 `0018_private_chunks_fts_rebuild.sql`）。
   0016 只建表与触发器，触发器对迁移之后写入的行生效；老库升级后倒排索引为空。更隐蔽的是两处
   既有探针都会说"正常"：外部内容表的 `COUNT(*)` **读穿主表**，而 FTS5 的 `'integrity-check'`
   对"被清空但主表还在"的索引**同样报 OK**（两者均已实测）。诊断因此改用功能性覆盖率探针
   `fts_index_complete`（抽样 ≤5 行、各做真实 MATCH，任一样本查不到即判定脱节），并由
   `ensure_fts_index` 在探针不通过时执行一次 rebuild。回归测试见
   `src/rag/hybrid.rs::fts_rebuild_indexes_rows_that_predate_the_virtual_table`。

2. **无空格的问句会让倒排通道返回空**（已修，决策 D-407）。`build_match_expression` 对没有空白的
   查询整串加引号作 FTS5 短语，trigram 下等价于"必须包含该整串"，于是"偏振光是什么意思"查不到
   任何东西，而"偏振光"或"偏振光 是什么意思"都能命中。现在 `bm25_top_k` 是三阶段召回：
   OR 分词（原有）→ 剥离问句壳后的整串短语 → 3-gram OR 兜底（限幅 32 窗口）；后两阶段只在
   前一阶段返回空集时生效。实测问句形态纯 BM25 Hit@3 由 **0.07 升到 0.39**、混合由 **0.61 升到 0.86**。

3. **融合层把私有片段压到知识库节点之后**（已修，决策 D-408）。`fuse_rrf` 的 `K+1` 平坦兜底让
   "倒排第 1 名"与"稠密第 1 名"同分，并列按 id 字典序破局，而 `knowledge_node:`/`question:`
   恒排在 `private_chunk:` 之前。现在改用标准 RRF（未入榜记 0）、并列按名次奇偶交替
   （奇倒排优先/偶稠密优先，以全序排序键实现）、并给 top-k 每源保留 2 个槽位抗饿死。
   片段金标融合后 MRR 由 **0.635 恢复到 0.9615**；代价是节点侧 MRR 由 0.788 降到 0.690
   （属公平性再平衡，不是净增益）。
