# 考试体系（ExamTaxonomy）设计与落地说明

版本：v1.0
状态：本分支实现基线（`codex/alerttime-json-integration`）
最后更新：2026-08-07
适用对象：项目负责人、Codex、Claude Code、后续开发者

## 1. 目标

TeacherAgent 需要把手机端 AlertTime 的「科目 / 计划」（可能是用户自定义名称）映射到可解释的考研考试体系，并以「今日真实计划」驱动出题。本设计采用**数据驱动的可扩展层级模型**，分类规则只存在于 `data/exam-taxonomy/catalog.json` 与 Registry 服务中，不散落在 Vue 组件、Kotlin UI 或 Prompt 字符串。

## 2. 盘点表（现状）

### 2.1 TeacherAgent 题库（PACK_MANIFEST，51 pack / 14 个平面学科码）

| 平面学科码 | 中文标签（subject.ts） | Pack 数 | approved Pack | 说明 |
| --- | --- | --- | --- | --- |
| math | 数学 | 12 | math-limits、math-derivatives、math-applications-of-derivatives、math-indefinite-integrals、math-definite-integrals、math-integral-applications、math-mean-value-theorems、math-multivariable-calculus、probability-distributions | 一般高等数学，未建模为考研数学考试组 |
| cs408 | 408 | 4 | cs408-computer-networks | 考研 408 统考（计算机学科专业基础） |
| programming | 编程 | 1 | python-basics | 一般编程 |
| physics | 物理 | 5 | — | 大学物理，非考研考试组 |
| english | 英语 | 4 | — | 考研英语（语法/阅读/翻译/完形） |
| politics | 政治 | 4 | — | 考研政治（马原/毛概/史纲/思法） |
| management | 管理类联考 | 3 | — | 管理类联考（初数/逻辑/写作） |
| education | 教育学311 | 3 | — | 教育学 311 |
| psychology | 心理学312 | 3 | — | 心理学 312 |
| lawmaster | 法律硕士 | 3 | — | 法律硕士 |
| xingce | 行测 | 5 | — | 考公·行测 |
| shenlun | 申论 | 4 | — | 考公·申论 |
| law / accounting | 法学/会计 | 0 | — | 仅有代码与标签，无数据 |

题目 seed 字段：`id / title / content / type / difficulty / options / answer / solutionSteps / knowledgeNodeIds / hints / source`；顶层：`subject / course / chapter / status`。**没有** examTrackId / subjectId / moduleId 字段——归属由 Registry 按 pack 推导。

### 2.2 同步读模型与映射（TeacherAgent）

- `sync_subjects / sync_tasks / sync_study_sessions / sync_weekly_goals`（迁移 0008，主键 `(device_id, remote_id)`）。
- `subject_mappings`（device_id, alert_subject_remote_id, teacher_subject_id）：旧映射值是平面学科码（如 `cs408`）或自定义学科（`custom-*`）。
- 协议 DTO（`src-tauri/src/sync/protocol.rs` 与 AlertTime `SyncDtos.kt`）：**本阶段新增可选字段** `examTrackId / examSubjectId / examModuleId`（subject 级）。

### 2.3 AlertTime 手机端

- Room 实体：subjects（name/color/icon，**无 code/exam 字段**）、tasks（title/status/dueAt）、weekly_goals、study_sessions；databaseVersion=4，本阶段不改 Room schema。
- 备份协议 `alerttime-backup`（databaseVersion=4）与同步协议 `alerttime-teacher-sync`（schemaVersion=1）完全分离；`sync_*` 运行时状态不进备份。
- 手机端科目名是用户自定义名称（seed 默认：未分类/英语/数学/专业课/阅读）。

## 3. 考试体系层级模型

```text
考试体系 / 考试组（EXAM_TRACK）
  └── 学科或课程（SUBJECT / Course）
        └── 知识模块（MODULE / Topic，可选，数据支持时再展开）
              └── 题目（Question，经 approved 题库检索）
```

节点字段（`data/exam-taxonomy/catalog.json`）：

| 字段 | 说明 |
| --- | --- |
| stableId | 稳定 ID，可迁移、不依赖中文显示名；全局唯一（如 `408.data-structures`） |
| code | 可选考试代码（如 `408`） |
| displayName / shortName | 中文展示名 / 短标题 |
| aliases | 精确别名（中文简称 + 英文名） |
| parentId | 父级 stableId；根节点 null |
| nodeType | EXAM_TRACK / SUBJECT / MODULE |
| status | approved / draft（与对应 Pack 审核状态一致） |
| questionScope | 叶子节点可检索的 pack id 列表 |
| legacySubjectCode | 旧平面学科码（如 `cs408`），兼容历史映射与题库 seed |
| source / license | 题库来源与许可（遵守 knowledge-base-governance） |

