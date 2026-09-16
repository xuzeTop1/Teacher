# experiments

本目录包含论文《面向隐私保护的多端协同智能辅导系统设计与实现》所用的**评测脚本**、**脱敏汇总结果**，以及论文表格到文件的一一映射，用于第三方复现与核对。

> **论文对应版本**：tag `paper-v1.0`（位于 branch `experiments-public-benchmark` 上）。**引用请用 tag**，详见 §八。
>
> ⚠ 本目录中的结果**仅覆盖论文第 7 章的基准实验**；`main` 分支承载系统完整源码。

## 一、论文表格 → 文件映射

下表把论文正文的每张基准表映射到本仓库的结果文件。「汇总文件（本仓库）」列给出可直接阅读的脱敏结果；「论文引用的原始归档」列为论文正文引用的 `benchmark-results/<timestamp>-<name>/` 原始归档名（该目录本身不入库）。

| 论文表 | 表题 | 汇总文件（本仓库） | 论文引用的原始归档 | 生成脚本 |
|---|---|---|---|---|
| 表 3 | 暴力余弦检索性能评测（系统 Rust 原生实现） | `paper_benchmark_summary/rag_index/rag-brute-cosine-1024-release.csv` | `benchmark-results/rag-brute-cosine-1024-release.csv` | `TeacherAgent/scripts/rag-index-benchmark.py` 与 `src-tauri` 内建 bench |
| 表 4 | 向量化暴力余弦与 FAISS HNSW 同进程基准对照 | `paper_benchmark_summary/rag_index/rag-index-comparison-1024.csv` | `benchmark-results/rag-index-comparison-1024.csv` | `TeacherAgent/scripts/rag-index-benchmark.py` |
| 表 5 | 100 题全口径与 93 题条件口径的混合检索质量评测结果 | `paper_benchmark_summary/hybrid_retrieval_100q/`（`results_overall.csv`、`results_by_category.csv`、`results_by_source.csv`、`coverage.json`、`per_query_metrics.csv`、`comparison_with_archived_93.csv`） | `benchmark-results/20260915-235805-hybrid-retrieval-100q-overall/` | `experiments/hybrid_retrieval/run_eval.py`；复算 `experiments/submission_audit/recompute_hybrid_100.py` |
| 表 6 | ASSISTments 稀疏子集三模型预测精度对照（5 折学生级 CV） | `paper_benchmark_summary/bkt_assistments_ablation/`（同批任务产出的 ASSISTments 侧指标） | `benchmark-results/20260910-233318-fb-bkt-assistments/` | `experiments/assistments/pipeline.py` + `experiments/assistments/run_eval.py` |
| 表 7 | EdNet-KT1 四组配置下固定 BKT / 训练折拟合 BKT / FB-BKT / DKT 的预测精度对照（5 折，AUC） | `paper_benchmark_summary/bkt_fitted_cv_ednet/`（`results.csv`、`fit_params.csv`、`fit_grid.csv`、`comparison_summary.csv`） | `benchmark-results/20260916-000926-bkt-fitted-cv-ednet-submission/` | `experiments/ednet_kt1/run_eval.py`、`fit_bkt_cv_fair_baseline.py`、`run_eval_batched_dkt.py` |
| 表 8 | FB-BKT 在 ASSISTments 与 EdNet-KT1 上的因素消融（5 折，AUC） | `paper_benchmark_summary/bkt_ednet_ablation/`、`paper_benchmark_summary/bkt_assistments_ablation/` | `benchmark-results/20260914-223854-fb-bkt-ednet-kt1-ablation/`、`benchmark-results/20260914-223915-fb-bkt-assistments-200-ablation/` | `experiments/ednet_kt1/ablation.py` |
| 表 9 | DKT 预先限定六组超参数配置的敏感性分析（EdNet first_tag 20 000 用户） | `paper_benchmark_summary/dkt_hyperparam_scan/`（`dkt_scan.csv`、`summary.json`） | `benchmark-results/20260915-000021-ednet-kt1-firsttag-20000u-dkt-scan/` | `experiments/ednet_kt1/dkt_hyperparam_scan.py` |
| 表 10 | 局域网快照同步性能实测表（各 10 轮） | `paper_benchmark_summary/sync_realdevice/rounds.csv`（真机 10 轮）、`paper_benchmark_summary/sync_realdevice/protocol_scale.csv`（协议入库基准） | `benchmark-results/20260912-132057-sync-realdevice/rounds.csv`、`benchmark-results/20260909-005639/scale.csv` | `TeacherAgent/scripts/sync-benchmark.py` |
| 表 11 | 同步协议异常输入鲁棒性与安全防护测试 | `paper_benchmark_summary/robustness/robustness.csv` | `benchmark-results/20260909-005747/robustness.csv` | `TeacherAgent/scripts/sync-benchmark.py` |

