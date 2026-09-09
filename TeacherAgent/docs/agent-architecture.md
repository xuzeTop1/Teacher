# TeacherAgent Agent 架构文档

版本：v1.1  
状态：MVP 开发基线  
最后更新：2026-07-05  
适用对象：Codex、Claude Code、前端/后端实现者

## 1. 架构目标

TeacherAgent 采用“一个主编排器 + 多个能力型子 Agent + 工具层”的轻量多 Agent 架构。MVP 阶段不需要多个自治模型进程，也不需要复杂的多 Agent 竞价/辩论系统；先用清晰的 TypeScript service、prompt 模板和工具接口实现职责分离。

目标：

- 保持教学人格一致。
- 把知识检索、护栏、评估、反思等能力拆清楚。
- 让 Codex/Claude Code 能按边界开发，不把所有逻辑塞进一个聊天函数。
- 允许后续把某些 Agent 替换成独立模型调用或本地模型调用。

## 2. 总体调用链

本节描述逻辑职责链，不表示每个 Agent 都必须单独发起一次 LLM 调用。MVP 运行时必须优先控制延迟：多个 Agent 可以共享一次 LLM 请求，Agent 作为代码边界和输出结构保留。

```text
User Message
  ↓
Tutor Orchestrator
  ├─ LearningMemoryService reads short-term memory / long-term memory / profile
  ↓
Intent + Context Planning
  ↓
ToolAgent decides tool calls
  ├─ KnowledgeAgent → knowledge_search
  ├─ ToolAgent → web_search / calculator / code_runner
  ├─ AssessmentAgent → student answer assessment
  └─ PlannerAgent → learning path / review suggestion
  ↓
SocraticAgent selects teaching strategy and hint level
  ↓
TutorAgent drafts student-visible reply
  ↓
GuardrailAgent reviews reply
  ├─ pass → return to UI
  └─ fail → rewrite or downgrade hint level
  ↓
ReflectionAgent updates learning memory after turn/session
  ↓
LearningMemoryService persists summarized memory signals
```

## 2.1 MVP 运行时调用预算

MVP 默认目标：一轮普通对话最多 `2` 次同步 LLM 调用，复杂轮次最多 `3` 次同步 LLM 调用。ReflectionAgent 异步执行，不计入学生等待路径。

| 轮次类型 | 同步 LLM 调用 | 说明 |
| --- | ---: | --- |
| 普通知识/解题引导 | 1-2 | 合并 Orchestrator + Socratic + Tutor；Guardrail 优先用规则，必要时 LLM 审核 |
| 需要 RAG 的题目 | 1-2 | `knowledge_search` 是本地工具；检索后合并策略和回复生成 |
| 高风险/疑似直接答案 | 2-3 | Tutor 草稿后触发 LLM Guardrail；最多一次重写 |
| 入学/目标诊断 | 2-3 | Assessment 需要结构化状态，但可与 Socratic/Tutor 合并部分输出 |
| 学习路径规划 | 1-2 | 仅事件触发，不进入每轮普通对话 |

推荐同步调用压缩：

```text
Call A: plan_and_draft
  combines: Tutor Orchestrator intent + Socratic strategy + TutorAgent draft
  output: AgentDecision + SocraticStrategy + StudentVisibleReply

Call B: guardrail_review
  only when rule guardrail flags risk or the turn is high risk
  output: GuardrailReview

Call C: rewrite_once
  only when GuardrailAgent rejects and deterministic fallback is insufficient
  output: StudentVisibleReply

Async: reflection
  runs after student-visible reply is returned
  output: ReflectionRecord / Assessment update
```

本地工具和轻量规则优先使用代码实现，不默认消耗 LLM 调用：

- Tool routing：优先由规则和 intent flags 决定。
- `knowledge_search`：本地检索，不调用 LLM。
- KnowledgeAgent 后处理：MVP 默认用代码裁剪和排序；需要摘要时才进入 Prompt Builder。
- Guardrail 初筛：正则、提示等级、来源风险、隐私规则先行。
- PlannerAgent：只在事件触发时运行。

## 3. Agent 列表

