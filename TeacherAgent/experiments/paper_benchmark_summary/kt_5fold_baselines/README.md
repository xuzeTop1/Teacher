# kt_5fold_baselines

EdNet-KT1 上**五类知识追踪模型**在同一训练协议下的 5 折学生级交叉验证结果汇总。

## 内容

| 文件 | 内容 |
|---|---|
| `table.md` | 论文用对照表（Markdown，含表下口径说明与统计表述红线） |
| `summary.json` | 完整记录：逐折 AUC/ACC/RMSE、参数量、验证集最佳轮次、与 BKT/DKT 的折级配对检验、模型配置与来源归档、协议元信息 |

**本包不含 CSV**（按分发约定以 JSON + Markdown 呈现）；亦不含原始数据集、嵌入权重或逐序列中间产物。

## 来源归档

- 任务级归档：`benchmark-results/20260917-235517-ednet-kt1-firsttag-20000u-ktsym-earlystop/`（DKT 30 个任务 + DKVMN 20 个任务）
- 任务级归档：`benchmark-results/20260917-213852-ednet-kt1-firsttag-20000u-akt-paper-5fold/`（AKT-NR 10 个任务）
- 合并归档：`benchmark-results/20260918-020722-ednet-kt1-firsttag-20000u-kt-5fold-merged/`（本包的 `table.md` / `summary.json` 即取自该归档）
- 概率图模型基线：`benchmark-results/20260914-232621-ednet-kt1-firsttag-20000u-batched-dkt/results.csv`（只读，未改动）

（上述 `benchmark-results/` 归档本身不入库，仅以名称回溯。）

## 数据集口径

EdNet-KT1，20 000 用户，KC 定义 `first_tag`，1 031 844 条作答，142 个知识概念，序列长 30–80（中位数 50）。

## 关键口径

1. **五个模型共用同一训练协议**：学生级 5 折（seed=42）；每折训练池内 10% 作验证集（seed=`H.SEED + fold`）；批大小 128；Adam；掩码 BCELoss；长度分桶；最大 300 轮，逐轮计算验证集 AUC，`patience=20`、`min_delta=1e-5`，保存验证集最佳轮次权重；**测试折只评估一次**。不存在「某模型固定取第 N 轮 checkpoint、另一模型可选最优 checkpoint」的不对称。
2. **AKT 只能使用无 Rasch 变体（AKT-NR）**：EdNet-KT1 不含题目标识，题目难度参数与题目变化向量无从估计。
3. **超参口径**：DKT 取先验配置 hidden=100、lr=1×10⁻³；AKT 按原论文（arXiv:2007.12324）取 d=256、lr=1×10⁻⁴、max 300 轮 + 验证集早停；DKVMN 取 memory=50、lr=1×10⁻³。均为**先验声明配置**，不是 best-of-grid 挑选结果。
4. **配对检验的 p 值下限为 0.0625**：5 折精确置换检验仅枚举 2⁵=32 种符号组合，任何模型都达不到 p<0.05。因此 DKVMN 与 DKT 的差异**只能据 95% CI 与折同向数表述，不得写作「显著优于」**。
5. **已废止的早期结果不在此包内**：首轮 AKT 网格（lr∈{1×10⁻³,3×10⁻³}、50 轮、无早停）与原论文口径不符，发现后即终止并排除，未参与任何对照。相关说明见 `TeacherAgent/experiments/ednet_kt1/EXPERIMENT_STATUS.md`。
6. **原先的 DKT 超参扫描（`dkt_hyperparam_scan/`）为固定轮次协议**，与本包统一早停协议下的 DKT 数字**不可混用**；本包 `table.md` 中的 DKT 行取自统一协议重跑。

## 复现

生成脚本（位于 `TeacherAgent/experiments/ednet_kt1/`）：

```bash
cd TeacherAgent/experiments/ednet_kt1

# DKT + DKVMN，统一早停协议（两者共用一个归档）
python kt_unified_earlystop.py --features <EdNet features parquet> \
       --models dkt,dkvmn --jobs 3 --label ednet-kt1-ktsym-earlystop

# AKT 论文口径（max 300 epoch + 验证集早停）
python akt_paper_protocol.py --features <EdNet features parquet> \
       --jobs 2 --label ednet-kt1-akt-paper-5fold

# 并表出论文用表（幂等，可重复执行；--status 只看进度不写文件）
python merge_kt_table.py
python merge_kt_table.py --status
```

特征文件的构建方式见 `../README.md` 的「表 7」一节与 `../data/README.md`。

## 校验

各文件 SHA-256 见 `../SHA256SUMS.txt`。
