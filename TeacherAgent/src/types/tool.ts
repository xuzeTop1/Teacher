export interface SourceRef {
  id: string
  title: string
  license: string
  url?: string
  sourceType?: "built_in_pack" | "private_document" | "local_knowledge" | "open_web" | "oer" | "user_content" | "generated"
}

export type ToolName =
  | "knowledge_search"
  | "web_search"
  | "calculator"
  | "math_compute"
  | "code_runner"
  | "student_memory_search"
  | "question_bank_search"

export interface ToolResult<TData> {
  ok: boolean
  data?: TData
  error?: string
  errorCode?: ToolErrorCode
  sources?: SourceRef[]
  /** 考试体系范围校验时被拒绝的题目说明（只用于诊断与 UI 提示，不进入 prompt） */
  rejected?: string[]
}

export type ToolErrorCode =
  | "TIMEOUT"
  | "EMPTY_RESULT"
  | "NETWORK_BLOCKED"
  | "PRIVACY_BLOCKED"
  | "UNSUPPORTED_INPUT"
  | "EXECUTION_ERROR"
  | "ENGINE_UNAVAILABLE"

export type MathComputeOperation =
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

export interface MathComputeInput {
  operation: MathComputeOperation
  expression: string
  variable?: string
  point?: number
  parameters?: Record<string, string | number>
  assumptions?: string[]
  domain?: "real" | "complex" | "integer" | "positive" | "nonzero"
  precision?: number
  showStepsRequested?: boolean
}

export interface MathComputeOutput {
  result: string
  latex?: string
  normalizedExpression: string
  operation: MathComputeOperation
  stepsHint?: string[]
  warnings: string[]
  confidence: number
  engine: "sympy" | "scipy" | "internal" | "builtin" | "unavailable"
  isFallback?: boolean
}

export interface KnowledgeSearchInput {
  query: string
  subject?: string
  course?: string
  learningGoal?: string
  knowledgeNodeIds?: string[]
  /** 已启用的 pack IDs 列表，如果指定则只搜索这些 pack */
  enabledPackIds?: string[]
  topK: number
  searchMode: "semantic" | "keyword" | "hybrid" | "graph"
  includePrerequisites: boolean
  includeMisconceptions: boolean
  includeSocraticHints: boolean
}

/**
 * Structured provenance for knowledge retrieval results.
 * Allows UI and tests to distinguish vector/keyword/JSON retrieval paths.
 */
export interface RetrievalProvenance {
  retrievalMode: "vector" | "database_keyword" | "json_seed"
  embeddingModel?: string
  topScore?: number
  topNodeIds?: string[]
}

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
    /** 私有资料附加元数据，仅用于 prompt 注入区分来源 */
    _privateMeta?: {
      sourceType: "private_document"
      documentTitle: string
      fileName: string
      heading: string | null
    }
  }>
  /** Structured retrieval provenance — always present for built-in knowledge search */
  provenance?: RetrievalProvenance
}

export type QuestionBankQuestionType =
  | "concept_check"
  | "solution"
  | "diagnostic"

export interface QuestionBankSearchInput {
  query?: string
  subject: string
  knowledgeNodeIds?: string[]
  /** 已启用的 pack IDs 列表，如果指定则只搜索这些 pack */
  enabledPackIds?: string[]
  /** 考试体系范围过滤（可选）：指定后强制 approved + 叶子范围校验，题目必须归属该叶子 */
  examScope?: {
    examTrackId: string | null
    subjectId: string | null
    moduleId: string | null
  }
  difficulty?: {
    min: number
    max: number
  }
  questionTypes?: QuestionBankQuestionType[]
  purpose: "similar_example" | "practice" | "assessment" | "review"
  topK: number
  excludeRecentlyUsed: boolean
}

export interface QuestionBankSearchOutput {
  questions: Array<{
    questionId: string
    title?: string
    content: string
    type: QuestionBankQuestionType
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
    /** 考试体系归属（examScope 指定时随题返回，用于「本题属于」展示与结构化校验） */
    examTrackId?: string | null
    subjectId?: string | null
    moduleId?: string | null
    packId?: string | null
  }>
}

// ── code_runner ──────────────────────────────────────────────────────────

export interface CodeRunnerInput {
  code: string
  language: "python"
  stdin?: string
  testCases?: Array<{
    name: string
    input: string
    expectedOutput?: string
  }>
  timeoutMs: number
}

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
