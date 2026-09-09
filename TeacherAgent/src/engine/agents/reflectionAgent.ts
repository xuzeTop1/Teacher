import type {
  NextBestActionType,
  ObservedPerformance,
  ReflectionAgentInput,
  ReflectionAgentResult,
  ReflectionMemoryCandidate,
  ReflectionMisconception,
  ReflectionNextBestAction,
  ReflectionRecord,
  ReflectionStrategy,
  ReflectionStrategyInsight,
  StrategyEffect
} from "../../types/reflection"
import type { MemoryKind } from "../../types/memory"
import { subjectLabel } from "../../utils/subject"
import { createId, truncateText as truncate, uniqueStrings as unique } from "../../utils/text"

export function reflectOnTutorTurn(input: ReflectionAgentInput): ReflectionAgentResult {
  const now = new Date().toISOString()
  const learningGoals = extractLearningGoals(input.userMessage)
  const explanationPreferences = extractPreferences(input.userMessage)
  const affectiveSignals = extractAffectiveSignals(input.userMessage)
  const misconceptions = extractMisconceptions(input)
  const strategyInsight = buildStrategyInsight(input)
  const knowledgeUpdates = buildKnowledgeUpdates(input)
  const nextBestAction = buildNextBestAction(input, misconceptions.length > 0)
  const observations = buildObservations(input, misconceptions.length > 0)
  const inferences = buildInferences(input, misconceptions, strategyInsight)
  const uncertainties = buildUncertainties(input, misconceptions.length > 0)
  const conversationSummary = buildConversationSummary(input, nextBestAction.type)
  const memoryCandidates = buildMemoryCandidates({
    input,
    learningGoals,
    explanationPreferences,
    affectiveSignals,
    misconceptions,
    strategyInsight,
    knowledgeUpdates
  })

  return {
    record: {
      id: createId("reflection"),
      conversationId: input.conversationId,
      studentId: input.studentId,
      subjectCode: input.subjectCode,
      conversationSummary,
      observations,
      inferences,
      uncertainties,
      knowledgeUpdates,
      misconceptions,
      strategyInsights: [strategyInsight],
      nextBestAction,
      confidence: calculateReflectionConfidence(input, misconceptions.length > 0),
      createdAt: now
    },
    profileUpdates: {
      learningGoals,
      explanationPreferences,
      recurringMisconceptions: misconceptions.map((item) => item.inference),
      effectiveStrategies: strategyInsight.effect === "helpful" ? [input.strategy] : [],
      affectiveSignals,
      confidenceDelta: memoryCandidates.length > 0 ? 0.03 : 0
    },
    memoryCandidates
  }
}

function buildKnowledgeUpdates(input: ReflectionAgentInput) {
  const performance = inferObservedPerformance(input)
  const masteryDelta = masteryDeltaFor(performance, input.maxHintLevel)
  const confidence = input.knowledgeNodes?.length ? 0.55 : 0.25

  return (input.knowledgeNodes ?? []).slice(0, 3).map((node) => ({
    knowledgeNodeId: node.id,
    observedPerformance: performance,
    masteryDelta,
    evidence: truncate(`学生输入：${input.userMessage}`, 180),
    confidence
  }))
}

function inferObservedPerformance(input: ReflectionAgentInput): ObservedPerformance {
  const message = input.userMessage
  const reply = input.tutorReply

  if (/(?:哪里错|错了|不对|为什么错|我算)/.test(message) || /(?:问题在于|关键错误|不对|这里卡住)/.test(reply)) {
    return "partially_correct"
  }

  if (/(?:不会|不懂|看不懂|卡住)/.test(message)) {
    return "unknown"
  }

  if (/(?:我觉得|我认为|因为|所以|=|≈|->|→)/.test(message) && /(?:方向是对|这个思路可以|对的|正确)/.test(reply)) {
    return "partially_correct"
  }

  if (input.mode === "review") {
    return "unknown"
  }

  return "unknown"
}

