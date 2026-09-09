# Draft Pack 批量审批纠正与重新验收记录

日期：2026-07-26

范围：全部 49 个 draft Pack

结论：本轮 49 个 Pack 均为 **FAIL（继续保持 draft）**，没有新增向量库准入项。

## 1. 为什么撤销上一轮批量批准

提交 `e7ba532` 将 11 个数学 Pack 和 `cs408-computer-networks` 一次性迁移为
approved，但该结论无法满足发布门槛：

1. 多个题目存在会改变数学或计算机含义的公式损坏，而非单纯排版问题。
2. `packSelection.test.ts` 依赖未提交的 `packSelection.ts` WIP；在干净快照中
   该提交不能独立通过测试。
3. 没有随提交保存逐 Pack 审核证据、合格审核者、审核日期和来源核验记录。
4. 当前 seed 中的 `human_authored`、`curriculum` 等字符串只是自述字段，不能替代
   人工专家复核或权威来源证据。
5. 当前安装包早于该内容提交，不能证明这些内容经过真实桌面和向量检索验收。

因此采用 fail-closed 处理：撤销 12 个 Pack 的 approved 状态，并把 Rust
`ApprovedManifestRegistry` 恢复为 `math-limits` 与 `python-basics` 两个 Pack。

## 2. 可复核的来源元数据结论

- 40 个非行测/申论 draft Pack 的实体主要声明
  `license=original_generated`，但没有 URL、访问日期和本次合格审核者证据。
- 9 个行测/申论 Pack 声明 `sourceType=ai_draft`；虽然部分实体带 URL，但没有
  访问日期，且政策、法律、时事和考试规则必须重新核对当前官方一手资料。
- “原创生成”可以说明没有直接复制教材，但不能自动证明学科正确性，也不能自动
  获得 approved 资格。

## 3. 逐 Pack 决策

### 数学

| Pack | 节点/题 | 决策 | 阻塞原因 |
|---|---:|---|---|
| `linear-algebra-basics` | 10/5 | FAIL | 检出多处解码后连续反斜杠；缺少独立公式与答案复核证据 |
| `probability-basics` | 8/5 | FAIL | 尚无逐题独立推导和人工复核记录 |
| `math-derivatives` | 12/9 | FAIL | `math-deriv-q007-quotient` 的题干、答案和分式结构损坏 |
| `math-applications-of-derivatives` | 7/8 | FAIL | 检出公式转义异常；尚无逐题独立推导记录 |
| `math-indefinite-integrals` | 8/8 | FAIL | `math-integ-q002-substitution`、`math-integ-q004-trig-half-angle` 的答案改变了函数含义 |
| `math-definite-integrals` | 8/7 | FAIL | 检出公式转义异常；尚无逐题独立推导记录 |
| `math-integral-applications` | 6/7 | FAIL | 检出数字/分式机械改写；尚无逐题独立推导记录 |
| `math-mean-value-theorems` | 5/7 | FAIL | 检出公式转义异常；尚无逐题独立推导记录 |
| `math-multivariable-calculus` | 7/7 | FAIL | 检出公式转义异常；尚无逐题独立推导记录 |
| `probability-distributions` | 9/10 | FAIL | `prob-q001-binomial` 的 10/32、5/16 被破坏；`prob-q010-poisson-approx` 的参数与题干矛盾 |
| `linear-algebra-expanded` | 7/6 | FAIL | 检出多处公式转义异常；缺少独立答案复核证据 |

### CS408

| Pack | 节点/题 | 决策 | 阻塞原因 |
|---|---:|---|---|
| `cs408-data-structures` | 40/40 | FAIL | 检出数字/分式机械改写；关键算法题未形成可执行的逐题验证记录 |
| `cs408-computer-organization` | 40/40 | FAIL | 检出数字/分式机械改写；关键计算题未形成独立复算记录 |
| `cs408-operating-systems` | 40/40 | FAIL | 检出数字/分式和括号异常；并发/调度题未形成独立复核记录 |
| `cs408-computer-networks` | 40/40 | FAIL | `cs408-cn-cidr`、`cs408-cn-q-ip-001`、`cs408-cn-q-cidr-001`、`cs408-cn-q-cidr-agg-001` 的 `/24` 等 CIDR 文本被破坏 |

### 物理

| Pack | 节点/题 | 决策 | 阻塞原因 |
|---|---:|---|---|
| `physics-mechanics` | 9/15 | FAIL | 检出公式转义/数字改写；缺少量纲、边界条件和答案独立复算 |
| `physics-electromagnetism` | 10/15 | FAIL | 检出公式机械改写；缺少量纲与符号约定复核 |
| `physics-thermodynamics` | 6/15 | FAIL | 检出公式转义/数字改写；缺少过程条件与符号约定复核 |
| `physics-waves-optics` | 9/15 | FAIL | 检出数字/分式机械改写；缺少相位、符号和边界条件复核 |
| `physics-modern` | 7/15 | FAIL | 检出多处公式转义异常；缺少常数、单位和近似条件复核 |

### 英语

