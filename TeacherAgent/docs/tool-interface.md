# TeacherAgent Tool Interface 文档

版本：v1.1  
状态：MVP 开发基线  
最后更新：2026-07-01  
适用对象：ToolAgent、KnowledgeAgent、Tutor Orchestrator、后端实现者

## 1. 工具层目标

工具层为 Agent 提供可验证的外部能力。工具不是直接面向学生的回答者，所有工具结果必须经过 Agent 整理、教学策略处理和护栏检查后才能展示给学生。

ToolAgent 统一负责工具路由、隐私过滤、超时、错误处理和原始 ToolResult 返回。KnowledgeAgent 不直接拥有工具执行权；它只负责把 `knowledge_search`、`question_bank_search` 等知识类工具结果后处理为教学可用的 KnowledgeContext。

MVP 工具：

- `knowledge_search`
- `web_search`
- `calculator`
- `math_compute`
- `code_runner`
- `student_memory_search`
- `question_bank_search`

后续学科计算工具：

- `physics_compute`：单位换算、量纲检查、基础物理计算，建议基于 SymPy + Pint + SciPy。
- `chemistry_compute`：化学计量、摩尔质量、分子式/SMILES 基础处理，建议基础计量先自研，结构化学后续再评估 RDKit。
- `biology_compute`：暂不进入 MVP；生物题更多依赖知识解释、数据来源和图表分析，计算工具需单独定义边界。

学科计算工具不应要求学生自行安装 Python 或科学计算库。Python/SymPy/SciPy 如果被采用，应作为 TeacherAgent 内部 runtime，由应用侧托管、打包或降级处理。

## 2. 通用接口

### 2.1 ToolRequest

```ts
export interface ToolRequest<TInput = unknown> {
  toolName: ToolName
  requestId: string
  conversationId?: string
  studentId?: string
  input: TInput
  privacy: {
    containsPersonalData: boolean
    allowExternalNetwork: boolean
    redactionApplied: boolean
  }
  timeoutMs?: number
}
```

### 2.2 ToolResult

```ts
export interface ToolResult<TOutput = unknown> {
  toolName: ToolName
  requestId: string
  status: "success" | "empty" | "error" | "blocked"
  output?: TOutput
  error?: {
    code: string
    message: string
    retryable: boolean
  }
  sources?: SourceRef[]
  metadata: {
    latencyMs?: number
    createdAt: string
    confidence?: number
  }
}
```

### 2.3 SourceRef

```ts
export interface SourceRef {
  title: string
  url?: string
  license?: string
  attributionRequired?: boolean
  commercialUseAllowed?: boolean
  sourceType: "built_in_pack" | "private_document" | "local_knowledge" | "open_web" | "oer" | "user_content" | "generated"
}
```

说明：

- `sourceType` 表示检索结果的来源类型。
- `built_in_pack`：内置知识库 Pack 检索结果。
- `private_document`：用户本地导入的私有资料检索结果。
- `private_user_import` 仅作为 `license` 字段值，表示来源/授权归属，不再作为 `sourceType`。

### 2.4 ToolName

```ts
export type ToolName =
  | "knowledge_search"
  | "web_search"
  | "calculator"
  | "math_compute"
  | "code_runner"
  | "student_memory_search"
  | "question_bank_search"
```

## 3. 工具调用原则

- 默认先查本地知识库，再考虑 web。
- 工具输入只包含完成任务所需的最小信息。
- `web_search` 不得携带学生姓名、学校、完整对话、学习画像等隐私。
- 工具失败不能导致模型编造结果。
- 工具结果必须保留来源和可信度。
- 题目、知识、网页内容不得未经审核直接写入正式知识库。
- 工具调用本身不应默认触发额外 LLM；需要摘要或冲突消解时，由 Tutor Orchestrator 明确安排。
- 工具原始结果不直接展示给学生；必须先进入 Prompt Builder 的受控 `tool_context` 或 KnowledgeAgent 后处理，再经过 Tutor/Guardrail。

## 4. knowledge_search

用途：从本地知识库检索概念、定理、知识节点、常见误区、苏格拉底提示和来源元数据。

### 输入