function masteryDeltaFor(performance: ObservedPerformance, hintLevel: string): number {
  if (performance === "correct") return 0.08
  if (performance === "partially_correct") return hintLevel === "L3" || hintLevel === "L4" ? 0.02 : 0.04
  if (performance === "incorrect") return -0.04
  return 0
}

function extractMisconceptions(input: ReflectionAgentInput): ReflectionMisconception[] {
  const nodeMisconceptions = unique(input.knowledgeNodes?.flatMap((node) => node.misconceptions ?? []) ?? [])
  const shouldRecord =
    input.mode === "diagnose" || /(?:哪里错|不对|错了|为什么错|我算|不会|不懂|看不懂|卡住)/.test(input.userMessage)

  if (!shouldRecord) return []

  const candidates = nodeMisconceptions.length
    ? nodeMisconceptions
    : ["当前题型的关键步骤或概念边界可能还不稳"]

  return candidates.slice(0, 2).map((candidate) => ({
    type: classifyMisconception(candidate),
    observation: truncate(`学生本轮表达：${input.userMessage}`, 180),
    inference: candidate,
    confidence: nodeMisconceptions.length ? 0.58 : 0.42
  }))
}

function buildStrategyInsight(input: ReflectionAgentInput): ReflectionStrategyInsight {
  const mapped = mapStrategy(input.strategy)
  const askedQuestion = /[？?]/.test(input.tutorReply)
  const effect = input.mode === "review" ? "neutral" : askedQuestion ? "helpful" : "unknown"

  return {
    strategy: mapped,
    effect,
    evidence: askedQuestion
      ? "导师回复保留了学生可继续推进的小问题。"
      : "本轮尚缺少学生后续反馈，策略效果需要继续观察。"
  }
}

function buildNextBestAction(input: ReflectionAgentInput, hasMisconception: boolean): ReflectionNextBestAction {
  if (input.mode === "review") {
    return {
      type: "practice",
      reason: "本轮已进入复盘，下一步适合用相近变式检查迁移。"
    }
  }

  if (hasMisconception) {
    return {
      type: "explain_concept",
      reason: "本轮暴露了可能的概念边界或关键步骤误区。"
    }
  }

  if (input.maxHintLevel === "L3") {
    return {
      type: "continue_problem",
      reason: "已经给到关键步骤提示，下一轮应让学生完成剩余步骤。"
    }
  }

  return {
    type: "continue_problem",
    reason: "本轮仍适合保持引导式推进，等待学生尝试下一步。"
  }
}

function buildObservations(input: ReflectionAgentInput, hasMisconception: boolean): string[] {
  const observations = [`学生本轮输入：${truncate(input.userMessage, 120)}`]

  if (input.knowledgeNodes?.length) {
    observations.push(`本轮检索到知识点：${input.knowledgeNodes.map((node) => node.title).slice(0, 3).join("、")}`)
  }

  if (hasMisconception) {
    observations.push("学生输入或对话模式显示当前需要诊断误区。")
  }

  return observations
}

function buildInferences(
  input: ReflectionAgentInput,
  misconceptions: ReflectionMisconception[],
  strategyInsight: ReflectionStrategyInsight
): string[] {
  const inferences = misconceptions.map((item) => item.inference)

  if (strategyInsight.effect === "helpful") {
    inferences.push(`本轮 ${input.strategy} 策略可能适合继续使用。`)
  }

  return unique(inferences).slice(0, 4)
}

function buildUncertainties(input: ReflectionAgentInput, hasMisconception: boolean): string[] {
  const uncertainties: string[] = []

  if (!input.recentMessages?.length) {
    uncertainties.push("缺少更长对话历史，不能仅凭本轮判断长期能力。")
  }

  if (hasMisconception) {
    uncertainties.push("误区判断需要通过下一轮学生作答继续验证。")
  }

  return uncertainties
}

function buildConversationSummary(input: ReflectionAgentInput, nextAction: NextBestActionType): string {
  const topic = input.knowledgeNodes?.[0]?.title ?? subjectLabel(input.subjectCode)
  return `本轮围绕「${topic}」进行${modeLabel(input.mode)}，下一步建议：${nextAction}。`
}