**硬规则**：
- 只有叶子 SUBJECT / MODULE 可以作为「具体出题范围」与「掌握度范围」。
- 父级 EXAM_TRACK 只能用于聚合、统计、导航与「综合复习」，不得伪装成具体课程。
- 同名课程在不同考试组必须拥有不同 stableId（如 `408.data-structures` 与未来 `自命题.xxx.data-structures`），不得仅凭中文标题全局混淆。
- 目录只从现有数据盘点（PACK_MANIFEST + seed 元数据），不凭空编造题库或考试大纲。

## 4. 已落地考试组

| stableId | 展示名 | 状态 | 叶子 |
| --- | --- | --- | --- |
| `408` | 计算机学科专业基础（408） | approved（聚合节点） | data-structures、computer-organization、operating-systems、computer-networks |
| `kaoyan-english` | 考研英语 | draft | grammar、reading、translation、cloze |
| `kaoyan-politics` | 考研政治 | draft | marxism、maoism、history、morals |
| `management-coop` | 管理类联考 | draft | math、logic、writing |
| `education-311` | 教育学311 | draft | pedagogy、educational-psychology、history |
| `psychology-312` | 心理学312 | draft | general、experimental、developmental |
| `law-master` | 法律硕士 | draft | civil、criminal、jurisprudence |
| `civil-xingce` | 考公·行测 | draft | verbal、logic、data-analysis、quant、common-sense |
| `civil-shenlun` | 考公·申论 | draft | summary、argument、implementation、writing |

408 四门子科目别名（按任务要求逐字）：数据结构（数构、Data Structures）、计算机组成原理（计组、组成原理、Computer Organization）、计算机操作系统（操作系统、OS、Operating Systems）、计算机网络（计网、网络、Computer Networks）。

**当前 approved 出题范围**：408 中只有 `408.computer-networks` 的 pack 已审核（40 题）；其余考试组的 pack 全部为 draft，出题时如实显示「题库待审核」，不得以草稿内容出题。

## 5. Registry 与解析

- 加载：`src/engine/examTaxonomy/registry.ts` 静态导入 catalog.json，并与 PACK_MANIFEST 交叉校验（questionScope 引用必须存在）。
- 查询 API：getExamNode / getExamChildren / getExamTracks / getExamLeaves / getExamPath / getDescendantLeaves / getLeafPackIds / isQuestionScopeNode / resolveByPhoneName / resolveByLegacyCode。
- 手机科目解析（`planScope.ts` 的 resolveSubject）优先级：
  1. **用户映射表**（examSubjectId 叶子 > 旧 teacherSubjectId；旧值指向考试组时要求重新选择子科目）；
  2. **精确别名匹配**（唯一叶子命中可直接映射；多候选或命中考试组 → 待确认）；
  3. **手机端声明字段**（DTO 可选字段，只作建议，必须用户确认）；
  4. 未命中 → `unmapped`（保留为「未映射自定义科目」，不得猜测）。

## 6. 今日计划驱动出题规则

`planScope.ts` 的 `decideQuestionScope`，输入：今日计划（type=1、未删除、dueAt 今日，含未完成与已完成）、读模型科目、用户映射、用户显式选择。规则优先级：

1. 用户明确选择叶子 → 严格按所选范围出题；
2. 今日计划唯一映射到叶子 → 按该叶子出题，展示依据「根据你今天的『计算机网络』计划与学习记录生成」；
3. 今日计划只映射到考试组（如只有「408」）→ `requires-choice`：要求选择子科目或进入「综合复习」模式（轮换 / 掌握度最低优先，展示当前实际子科目）；
4. 没有今日计划或没有可靠映射 → `no-plan`：提示选择考试组与具体课程，不伪造「根据今日计划」，不返回任意默认 408 题；
5. 学习时长只进入 evidence（难度/节奏/反馈），**不**作为掌握度依据。

## 7. 题目归属与检索链

- `questionScope.ts`：pack → 叶子归属推导（`attributionsForPack`）、范围校验（`validateQuestionScope`，fail-closed）、`filterSeedsToScope`（approved 过滤 → 叶子过滤 → 拒绝统计）。
- 检索链（`searchLocalQuestionBankLazy` 的 examScope 分支）：
  1. 先按 approved 过滤（**白名单式**：`PACK_MANIFEST.status === "approved"` 是权威源，不依赖 seed JSON 黑名单，防止目录/seed 与 Manifest 状态漂移）；
  2. 再按 examTrackId / subjectId / moduleId 过滤（归属必须匹配当前请求叶子）；
  3. 最后按知识点、掌握度、今日计划排序（questionRecommender）。