```ts
export interface KnowledgeSearchInput {
  query: string
  subject?: string
  course?: string
  learningGoal?: string
  knowledgeNodeIds?: string[]
  topK: number
  searchMode: "semantic" | "keyword" | "hybrid" | "graph"
  includePrerequisites: boolean
  includeMisconceptions: boolean
  includeSocraticHints: boolean
}
```

### 输出

```ts
export interface KnowledgeSearchOutput {
  results: Array<{
    knowledgeNodeId: string
    title: string
    subject: string
    course?: string
    summary: string
    prerequisites: string[]
    relatedNodeIds: string[]
    misconceptions: string[]
    socraticHints: Array<{
      level: "L1" | "L2" | "L3"
      text: string
    }>
    source: SourceRef
    score: number
  }>
}
```

### 使用规则

- 这是默认首选工具。
- 如果结果为空，TutorAgent 应要求学生补充题目或上下文。
- 如果多个知识点相近，SocraticAgent 先用追问澄清。
- ToolAgent 会在 built-in Pack 搜索之外，额外搜索用户导入的私有资料（最多 3 条）。
- 当用户在对话页刚导入资料并使用“这份资料/刚才上传的资料”等指代时，ToolAgent 优先读取当前会话绑定资料的 chunks（持久化到 `conversation_private_documents` 表），而不是只依赖关键词搜索。会话绑定资料在切换会话和重启后仍可恢复。
- 私有资料结果通过 `sourceType: "private_document"` 区分，built-in Pack 使用 `"built_in_pack"`。
- 私有资料搜索失败不影响 built-in Pack 检索。
- 未导入私有资料时，原有 built-in Pack 行为不退化。
- 引用私有资料时，prompt 注入使用"你的资料中提到..."等表达，不伪装成公共知识。
- 不暴露本地文件路径，不大段复述原文。

## 5. web_search

用途：查询最新信息、政策、考试安排、开放资源来源、工具文档等本地知识库没有或可能过期的信息。

### 输入

```ts
export interface WebSearchInput {
  query: string
  purpose:
    | "latest_policy"
    | "exam_info"
    | "source_verification"
    | "open_educational_resource"
    | "technical_docs"
    | "general_reference"
  domains?: string[]
  recencyDays?: number
  maxResults: number
  safeSearch: boolean
}
```

### 输出

```ts
export interface WebSearchOutput {
  results: Array<{
    title: string
    url: string
    snippet: string
    publishedAt?: string
    retrievedAt: string
    sourceType: "official" | "oer" | "encyclopedia" | "forum" | "unknown"
    license?: string
    confidence: number
  }>
}
```

### 隐私与合规规则

- 禁止把学生个人信息、完整题目来源、学习画像发到 web_search。
- 搜索考试政策时优先官方来源。
- 搜索教学内容时优先 OER 或官方教材资源。
- web 结果只能作为回答来源或候选资料，不能自动入库。
- 自建学科可以使用 web_search 作为候选来源发现工具，但必须先按主题展示给用户确认；确认后才允许以 `draft` 状态写入本地知识库。若调用 LLM 做归纳，LLM 只能基于用户确认来源生成摘要/大纲，不得虚构来源或绕过确认直接入库。
- 对版权不明内容，只能摘要引用，不得复制到知识库。

## 6. calculator

用途：验证数学计算、代数化简、数值结果、简单统计。

### 输入

```ts
export interface CalculatorInput {
  expression: string
  mode: "numeric" | "symbolic" | "matrix" | "statistics"
  variables?: Record<string, number>
  precision?: number
  showStepsRequested: boolean
}
```

### 输出

```ts
export interface CalculatorOutput {
  result: string
  normalizedExpression: string
  steps?: string[]
  warnings: string[]
}
```

### 使用规则

- calculator 用于验证，不等于可以直接把最终答案给学生。
- 若当前提示等级低于 L4，默认不展示完整 steps。
- 不确定的符号计算要返回 warning。

## 7. math_compute

用途：面向数学学科的结构化计算工具，优先服务高等数学、线性代数、概率统计中的符号计算与可核验中间结果。

**计算引擎分层（2026-07-07 更新）：**