| Agent | 类型 | 是否学生可见 | MVP 必须 | 职责 |
| --- | --- | --- | --- | --- |
| Tutor Orchestrator | 编排器 | 否 | 是 | 判断流程、组织上下文、调用其他 Agent |
| TutorAgent | 回复生成 | 是 | 是 | 生成最终学生可见回复 |
| SocraticAgent | 教学策略 | 间接 | 是 | 决定追问、提示等级、解释/复盘模式 |
| GuardrailAgent | 安全/教学护栏 | 否 | 是 | 检查是否过早给答案、越界、语气不当 |
| KnowledgeAgent | 知识检索 | 间接 | 是 | 查本地知识库和题库相关知识 |
| AssessmentAgent | 学习评估/对话式评估 | 间接 | 是 | 判断学生回答质量、掌握度变化，并承接入学测试、目标定位、周期复盘 |
| ReflectionAgent | 记忆沉淀 | 否 | 是 | 对话后提取知识更新、误区、策略效果 |
| LearningMemoryService | 记忆服务 | 否 | 是 | 管理短期记忆、长期记忆和用户画像摘要 |
| PlannerAgent | 学习规划 | 可见 | Phase 0 骨架 / Phase 2 完整 | 生成路径、复习计划、下一步建议 |
| ToolAgent | 工具路由 | 否 | 是 | 决定调用哪些工具及隐私过滤；合并 built-in Pack 和私有资料检索结果；对“这份资料/刚才上传的资料”等指代优先读取当前会话绑定资料 chunks（持久化到 `conversation_private_documents`） |

## 4. 数据对象

### 4.1 AgentContext

```ts
export interface AgentContext {
  conversationId: string
  studentId?: string
  subject?: string
  subjectStyle?: SubjectStyle
  learningGoal?: string
  mode: "guide" | "diagnose" | "explain" | "review" | "exam_sprint"
  maxHintLevel: "L0" | "L1" | "L2" | "L3" | "L4"
  userMessage: string
  recentMessages: ChatMessage[]
  studentContext?: StudentContext
  knowledgeContext?: KnowledgeContext
  toolResults?: ToolResult[]
}
```

### 4.1.1 SubjectStyle

```ts
export interface SubjectStyle {
  subject: string
  styleName:
    | "calm_tutor"
    | "rigorous_patient"
    | "light_witty_coach"
    | "serious_fair_examiner"
    | "careful_standards_based"
    | "debugging_partner"
    | "structured_exam_coach"
  toneRules: string[]
  rigorRules: string[]
  humorLevel: "none" | "low" | "medium"
  correctionStyle: string
}
```

`subjectStyle` 由 Prompt Builder 或 Tutor Orchestrator 根据学科推断，并必须遵守 `docs/prompt-governance.md` 的 Subject Style Policy。核心人格统一为引导式导师，但学生可见表达应按学科调整：英语类更轻松诙谐，数学/物理/法学/会计等严谨学科更审慎、可验证。

### 4.2 AgentDecision

```ts
export interface AgentDecision {
  intent:
    | "solve_problem"
    | "explain_concept"
    | "review_solution"
    | "plan_learning"
    | "assess_level"
    | "diagnostic_assessment"
    | "general_chat"
    | "unknown"
  needsKnowledgeSearch: boolean
  needsWebSearch: boolean
  needsCalculator: boolean
  needsCodeRunner: boolean
  needsStudentMemory: boolean
  needsQuestionBank: boolean
  riskLevel: "low" | "medium" | "high"
  suggestedMode: AgentContext["mode"]
  maxHintLevel: AgentContext["maxHintLevel"]
  rationale: string
}
```

### 4.2.1 CombinedPlanDraft

MVP 可以用一次 LLM 调用同时产出意图、教学策略和候选回复。

```ts
export interface CombinedPlanDraft {
  decision: AgentDecision
  strategy: SocraticStrategy
  draftReply: StudentVisibleReply
  guardrailHints: {
    needsLlmReview: boolean
    riskSignals: string[]
  }
}
```

`CombinedPlanDraft` 不绕过 GuardrailAgent。它只是减少调用次数；最终回复仍必须经过规则护栏或 LLM 护栏审核。

### 4.3 StudentVisibleReply

```ts
export interface StudentVisibleReply {
  content: string
  mode: AgentContext["mode"]
  hintLevelUsed: AgentContext["maxHintLevel"]
  followUpQuestion?: string
  suggestedActions?: Array<{
    label: string
    action: "try_again" | "show_hint" | "review_solution" | "practice_similar"
  }>
}
```

