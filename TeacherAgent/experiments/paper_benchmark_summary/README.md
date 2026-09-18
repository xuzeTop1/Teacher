# paper_benchmark_summary

论文《隐私优先的多端协同智能辅导系统设计与实现》所用评测的**脱敏汇总结果**。

本目录只保留聚合指标与逐题**度量值**（不含查询文本、不含金标准标识、不含私有文档引用），用于让读者核对论文表格中的数字来源。

## 来源对照

| 本目录 | 来源归档 | 归档时间 | 内容 |
|---|---|---|---|
| `hybrid_retrieval_100q/` | `benchmark-results/20260915-235805-hybrid-retrieval-100q-overall/` | 2026-09-15 23:58 | 100 题混合检索（BM25 / 稠密 / 混合三配置）的 overall_100 与 conditional_93 指标、按类别/来源分组、逐题度量 |
| `bkt_assistments_ablation/` | `benchmark-results/20260914-223915-fb-bkt-assistments-200-ablation/` | 2026-09-14 22:39 | ASSISTments 上 FB-BKT 的因素消融 |
| `bkt_ednet_ablation/` | `benchmark-results/20260914-223854-fb-bkt-ednet-kt1-ablation/` | 2026-09-14 22:38 | EdNet-KT1 上 FB-BKT 的因素消融 |
| `dkt_hyperparam_scan/` | `benchmark-results/20260915-000021-ednet-kt1-firsttag-20000u-dkt-scan/` | 2026-09-15 00:00 | EdNet-KT1 上 DKT 的超参敏感性扫描 |
| `bkt_fitted_cv_ednet/` | `benchmark-results/20260916-000926-bkt-fitted-cv-ednet-submission/` | 2026-09-16 00:09 | EdNet-KT1 上「训练折拟合 BKT 参数 vs 固定先验」的五折对照（含参数网格与逐折结果） |
| `rag_index/` | `benchmark-results/rag-*.csv` | 2026-09 | RAG 检索索引的暴力余弦与索引加速对照（由 `scripts/rag-index-benchmark.py` 产出） |
| `sync_realdevice/` | `benchmark-results/20260912-132057-sync-realdevice/rounds.csv`、`benchmark-results/20260909-005639/scale.csv` | 2026-09-12 / 2026-09-09 | 局域网真机快照同步 10 轮实测（表 10）与协议入库规模基准（每规模 3 次重复的报文体积与耗时） |
| `robustness/` | `benchmark-results/20260909-005747/robustness.csv` | 2026-09-09 | 同步协议 15 项异常输入用例的期望判定、实际状态码与结论（表 11） |
| `kt_5fold_baselines/` | `benchmark-results/20260918-020722-ednet-kt1-firsttag-20000u-kt-5fold-merged/` | 2026-09-18 02:07 | EdNet-KT1 上 BKT / FB-BKT / DKT / AKT-NR / DKVMN **五模型在统一早停协议下**的 5 折对照（含折级配对检验；本包为 JSON + Markdown） |

## 关键口径

1. **两套检索口径不可混用**：`overall_100` 为全 100 题（无候选题的 7 题按未命中计入），`conditional_93` 仅含有候选题的 93 题。引用论文表格时须标明采用哪套。
2. **候选池覆盖率 93%**：100 题中有 7 题（`q073/q074/q087/q092/q095/q099/q100`）在候选池中不存在达到 3/5 多数门槛的相关项，属覆盖率问题，**不是被静默剔除**——它们在 overall_100 中按 0 计入。
3. **标注性质**：2 名真人 + 3 个 LLM 等权多数票，**不是纯人工金标准**。
4. **训练折拟合 BKT 的负结果如实保留**：拟合改善了 RMSE，但 AUC 未超过固定先验 BKT。
5. **本次复算是确定性的**：100 题全口径指标由既有排名缓存重新聚合得出，**未调用任何模型或向量服务**。
6. **同步与鲁棒性结果为聚合量**：`sync_realdevice/` 与 `robustness/` 仅含每轮/每用例的耗时、体积与判定结果，不含设备标识、用户数据或网络抓包内容。
7. **BKT/AUC 对照的 source 列已改为相对路径**：`bkt_fitted_cv_ednet/comparison_summary.csv` 的 `source` 列给出 `benchmark-results/<归档名>/results.csv` 形式的相对归档名，便于回溯。

## 未包含内容

- 原始数据集（ASSISTments / EdNet-KT1）与其派生的中间文件（获取方式见 `../data/README.md`）；
- 嵌入模型权重与向量索引；
- 含私有文档标识的原始标注文件与逐题排名缓存；
- 运行环境的绝对路径信息（本目录与脚本均为相对路径表述）。

## 校验

各文件的 SHA-256 见同目录 `SHA256SUMS.txt`。