function buildMemoryCandidates(args: {
  input: ReflectionAgentInput
  learningGoals: string[]
  explanationPreferences: string[]
  affectiveSignals: string[]
  misconceptions: ReflectionMisconception[]
  strategyInsight: ReflectionStrategyInsight
  knowledgeUpdates: ReturnType<typeof buildKnowledgeUpdates>
}): ReflectionMemoryCandidate[] {
  const memories: ReflectionMemoryCandidate[] = []

  for (const goal of args.learningGoals) {
    memories.push(createMemory("learning_goal", goal, args.input.userMessage, 0.75, "user_explicit"))
  }

  for (const preference of args.explanationPreferences) {
    memories.push(createMemory("preference", preference, args.input.userMessage, 0.7, "user_explicit"))
  }

  for (const misconception of args.misconceptions) {
    memories.push(createMemory("misconception", misconception.inference, misconception.observation, misconception.confidence, "rule_reflection"))
  }

  for (const signal of args.affectiveSignals) {
    memories.push(createMemory("affective_signal", signal, args.input.userMessage, 0.55, "rule_reflection"))
  }

  if (args.strategyInsight.effect === "helpful") {
    memories.push(createMemory("strategy_signal", `${args.input.strategy} 对本轮引导可能有效`, args.strategyInsight.evidence, 0.52, "rule_reflection"))
  }

  for (const update of args.knowledgeUpdates.filter((item) => item.masteryDelta !== 0)) {
    memories.push(
      createMemory(
        "mastery_signal",
        `${update.knowledgeNodeId} 本轮表现：${update.observedPerformance}，掌握度变化 ${update.masteryDelta}`,
        update.evidence,
        update.confidence,
        "rule_reflection"
      )
    )
  }

  return memories
}

function createMemory(
  kind: ReflectionMemoryCandidate["kind"],
  summary: string,
  evidence: string,
  confidence: number,
  source: ReflectionMemoryCandidate["source"]
): ReflectionMemoryCandidate {
  return {
    kind,
    summary: truncate(summary, 180),
    evidence: truncate(evidence, 220),
    confidence,
    source
  }
}

function extractLearningGoals(message: string): string[] {
  const goals: string[] = []

  if (/(?:考研|研究生考试)/.test(message)) goals.push("目标包含考研备考")
  if (/(?:期末|考试|测验)/.test(message)) goals.push("目标包含近期考试或测验")
  if (/(?:CPA|注会|法考|资格证)/i.test(message)) goals.push("目标包含资格证或职业考试")
  if (/(?:我要|我想|目标是|计划).{0,24}(?:学会|掌握|提高|提分|通过)/.test(message)) {
    goals.push(`用户明确表达学习目标：${truncate(message, 80)}`)
  }

  return goals
}

function extractPreferences(message: string): string[] {
  const preferences: string[] = []

  if (/(?:简单点|通俗|白话|别太抽象)/.test(message)) preferences.push("偏好通俗、低抽象度讲解")
  if (/(?:详细|一步一步|不要跳步)/.test(message)) preferences.push("偏好分步骤、少跳步讲解")
  if (/(?:举例|例子|类比)/.test(message)) preferences.push("偏好例子或类比辅助理解")
  if (/(?:严谨|证明|推导|条件)/.test(message)) preferences.push("偏好严谨推导和适用条件")
  if (/(?:幽默|轻松|别太严肃)/.test(message)) preferences.push("偏好轻松一点的表达")
  if (/(?:不要直接给答案|先提示|引导我)/.test(message)) preferences.push("偏好引导式提示而非直接给答案")

  return preferences
}

function extractAffectiveSignals(message: string): string[] {
  const signals: string[] = []

  if (/(?:焦虑|崩溃|绝望|烦死|emo)/i.test(message)) signals.push("近期学习情绪压力较高")
  if (/(?:我太笨|学不会|看不懂|不会)/.test(message)) signals.push("遇到困难时容易自我否定或降低信心")

  return signals
}