论文 §7.8 提到的案例材料（`benchmark-results/20260912-133100-case-study/`）与 DKT 快速实现一致性校验（`benchmark-results/20260915-000138-dkt-impl-verify/`）属过程性归档，未随本快照分发。

## 二、复现命令

脚本按本地相对路径运行，数据目录以命令行参数或环境变量传入。**以下命令均已按脚本实际接口核对。**

**表 3 / 表 4（RAG 索引基准，无需数据集）**

```bash
cd TeacherAgent
python scripts/rag-index-benchmark.py > rag-index-benchmark.csv
```

> 该脚本**不接受命令行参数**，结果直接打印到 stdout（1536 维单位化向量、30 查询、前 3 次预热不计入）。表 3 的 Rust 原生实现耗时来自 `src-tauri` 内建 bench。

**表 5（100 题混合检索）**

```bash
cd experiments/hybrid_retrieval
python run_eval.py prepare                               # 复制运行时库为评测副本（不动线上库）
python run_eval.py --qa work/qa_100_human.jsonl embed    # 生成查询向量
python run_eval.py --qa work/qa_100_human.jsonl run      # 出排名与指标并归档
```

复算 100 题全口径指标（**不调用模型与向量服务**，由既有排名缓存重新聚合）：

```bash
cd experiments/submission_audit
python recompute_hybrid_100.py
```

> `--qa` / `--reps` / `--profile` 是**全局参数**，必须写在子命令**之前**。
> 运行时数据库默认为 `~/AppData/Roaming/com.teacheragent.app/teacher_agent.sqlite3`，可用环境变量 `TEACHER_AGENT_DB` 覆盖。

**表 6（ASSISTments）**

```bash
cd experiments/assistments
python pipeline.py prepare --raw <ASSISTments 官方 CSV 路径>    # 抽出稀疏子集
python pipeline.py features --subset work/sparse_assist_200.parquet   # 合成 FB-BKT 输入特征
python run_eval.py --features work/features_assist_200.parquet
```

> `pipeline.py smoke` 可用合成数据跑通全链路（**非论文数据**）。
> `run_eval.py --smoke` 为单折快速自检；`--skip-dkt` 跳过 DKT 对照。

**表 7（EdNet-KT1 四配置对照）**

```bash
cd experiments/ednet_kt1/data_prep
python materialize_kt1.py --users 20000 --tag subA                # 物化用户序列
python build_features_ednet.py --raw <物化输出> --users 20000 --kc-mode first_tag --tag first_tag_20000u

cd ../..
python run_eval.py --features <features 路径> --label fb-bkt-ednet-kt1
python fit_bkt_cv_fair_baseline.py --queue all --label bkt-fitted-cv-ednet
python run_eval_batched_dkt.py --features <features 路径> --label ednet-kt1-batched
```

> `materialize_kt1.py` / `profile_kt1.py` 读取的 EdNet-KT1 压缩包路径默认为 `~/Downloads/EdNet-KT1.zip`，可用环境变量 `EDNET_KT1_ZIP` 覆盖。

**表 8（因素消融）**

```bash
cd experiments/ednet_kt1
python ablation.py --dataset ednet --features <EdNet features 路径> --tag fb-bkt-ednet-kt1-ablation
python ablation.py --dataset assistments --features <ASSISTments features 路径> --tag fb-bkt-assistments-200-ablation
```

**表 9（DKT 超参扫描）**