## 5. Tutor Orchestrator

职责：

- 接收 UI 传来的学生消息。
- 读取会话、学生画像、知识状态和必要配置。
- 判断当前需要哪些 Agent 和工具。
- 控制最大提示等级。
- 保证最终只返回 GuardrailAgent 通过的学生可见回复。
- 安排 ReflectionAgent 在合适时机异步运行。

不负责：

- 不直接写最终长回复。
- 不直接操作数据库细节。
- 不直接决定所有教学策略。

伪代码：

```ts
async function handleUserTurn(input: UserTurnInput): Promise<StudentVisibleReply> {
  const context = await buildAgentContext(input)
  const decision = tutorOrchestrator.planWithRules(context)
  const toolResults = await toolAgent.runTools(decision, context)
  const combined = await tutorAgent.planAndDraft({ ...context, toolResults })
  const review = await guardrailAgent.reviewFast(combined.draftReply, context, combined.strategy)

  if (!review.allowed) {
    return guardrailAgent.rewriteOnceOrFallback(combined.draftReply, context, review)
  }

  reflectionAgent.schedule(input.conversationId)
  return combined.draftReply
}
```

规则：

- `planWithRules` 不调用 LLM，除非 intent 无法判定且会影响安全。
- `planAndDraft` 是普通轮次的主 LLM 调用。
- `reviewFast` 先跑规则护栏；只有高风险时调用 LLM Guardrail。
- `rewriteOnceOrFallback` 最多触发一次重写 LLM 调用。

当前 Phase 0 已落地 `TutorOrchestrator v1`：

- 文件：`src/engine/agents/tutorOrchestrator.ts`
- 能力：普通对话轮次串联 LearningMemoryService、ToolAgent、SocraticAgent、Tutor Prompt Builder、OpenAI-compatible Provider、GuardrailAgent、规则版 AssessmentAgent 和规则版 ReflectionAgent；规划型轮次可事件触发 PlannerAgent。
- 接入点：`ChatView` 调用 `handleTurn()`，不再直接组装 prompt 或调用 Provider。
- 护栏链路：普通低风险轮次只用规则护栏，不增加 LLM 调用；规则护栏拒绝时才触发 LLM Guardrail 审核，并最多执行一次 rewrite；重写后仍未通过则使用兜底模板。
- 规划链路：当用户主动问“接下来学什么”“怎么安排复习”等问题时，`TutorOrchestrator` 会短路普通 Tutor 草稿路径，调用规则版 PlannerAgent 生成学生可见计划，并继续经过规则护栏和学习记忆记录。
- 限制：尚未接入 LLM Reflection；ToolAgent 真实后端仍只覆盖本地 `knowledge_search`，`math_compute` 暂为占位适配。

当前 Phase 0 已落地 `GuardrailAgent v1`：

- 文件：`src/engine/agents/guardrailAgent.ts`
- 能力：规则初筛过早最终答案、完整解法、内部信息泄露、隐私诱导和语气问题；必要时调用 LLM Guardrail 输出结构化 JSON 审核；支持一次性安全改写和最终兜底。
- 接入点：`TutorOrchestrator v1` 在 Tutor 草稿生成后统一调用，不允许 UI 绕过护栏直接展示草稿。
- 运行预算：低风险轮次不新增 LLM 调用；高风险轮次最多增加 Guardrail 审核和一次 rewrite 调用。
- 限制：当前规则检测和 LLM JSON 解析仍是 MVP 版本，后续需要补充更完整的护栏测试样例集。

## 6. TutorAgent

职责：

- 根据核心导师 Prompt 生成学生可见回复。
- 保持统一人格和语气。
- 应用 `subjectStyle`，让不同学科拥有不同表达风格。
- 将知识上下文、学生上下文和教学策略自然融合。

输入：

- AgentContext。
- SocraticStrategy。
- ToolResult[]。

输出：

- StudentVisibleReply。

规则：

- 不暴露工具原始输出。
- 不暴露内部 Agent 名称。
- 不说“根据你的学生画像”，而是自然调整解释方式。
- 默认中文回复。
- 英语类学科可以使用轻微幽默和自然表达示范；严谨学科必须优先保证定义、条件和推理边界。

## 7. SocraticAgent

职责：

