# 知识追踪基线实验 · 状态与口径

> 最后更新：2026-09-17（收尾跨至 09-18 凌晨）
> 本文是**知识追踪基线这一块的状态说明**，权威数字一律以归档目录里的
> `kt1_5fold_table.md` / `kt1_5fold_summary.json` 为准，本文不复述数字以免两处不一致。

## 一、结论一句话

知识追踪基线谱系已补齐为 **BKT → FB-BKT → DKT → AKT → DKVMN**，
五类代表路线（概率图 / 特征增强概率图 / RNN / 注意力 / 记忆网络）全覆盖，
足以回应「怎么只和两个已有模型比」的质疑。**不再扩充模型**——继续加
SAKT / SAINT+ / GKT 的边际收益很低，且会把论文推向「KT benchmark」而不是多端智能辅导系统。

### 最终锁定结果（统一训练协议，5 折学生级交叉验证）

| 模型 | 族 | 参数量 | AUC (mean ± std) | ACC | RMSE |
|---|---|---:|---|---:|---:|
| BKT | 概率图模型 | — | 0.5602 ± 0.0013 | 0.5213 | 0.5023 |
| FB-BKT | 概率图模型（特征增强） | — | 0.5444 ± 0.0017 | 0.5109 | 0.5063 |
| DKT (hidden=100) | RNN / LSTM | 98,101 | **0.7006 ± 0.0012** | 0.6486 | 0.4665 |
| AKT-NR (256, 1e-4) | 注意力 / Transformer | 1,220,633 | 0.6766 ± 0.0021 | 0.6311 | 0.4729 |
| DKVMN (memory=50) | 记忆网络 | **22,451** | **0.7003 ± 0.0009** | 0.6484 | 0.4666 |

**可写的结论**：DKVMN 以 DKT 约 **1/4.4 的参数**达到与 DKT **统计上不可区分**的性能
（配对差值 −0.0003，95% CI [−0.0013, +0.0007]）；AKT-NR 明显低于前两者
（vs DKT −0.0240，5/5 折同向），该缺口量级与原论文实测的「Rasch 题目嵌入贡献」
（ASSISTments2009 +0.018、2017 +0.042）相符，可归因于 EdNet-KT1 不含题目 ID。

**不可写的结论**：DKVMN「优于」或「显著优于」DKT（协议统一后二者已不可区分，见第六节）。

> 权威数字以归档 `20260918-020722-ednet-kt1-firsttag-20000u-kt-5fold-merged/` 内的
> `kt1_5fold_table.md` 与 `kt1_5fold_summary.json` 为准。

## 二、数据集与评估口径（三个神经模型完全一致）

| 项目 | 取值 |
|---|---|
| 数据 | EdNet-KT1 队列，`experiments/ednet_kt1/work/features_ednet_20000.parquet` |
| 规模 | 20,000 学生 / 1,031,844 响应 / 142 个知识概念（KC） |
| 划分 | `run_eval.student_folds(seed=42)` 学生级 5 折 |
| 验证集 | 每折训练池内部 10%，`run_eval.split_train_val(train_pool, 0.1, seed=H.SEED+fold)` |
| 指标 | `run_eval.metrics` 的 AUC / ACC / RMSE（全流程同一实现，无第二套 AUC） |
| 随机种子 | `H.SEED = 42`；每个 (模型, 配置, 折) 任务独立播种，与并发度无关 |

## 三、最终采用的训练协议（已统一，消除预算不对称）

**DKT / AKT-NR / DKVMN 三者逐字相同：**

- 优化器 Adam，损失 `BCELoss(masked)`，批大小 128，长度分桶
- 最大 epoch 上限 300（各模型相同）
- **逐轮**在验证集上计算 AUC；`patience = 20`、`min_delta = 1e-5`
- **保存验证集最佳轮次的权重**，并用它评估测试折
- **测试折只评估一次**

> 动机：首轮结果里 DKT / DKVMN 是「固定 50 轮、无早停、报第 50 轮 checkpoint」，
> 而 AKT 是「验证集早停 + 用最优 checkpoint」。后者在训练预算与 checkpoint 选择上
> 都占优，构成口径不对称。现在三者都改为「是否停止由验证集决定」，
> 且都以验证集最佳轮次评估测试折。**不再存在某个模型固定拿第 N 轮 checkpoint 的情况。**

允许并已声明的差异（写入归档 `summary.json`，不隐藏）：

- 各模型超参网格仍沿用原先「先声明后执行」的那一套，不因本次统一而调整；
- AKT 无法使用 Rasch 题目嵌入（EdNet-KT1 不含题目 ID），只能跑 **AKT-NR**，
  属数据集限制而非调参取舍。

## 四、超参网格与主结果配置