```bash
cd experiments/ednet_kt1
python dkt_hyperparam_scan.py --features <EdNet features 路径> --label ednet-kt1-dkt-scan
```

**表 10 / 表 11（同步链路与协议鲁棒性）**

```bash
cd TeacherAgent
python scripts/sync-benchmark.py robustness                 # 表 11：异常输入正确拒绝/漏放统计
python scripts/sync-benchmark.py pairing --rounds 10        # 表 10：配对→快照确认端到端耗时
python scripts/sync-benchmark.py scale                      # 表 10：不同规模快照体积与上报耗时
```

> 可用子命令：`pairing` / `scale` / `robustness` / `proposal` / `observe` / `all`。
> 真机口径需要桌面端同步服务在局域网内运行（`--host` / `--port` 可指定）。

## 三、数据集获取

原始数据集**不随本仓库分发**（许可与体积原因）。下载地址、预处理步骤与校验值见 `data/README.md`。

## 四、目录结构

| 路径 | 内容 |
|---|---|
| `assistments/` | ASSISTments 数据集上的 FB-BKT 评测：`pipeline.py`（`prepare`/`features`/`smoke` 三个子命令）与 `run_eval.py`（逐折评测） |
| `ednet_kt1/` | EdNet-KT1 上的知识追踪评测：`run_eval.py`（BKT/FB-BKT 对照）、`run_eval_batched_dkt.py`（DKT 对照）、`fit_bkt_cv_fair_baseline.py`（五折交叉验证拟合基线）、`dkt_hyperparam_scan.py`（DKT 超参扫描）、`ablation.py`（因素消融）；`data_prep/` 为语料与特征构建脚本 |
| `hybrid_retrieval/` | 私有文档混合检索的 100 题评测：`run_eval.py`（`prepare`/`build-qa`/`embed`/`run`/`all`）、`build_annotation_pack.py`、`merge_annotations*.py`（人工与 LLM 标注合并）、`build_chunk_vectors_eval.py` |
| `submission_audit/` | 投稿前复核脚本：BKT 五折拟合复核、100 题混合检索复算、清单修复 |
| `paper_benchmark_summary/` | 上述评测的**脱敏汇总结果**（CSV/JSON），含每个归档的来源说明，见该目录 README |

## 五、范围说明

本目录**不含**以下内容，请勿在此查找：

- **数据集与模型权重**：ASSISTments / EdNet-KT1 原始数据、bge-m3 权重、向量索引与运行时数据库均不入库，仅在本地评测环境中存在；
- **原始逐题标注与私有切片引用**：包含学习者私有文档标识的中间产物不入库；
- **检索融合策略的比较研究**：该部分属另一篇独立工作，未包含在本次快照内。

## 六、运行环境

评测脚本按本地 Python 运行，主要依赖 `numpy`、`sqlite3`（FTS5）、`torch`（GPU 编码）与 `jieba`（词级倒排）。除少量可被环境变量覆盖的默认路径外，脚本不含硬编码的本机绝对路径。

## 七、口径提示

- 混合检索评测同时给出 `overall_100`（全 100 题，无候选题的 7 题按未命中计入）与 `conditional_93`（仅有候选题，93 题）两套口径。两套数字**不可混用**，引用时须标明口径。
- 候选池覆盖率为 93/100 = 93%，与条件口径的检索质量是两个不同指标。
- 标注为「2 名真人 + 3 个 LLM 等权多数票」，**不是纯人工金标准**。
- 训练折上拟合的 BKT 参数改善了 RMSE，但未使 AUC 超过固定先验 BKT；该负结果如实保留。

## 八、引用本快照

论文实验对应本仓库的 **tag `paper-v1.0`**（位于 branch `experiments-public-benchmark` 上）。

**引用时请优先使用 tag 而非分支名**——tag 不会移动，可长期复现；分支名可能随后续修订指向更新的提交。该分支历史**不重写、不 force-push**，tag `paper-v1.0` 对应的提交内容永久固定。

若需从本快照直接取用：

```bash
git clone --branch paper-v1.0 --depth 1 https://github.com/xuzeTop1/Teacher.git
# 目录结构：TeacherAgent/（桌面端 + 本文实验）  AlertTime/（手机端）
```
