# experiments

本目录包含论文《隐私优先的多端协同智能辅导系统设计与实现》所用的**评测脚本**与**可公开的汇总结果**。

## 目录结构

| 路径 | 内容 |
|---|---|
| `assistments/` | ASSISTments 数据集上的 FB-BKT 评测：数据管道（`pipeline.py`）与逐折评测（`run_eval.py`） |
| `ednet_kt1/` | EdNet-KT1 上的知识追踪评测：`run_eval.py`（BKT/DKT 对照）、`run_eval_batched_dkt.py`、`fit_bkt_cv_fair_baseline.py`（五折交叉验证拟合基线）、`dkt_hyperparam_scan.py`（DKT 超参扫描）、`ablation.py`（因素消融）；`data_prep/` 为语料与特征构建脚本 |
| `hybrid_retrieval/` | 私有文档混合检索的 100 题评测：`run_eval.py`（BM25 / 稠密 / 混合三配置）、`build_annotation_pack.py`、`merge_annotations*.py`（人工与 LLM 标注合并）、`build_chunk_vectors_eval.py` |
| `submission_audit/` | 投稿前复核脚本：BKT 五折拟合复核、100 题混合检索复算、清单修复 |
| `paper_benchmark_summary/` | 上述评测的**脱敏汇总结果**（CSV/JSON），含每个归档的来源说明，见该目录 README |

## 范围说明

本目录**不含**以下内容，请勿在此查找：

- **数据集与模型权重**：ASSISTments / EdNet-KT1 原始数据、bge-m3 权重、向量索引与运行时数据库均不入库，仅在本地评测环境中存在。
- **原始逐题标注与私有切片引用**：包含学习者私有文档标识的中间产物不入库。
- **检索融合策略的比较研究**：该部分属另一篇独立工作，未包含在本次快照内。

## 运行环境

评测脚本按本地 Python 运行，主要依赖 `numpy`、`sqlite3`（FTS5）、`torch`（GPU 编码）与 `jieba`（词级倒排）。脚本内不含任何硬编码的本机路径，数据路径以命令行参数传入。

## 口径提示

- 混合检索评测同时给出 `overall_100`（全 100 题，无候选题的 7 题按未命中计入）与 `conditional_93`（仅有候选题，93 题）两套口径。两套数字**不可混用**，引用时须标明口径。
- 候选池覆盖率为 93/100 = 93%，与条件口径的检索质量是两个不同指标。
- 标注为「2 名真人 + 3 个 LLM 等权多数票」，**不是纯人工金标准**。
- 训练折上拟合的 BKT 参数改善了 RMSE，但未使 AUC 超过固定先验 BKT；该负结果如实保留。