| 模型 | 声明网格 | 正文 headline |
|---|---|---|
| DKT | hidden ∈ {64,100,200} × lr ∈ {1e-3,3e-3}（6 组） | hidden=100, lr=1e-3 |
| AKT-NR | d ∈ {256} × lr ∈ {1e-5,1e-4}（2 组） | d=256, lr=1e-4 |
| DKVMN | memory ∈ {50,200} × lr ∈ {1e-3,3e-3}（4 组） | memory=50, lr=1e-3 |

AKT 网格说明：原论文（arXiv:2007.12324 §4.1）嵌入维度候选为 {256,512}、
Adam 学习率候选为 {5e-6,1e-5,1e-4}、max 300 epoch 并以验证集早停。
本队列仅 142 个 KC，d=512 属明显过参数化（且同队列 DKT 扫描显示容量越大越差），
故取 d=256；lr 取上两档。**正文只引先验配置，不做 best-of-grid 挑选。**

## 五、被排除的实验（记录在案，不参与任何结论）

| 实验 | 状态 | 排除原因 |
|---|---|---|
| 首轮 AKT 网格 `(128, 1e-3)` / `(128, 3e-3)` | **8/20 后主动停止** | **口径失配**：该网格沿用 DKT 配方（lr ∈ {1e-3,3e-3}、50 轮、无早停），学习率比原论文上界（1e-4）高一个量级、训练轮数只有 1/6。发现后立即停止并改用论文口径重跑。 |
| 同上，`(128, 3e-3)` | 3/5 折 | 与上面同因，未跑完即停 |

**英文表述（可直接用于论文的实验记录/回复审稿人）：**

> Preliminary AKT ablation runs were terminated after identifying a protocol mismatch
> and were excluded from all reported comparisons.

注：该消融的 `(128, 1e-3)` 五折均值 0.6596，修正口径后为 0.6766（+0.0170），
可作为「口径失配代价」的量化证据保留在归档里，但**不得用于支持任何关于 AKT 能力的结论**。

## 六、统计表述红线（务必遵守）

- 5 折精确置换检验只枚举 2^5 = 32 种符号组合，**p 的最小可达值是 0.0625，
  任何模型都达不到 p < 0.05**。这是设计属性，不是某个模型的问题。
- **在统一训练协议下 DKT 与 DKVMN 已统计上不可区分**（见下表）：它们的折级配对差值为
  −0.0003，95% CI [−0.0013, +0.0007]，仅 3/5 折同向，**区间跨 0**。
- 因此正文**不得**写「DKVMN 优于 DKT」或「显著优于 DKT」。允许的表述是
  **「DKVMN 以约 4.4 分之一的参数达到与 DKT 相当的性能」**（容量效率，而非性能优势）。
- 需要体现差异时，一律用 **95% CI** 与 **「k/5 折同向」** 表述。
- 具体差值、CI 与折同向数见归档 `kt1_5fold_summary.json` 各模型的
  `deltaVsDkt` / `pairedVsDkt` 字段；`merge_kt_table.py` 会**从数据生成**这句表述，
  不会硬编码，避免协议变动后结论悄悄失效。

### ⚠️ 协议统一后结论发生了翻转（本次最重要的发现）

| 模型 | 旧口径（固定 50 轮、报第 50 轮） | 统一口径（验证集早停、报最佳轮次） | 变化 |
|---|---|---|---|
| DKT (hidden=100) | 0.6958 | **0.7006 ± 0.0012** | **+0.0048** |
| DKVMN (memory=50) | 0.6993 | **0.7003 ± 0.0009** | +0.0010 |

- 旧口径下 DKVMN 领先 DKT **+0.0035 且 5/5 折同向**，看起来是一个干净的优势结论；
- 统一口径后差值变成 **−0.0003、3/5 折同向、CI 跨 0** ⇒ **那个「优势」是不对称协议造出来的假象**。
- 根因：DKT 的验证集最佳轮次只有 **24–35 轮**，而旧协议强迫它训到第 50 轮，
  等于**训过了最优点再交一个更差的 checkpoint**；DKVMN 最佳轮次 61–127 轮，受影响小。
- 教训：**任何跨模型的 checkpoint 选择规则不一致，都会系统性地偏向某一方**；
  这类偏差不会体现在单个模型的方差里，只能靠统一协议消除。
- 归档 ID（最终锁定）：`benchmark-results/20260918-020722-ednet-kt1-firsttag-20000u-kt-5fold-merged/`

### 跨数据集对照表 DKT 列的四切片对齐（2026-09-18 上午补跑）

