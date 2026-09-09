# 考公（行测 / 申论）扩展治理规范

> 本文档是「考公」方向（行测 `xingce`、申论 `shenlun`）接入 TeacherAgent 的**专项治理规范**，
> 与 `src-patches/INTEGRATION_SPEC.md`（源码改动点）和 `data/`（9 个知识包 / 45 节点 / 32 题）配套。
>
> 定位：**本地优先（local-first）的引导式学习助手**，不是刷题网站、不接云账号、不做在线考试系统。

---

## 1. 范围与定位

| 维度 | 本扩展的做法 | 明确不做（non-goals） |
| --- | --- | --- |
| 形态 | 本地知识包 + 苏格拉底式引导 | 在线考试 / 自动组卷 / 自动判分 |
| 账号 | 不依赖任何云账号 | 云端同步 / 多用户协作 |
| 内容来源 | 公开大纲为锚、AI 起草、人工审核 | 把 Web 搜索结果直接混入正式包 |
| 申论产出 | 拆材料 / 列提纲 / 段落改写 / 结构辅导 | 默认整篇代写、精确实时作文评分 |
| 数据 | 包内自洽、来源可追溯、含 `review_status` | 复杂向量检索强依赖、外部训练服务 |

> 第一阶段覆盖：**行测**（言语理解 / 判断推理 / 资料分析 / 数量关系 / 常识判断）+
> **申论**（归纳概括 / 综合分析 / 提出对策 / 贯彻执行 / 大作文）。

---

## 2. subject code 设计

采用两个独立 code，便于意图路由、欢迎语、图谱、仪表盘各自可测、零侵入既有学科：

- `xingce` ＝ 行测（行政职业能力测验）
- `shenlun` ＝ 申论

UI 上二者归入同一中文分类「考公」（`SUBJECT_CATEGORY`），**不向用户暴露英文 subjectCode**。
（若团队更希望单一 `civil_service` 伞代码 + `track` 维度，仅需把 `xingce`/`shenlun` 合并并在
`selectSocraticStrategy` 中读 `track`；数据种子把 `subject` 统一即可，其余逻辑不变。详见 INTEGRATION_SPEC §0。）

---

## 3. 知识包清单（9 个）

| pack id | subject | 显示名 | shortTitle | 节点 | 题数 |
| --- | --- | --- | --- | --- | --- |
| civil-verbal | xingce | 言语理解与表达 | 言语理解 | 5 | 4 |
| civil-logic | xingce | 判断推理 | 判断推理 | 5 | 4 |
| civil-data-analysis | xingce | 资料分析 | 资料分析 | 5 | 4 |
| civil-quant | xingce | 数量关系 | 数量关系 | 5 | 4 |
| civil-common-sense | xingce | 常识判断 | 常识判断 | 5 | 4 |
| civil-shenlun-summary | shenlun | 申论·归纳概括 | 概括题 | 5 | 3 |
| civil-shenlun-argument | shenlun | 申论·综合分析与对策 | 对策题 | 5 | 3 |
| civil-shenlun-implementation | shenlun | 申论·贯彻执行 | 贯彻执行 | 5 | 3 |
| civil-shenlun-writing | shenlun | 申论·大作文 | 大作文 | 5 | 3 |

合计：**45 节点 / 32 题**。集成后全量基线变为 **50 pack / 768 node / 758 question**
（既有 41 / 723 / 726 不变，仅增量）。

### 3.1 节点设计原则
- 每个节点含 `summary`、`prerequisites[]`、`misconceptions[]`、`socraticHints[{level,text}]`（L1/L2/L3 三级提示）、`source{...}`。
- `prerequisites` 全部指向**包内**节点，已通过 `dataIntegrity.test` 校验（无悬空引用）。
- 行测节点偏「题型识别 + 解题流程 + 高频陷阱」；申论节点偏「材料依据 + 结构方法 + 改写依据」。