- 选择教学模式：guide、diagnose、explain、review、exam_sprint。
- 选择提示等级：L0-L4。
- 选择策略：探测性追问、分解引导、反例探索、反思性提问、类比桥接。
- 选择意图（intent）：区分 concept_question / outline_summary / practice_solve / direct_answer_request / review / learning_plan / exam_sprint / emotional_support / counterexample / answer_with_reasoning / default_guide。其中 `answer_with_reasoning` 用于检测学生已给出正确结论和推导的场景，命中时 shouldAskQuestion=false，进入确认+规范推导模式。
- 根据 `subjectStyle` 调整问题密度、幽默程度、纠错方式和解释深度。

输入：

```ts
export interface SocraticInput {
  context: AgentContext
  assessment?: AssessmentResult
  knowledgeContext?: KnowledgeContext
}
```

输出：

```ts
export interface SocraticStrategy {
  mode: AgentContext["mode"]
  hintLevel: AgentContext["maxHintLevel"]
  strategy:
    | "probing_question"
    | "decomposition"
    | "counterexample"
    | "reflection_question"
    | "analogy_bridge"
    | "direct_review"
  shouldAskQuestion: boolean
  intent: SocraticIntent
  targetQuestion?: string
  explanationDepth: "none" | "concept" | "method" | "key_step" | "full_review"
  rationale: string
}
```

当前 Phase 0 已落地规则版 `SocraticAgent v1.1`：

- 文件：`src/engine/agents/socraticAgent.ts`
- 能力：根据学生输入选择 `guide`、`diagnose`、`explain`、`review`、`exam_sprint` 模式，给出最大提示等级、策略名称、解释深度、意图和风险信号。
- 意图体系：`SocraticIntent` 区分 10 种意图，其中 `outline_summary` 覆盖资料摘要/大纲查询（跨学科），命中时 shouldAskQuestion=false，先结构化概括再给轻量后续建议。
- 接入点：`TutorOrchestrator v1` 在调用 Prompt Builder 前执行，并把策略和意图注入 `<teaching_strategy>` 运行时上下文。`TutorPromptBuilder` 基于 `intent` 字段（而非 `shouldAskQuestion`）做 prompt 分支，避免 review 模式误触大纲查询引导。
- 运行预算：纯规则实现，不新增 LLM 调用。
- 限制：尚未结合长期学生画像、AssessmentAgent 结果和知识图谱掌握度做个性化策略选择。

## 8. GuardrailAgent

职责：

- 检查候选回复是否过早给答案。
- 检查是否超出允许提示等级。
- 检查是否有不准确、编造、泄露内部信息或隐私风险。
- 给出 rewriteInstruction。
- 控制失败重试次数，避免无限重写。

输入：

```ts
export interface GuardrailInput {
  studentMessage: string
  candidateReply: StudentVisibleReply
  mode: AgentContext["mode"]
  maxHintLevel: AgentContext["maxHintLevel"]
  toolResults?: ToolResult[]
}
```

输出：

```ts
export interface GuardrailReview {
  allowed: boolean
  maxHintLevelDetected: "L0" | "L1" | "L2" | "L3" | "L4"
  violations: Array<
    | "final_answer_too_early"
    | "full_solution_too_early"
    | "unsupported_claim"
    | "privacy_risk"
    | "internal_leak"
    | "tone_problem"
  >
  rewriteRequired: boolean
  rewriteInstruction?: string
  fallbackReply?: string
}
```

### 8.1 Guardrail 重试与兜底

GuardrailAgent 必须有确定的终止路径。

```ts
export interface GuardrailPolicy {
  maxRewriteAttempts: 1
  fallbackTemplate:
    | "guided_hint_fallback"
    | "need_more_context_fallback"
    | "cannot_verify_fallback"
    | "safety_boundary_fallback"
}
```

重写流程：

1. 规则护栏先审候选回复。
2. 若风险低，直接通过。
3. 若风险中高，调用 LLM Guardrail 审核。
4. 若不通过，最多重写 `1` 次。
5. 重写后仍不通过，使用预置兜底模板，不再继续调用 LLM。

Phase 0 当前已实现第 1-5 步：规则初筛、必要时 LLM Guardrail、最多一次 rewrite，以及重写失败后的兜底模板。

兜底示例：

```text
我先不直接给完整答案，避免把你本来要练的关键步骤跳过去。我们把问题缩小到下一步：{safe_next_question}
```

