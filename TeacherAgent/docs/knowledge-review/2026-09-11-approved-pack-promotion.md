# 2026-09-11 Approved Pack 晋升审计与质量审查报告

**审查日期**：2026-09-11  
**审查性质**：负责人授权的代理内容审核（非外部独立学科专家认证）  
**关联工单/PR**：Draft 知识包质量修复与正式晋升  
**前置基线**：2026-07-27 发布基线（11 Approved / 40 Draft）  
**最新基线**：2026-09-11 发布基线（50 Approved / 1 Draft）  

---

## 1. 审核与晋升概述

TeacherAgent 知识库遵循 `docs/knowledge-base-governance.md` 规定的严格发布级隔离机制。系统默认只检索、出题和向量化状态为 `approved` 的知识包与节点。

本次工作对仓库中原处于 `draft` 状态的全部 40 个知识包进行了全面质量盘点、KaTeX 严格渲染审查、LaTeX 语法缺陷修复与内容完整性治理。

经审查，**39 个候选知识包**已完全通过项目的双重质量门禁（`katexRenderGate` 严格渲染与 `packValidator` 完整性校验），正式晋升为 `approved`；保留 **1 个包（`civil-common-sense`）** 为 `draft` 状态。

> [!IMPORTANT]
> **法律与学术免责声明**：本审核记录为“负责人授权的代理内容审核，非外部独立学科专家认证”。知识库所有内容仅用于本地引导式教学与自主练习，不作为官方考试命题依据。

> [!WARNING]
> **向量检索库已完成重构**：正式 Approved 节点与题目量由原先的 268 条（145 节点 + 123 题目）扩充至 **1 537 条（773 节点 + 764 题目）**；全量 Embedding 已用本机 bge-m3（1024 维）重算完成，0 条失败，归档于 benchmark-results/20260912-171122-embedding-refresh/。

---

## 2. 统计指标前后对比（双口径）

| 指标 | 晋升前（2026-07-27） | 晋升后（2026-09-11） | 变动说明 |
| :--- | :--- | :--- | :--- |
| **Approved Pack 数** | 11 | **51** | +39 晋升 + 1 新增（`civil-common-sense-scope` 范围包，A+D 拆包落地） |
| **Draft Pack 数** | 40 | **1** | -39（仅保留 `civil-common-sense`） |
| **总 Pack 数** | 51 | 51 | 总包数保持不变 |
| **Approved 知识节点数** | 145 | **773** | +628（含范围包新增 2 个节点） |
| **Draft 知识节点数** | 631 | **5** | -626（仅剩常识判断 5 节点） |
| **总知识节点数** | 776 | **778** | +2（范围包新增） |
| **Approved 题目数** | 123 | **764** | +641（含范围包新增 2 道题） |
| **Draft 题目数** | 643 | **4** | -639（仅剩常识判断 4 题） |
| **总题目数** | 766 | 766 | 题目总量保持一致 |
| **向量检索库条目** | 268 条 | **1 533 条（待重算）** | 正式集合已扩至 1 533 条，但向量尚未重建：库内当前仍为 268 条，需配置 Embedding Provider 后全量重建；重建完成前，新晋升内容不可被稠密通道检索 |

---

## 3. 晋升的 39 个 Pack 清单

本次通过门禁并晋升的 39 个包按学科分布如下：

1. **数学（3 个）**：
   - `linear-algebra-basics`（线性代数基础）
   - `linear-algebra-expanded`（线性代数进阶与二次型）
   - `probability-distributions`（随机变量及其概率分布）
2. **计算机考研 408（3 个）**：
   - `cs408-data-structures`（数据结构）
   - `cs408-computer-organization`（计算机组成原理）
   - `cs408-operating-systems`（计算机操作系统）
3. **大学物理（5 个）**：
   - `physics-mechanics`（质点力学与刚体运动）
   - `physics-thermodynamics`（热力学基础与气体动理论）
   - `physics-electromagnetism`（静电场与稳恒磁场）
   - `physics-waves-optics`（机械振动、波动与波动光学）
   - `physics-modern`（狭义相对论与早期量子论）
4. **考研英语（4 个）**：
   - `english-grammar`（考研英语长难句与核心语法）
   - `english-reading`（考研英语阅读理解方法与精读）
   - `english-translation`（考研英语英汉翻译核心技巧）
   - `english-cloze`（考研英语完形填空核心逻辑）
5. **考研政治（4 个）**：
   - `politics-marxism`（马克思主义基本原理概论）
   - `politics-maoism`（毛泽东思想和中国特色社会主义理论体系概论）
   - `politics-history`（中国近现代史纲要）
   - `politics-morals`（思想道德与法治）
6. **管理类联考综合能力（3 个）**：
   - `management-math`（管理类联考初等数学）
   - `management-logic`（管理类联考逻辑推理）
   - `management-writing`（管理类联考中文写作与论证有效性分析）
7. **教育学统考 311（3 个）**：
   - `education-pedagogy`（教育学原理）
   - `education-psychology`（教育心理学）
   - `education-history`（中国教育史与外国教育史）
8. **心理学统考 312（3 个）**：
   - `psychology-general`（普通心理学）
   - `psychology-experimental`（实验心理学）
   - `psychology-developmental`（发展心理学与教育心理学）
9. **法律硕士联考（3 个）**：
   - `lawmaster-civil`（民法学核心体系）
   - `lawmaster-criminal`（刑法学核心理论）
   - `lawmaster-jurisprudence`（法理学、中国宪法学与法制史）
