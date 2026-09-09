import type { ChatMessage, ChatRole } from "../../types/chat"
import type { TutorTurnResult } from "../../engine/agents/tutorOrchestrator"
import type { PlannerResult } from "../../types/planner"

export interface StoredChatMessageSnapshot {
  id: string
  role: string
  content: string
  knowledgeRefsJson: string
  toolRefsJson: string
  guardrailJson: string
  attachmentsJson?: string
}

export function parsePlannerResultFromToolRefs(raw: string): PlannerResult | undefined {
  try {
    const parsed = JSON.parse(raw)
    const candidate = parsed?.plannerResult
    if (!candidate || !Array.isArray(candidate.nextTasks)) {
      return undefined
    }

    return {
      trigger: candidate.trigger,
      subjectCode: candidate.subjectCode,
      summary: candidate.summary,
      nextTasks: candidate.nextTasks,
      reviewFocus: Array.isArray(candidate.reviewFocus) ? candidate.reviewFocus : [],
      masterySignals: Array.isArray(candidate.masterySignals) ? candidate.masterySignals : [],
      prerequisiteSignals: Array.isArray(candidate.prerequisiteSignals) ? candidate.prerequisiteSignals : [],
      reviewDueSignals: Array.isArray(candidate.reviewDueSignals) ? candidate.reviewDueSignals : [],
      chapterSignals: Array.isArray(candidate.chapterSignals) ? candidate.chapterSignals : [],
      planningHorizon: candidate.planningHorizon,
      confidence: typeof candidate.confidence === "number" ? candidate.confidence : 0
    }
  } catch {
    return undefined
  }
}

export function restoreChatMessagesFromStoredMessages(storedMessages: StoredChatMessageSnapshot[]): ChatMessage[] {
  return storedMessages.filter(isStudentOrTutorMessage).map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    plannerResult: parsePlannerResultFromToolRefs(message.toolRefsJson),
    knowledgeRefsJson: message.knowledgeRefsJson,
    toolRefsJson: message.toolRefsJson,
    guardrailJson: message.guardrailJson,
    attachments: message.attachmentsJson ? safelyParseAttachments(message.attachmentsJson) : undefined
  }))
}

function safelyParseAttachments(json: string) {
  if (!json || json === "[]") return undefined
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

export function serializeChatMessageToolRefs(message: Pick<ChatMessage, "toolRefsJson" | "plannerResult">): string {
  if (message.toolRefsJson) {
    return message.toolRefsJson
  }

  if (!message.plannerResult) {
    return "[]"
  }

  return JSON.stringify({
    plannerResult: message.plannerResult
  })
}

export function createKnowledgeRefsJson(result: Pick<TutorTurnResult, "toolAgentResult">): string {
  const nodes = result.toolAgentResult.knowledgeContext?.nodes ?? []

  return JSON.stringify(
    nodes.map((node) => ({
      id: node.id,
      title: node.title,
      subjectCode: node.subjectCode
    }))
  )
}

export function createTutorTurnToolRefsJson(message: Pick<ChatMessage, "plannerResult">, result: TutorTurnResult): string {
  return JSON.stringify({
    plannerResult: message.plannerResult,
    provider: {
      name: result.providerName,
      model: result.model,
      promptVersion: result.promptVersion
    },
    socratic: {
      mode: result.mode,
      maxHintLevel: result.maxHintLevel,
      strategy: result.socraticDecision.strategy
    },
    tools: {
      knowledgeSearch: result.toolAgentResult.knowledgeSearch
        ? {
            ok: result.toolAgentResult.knowledgeSearch.ok,
            resultCount: result.toolAgentResult.knowledgeSearch.data?.results.length ?? 0,
            topNodeIds:
              result.toolAgentResult.knowledgeSearch.data?.results.map((item) => item.knowledgeNodeId).slice(0, 5) ?? [],
            provenance: result.toolAgentResult.knowledgeSearch.data?.provenance
          }
        : undefined,
      questionBankSearch: result.toolAgentResult.questionBankSearch
        ? {
            ok: result.toolAgentResult.questionBankSearch.ok,
            resultCount: result.toolAgentResult.questionBankSearch.data?.questions.length ?? 0,
            questionIds:
              result.toolAgentResult.questionBankSearch.data?.questions.map((item) => item.questionId).slice(0, 5) ?? []
          }
        : undefined,
      mathCompute: result.toolAgentResult.mathCompute
        ? {
            ok: result.toolAgentResult.mathCompute.ok,
            errorCode: result.toolAgentResult.mathCompute.errorCode,
            operation: result.toolAgentResult.mathCompute.data?.operation,
            engine: result.toolAgentResult.mathCompute.data?.engine
          }
        : undefined
    },
    assessmentResultId: result.assessmentResult?.id
  })
}

export function createGuardrailSummaryJson(result: Pick<TutorTurnResult, "guardrailReview">): string {
  return JSON.stringify({
    allowed: result.guardrailReview.allowed,
    source: result.guardrailReview.source,
    maxHintLevelDetected: result.guardrailReview.maxHintLevelDetected,
    violations: result.guardrailReview.violations,
    rewriteRequired: result.guardrailReview.rewriteRequired,
    rewriteAttempts: result.guardrailReview.rewriteAttempts ?? 0
  })
}

function isStudentOrTutorMessage(message: StoredChatMessageSnapshot): message is StoredChatMessageSnapshot & {
  role: ChatRole
} {
  return message.role === "student" || message.role === "tutor"
}