若问题涉及事实核验或来源不足：

```text
这个信息我现在不能可靠核验，所以不直接下结论。你可以补充题目来源或允许我查找权威来源；在此之前，我们先基于已知条件分析。
```

## 9. KnowledgeAgent

职责：

- 调用 `knowledge_search` 查本地知识库。
- 调用 `question_bank_search` 查类似题或变式题。
- 将检索结果整理为 RAG 注入上下文。
- 对来源许可证和可信度做基础标记。
- 作为 ToolAgent 结果的教学后处理器，而不是默认独立 LLM Agent。

规则：

- 本地知识库优先于 web。
- 不把未经审核的 web 内容写入正式知识库。
- 不把版权不明内容当作可复用知识节点。

### 9.1 KnowledgeAgent 与 ToolAgent 的关系

ToolAgent 统一负责“是否调用工具、如何调用工具、隐私过滤、超时和错误处理”。KnowledgeAgent 负责“把知识类工具结果变成教学上下文”。

边界：

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| ToolAgent | 路由工具、执行工具、隐私过滤、错误处理 | 解读知识点教学意义 |
| KnowledgeAgent | 整理知识节点、前置知识、误区、提示、来源可信度 | 决定是否允许外部网络、执行工具 |
| Prompt Builder | 将整理后的 KnowledgeContext 注入 Prompt | 原始检索和版权判断 |

MVP 默认：KnowledgeAgent 后处理不调用 LLM，只做裁剪、排序、去重和结构化映射。只有当检索结果过长、冲突或需要摘要时，才允许增加一次后台摘要调用。

## 10. AssessmentAgent

职责：

- 判断学生回答是否正确、部分正确、错误或无法判断。
- 识别可能涉及的知识点。
- 给出掌握度变化建议。
- 区分事实和推断。
- 承接 `docs/design.md` 中的“对话式能力评估系统”，不再另设独立 `AssessmentEngine` Agent。
- 支持两种工作模式：
  - `turn_assessment`：每轮对话后评估当前回答质量和掌握度变化。
  - `diagnostic_assessment`：用于入学测试、目标定位和周期复盘，生成结构化能力报告。

对话式评估调用链：

```text
User starts placement / goal assessment
  ↓
Tutor Orchestrator sets mode = assess_level
  ↓
AssessmentAgent selects diagnostic probes
  ↓
SocraticAgent turns probes into natural questions
  ↓
TutorAgent asks student-visible question
  ↓
AssessmentAgent evaluates response and updates assessment state
  ↓
PlannerAgent may use result to suggest learning path
```

输出：

```ts
export interface AssessmentResult {
  assessmentMode: "turn_assessment" | "diagnostic_assessment"
  correctness: "correct" | "partially_correct" | "incorrect" | "unknown"
  confidence: number
  evidence: string
  knowledgeUpdates: Array<{
    knowledgeNodeId: string
    masteryDelta: number
    reason: string
  }>
  detectedMisconceptions: string[]
  suggestedNextAction: "continue" | "hint" | "explain_concept" | "practice" | "review"
  diagnosticReport?: {
    overallLevel: "foundation_gap" | "developing" | "solid" | "advanced" | "unknown"
    strengths: string[]
    weaknesses: string[]
    recommendedPriorities: string[]
    evidenceSummary: string
  }
}
```

当前 Phase 0 已落地规则版 `AssessmentAgent v1`：

- 文件：`src/engine/agents/assessmentAgent.ts`
- 类型：`src/types/assessment.ts`
- 能力：基于本轮学生输入、学生可见导师回复、提示等级和知识节点，输出 `turn_assessment` 的正确性、置信度、掌握度 delta、误区候选和下一步建议。
- 持久化：前端通过 `saveAssessmentResult()` 调用 Rust `save_assessment_result`，写入 `assessment_results` 表，并由后端同步知识节点快照与 `student_knowledge` 基础掌握度状态。
- 运行预算：纯规则实现，不新增 LLM 调用；SQLite/Tauri 不可用时不阻断学生可见回复。
- 限制：尚未实现 `diagnostic_assessment` 的多轮诊断报告；当前掌握度更新是规则版增量，后续需要更细的 Bayesian/IRT 或间隔复习模型。

## 11. ReflectionAgent

职责：