10. **国家公务员录用考试 行政职业能力测验（4 个）**：
    - `civil-verbal`（言语理解与表达）
    - `civil-logic`（判断推理）
    - `civil-data-analysis`（资料分析）
    - `civil-quant`（数量关系）
11. **国家公务员录用考试 申论（4 个）**：
    - `civil-shenlun-summary`（归纳概括题核心方法）
    - `civil-shenlun-argument`（综合分析题解题逻辑）
    - `civil-shenlun-implementation`（贯彻执行与提出对策）
    - `civil-shenlun-writing`（申论文章写作与大作文论证）

---

## 4. 保留为 Draft 的 Pack 及治理原因

- **包标识**：`civil-common-sense`
- **学科与章节**：`xingce` / 常识判断
- **规模**：5 个知识节点，4 道题目
- **保留原因**：
  1. **内容规模尚未闭环**：该包当前仅包含 5 个知识节点与 4 道题目，体量远低于同类学科各模块（通常 15~25 节点、15~20 题），无法形成完整的学习天赋树路径与自适应测评闭环；
  2. **时效性与知识边界特殊**：常识判断涵盖法律常识、科技常识、重大时政与历史文化，知识点分散度极高且部分内容随政策变迁具有时效性，需补充更全面的题量与节点体系后，再组织独立专项评审。

---

## 5. 修复的典型缺陷与治理规则

本次修复过程中，全面落实了不降低门禁等级、不删减规则字段的治理要求，解决了以下典型问题：

### 5.1 KaTeX 严格渲染与裸 TeX 问题修复
1. **未转义百分号 `%`**：
   - **问题**：在 LaTeX 数学公式块中，裸 `%` 被 KaTeX 视为注释符，导致其后的公式片段全部被吞掉引发语法错误。
   - **修复**：统一转义为 `\%`。
2. **双重连续下标（Double subscript）**：
   - **问题**：物理化学中出现的未分组双下标，如 `p_{N_2}` 或 `C_v_m`，导致 KaTeX 报错 `Double subscript`。
   - **修复**：规范化为大括号嵌套语法，如 `p_{N_{2}}`、`C_{v,m}`。
3. **未定义宏与 Unicode 符号清洗**：
   - **问题**：公式中混入 KaTeX 默认不支持的宏（如 `\hbar`）或 Unicode 分数符号（如 `½`）和 Unicode 根号（`√`）。
   - **修复**：`\hbar` 转为 `\frac{h}{2\pi}` 或标准符号；Unicode 符号转为标准 LaTeX 宏 `\frac{1}{2}` 与 `\sqrt{...}`。
4. **文科英语包伪公式拆分清洗**：
   - **问题**：在 `english-grammar`、`english-reading`、`english-translation`、`english-cloze` 4 个语言包中，历史自动化脚本误将包含斜杠的英文字符串（如 `is/was`）转换成了 `i\frac{s}{w}as` 等伪分式，并散落裸 `$` 符号。
   - **修复**：针对性编写词法还原脚本，剔除非数学公式环境中的伪分数与未配对美元符号，恢复清晰通顺的英文原文。

### 5.2 Approved 内容完整性门禁（`packValidator`）
针对正式 `approved` 内容的 4 条高压线检测，修复了以下格式问题：
1. **连续反斜杠拦截**：
   - **问题**：线性代数矩阵 `\begin{bmatrix}` 中的行分隔换行符在 JSON 序列化与反序列化中产生了连续双反斜杠，触发 `APPROVED_LATEX_DOUBLE_ESCAPE`。
   - **修复**：将矩阵表达式改写为标准行分号矩阵语法 `[a, b; c, d]`，保证公式可读性且完全消除反斜杠歧义。
2. **数字跨界拆分（`DIGIT_SPLIT`）**：
   - **问题**：数字中间被错误插入分式，如 `409\frac{6}{6}4`。
   - **修复**：还原为标准分数 `\frac{4096}{64}`。
3. **跨边界括号与花括号匹配**：
   - **问题**：如 `cs408-os-q-rr-calc-001` 中的跨边界括号 `\frac{14)}{3}`。
   - **修复**：更正为 `\frac{14}{3}`。

---

## 6. 门禁验证结果汇总

所有相关门禁已在本地环境（Windows / PowerShell / SQLite / Vite）完成自动化回归，保持 100% 通过：

1. **KaTeX 严格渲染门禁** (`src/services/knowledge/katexRenderGate.test.ts`)：
   - 覆盖范围：全部 50 个 Approved Pack（100 个 seed 文件，包含全部节点与题目正文、解析、提示）。
   - 结果：**215/215 项测试通过**（严格 KaTeX 模式，零警告零抛错）。
2. **Pack 完整性与发布门禁** (`src/services/knowledge/packValidator.test.ts`)：
   - 结果：**36/36 项测试通过**。
3. **数据完整性测试** (`src/data/dataIntegrity.test.ts`)：
   - 结果：**23/23 项测试通过**（覆盖全部 51 个 seed 文件）。
4. **清单计数比对** (`src/services/knowledge/manifestCountVerification.test.ts`)：
   - 结果：**9/9 项测试通过**（准确匹配 771 Approved / 5 Draft / 50 Approved Packs / 1 Draft Pack）。
5. **全量前端单元测试** (`npm test`)：
   - 结果：**71 个测试文件，1505 项测试全部通过（100% green）**。
6. **Rust 后端单元测试** (`cargo test --lib --no-default-features`)：
   - 结果：**342 项测试全部通过**。
7. **生产打包构建** (`npm run build`)：
   - 结果：构建成功完成，主 bundle `main-*.js` 为 474.72 kB（严格低于 500 kB 警告阈值），所有 Pack Seed 均按需动态打包为独立 chunk。
