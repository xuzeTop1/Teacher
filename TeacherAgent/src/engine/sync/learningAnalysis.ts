import type {
  SyncAssessmentDraftQuestionType,
  SyncLearningAnalysisDto,
  SyncLearningAnalysisGenerator,
  SyncPlanEvaluationVerdict
} from "../../types/sync"

export interface TrustedLearningAnalysisModel {
  analysisId: string
  sourceSnapshotId: string
  generatedAt: number
  promptVersion: string
  generator: SyncLearningAnalysisGenerator
  facts: Array<{ code: string; label: string; value: unknown; evidenceRefs: string[] }>
  inferences: Array<{ statement: string; confidence: number; evidenceRefs: string[] }>
  planEvaluation: {
    verdict: SyncPlanEvaluationVerdict
    score: number | null
    dimensions: Array<{ code: string; score: number | null; summary: string }>
    risks: string[]
    suggestions: string[]
  }
  draftQuestions: Array<{
    questionId: string
    subjectRemoteId: string | null
    taskRemoteId: string | null
    type: SyncAssessmentDraftQuestionType
    prompt: string
    rationale: string
    rubric: string[]
    masteryEvidence: false
  }>
  warnings: string[]
}

const MAX_PROFILE_ITEMS = 100
const MAX_DRAFT_QUESTIONS = 50
const MAX_WARNINGS = 50
const MAX_EVIDENCE_REFS = 20
const MAX_DIMENSIONS = 20
const MAX_PLAN_LIST_ITEMS = 20
const MAX_RUBRIC_ITEMS = 20
const MIN_ID_LENGTH = 8
const MAX_ID_LENGTH = 64
const MAX_CODE_LENGTH = 100
const MAX_LABEL_LENGTH = 200
const MAX_PROMPT_VERSION_LENGTH = 100
const MAX_LONG_TEXT_LENGTH = 20_000
const MAX_FACT_VALUE_LENGTH = 20_000
const MAX_FACT_DISPLAY_LENGTH = 240
const GENERATORS = new Set<SyncLearningAnalysisGenerator>(["android_llm", "deterministic_fallback"])
const VERDICTS = new Set<SyncPlanEvaluationVerdict>(["reasonable", "needs_adjustment", "insufficient_data"])
const QUESTION_TYPES = new Set<SyncAssessmentDraftQuestionType>(["concept_check", "diagnostic", "reflection"])

/**
 * 与 Android LearningAnalysisLogic.learningAnalysisWarningLabel 逐条对齐：
 * 手机端生成的分析警告是稳定代码，桌面端必须翻译成中文展示，不能把原始
 * 代码当错误提示丢给用户（它们多为教学性说明，不是故障）。
 */
const WARNING_LABELS: Record<string, string> = {
  llm_fallback_http_401_403: "模型服务拒绝认证，请检查 API Key 与账号权限",
  llm_fallback_http_404: "模型接口或模型不存在，请检查 Base URL 与模型 ID",
  llm_fallback_http_429: "模型服务限流或额度不足，请稍后重试或检查额度",
  llm_fallback_http_other: "模型服务拒绝本次请求，请检查模型 ID 与服务兼容性",
  llm_fallback_timeout_network: "连接模型服务超时或网络不可用",
  llm_fallback_response_non_json: "模型返回内容不是可识别的 JSON",
  llm_fallback_response_truncated: "模型输出达到长度上限，内容被截断；本次已使用手机本地评估",
  llm_fallback_output_root_shape: "模型返回的 JSON 顶层不是对象",
  llm_fallback_output_answer_guard: "模型返回内容包含不允许保存的答案字段",
  llm_fallback_output_schema: "模型返回的分析字段缺失或类型不正确",
  llm_fallback_output_constraints: "模型返回的分析内容超出安全范围",
  llm_fallback_output_task_binding: "模型生成的测试题无法可靠绑定当前计划",
  llm_fallback_output_protocol: "模型分析未通过本地同步协议校验",
  llm_fallback_output_validation: "模型返回的分析结构不符合安全要求",
  llm_fallback_request_too_large: "学习记录过多，未发送给模型；本次使用手机本地评估",
  learning_time_is_not_mastery_evidence: "学习时长只作为投入证据，不代表已经掌握",
  no_reliable_today_plan: "今天没有可识别的计划；分析已使用历史记录补充判断",
  weekly_goal_success_criteria_missing: "部分周目标缺少可验证的成功标准",
  assessment_draft_not_counted_toward_mastery: "测试草稿不会直接计入掌握度",
  cross_day_session_uses_proportional_split: "跨日专注会话已按日期比例计算"
}