### 3.2 题目类型编码
- 行测：`verbal_*`（言语）/ `logic_*`（判断推理）/ `data_*`（资料分析）/ `quant_*`（数量关系）/ `sense_*`（常识）。
- 申论：`summary_*`（概括）/ `countermeasure_*`（对策）/ `implementation_*`（贯彻执行）/ `outline_*`（提纲）/ `rewrite_*`（段落改写）。
- 难度 `difficulty ∈ {1,2,3}`；每题含 `solutionSteps[]` 与 `hints[{level,text}]`。

---

## 4. 教学链路

### 4.1 行测（题型导向、步骤感强）
意图 `xingce_practice`（出题/训练）→ 先点明题型，给解题流程与关键一步（L1），请学员先试做；
意图 `xingce_method`（方法讲解）→ 拆「题型识别 → 解题步骤 → 排除/代入/速算技巧 → 高频陷阱」。
行测答对闭环复用既有 `answer_with_reasoning`：学员给出结论+推导依据时确认并补规范步骤，不反复低阶追问。

### 4.2 申论（材料贴合、结构优先、不代写）
- `shenlun_material`（材料拆解/概括）：先带学员逐段标注问题/原因/表现/对策，再一起归并要点；不直接给成品概括。
- `shenlun_outline`（提纲辅导）：先确认总论点，再给 2–3 个分论点搭建方法（并列/递进），用「主题词+动作」句式；不替学员写完提纲或整篇。
- `shenlun_rewrite`（段落改写）：在学员**已有段落**上改，说明改了哪里、为什么改；`maxHintLevel` 仅 L3（段落级），非整篇。
- `shenlun_essay_structure`（大作文结构）：按 引论（点题+总论点）— 本论（分论点句+论证+回扣）— 结论（升华不跑题）给框架；**严禁默认输出完整作文**。

> 关键约束：`shenlun_outline` / `shenlun_essay_structure` 走 `explain`（`maxHintLevel` L2），**绝不**走 `review`/L4；
> 因此不会默认输出整篇代写。`shenlun_rewrite` 仅在学员已提供段落时给改写。

---

## 5. 申论「去 AI 味」方案（非 humanizer）

目标：让申论表达贴近**机关文风**，而非用同义词替换的「降 AI 率」工具。

**改写依据（必须可见、可解释）：**
1. **具体主体**：把「我们要……」改为明确责任主体（如「地方政府」「主管部门」「社区街道」）。
2. **具体动作**：把「加强……」改为可执行的动作（如「建立台账」「开展专项巡查」「纳入考核」）。
3. **具体依据**：要点能从材料找到出处；引用政策/数据要标注来源。
4. **少用万能排比、少空泛正确话、少机械金句**；一段一意，忌堆砌。

**明确禁止：**
- 用 humanizer / 同义词替换类工具「洗稿」去 AI 味（属于掩耳盗铃，不提升内容质量）。
- 默认生成整篇大作文（见 §4.2 约束）。
- 把「写作能力」拆成伪精确的 mastery% 图谱（申论能力不是知识点，仪表盘改用「任务完成度 / 练习次数 / 反馈状态」）。

---

## 6. 数据治理

- **来源可追溯**：每个节点/题目 `source` 含 `title` / `url` / `license` / `sourceType` / `sourceCategory`。
- **官方锚定**：考公种子以公开大纲为锚 ——
  `国家公务员局《中央机关及其直属机构2026年度考试录用公务员公共科目笔试考试大纲》`
  （URL：`http://bm.scs.gov.cn/pp/gkweb/core/web/ui/business/article/articledetail.html?ArticleId=8a81f6d19780e4080199ddabd11200f1&id=0000000062b7b2b60162bccd55ec0006&eid=0000000062b7b2b60162bccdd5860007`）。
  该 URL 已记录为 draft 范围来源，待人工打开官方 URL 复核。
- **AI 起草 → 人工审核**：所有考公种子 `reviewStatus: "draft"`（AI 起草，待人工审核）；`sourceType: "ai_draft"`、

  `sourceCategory: "official_syllabus_reference"`、`license: "reference_public_syllabus"`。
- **Web 搜索隔离**：WebSearch 仅用于**核对**题型/大纲是否与公开考纲一致；搜索结果**不**直接写入正式包，
  正式包内容由人工审核后的本地种子提供。