function mapStrategy(strategy: string): ReflectionStrategy {
  if (strategy === "analogy_bridge") return "analogy"
  if (strategy === "counterexample") return "counterexample"
  if (strategy === "direct_review") return "direct_explanation"
  if (strategy === "decomposition") return "step_hint"
  return "socratic_question"
}

function classifyMisconception(value: string): string {
  if (/(?:定义|函数值|极限值|概念|条件)/.test(value)) return "concept_boundary"
  if (/(?:步骤|代入|计算|变形|推导)/.test(value)) return "procedure"
  return "unknown_misconception"
}

function calculateReflectionConfidence(input: ReflectionAgentInput, hasMisconception: boolean): number {
  let confidence = 0.35
  if (input.knowledgeNodes?.length) confidence += 0.15
  if (hasMisconception) confidence += 0.08
  if (input.recentMessages?.length) confidence += 0.07
  return Math.min(confidence, 0.72)
}

function modeLabel(mode: string): string {
  if (mode === "review") return "复盘"
  if (mode === "diagnose") return "诊断"
  if (mode === "explain") return "概念解释"
  if (mode === "exam_sprint") return "冲刺引导"
  return "引导"
}

// ===== LLM-Powered Reflection (Phase 2+) =====

const LLM_REFLECTION_PROMPT = `你是 TeacherAgent 的学习反思引擎。请根据本轮对话，提取可用于后续个性化教学的结构化信息。

请区分：
- observation：对话中直接可见的事实。
- inference：基于事实的谨慎推断。
- uncertainty：仍不确定、需要后续验证的点。

不要夸大学生能力变化。不要把一次表现永久化。

输出 JSON：
{
  "conversationSummary": "一句话总结本轮学习内容",
  "observations": ["观察1", "观察2"],
  "inferences": ["推断1", "推断2"],
  "uncertainties": ["不确定1"],
  "knowledgeUpdates": [
    {
      "knowledgeNodeId": "string",
      "observedPerformance": "correct | partially_correct | incorrect | unknown",
      "masteryDelta": -0.1,
      "evidence": "string",
      "confidence": 0.5
    }
  ],
  "misconceptions": [
    {
      "type": "string",
      "observation": "string",
      "inference": "string",
      "confidence": 0.5
    }
  ],
  "strategyInsights": [
    {
      "strategy": "socratic_question | analogy | counterexample | step_hint | direct_explanation",
      "effect": "helpful | neutral | unhelpful | unknown",
      "evidence": "string"
    }
  ],
  "nextBestAction": {
    "type": "review | practice | explain_concept | continue_problem | assess",
    "reason": "string"
  },
  "memoryCandidates": [
    {
      "kind": "learning_goal | preference | misconception | mastery_signal | affective_signal",
      "summary": "string",
      "evidence": "string",
      "confidence": 0.5
    }
  ]
}`

interface LlmReflectionInput {
  input: ReflectionAgentInput
  providerConfig: {
    baseUrl: string
    apiKeyRef: string
    model: string
  }
}

/**
 * Generate a reflection using LLM when a provider is configured.
 * Falls back to rule-based reflection on any error.
 */
export async function reflectOnTutorTurnWithLlm(
  input: ReflectionAgentInput,
  providerConfig: { baseUrl: string; apiKeyRef: string; model: string }
): Promise<ReflectionAgentResult> {
  try {
    const contextMessages = [
      { role: "system" as const, content: LLM_REFLECTION_PROMPT },
      {
        role: "user" as const,
        content: buildReflectionPrompt(input)
      }
    ]

    const { completeLlmChat } = await import("../../services/tauri/commands")
    const result = await completeLlmChat(
      {
        providerName: "reflection",
        baseUrl: providerConfig.baseUrl,
        model: providerConfig.model,
        apiKeyRef: providerConfig.apiKeyRef
      },
      {
        messages: contextMessages,
        temperature: 0.3,
        maxTokens: 1024
      }
    )

    const parsed = parseLlmReflection(result.content, input)
    if (parsed) {
      return parsed
    }
  } catch (error) {
    console.warn("[TeacherAgent] LLM reflection failed, falling back to rule-based:", error)
  }

  // Fallback to rule-based
  return reflectOnTutorTurn(input)
}