论文的 EdNet 跨数据集对照表按「标注方式 × 用户数」列出四个切片，每个切片只报一个 DKT 值
（先验配置 hidden=100、lr=1e-3）。这些值原为固定 50 轮、无早停的旧协议，与统一协议下的
first_tag-20000u 不可混排，故用 `run_dkt_slices_unified.py` 按统一协议只补先验配置
（4 切片 × 5 折 = 20 个任务，约 10 分钟）：

| 切片 | DKT AUC | BKT AUC | 相对 BKT |
|---|---|---|---|
| first_tag 2000 | 0.688091 | 0.561478 | +0.126613 |
| first_tag 20000 | 0.700604 | 0.560210 | +0.140394 |
| single_tag 10000 | 0.639630 | 0.552377 | +0.087253 |
| part 20000 | 0.679980 | 0.614398 | +0.065582 |

⇒ 四切片相对增益区间 **+0.0656～+0.1404**，论文口径 **0.066～0.140**（取代旧协议的 0.065～0.136）。

附：ASSISTments 稀疏 200 用户子集上，统一协议下 DKT 为 0.677282，仍**低于**同数据集的
Standard BKT（0.695519），差值 −0.018237 —— 与论文原有结论方向一致，该小样本子集上深度模型不占优。

## 七、内部性能记录（**不进准确率主表**）

主表全部为 FP32。以下为 RTX 4060 Laptop（8 GB, Ada SM89）上的实测加速，
仅供「训练效率」小节或复现性说明使用；若将来专门写效率实验，
必须让所有相关神经模型在同一精度口径下统一重跑：

| 手段 | 实测加速 | 备注 |
|---|---|---|
| 多进程并发（`--jobs`） | 1.53x（AKT 2 进程） | 不改数值，已用于正式实验 |
| AMP（fp16 自动混合精度） | 约 1.27x | 改数值精度，**未采用** |
| TF32 | 约 1.13x | 改数值精度，**未采用** |
| `torch.compile` | **1.00x（无收益）** | 且需 `triton-windows`；本次已卸载 |

## 八、复现命令

```bash
cd D:\TeacherAgent-alerttime-json\experiments\ednet_kt1
PY="C:\Users\Acer\AppData\Local\Programs\Python\Python312\python.exe"

# 1) DKT + DKVMN，统一早停协议（两者共用一个归档）
"$PY" kt_unified_earlystop.py --features work/features_ednet_20000.parquet \
      --models dkt,dkvmn --jobs 3 --label ednet-kt1-firsttag-20000u-ktsym-earlystop

# 2) AKT 论文口径（max 300 epoch + 验证集早停）
"$PY" akt_paper_protocol.py --features work/features_ednet_20000.parquet \
      --jobs 2 --label ednet-kt1-firsttag-20000u-akt-paper-5fold

# 3) 并表出论文用表（幂等，可重复执行）
"$PY" merge_kt_table.py
"$PY" merge_kt_table.py --status     # 只看进度，不写文件
```

概率模型（BKT / FB-BKT）与旧的 DKT 基线归档：
`benchmark-results/20260914-232621-ednet-kt1-firsttag-20000u-batched-dkt/`（只读，不再改动）。

## 九、文件地图

**论文复现所需（保留在仓库）：**

- `experiments/ednet_kt1/run_eval.py`、`run_eval_batched_dkt.py` —— 数据、划分、指标、DKT 实现（**只读**，其他归档依赖）
- `experiments/ednet_kt1/kt_deep_baselines.py` —— AKT / DKVMN 模型类、旧网格（消融）
- `experiments/ednet_kt1/akt_paper_protocol.py` —— AKT 论文口径
- `experiments/ednet_kt1/kt_unified_earlystop.py` —— DKT / DKVMN 统一早停
- `experiments/ednet_kt1/merge_kt_table.py` —— 并表（正文用表）
- `experiments/ednet_kt1/dkt_hyperparam_scan.py` —— DKT 6 组扫描（旧口径，留作对照）
- `tools/archive_debug_artifacts.py` —— 诊断产物归档工具

**开发期诊断产物（本地保留、不推仓库）：**

- `internal_debug_archive/2026-09-17-kt-earlystop-and-optimization/`
  —— 含全部 profiling 探针、并发/编译/内存实测脚本、日志，以及被取代的 `RESUME.md`。
  清单见该目录下 `archive_manifest.csv`（含 SHA-256，可回滚）。
- `internal_debug_archive/superseded-merged-tables/`
  —— 三个重跑前的合并表（协议未统一，结论已被推翻）与一个重复生成的表。
  **它们含已被证伪的「DKVMN 优于 DKT」结论，禁止引用**；清单见 `move_manifest.csv`。
  `benchmark-results/` 下只保留一个锁定版合并归档，避免误引。

注：`experiments/ednet_kt1/work/` 早已在 `.gitignore` 中，
其下的 parquet 数据文件与 IPC 临时目录不会进入版本库。