- 对一轮或一段对话做结构化反思。
- 生成 ReflectionRecord。
- 更新学生画像候选项。
- 标记需要后续验证的不确定推断。

运行时机：

- 每轮重要对话后异步运行。
- 完成一道题后运行。
- 复盘结束后运行。
- 会话结束时运行。

当前 Phase 0 已落地规则版 `ReflectionAgent v1`：

- 文件：`src/engine/agents/reflectionAgent.ts`
- 类型：`src/types/reflection.ts`
- 能力：根据本轮学生输入、导师回复、学科、教学模式、策略和知识节点生成 `ReflectionRecord`，区分 `observations`、`inferences` 和 `uncertainties`。
- 输出：知识更新、误区候选、策略效果、下一步建议、用户画像增量和长期记忆候选。
- 持久化：前端通过 `saveReflectionRecord()` 调用 Rust `save_reflection_record`，写入 `reflection_records` 表。
- 限制：当前为规则版，不额外调用 LLM；更细腻的对话段落总结和不确定性校准留到 LLM Reflection v2。

## 11.1 LearningMemoryService

职责：

- 管理短期记忆：当前会话摘要、近期关注点、待跟进问题、最近误区。
- 管理长期记忆：学习目标、讲解偏好、误区、策略信号和情绪信号的脱敏摘要。
- 管理用户画像：按学生和学科聚合的学习目标、解释偏好、常见误区和有效策略。
- 向 Prompt Builder 提供 `sessionMemory` 和 `studentContext`。

边界：

- 不保存完整 prompt、完整 Provider 请求体、API Key、工具原始输出或 Guardrail 未通过草稿。
- 用户画像是可修正的教学假设，不是永久标签。
- 学生可见回复不得生硬暴露“你的画像显示”。

当前 Phase 0 已落地 SQLite-first 版 `LearningMemoryService v1`：

- 文件：`src/services/student/memoryService.ts`
- 存储：优先通过 Tauri command 读写 SQLite；浏览器预览、Tauri IPC 不可用或写入失败时回退到 `localStorage`。
- 后端命令：`load_learning_memory_context`、`save_learning_memory_state`
- 存储表：`student_cognitive_profiles`、`short_term_memories`、`long_term_memories`
- 接入点：`TutorOrchestrator v1` 在生成 prompt 前读取记忆，在回复通过护栏后记录本轮信号。
- 限制：当前记忆信号来自规则版 ReflectionAgent；LLM Reflection 尚未接管更深层的 observation / inference / uncertainty 校准。
- 后续扩展：长期记忆摘要可进入 SQLite-vec，用于跨会话语义召回。

## 12. PlannerAgent

职责：

- 根据学习目标、掌握度和知识图谱生成学习路径。
- 给出复习建议和下一步学习任务。
- 检测长期未复习知识点。

MVP 阶段 PlannerAgent 可以先只返回简单建议；Phase 2 再做完整路径规划。

当前 Phase 0 已落地规则版 `PlannerAgent v1`：

- 文件：`src/engine/agents/plannerAgent.ts`
- 类型：`src/types/planner.ts`
- 能力：识别用户主动规划请求，基于学科默认路径、短期记忆、长期记忆、评估结果候选、`student_knowledge` 掌握度、复习间隔和知识图谱前置依赖，输出 `PlannerResult`、下一步任务、复习重点、掌握度信号、复习到期信号、前置依赖信号和规划周期。
- 接入点：`TutorOrchestrator v1` 仅在用户显式请求规划时触发；普通概念解释、解题引导和验算轮次不会调用 PlannerAgent。
- 运行预算：纯规则实现，不新增 LLM 调用。
- 当前数据读取：规划触发时会读取 `student_knowledge`，用 `last_practiced_at` / `updated_at` 计算简化复习到期信号，再针对低掌握度节点读取 `knowledge_edges` 的 `prerequisite` 边；若边表暂未导入，则回退读取节点自身 `prerequisites_json` 的文本前置概念。
- 限制：当前只做弱点节点的一跳前置依赖建议和简化复习间隔规则，不做完整 DAG 路径优化、日历化复习时间表或遗忘曲线参数学习；Phase 2 需要接入章节依赖图、复习间隔和更可靠的路径优化。

触发时机：