- **审核流转**：`draft → review → approved`；未 `approved` 的包不进入推荐主链路（或明确标注「草稿，待校准」）。

### 6.1 来源验证记录

| 字段 | 值 |
|------|-----|
| 官方大纲 URL | `http://bm.scs.gov.cn/pp/gkweb/core/web/ui/business/article/articledetail.html?ArticleId=8a81f6d19780e4080199ddabd11200f1&id=0000000062b7b2b60162bccd55ec0006&eid=0000000062b7b2b60162bccdd5860007` |
| 大纲名称 | 国家公务员局《中央机关及其直属机构2026年度考试录用公务员公共科目笔试考试大纲》 |
| 验证日期 | 2026-07-08（AI 生成时） |
| 验证方式 | WebSearch 核对 URL 可访问性与大纲标题一致性 |
| 验证结果 | 待人工打开官方 URL 复核；当前仅作为 draft 范围来源记录 |
| 备注 | AI 生成时确认该 URL 指向公开大纲页，但未逐条核对大纲正文与种子内容的事实对应性；具体事实准确性需人工复核 |

---

## 7. 非目标（non-goals，第一阶段不做）

1. 完整真题套卷闭环 / 自动组卷 / 自动判分。
2. 大规模时事政治数据库（仅常识节点做轻量示例，不维护实时库）。
3. 在线考试模拟器、云端同步、多人协作。
4. 自动整篇作文写作、精确实时作文评分。
5. 面试系统。
6. 强依赖向量检索 / 外部训练服务。

---

## 8. 验证清单（摘要，全量见 docs/sync/verification-checklist.md）

- 种子完整性：`validate_civil_seeds.py` 通过（9 知识 / 45 节点，9 题 / 32 题，无悬空引用，source 字段齐备）。
- 学科接入：`civilService.subject.test.ts`（label / 分类 / welcome 非数学 / style / manifest / 可打开）。
- 意图路由：`civilService.intent.test.ts`（行测 practice/method、申论 material/outline/rewrite/essay_structure、
  行测答对闭环、申论不默认整篇代写、subjectCode 守卫）。
- 集成命令（在 TeacherAgent 根目录）：`npm run test -- --maxWorkers=1`、`npm run build`、
  `cargo fmt -- --check`、`cargo check`、`cargo test`（如需生产包：`npm run tauri build`）。

---

## 9. 常识判断来源治理

### 9.1 核心原则

**考试大纲只能作为范围来源，不能作为事实来源。**

`civil-common-sense` 包覆盖政治制度、法律基础、经济常识、科技与生活、人文历史五大领域。这些领域的具体内容（法律条文、经济政策、科技事实、历史事件）**不能仅凭考试大纲支撑**。大纲只能证明"考试会考这些方向"，不能证明"具体事实/法条/政策表述是准确的"。

### 9.2 当前状态

- 所有 `civil-common-sense` 知识节点和题目均为 `reviewStatus: "draft"`。
- `source.sourceType: "ai_draft"`、`source.sourceCategory: "official_syllabus_reference"`。
- 每个节点/题目的 `source.note` 已标注："本条为基于公开考试大纲范围生成的 AI 草稿，具体事实、法律条文和政策表述需以权威来源及人工审核为准。"

### 9.3 升级为 approved 的前置条件

`civil-common-sense` 包从 `draft` 升级为 `approved` 前，**必须**满足以下条件之一：

1. **补充权威来源**：为每个节点/题目补充具体的权威来源（如法律条文引用、官方统计数字来源、教科书引用），并更新 `source.title` / `source.url`。
2. **人工复核记录**：由具备相关领域知识的审核人逐条复核，确认事实准确性，并在 `source.note` 中记录审核人、审核日期、审核结论。
3. **两者结合**：部分条目补充权威来源，部分条目经人工复核。

**不允许**的做法：
- 不要把大纲 URL 作为法律条文/经济政策/科技事实的来源。
- 不要伪造具体来源 URL。
- 不要将未经审核的 AI 生成内容标记为 `approved`。
