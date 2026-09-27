# 数据集获取与许可边界

本目录说明论文实验所用**第三方公开数据集**的获取方式、许可条款与预处理步骤。

## ⚠ 许可边界（重要）

本仓库**不重新分发任何原始数据集**。原因是两个数据集均带有独立的使用条款，再分发会越权：

- 原始数据集体积大（EdNet-KT1 压缩 1.2 GB / 解压 5.6 GB），不适合放入 Git 仓库；
- 两个数据集都要求使用者自行下载并在论文中给出**指定的引用与 URL**；
- 部分数据含学习者行为记录，再分发会引入额外的隐私与合规风险。

因此本仓库只提供：**下载渠道说明 + 预处理脚本 + 期望统计值（可用于校验下载是否完整、预处理是否一致）**。

## 一、ASSISTments 2009-2010 Skill Builder

| 项 | 值 |
|---|---|
| 数据集 | ASSISTments 2009-2010 Skill Builder |
| 下载页面 | https://sites.google.com/site/assistmentsdata/home/2009-2010-assistment-data/skill-builder-data-2009-2010 |
| 期望文件名 | `skill_builder_data.csv` |
| 实测规模 | 525,534 行 / 4,217 名学生 / 123 个技能 |
| 许可 | 由 ASSISTments 官方页面条款约束（研究用途）；**使用须在论文中给出上述 URL** |

**必须引用**：

> Feng, M., Heffernan, N.T., & Koedinger, K.R. (2009). Addressing the assessment challenge in an Intelligent Tutoring System that tutors as it assesses. *User Modeling and User-Adapted Interaction*, 19, 243-266.

**用法**：

```bash
cd experiments/assistments
mkdir -p raw && cp <下载的 skill_builder_data.csv> raw/
python pipeline.py prepare  --raw raw/skill_builder_data.csv
python pipeline.py features --subset work/sparse_assist_200.parquet
python run_eval.py --features work/features_assist_200.parquet
```

**预处理注意（脚本已实现，此处说明口径）**：

1. **该数据集不含绝对时间戳**。`first_action` 取值仅 0–2（非时间）；唯一的时间信号是全局递增的 `order_id`（20,224,085 → 38,310,202）。Δt 由 `order_id` 增量 × 标定系数推算，标定系数取 **1.31 s/单位**（推导：跨度 18,086,117 单位覆盖约 275 个自然日，≈23.76 M 秒）。脚本内置 ±2 倍系数的敏感性检查。
2. **原始文件含重复记录**（官方页面已提示）。脚本对 `(user_id, order_id)` 去重，实测 **34.0% 的行是重复**，去重计数写入 meta。
3. **`rFocus` / `N_distract` 是按规则由作答间隔合成的行为代理**（≥5 分钟视为一次中断），**不是真实端侧观测**。论文中必须如实表述为代理变量。
4. 稀疏子集筛选：每生 30–80 次作答，目标 200 名学生。

## 二、EdNet-KT1

| 项 | 值 |
|---|---|
| 数据集 | EdNet-KT1（Riiid Santa 平台解题交互序列） |
| 下载入口 | GitHub: https://github.com/riiid/ednet （README 内链 `bit.ly/ednet_kt1`） |
| 期望文件名 | `EdNet-KT1.zip` |
| 压缩 / 解压体积 | 1.2 GB / 5.6 GB |
| 文件数 | 784,309 个 `{user_id}.csv` |
| 许可 | **CC BY-NC 4.0**（署名—非商业性使用 4.0 国际）——仅限研究用途 |

**必须引用**：

> Choi, Y., Lee, Y., Cho, J., Baek, J., Kim, B., Cha, Y., Shin, D., Bae, C., & Heo, J. (2020). Towards an Appropriate Query, Key, and Value Computation for Knowledge Tracing. *Proceedings of the Seventh ACM Conference on Learning @ Scale*, 341-344. DOI: 10.1145/3386527.3405945

EdNet 数据集本身的介绍论文另见 arXiv:1912.03072（*EdNet: A Large-Scale Hierarchical Dataset in Education*）。

**数据格式（KT1）**：每个 `{user_id}.csv` 含 `timestamp` / `question_id` / `bundle_id` / `user_answer` / `elapsed_time` 等字段。**时间戳经过固定偏移处理**，非真实时间（官方出于安全考虑已移位），但同用户内的相对间隔有效。

**知识点标签**：需另外下载 **Contents**（`bit.ly/ednet-content`）中的 `questions.csv`，脚本从中读取 `tags` 与 `part` 字段。

**用法**：

```bash
# 1) 物化用户序列（默认读 ~/Downloads/EdNet-KT1.zip，可用 EDNET_KT1_ZIP 覆盖）
cd experiments/ednet_kt1/data_prep
python materialize_kt1.py --users 20000 --tag subA

# 2) 构建特征（需要 contents/questions.csv）
python build_features_ednet.py --raw <物化输出 parquet> --users 20000 \
    --kc-mode first_tag --kc-mode first_tag_20000u
```

**知识点口径（`--kc-mode`）**：

| 取值 | 含义 |
|---|---|
| `first_tag`（**主口径**） | 取 `tags` 的首个标签，与论文已有设定一致 |
| `single_tag` | 只保留单标签题，`skill` = 该唯一标签（剔除多标签歧义） |
| `part` | `skill` = TOEIC part(1..7)，粗粒度对照 |

**Δt 语义**：**同一知识点上次作答**的间隔（基于真实相对时间戳），与 `fb_bkt.rs` 的模型定义一致。注意：筛选发生在计算间隔**之前**，剔除行后需重算间隔才是正确的（脚本已按此顺序实现）。

## 三、校验建议

下载完成后建议核对以下统计，确保与本仓库结果可比：

- ASSISTments：`skill_builder_data.csv` 原始 525,534 行；去重后行数约为原始的 66%。
- EdNet-KT1：`EdNet-KT1.zip` 内应有 784,309 个 `.csv`；`profile_kt1.py` 可产出每用户作答数、时间跨度与间隔分布画像（`kt1_user_summary.csv`、`kt1_dataset_stats.json`）。

各脱敏结果文件的 SHA-256 见 `experiments/paper_benchmark_summary/SHA256SUMS.txt`。

## 四、不在本仓库中的内容

- 原始数据集压缩包与解压文件；
- 由原始数据派生的中间 parquet / jsonl（含逐用户行为序列）；
- 嵌入模型权重（bge-m3）与向量索引；
- 含私有文档标识的标注材料。