export function learningAnalysisWarningLabel(code: string): string {
  return WARNING_LABELS[code] ?? code
}

/** Safely formats a fact value for compact UI display. */
export function formatLearningFactValue(value: unknown): string {
  const serialized = serializeJsonValue(value)
  if (serialized === null) return "无法显示"
  const display = typeof value === "string" ? value : serialized
  if (display.length <= MAX_FACT_DISPLAY_LENGTH) return display
  return `${display.slice(0, MAX_FACT_DISPLAY_LENGTH - 1)}…`
}

/** Pure, fail-closed projection. It never writes assessment or mastery state. */
export function toTrustedLearningAnalysisModel(
  analysis: SyncLearningAnalysisDto | null | undefined,
  expectedSnapshotId: string | null | undefined
): TrustedLearningAnalysisModel | null {
  if (!analysis || !isId(expectedSnapshotId) || analysis.sourceSnapshotId !== expectedSnapshotId) return null
  if (!isId(analysis.analysisId) || !isId(analysis.sourceSnapshotId) || !isFiniteNonNegative(analysis.generatedAt)) return null
  if (!isBoundedString(analysis.promptVersion, 1, MAX_PROMPT_VERSION_LENGTH)) return null
  if (!GENERATORS.has(analysis.generator) || !validStringList(analysis.warnings, MAX_WARNINGS, MAX_LONG_TEXT_LENGTH)) return null
  const facts = analysis.profile?.facts
  const inferences = analysis.profile?.inferences
  if (!Array.isArray(facts) || !Array.isArray(inferences) || facts.length > MAX_PROFILE_ITEMS || inferences.length > MAX_PROFILE_ITEMS) return null
  if (!facts.every((fact) =>
    isBoundedString(fact.code, 1, MAX_CODE_LENGTH) &&
    isBoundedString(fact.label, 1, MAX_LABEL_LENGTH) &&
    validEvidenceRefs(fact.evidenceRefs) &&
    isValidFactValue(fact.value)
  )) return null
  if (new Set(facts.map((fact) => fact.code)).size !== facts.length) return null
  if (!inferences.every((inference) =>
    isBoundedString(inference.statement, 1, MAX_LONG_TEXT_LENGTH) &&
    isFiniteInRange(inference.confidence, 0, 1) &&
    validEvidenceRefs(inference.evidenceRefs)
  )) return null

  const plan = analysis.planEvaluation
  if (!plan || !VERDICTS.has(plan.verdict) || !isNullableScore(plan.score) || !Array.isArray(plan.dimensions) || plan.dimensions.length > MAX_DIMENSIONS) return null
  if (!plan.dimensions.every((dimension) =>
    isBoundedString(dimension.code, 1, MAX_CODE_LENGTH) &&
    isNullableScore(dimension.score) &&
    isBoundedString(dimension.summary, 1, MAX_LONG_TEXT_LENGTH)
  )) return null
  if (!validStringList(plan.risks, MAX_PLAN_LIST_ITEMS, MAX_LONG_TEXT_LENGTH)) return null
  if (!validStringList(plan.suggestions, MAX_PLAN_LIST_ITEMS, MAX_LONG_TEXT_LENGTH)) return null

  const draft = analysis.assessmentDraft
  if (!draft || draft.status !== "draft" || !isBoundedString(draft.scopeSummary, 1, MAX_LONG_TEXT_LENGTH) || !Array.isArray(draft.questions) || draft.questions.length > MAX_DRAFT_QUESTIONS) return null
  if (!draft.questions.every((question) =>
    isId(question.questionId) && isOptionalId(question.subjectRemoteId) && isOptionalId(question.taskRemoteId) &&
    QUESTION_TYPES.has(question.type) && isBoundedString(question.prompt, 1, MAX_LONG_TEXT_LENGTH) &&
    isBoundedString(question.rationale, 1, MAX_LONG_TEXT_LENGTH) &&
    validStringList(question.rubric, MAX_RUBRIC_ITEMS, MAX_LONG_TEXT_LENGTH) && !hasForbiddenAnswerFields(question)
  )) return null
  if (new Set(draft.questions.map((question) => question.questionId)).size !== draft.questions.length) return null

  return {
    analysisId: analysis.analysisId,
    sourceSnapshotId: analysis.sourceSnapshotId,
    generatedAt: analysis.generatedAt,
    promptVersion: analysis.promptVersion,
    generator: analysis.generator,
    facts: facts.map((fact) => ({ ...fact, evidenceRefs: [...fact.evidenceRefs] })),
    inferences: inferences.map((inference) => ({ ...inference, evidenceRefs: [...inference.evidenceRefs] })),
    planEvaluation: {
      verdict: plan.verdict,
      score: plan.score,
      dimensions: plan.dimensions.map((dimension) => ({ ...dimension })),
      risks: [...plan.risks],
      suggestions: [...plan.suggestions]
    },
    draftQuestions: draft.questions.map((question) => ({
      questionId: question.questionId,
      subjectRemoteId: question.subjectRemoteId ?? null,
      taskRemoteId: question.taskRemoteId ?? null,
      type: question.type,
      prompt: question.prompt,
      rationale: question.rationale,
      rubric: [...question.rubric],
      masteryEvidence: false
    })),
    warnings: [...analysis.warnings]
  }
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.trim().length >= minimum && value.length <= maximum
}
function isId(value: unknown): value is string { return isBoundedString(value, MIN_ID_LENGTH, MAX_ID_LENGTH) }
function isOptionalId(value: unknown): value is string | null | undefined { return value == null || isId(value) }
function isFiniteNonNegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 }
function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum }
function isNullableScore(value: unknown): value is number | null { return value === null || isFiniteInRange(value, 0, 100) }
function validStringList(value: unknown, maximumItems: number, maximumLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maximumItems && value.every((item) => isBoundedString(item, 1, maximumLength))
}
function validEvidenceRefs(value: unknown): value is string[] {
  return validStringList(value, MAX_EVIDENCE_REFS, MAX_LABEL_LENGTH)
}
function isValidFactValue(value: unknown): boolean {
  const serialized = serializeJsonValue(value)
  return serialized !== null && serialized.length <= MAX_FACT_VALUE_LENGTH
}
function serializeJsonValue(value: unknown): string | null {
  try {
    const seen = new WeakSet<object>()
    const serialized = JSON.stringify(value, (_key, current) => {
      if (typeof current === "number" && !Number.isFinite(current)) throw new Error("non-finite number")
      if (["bigint", "function", "symbol", "undefined"].includes(typeof current)) throw new Error("unsupported JSON value")
      if (current !== null && typeof current === "object") {
        if (seen.has(current)) throw new Error("cyclic JSON value")
        seen.add(current)
      }
      return current
    })
    return typeof serialized === "string" ? serialized : null
  } catch {
    return null
  }
}
function hasForbiddenAnswerFields(question: object): boolean {
  return Object.keys(question).some((key) => {
    const normalized = key.toLowerCase()
    return normalized.includes("answer") || normalized.includes("solution") || normalized === "explanation"
  })
}