function buildReflectionPrompt(input: ReflectionAgentInput): string {
  const parts = [
    `学科：${subjectLabel(input.subjectCode)}`,
    `教学模式：${modeLabel(input.mode)}`,
    `提示等级：${input.maxHintLevel}`,
    `教学策略：${input.strategy}`,
    "",
    `学生输入：${input.userMessage}`,
    "",
    `导师回复：${input.tutorReply}`
  ]

  if (input.knowledgeNodes?.length) {
    parts.push("", `涉及知识点：${input.knowledgeNodes.map((n) => n.title).join("、")}`)
  }

  if (input.recentMessages?.length) {
    const history = input.recentMessages
      .slice(-4)
      .map((m) => `${m.role === "student" ? "学生" : "导师"}：${m.content.slice(0, 100)}`)
      .join("\n")
    parts.push("", `近期对话：`, history)
  }

  return parts.join("\n")
}

function parseLlmReflection(
  content: string,
  input: ReflectionAgentInput
): ReflectionAgentResult | null {
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const data = JSON.parse(jsonMatch[0])
    const now = new Date().toISOString()

    const record: ReflectionRecord = {
      id: createId("reflection"),
      conversationId: input.conversationId,
      studentId: input.studentId,
      subjectCode: input.subjectCode,
      conversationSummary: data.conversationSummary ?? "本轮对话",
      observations: Array.isArray(data.observations) ? data.observations : [],
      inferences: Array.isArray(data.inferences) ? data.inferences : [],
      uncertainties: Array.isArray(data.uncertainties) ? data.uncertainties : [],
      knowledgeUpdates: Array.isArray(data.knowledgeUpdates)
        ? data.knowledgeUpdates.map((u: Record<string, unknown>) => ({
            knowledgeNodeId: String(u.knowledgeNodeId ?? ""),
            observedPerformance: (u.observedPerformance ?? "unknown") as ObservedPerformance,
            masteryDelta: typeof u.masteryDelta === "number" ? u.masteryDelta : 0,
            evidence: String(u.evidence ?? ""),
            confidence: typeof u.confidence === "number" ? u.confidence : 0.3
          }))
        : [],
      misconceptions: Array.isArray(data.misconceptions)
        ? data.misconceptions.map((m: Record<string, unknown>) => ({
            type: String(m.type ?? "unknown"),
            observation: String(m.observation ?? ""),
            inference: String(m.inference ?? ""),
            confidence: typeof m.confidence === "number" ? m.confidence : 0.3
          }))
        : [],
      strategyInsights: Array.isArray(data.strategyInsights)
        ? data.strategyInsights.map((s: Record<string, unknown>) => ({
            strategy: mapStrategy(String(s.strategy ?? input.strategy)),
            effect: (s.effect ?? "unknown") as StrategyEffect,
            evidence: String(s.evidence ?? "")
          }))
        : [],
      nextBestAction: {
        type: (data.nextBestAction?.type ?? "continue_problem") as NextBestActionType,
        reason: String(data.nextBestAction?.reason ?? "")
      },
      confidence: 0.65, // LLM reflection has higher base confidence
      createdAt: now
    }

    const memoryCandidates: ReflectionMemoryCandidate[] = Array.isArray(data.memoryCandidates)
      ? data.memoryCandidates.map((m: Record<string, unknown>) => ({
          kind: (m.kind ?? "mastery_signal") as MemoryKind,
          summary: String(m.summary ?? ""),
          evidence: String(m.evidence ?? ""),
          confidence: typeof m.confidence === "number" ? m.confidence : 0.3,
          source: "rule_reflection" as const
        }))
      : []

    return {
      record,
      profileUpdates: {
        learningGoals: [],
        explanationPreferences: [],
        recurringMisconceptions: record.misconceptions.map((m) => m.inference),
        effectiveStrategies: record.strategyInsights
          .filter((s) => s.effect === "helpful")
          .map((s) => s.strategy),
        affectiveSignals: [],
        confidenceDelta: 0.05
      },
      memoryCandidates
    }
  } catch {
    return null
  }
}