| 优先级 | 引擎 | 覆盖 operation | confidence | 说明 |
|--------|------|----------------|------------|------|
| 1 | SymPy worker | simplify, differentiate, integrate, solve, evaluate, limit, expand, factor | 0.95 | CAS 验证，高可信 |
| 2 | Rust builtin | simplify, differentiate, integrate, solve, evaluate, limit | 0.6 | 弱校验，不可作为绝对依据 |
| 3 | LLM-only | 所有 | 0 | 无计算支持，仅解释和启发 |

不支持的 operation（matrix, series, probability）：返回 `UNSUPPORTED_INPUT`，不假装支持。

`math_compute` 和 `calculator` 的区别：

- `calculator`：轻量表达式验算，适合简单数值、统计或矩阵结果检查。
- `math_compute`：学科级符号计算，适合极限、导数、积分、方程求解等任务。计算型问题优先真实计算；解释型问题仍主要靠 LLM 教学表达。

### 输入

```ts
export interface MathComputeInput {
  operation:
    | "simplify"
    | "limit"
    | "differentiate"
    | "integrate"
    | "solve"
    | "evaluate"
    | "expand"
    | "factor"
    | "matrix"
    | "series"
    | "probability"
  expression: string
  variable?: string
  parameters?: Record<string, string | number>
  assumptions?: string[]
  domain?: "real" | "complex" | "integer" | "positive" | "nonzero"
  precision?: number
  showStepsRequested: boolean
}
```

### 输出

```ts
export interface MathComputeOutput {
  result: string
  latex?: string
  normalizedExpression: string
  operation: MathComputeOperation
  stepsHint?: string[]
  warnings: string[]
  confidence: number          // 0.95 (sympy) / 0.6 (builtin) / 0 (unavailable)
  engine: "sympy" | "builtin" | "unavailable"
  isFallback?: boolean       // true if sympy failed and fell back to builtin
}
```

### 安全与教学规则

- 工具输入必须是结构化表达式和操作类型，不接收任意 Python 代码。
- Rust command 是最终输入边界：expression 最长 2000 字符、最多 512 token、括号深度最多 32；operation 必须属于 SymPy worker 明确枚举；variable 必须是最长 32 位的 ASCII 字母数字标识符。
- expression 只允许数字、受控变量/函数/常量和基础数学运算符；引号、下划线、属性访问、方括号、花括号及未知标识符在启动 worker 前拒绝。
- 不要求学生本机预装 Python；Python 作为内部 runtime 由应用侧托管。
- Python 后端必须禁用网络、文件系统破坏性操作和任意 shell 命令。
- 工具输出默认只供 TutorAgent / SocraticAgent 内部验算使用。
- 若当前提示等级低于 L4，不应直接展示完整 `result` 和 `stepsHint`；应转化为提示、反例或下一步问题。
- 对极限、积分、方程求解等可能有条件限制的结果，必须保留 assumptions / warnings。
- `math_compute` 不能替代证明；证明题只能用于验证局部代数或构造反例。
- 后端不可用时必须返回 `ENGINE_UNAVAILABLE`，TutorAgent 只能说明"暂时无法核验"，不得编造计算结果。

### 能力边界矩阵

| 能力级别 | Operation | 引擎 | 说明 |
|---------|-----------|------|------|
| **已强接管** | simplify, differentiate, integrate, solve, evaluate | SymPy first, builtin fallback | 高可信计算结果 |
| **已强接管** | expand, factor | SymPy first | 无 builtin fallback |
| **部分能力** | limit | SymPy first, builtin fallback | 复杂极限可能退回 LLM |
| **弱/不支持** | matrix, series, probability | 无引擎 | 明确降级到 LLM-only 解释 |
| **弱/不支持** | 微分方程, 多重积分, 复杂证明型 | 无引擎 | 退化为弱校验或解释链路 |

### MVP 支持优先级

1. 高数：`limit`、`differentiate`、`integrate`。
2. 线代：矩阵乘法、行列式、特征值、秩。
3. 概率：基础分布期望、方差、组合计数。
4. 数值：需要 SciPy 的 ODE、优化、数值积分放到 Phase 2。

### 运行时方案

按优先级建议：