| Pack | 节点/题 | 决策 | 阻塞原因 |
|---|---:|---|---|
| `english-grammar` | 20/20 | FAIL | 来源仅为自述 curriculum/practice，无 URL、访问日期和合格语言审核记录 |
| `english-reading` | 20/20 | FAIL | 无文本来源/许可链和逐题歧义检查记录 |
| `english-translation` | 20/20 | FAIL | 无双语人工复核与可接受译法边界记录 |
| `english-cloze` | 20/20 | FAIL | 无逐题语法、语义和唯一答案人工复核记录 |

### 政治、管理、教育、心理与法律

| Pack | 节点/题 | 决策 | 阻塞原因 |
|---|---:|---|---|
| `politics-marxism` | 20/20 | FAIL | 无当前权威来源 URL/访问日期及合格人工复核 |
| `politics-maoism` | 20/20 | FAIL | 无当前权威来源 URL/访问日期及合格人工复核 |
| `politics-history` | 20/20 | FAIL | 无当前权威来源 URL/访问日期及合格人工复核 |
| `politics-morals` | 20/20 | FAIL | 无当前权威来源 URL/访问日期及合格人工复核 |
| `management-math` | 20/20 | FAIL | 检出公式/数字机械改写，且无逐题复算记录 |
| `management-logic` | 20/20 | FAIL | 无逐题唯一答案、歧义与论证有效性复核记录 |
| `management-writing` | 20/20 | FAIL | 检出可疑数字结构，且无评分标准人工复核 |
| `education-pedagogy` | 20/20 | FAIL | 无课程标准/权威来源 URL、访问日期和专家复核 |
| `education-psychology` | 20/20 | FAIL | 无课程标准/权威来源 URL、访问日期和专家复核 |
| `education-history` | 20/20 | FAIL | 无课程标准/权威来源 URL、访问日期和专家复核 |
| `psychology-general` | 20/20 | FAIL | 无权威教材/OER 许可链和专业复核 |
| `psychology-experimental` | 20/20 | FAIL | 无实验方法、统计条件与专业复核记录 |
| `psychology-developmental` | 20/20 | FAIL | 无权威来源和专业复核记录 |
| `lawmaster-civil` | 20/20 | FAIL | 法律时效内容无当前官方法条来源、访问日期和法律复核 |
| `lawmaster-criminal` | 20/20 | FAIL | 法律时效内容无当前官方法条来源、访问日期和法律复核 |
| `lawmaster-jurisprudence` | 20/20 | FAIL | 无权威来源、版本信息和专业复核 |

### 行测与申论

| Pack | 节点/题 | 决策 | 阻塞原因 |
|---|---:|---|---|
| `civil-verbal` | 5/4 | FAIL | `sourceType=ai_draft`；来源缺访问日期，未做逐题唯一答案复核 |
| `civil-logic` | 5/4 | FAIL | `sourceType=ai_draft`；未做逐题论证有效性和歧义复核 |
| `civil-data-analysis` | 5/4 | FAIL | `sourceType=ai_draft`；未做数据口径和计算复核 |
| `civil-quant` | 5/4 | FAIL | `sourceType=ai_draft`；未做逐题独立复算 |
| `civil-common-sense` | 5/4 | FAIL | `sourceType=ai_draft`；时效内容缺当前官方一手来源核验 |
| `civil-shenlun-summary` | 5/3 | FAIL | `sourceType=ai_draft`；缺材料版权、访问日期和评分复核 |
| `civil-shenlun-argument` | 5/3 | FAIL | `sourceType=ai_draft`；缺材料版权、访问日期和评分复核 |
| `civil-shenlun-implementation` | 5/3 | FAIL | `sourceType=ai_draft`；缺当前公文规范来源和评分复核 |
| `civil-shenlun-writing` | 5/3 | FAIL | `sourceType=ai_draft`；缺材料版权、访问日期和评分复核 |

## 4. 本轮修复的正式内容

原 approved Pack `math-limits` 也存在历史公式损坏。本轮修复：

- `math-limit-equivalent-infinitesimal`
- `math-limit-trig-basic`
- `math-limit-q001-basic-type`
- `math-limit-q002-factor-cancel`
- `math-limit-q003-rationalization`
- `math-limit-q004-equivalent-infinitesimal`
- `math-limit-q005-one-sided-piecewise`
- `math-limit-q007-squeeze`
- `math-limit-q008-lhopital-boundary`
- `math-limit-q009-removable-discontinuity`
- `math-limit-q011-infinite-rational`
- `math-limit-q012-log-exponential`

同时在 `packValidator.ts` 增加 approved-only 公式完整性门禁。门禁拦截连续反斜杠、
数字被拆进分式、行内公式花括号不配对和分式括号跨边界等高置信机械损坏。
draft 内容不会因此被静默批准；一旦迁移为 approved，同一门禁自动生效。

## 5. Catalog 与向量准入结论

| 口径 | 纠正前（`e7ba532`） | 纠正后 |
|---|---:|---:|
| approved Pack | 14 | 2 |
| approved 节点 | 170 | 43 |
| approved 题目 | 139 | 20 |
| draft Pack | 37 | 49 |
| draft 节点 | 606 | 733 |
| draft 题目 | 627 | 746 |