- 出题门禁（运行时硬校验，三者缺一不可）：Manifest approved ∧ 叶子 approved ∧ 题目归属当前叶子；任一不满足即拒绝。
- 共享 Pack（多考试组/子科目复用题源）：`attributedQuestion` 必须使用当前请求范围匹配到的 attribution，不得取第一条归属。
- `moduleId` 推导：叶子为 MODULE 时返回自身 stableId；叶子为 SUBJECT 时为 null（不会把父级 Subject 错误赋值为 moduleId）。
- 不满足具体叶子 subjectId 的题目一律拒绝；只有「408」考试组标签的题目不能绕过筛选。

## 8. 同步兼容策略

- 协议可选字段 `examTrackId / examSubjectId / examModuleId`（subject 级）：旧版手机端不发送 → serde default / Kotlin 默认 null，完全兼容；非空时长度 ≤ 200、不得为空字符串。
- `sync_subjects` 与 `subject_mappings` 只新增可选列（迁移 0009），不删除、不重建、不清空任何既有数据。
- 手机端原始 subjectRemoteId / subjectName / taskTitle / 任务时间与完成状态**原样保留**，TeacherAgent 不改写手机数据。
- 模糊历史数据（如只有「408」）保留在父级 / unresolved 状态，不随机归为某一门子科目。
- JSON 备份、Room 数据与同步 DTO 新字段向后兼容；`sync_*` 运行时状态不进入备份（沿用 BackupRepository 现有排除逻辑）。

## 9. UI

- TeacherAgent：
  - 练习页 `ExamScopeSelector`：考试组 → 具体课程 → 模块 + 「综合复习」入口 + 今日计划映射状态（已映射 / 待确认 / 未映射，来自 planDecision）。
  - 出题页显示「本题属于：考试组 / 课程 / 模块」与「推荐依据：今日计划 / 用户手动选择 / 综合复习策略」。
  - AlertTime 同步页映射区：选项按考试组分组（`exam:` 前缀），显示映射状态与「建议」按钮；诊断按钮按映射对象启动（考试叶子走 examScope）。
  - 父级聚合统计（408 总体）与子科目独立统计（408 / 计算机网络）：练习页范围横幅 + 诊断页展示。
- AlertTime：
  - 保持通用学习 App 定位；「Teacher 同步」对话框新增可选的「考试体系标签」编辑（考试组/课程/模块），只影响同步上报与 TeacherAgent 展示，不参与本地统计与计时；空标签行为与旧版完全一致。
  - 不因 TeacherAgent 映射失败阻断计划、统计、备份与计时功能。

## 10. 兼容与数据安全

- 不删除、清空、迁移重建用户数据库；迁移 0009 只加列。
- 不覆盖两个工作区已有脏改动；不提交 Git（保留可审阅 diff）。
- 掌握度只由真实作答（BKT + assessment_results + student_knowledge）驱动；学习时长只影响投入度。

## 11. 测试

- 前端：`registry.test.ts`（组 A）、`planScope.test.ts`（组 B）、`questionScope.test.ts`（五.1 检索链）。
- Rust：`sync::protocol`（exam 可选字段校验、旧快照兼容）、`sync::db`（exam 字段落库回读、映射 upsert）。
- AlertTime：`SyncCodecTest`（exam 字段编解码、fixture 校验）、`SubjectExamTagStoreTest`（标签存储）。
- 构建：`npm run test` / `npm run build` / `cargo test` / AlertTime `testDebugUnitTest` + `lintDebug` + `assembleDebug`。

## 12. 未解决风险与后续建议

1. **其他考试组题库均为 draft**：出题闭环目前只有 408 计算机网络；其余考试组（英语/政治/管理联考等）的 pack 需学科专家复核后升 approved（`docs/knowledge-base-governance.md`）。
2. **考研数学未建模**：现有 math pack 是一般高等数学；如用户目标为考研数学（数学一/二/三），建议后续新增考试组并声明 pack 复用。
3. **模块层级未展开**：目录支持 MODULE 节点，当前数据粒度为 subject=pack chapter；后续细化章节时可加模块层。
4. **多手机**：映射与出题按设备隔离（device_id 主键），单 TeacherAgent 多手机并存需要 UI 侧确认当前设备。
5. **自命题考试组**：目录结构已支持（可加 `自命题.xxx` 考试组），需要用户提供真实大纲与题库数据后落地。