1. Phase 0：只定义接口和输入校验，后端不可用时返回 `ENGINE_UNAVAILABLE`，TutorAgent 不编造计算结果。
2. Phase 1：随桌面应用打包一个受控 Python sidecar 或科学计算微运行时，由 Tauri/Rust command 调用。
3. Phase 2：评估 WASM / JS / Rust 原生替代方案，减少安装体积和跨平台打包复杂度。
4. 云端增强：只作为用户明确启用的可选方案，不默认上传学生题目或个人上下文。

禁止方案：

- 要求学生手动安装 Python、pip、SymPy 或 SciPy 后才能使用核心功能。
- 让 LLM 生成任意 Python 代码并直接在学生系统环境执行。
- 把计算失败伪装成已核验结果。

## 8. code_runner

用途：运行编程题、算法题、数据处理题的安全测试代码。

**Phase 1 状态**：Python sidecar 与教学护栏已实现，但没有 OS 级隔离。Release 默认关闭；Debug 也需双重显式 opt-in，且只允许可信本地开发代码。普通学生输入 fail-closed。TypeScript/JavaScript 待 Phase 2。

### 输入

```ts
export interface CodeRunnerInput {
  language: "python"
  code: string
  stdin?: string
  testCases?: Array<{
    name: string
    input: string
    expectedOutput?: string
  }>
  timeoutMs: number
}
```

### 输出

```ts
export interface CodeRunnerOutput {
  exitCode: number
  stdout: string
  stderr: string
  testResults?: Array<{
    name: string
    passed: boolean
    actualOutput: string
    expectedOutput?: string
  }>
  runtimeMs: number
}
```

### 安全分类：Phase 1 = 教学护栏，非安全沙箱

Phase 1 使用 6 层防御护栏（restricted builtins、import guard、pruned sys.modules、os/subprocess 阻断、超时、输出限制），可阻止意外误用和初学者错误。但存在 CPython 级不可封堵的逃逸路径（`object.__subclasses__()` → `catch_warnings` → warnings → 真实 builtins），有经验的攻击者可恢复 `open`/`__import__`。

**Phase 1 仅适用于可信代码（练习、教学演示）。** 真实安全执行必须迁移到 OS 级隔离（Windows Job Object / seccomp / WASM / 容器）。

当前执行契约：

- 普通学生输入和生产构建不得启动 code-worker。
- 未启用隔离时返回 `PRIVACY_BLOCKED` / 明确的安全隔离错误。
- 学生代码与 stdin 只经进程 stdin 传输，不出现在命令行。
- worker 子进程环境使用显式白名单，不继承 Provider Key、代理、云凭据、SSH 凭据或数据库连接串。
- `stderr`、worker `error` 和 `warnings` 在 Rust IPC 边界移除 ANSI/控制字符、绝对路径和已知 API Key/Bearer 形态，并限制到 4K 字符；它们是教学诊断，不是原始字节透传接口。
- 超时与 64KB 输出限制仍是资源护栏，不代表进程树、网络和文件系统已被 OS 隔离。

- 输出给学生前要解释测试意义，不直接代写完整作业代码，除非进入复盘模式

### 实现方案

独立 `code-worker` Python sidecar，不混入 document-worker。

| 层 | 文件 | 说明 |
|---|---|---|
| Python sidecar | `tools/code-worker/` | CLI `run` 子命令，JSON stdin → JSON stdout |
| Rust 模块 | `src-tauri/src/code_worker.rs` | 查找 sidecar exe → fallback Python module |
| Tauri command | `src-tauri/src/lib.rs` (`run_code`) | 暴露给前端 |
| 前端 service | `src/services/tools/codeRunner.ts` | 封装 Tauri command + tool context 构建 |
| ToolAgent | `src/engine/agents/toolAgent.ts` | 路由 code_runner |

## 9. student_memory_search

用途：检索学生历史误区、有效教学策略、近期学习内容和长期掌握度。

### 输入

```ts
export interface StudentMemorySearchInput {
  studentId: string
  query: string
  subject?: string
  knowledgeNodeIds?: string[]
  memoryTypes: Array<
    | "misconception"
    | "strategy_insight"
    | "mastery"
    | "recent_conversation"
    | "learning_preference"
  >
  topK: number
  maxAgeDays?: number
}
```

### 输出