正式向量目标恢复为 `43 + 20 = 63`。本轮没有生成 309 条向量，也没有把任何
新增 draft entity ID 加入 Rust registry。现有用户数据库的真实向量数量和命中
仍需通过 Tauri 桌面入口单独验收，本报告不伪造该结果。

## 6. 后续单 Pack 准入条件

每个 Pack 必须单独完成以下事项后才能再次提出 approved 迁移：

1. 修复 validator 与公式完整性扫描命中项。
2. 数学/物理/计算机题完成独立推导、执行或复算，并记录实体 ID。
3. 高时效内容补当前官方一手来源、URL、许可证/使用依据和访问日期。
4. 保存合格人工复核证据；不得用 `reviewStatus` 字符串冒充审核过程。
5. 在干净快照通过前端、Rust、构建与差异检查。
6. 通过正式 Tauri 入口生成当前 approved 全集向量，并核对命中 entity ID。

## 7. 自动验证结果

| 命令 | 结果 | Warning |
|---|---|---:|
| `npm run test -- --maxWorkers=1` | 49 files / 975 passed | 0 |
| `npm run build` | 通过；1617 modules；主 bundle 474.31 kB | 0 |
| `cargo fmt -- --check` | 通过 | 0 |
| `cargo check` | 通过 | 1 条既有 `generate_hash_manifest` dead_code |
| `cargo test` | 179 passed | 同一条既有 dead_code warning |
| `python -m pytest tools/code-worker` | 53 passed | 3 条既有 PytestCollectionWarning |
| `python -m pytest tools/document-worker` | 43 passed | 0 |
| `git diff --check` / `git show --check` | 无实质错误 | 仅 Windows CRLF 提示 |

总计：1250 tests passed，0 failed。

本轮未运行 `npm run tauri:dev`、未重新生成向量、未构建 MSI/NSIS。因此没有伪造
桌面查询、topScore、entity ID 或安装包验收结果。

## 8. 提交范围

1. `58f7bad10dc8224f519e155e62728933e763e55e`
   `fix(settings): make enable-all an explicit draft opt-in`
   - `src/stores/packSelection.ts`
   - `src/stores/packSelection.test.ts`
2. `1e02365a299024453866e4ba32ae767325d949f3`
   `fix(knowledge): revoke unverified batch approval`
   - 12 个 Pack 的 24 个 knowledge/question seed
   - `src/services/knowledge/packManifest.ts`
   - `src-tauri/src/seed.rs`
   - Catalog、Pack status、ToolAgent 相关基线测试
3. `3ad2f5480e8b71f39959e5d5ac729581a0274e1f`
   `fix(knowledge): gate approved formula integrity`
   - `math-limits` knowledge/question 公式修复
   - `packValidator.ts` 与测试
   - 知识库治理文档与本审核记录

## 9. 当前工作树与发布判断

提交后的分支为 `main...origin/main [ahead 66]`。以下任务前已有 WIP 保持未提交：

```text
 M docs/claudecode-handoff.md
 M docs/code-worker.md
 M docs/project-status.md
 M docs/user-action-required.md
 M docs/verification-checklist.md
 M src-tauri/src/provider.rs
 M src-tauri/src/vector.rs
 M src-tauri/src/worker.rs
 M src/components/chat/welcomeMessages.test.ts
 M src/components/chat/welcomeMessages.ts
 M src/components/settings/KnowledgeBasePanel.vue
 M src/components/settings/ProviderPanel.vue
 M src/engine/agents/toolAgent.ts
 M src/engine/agents/tutorOrchestrator.ts
 M src/services/knowledge/graphBuilder.ts
 M src/services/knowledge/seedEmbeddingService.test.ts
 M src/services/knowledge/seedEmbeddingService.ts
 M src/services/llm/providerDiagnostics.ts
 M src/services/llm/providerFormState.test.ts
 M src/services/llm/providerFormState.ts
 M src/styles/main.css
 M src/utils/mastery.test.ts
 M src/utils/mastery.ts
 M src/views/ChatView.vue
 M src/views/DashboardView.vue
 M src/views/KnowledgeGraphView.vue
 M src/views/knowledgeGraphLogic.test.ts
 M tools/code-worker/code_worker/runner.py
 M tools/code-worker/tests/test_runner.py
?? .claude/
?? docs/design/
?? docs/frontend-redesign-v1.md
?? docs/security-audit-2026-07-25.md
?? src/components/chat/PythonPlayground.vue
?? src/services/llm/providerDiagnostics.test.ts
?? src/stores/app.test.ts
```

明确结论：

- 可进入正式向量库：仅既有 `math-limits` 与 `python-basics`，目标仍为 63 条。
- 必须继续 draft：本报告列出的全部 49 Pack。
- 内部测试安装包：代码已具备继续构建验证的条件，但当前工作树仍含大量 WIP，
  且本轮没有执行 `tauri build` 或真实桌面验收；现有安装包不能视为本提交链产物。
- 正式发布候选：否。至少需要干净工作树构建、真实 Tauri 验收和当前安装包验证。