- 用户设定新学习目标。
- 用户主动问“接下来学什么”“怎么安排复习”。
- 完成一个知识点、章节、练习组或阶段评估。
- AssessmentAgent 生成 diagnosticReport 后。
- 系统检测到长期未复习知识点，需要生成复习建议。

非触发时机：

- 普通一问一答。
- 单轮概念解释。
- 学生还没完成当前题目。
- 只是查询一个知识点或验算一个步骤。

PlannerAgent 不应进入每轮默认同步链路。Tutor Orchestrator 只在 `intent` 为 `plan_learning`、`diagnostic_assessment` 完成后，或明确事件触发时调用它。

## 13. ToolAgent

职责：

- 统一管理工具调用。
- 在调用 web_search 前做隐私过滤。
- 控制工具超时、失败降级和来源标注。
- 将工具结果转成 Agent 可用的 ToolResult。

规则：

- `knowledge_search` 优先级高于 `web_search`。
- `calculator` 用于验证计算，不默认把内部计算过程完整展示给学生。
- `code_runner` Phase 1 只作为教学护栏运行可信练习代码，不承诺安全沙箱隔离。
- `web_search` 不能上传学生隐私、完整对话历史或学习画像。

当前 Phase 0 已落地 `ToolAgent v1`：

- 文件：`src/engine/agents/toolAgent.ts`
- 能力：对普通对话执行本地 `knowledge_search`，并将结果归一化为 Tutor Prompt 可用的 `KnowledgeContext`；对明显数学计算请求尝试 `math_compute` 路由；对编程学科（programming）的代码执行请求路由 `code_runner`（Python，独立 code-worker sidecar），支持从当前消息和最近学生消息中提取代码片段。
- 接入点：`TutorOrchestrator v1` 调用 ToolAgent，而不是直接访问 `localKnowledgeSearch`。
- 限制：`code_runner` 仅支持 Python，TypeScript/JavaScript 待 Phase 2；尚未实现 `web_search`、`calculator` 的真实路由。

## 14. 推荐目录结构

项目目录以 `docs/project-governance.md` 的架构层边界为准。Agent 架构使用以下子目录落位，避免与 `src/services/`、`src/engine/` 两套命名冲突。

**命名约定**：实际代码采用 camelCase 命名（如 `tutorOrchestrator.ts`），与 Vue/TypeScript 生态惯例一致。

```text
src/
├── components/
├── views/
├── stores/
├── engine/
│   ├── agents/
│   │   ├── tutorOrchestrator.ts
│   │   ├── tutorAgent.ts
│   │   ├── socraticAgent.ts
│   │   ├── guardrailAgent.ts
│   │   ├── knowledgeAgent.ts
│   │   ├── assessmentAgent.ts
│   │   ├── reflectionAgent.ts
│   │   ├── plannerAgent.ts
│   │   └── toolAgent.ts
│   ├── prompts/
│   │   ├── tutor-system.ts
│   │   ├── guardrail-review.ts
│   │   ├── reflection.ts
│   │   └── rag-context.ts
│   └── policies/
│       ├── subject-style.ts
│       ├── hint-level.ts
│       └── guardrail-policy.ts
├── services/
│   ├── llm/
│   ├── knowledge/
│   ├── student/
│   └── tools/
│       ├── knowledge-search.ts
│       ├── web-search.ts
│       ├── calculator.ts
│       ├── code-runner.ts
│       ├── student-memory-search.ts
│       └── question-bank-search.ts
└── types/
    ├── agent.ts
    ├── tool.ts
    └── learning.ts
```

## 15. 失败降级

| 失败点 | 降级策略 |
| --- | --- |
| KnowledgeAgent 无结果 | 说明需要更多信息，使用通用教学策略 |
| web_search 失败 | 提示无法核对最新信息，不编造 |
| calculator 失败 | 不给确定数值，要求人工/后续核算 |
| GuardrailAgent 不通过 | 降低提示等级并重写 |
| ReflectionAgent 失败 | 不影响学生当前回复，记录后台错误 |
| LLM Provider 失败 | 尝试备用 Provider 或提示用户检查配置 |

GuardrailAgent 不通过的详细策略以第 8.1 节为准：最多一次重写，仍失败则使用预置兜底模板。

## 16. 待决策事项

Agent 相关待决策事项统一维护在 `docs/open-decisions.md`，本文件只保留已决定的 Agent 契约。