```ts
export interface StudentMemorySearchOutput {
  memories: Array<{
    memoryId: string
    memoryType: string
    summary: string
    evidence: string
    confidence: number
    createdAt: string
    updatedAt?: string
    sourceConversationId?: string
  }>
}
```

### 使用规则

- 学生画像只用于调整教学，不要生硬展示给学生。
- 低置信度记忆只能作为弱信号。
- 长期未验证的记忆要降低权重。

## 10. question_bank_search

用途：检索题库中的类似题、变式题、练习题、分步提示。

### 输入

```ts
export interface QuestionBankSearchInput {
  query?: string
  subject: string
  knowledgeNodeIds?: string[]
  difficulty?: {
    min: number
    max: number
  }
  questionTypes?: Array<
    | "choice"
    | "blank"
    | "solution"
    | "proof"
    | "coding"
    | "concept_check"
    | "diagnostic"
  >
  purpose: "similar_example" | "practice" | "assessment" | "review"
  topK: number
  excludeRecentlyUsed: boolean
}
```

### 输出

```ts
export interface QuestionBankSearchOutput {
  questions: Array<{
    questionId: string
    title?: string
    content: string
    type:
      | "choice"
      | "blank"
      | "solution"
      | "proof"
      | "coding"
      | "concept_check"
      | "diagnostic"
    difficulty: number
    knowledgeNodeIds: string[]
    hints: Array<{
      level: "L1" | "L2" | "L3"
      text: string
    }>
    answer?: string
    solutionSteps?: string[]
    source: SourceRef
    score: number
  }>
}
```

### 使用规则

- 练习模式优先只展示题目和 L1 提示。
- `answer` 和 `solutionSteps` 默认只供内部评估或复盘模式使用。
- 若题目来源不是 original 或明确可商用开放授权，不得进入正式题库。
- Phase 0 已接入本地 JSON seed 检索：`data/questions/math-limits.seed.json`，ToolAgent 只在“练习、类似题、测验、复盘题”等明确意图下调用。

## 11. 工具选择矩阵

| 场景 | 首选工具 | 备用工具 |
| --- | --- | --- |
| 学生问知识点 | knowledge_search | web_search |
| 学生问最新考试政策 | web_search | none |
| 学生要求简单验算 | calculator | TutorAgent 手算并标注不确定 |
| 高数/线代/概率计算题 | math_compute | calculator |
| 编程题调试 | code_runner | TutorAgent 静态分析 |
| 个性化提示 | student_memory_search | AssessmentAgent 当前轮判断 |
| 推荐练习 | question_bank_search | KnowledgeAgent 生成练习候选 |

## 12. 错误处理

工具错误统一映射：

| code | 含义 | 学生可见处理 |
| --- | --- | --- |
| `TIMEOUT` | 工具超时 | “我暂时没能核验这个结果，我们先用可确定的信息推进。” |
| `EMPTY_RESULT` | 无结果 | 询问更多上下文或换检索方式 |
| `NETWORK_BLOCKED` | 网络不可用 | 不编造最新信息 |
| `PRIVACY_BLOCKED` | 隐私规则阻止 | 改用脱敏 query 或本地工具 |
| `UNSUPPORTED_INPUT` | 输入不支持 | 请求学生换格式 |
| `EXECUTION_ERROR` | 执行失败 | 给出错误摘要和下一步调试建议 |
| `ENGINE_UNAVAILABLE` | 学科计算引擎未配置 | 使用通用教学策略，不编造计算结果 |

## 13. MVP 实现顺序

1. `knowledge_search`：先用 JSON seed + keyword/hybrid mock。
2. `student_memory_search`：先查 SQLite 或内存 mock。
3. `calculator`：先支持基础表达式和数值计算。
4. `math_compute`：先定义接口和安全边界，后接 Tauri/Rust 调用内置 Python sidecar 或其他受控计算 runtime。
5. `question_bank_search`：先支持本地题库 JSON。
6. `web_search`：先做接口和隐私过滤，实际接入可放 Phase 2。
7. `code_runner`：先做安全设计，实际执行放在沙箱能力明确后。

## 14. 待决策事项

工具相关待决策事项统一维护在 `docs/open-decisions.md`，本文件只保留已决定的工具契约。
