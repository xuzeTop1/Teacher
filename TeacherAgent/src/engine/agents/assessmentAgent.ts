import type {
  AssessmentAgentInput,
  AssessmentCorrectness,
  AssessmentNextAction,
  AssessmentResult
} from "../../types/assessment"
import { subjectLabel } from "../../utils/subject"
import { createId, truncateText as truncate, uniqueStrings as unique } from "../../utils/text"

export function assessTutorTurn(input: AssessmentAgentInput): AssessmentResult {
  const correctness = inferCorrectness(input)
  const detectedMisconceptions = inferMisconceptions(input, correctness)
  const knowledgeUpdates = buildKnowledgeUpdates(input, correctness)
  const suggestedNextAction = suggestNextAction(input, correctness, detectedMisconceptions.length > 0)
  const evidence = buildEvidence(input, correctness)
  const confidence = calculateConfidence(input, correctness, detectedMisconceptions.length > 0)

  return {
    id: createId("assessment"),
    studentId: input.studentId,
    conversationId: input.conversationId,
    subjectCode: input.subjectCode,
    assessmentMode: "turn_assessment",
    correctness,
    confidence,
    evidence,
    knowledgeUpdates,
    knowledgeSnapshots: assessableKnowledgeNodes(input).slice(0, 3),
    detectedMisconceptions,
    suggestedNextAction,
    createdAt: new Date().toISOString()
  }
}

function inferCorrectness(input: AssessmentAgentInput): AssessmentCorrectness {
  const message = input.userMessage
  const reply = input.tutorReply

  if (/(?:不会|不懂|看不懂|卡住|没思路|算不出来)/.test(message)) {
    return "unknown"
  }

  if (/(?:错了|不对|哪里错|为什么错|算错|我算)/.test(message)) {
    return /(?:关键错误|问题在于|不对|错在|这里需要改)/.test(reply) ? "incorrect" : "partially_correct"
  }

  if (/(?:我觉得|我认为|因为|所以|=|≈|->|→|得出|答案是)/.test(message)) {
    if (/(?:完全正确|是正确的|推理正确|你的答案正确)(?![吗？?])/.test(reply)) {
      return "correct"
    }
    if (/(?:方向是对|思路可以|这一步对|部分正确|还差|接近)/.test(reply)) {
      return "partially_correct"
    }
    if (/(?:不对|错误|问题在于|关键错误|需要重新)/.test(reply)) {
      return "incorrect"
    }
  }

  return "unknown"
}

function buildKnowledgeUpdates(
  input: AssessmentAgentInput,
  correctness: AssessmentCorrectness
): AssessmentResult["knowledgeUpdates"] {
  // unknown means no assessable attempt — do not generate any knowledge updates.
  // explain, review, planner, and普通提问 all flow through unknown and must not
  // touch attempts_count or correct_count.
  if (correctness === "unknown") {
    return []
  }

  const masteryDelta = masteryDeltaFor(correctness, input.maxHintLevel)

  return assessableKnowledgeNodes(input).slice(0, 3).map((node) => ({
    knowledgeNodeId: node.id,
    masteryDelta,
    correctness,
    reason: buildKnowledgeUpdateReason(node.title, correctness, input.maxHintLevel)
  }))
}

function assessableKnowledgeNodes(input: AssessmentAgentInput) {
  return (input.knowledgeNodes ?? []).filter(
    (node) => node.sourceType !== "private_document" && !node.id.startsWith("private:")
  )
}

function masteryDeltaFor(correctness: AssessmentCorrectness, hintLevel: string): number {
  if (correctness === "correct") return hintLevel === "L1" || hintLevel === "L2" ? 0.08 : 0.05
  if (correctness === "partially_correct") return hintLevel === "L3" || hintLevel === "L4" ? 0.02 : 0.04
  if (correctness === "incorrect") return -0.04
  return 0
}

function inferMisconceptions(input: AssessmentAgentInput, correctness: AssessmentCorrectness): string[] {
  const shouldDiagnose =
    correctness === "incorrect" ||
    input.mode === "diagnose" ||
    /(?:不会|不懂|看不懂|卡住|哪里错|为什么错)/.test(input.userMessage)

  if (!shouldDiagnose) {
    return []
  }

  const fromKnowledge = input.knowledgeNodes?.flatMap((node) => node.misconceptions ?? []) ?? []
  const fallback = ["当前知识点的概念边界或关键步骤可能仍需验证"]

  return unique(fromKnowledge.length ? fromKnowledge : fallback).slice(0, 3)
}

function suggestNextAction(
  input: AssessmentAgentInput,
  correctness: AssessmentCorrectness,
  hasMisconception: boolean
): AssessmentNextAction {
  if (hasMisconception || correctness === "incorrect") return "explain_concept"
  if (correctness === "correct") return "practice"
  if (correctness === "partially_correct") return input.maxHintLevel === "L3" || input.maxHintLevel === "L4" ? "continue" : "hint"
  if (input.mode === "review") return "review"
  return "continue"
}

function calculateConfidence(
  input: AssessmentAgentInput,
  correctness: AssessmentCorrectness,
  hasMisconception: boolean
): number {
  let confidence = correctness === "unknown" ? 0.28 : 0.42

  if (input.knowledgeNodes?.length) confidence += 0.1
  if (input.recentMessages?.length) confidence += 0.06
  if (hasMisconception) confidence += 0.05
  if (/(?:正确|对|错误|不对|问题在于|关键错误)/.test(input.tutorReply)) confidence += 0.08

  return Math.min(confidence, 0.68)
}

function buildEvidence(input: AssessmentAgentInput, correctness: AssessmentCorrectness): string {
  const topic = input.knowledgeNodes?.[0]?.title ?? subjectLabel(input.subjectCode)
  return truncate(`主题：${topic}；判断：${correctness}；学生输入：${input.userMessage}`, 220)
}

function buildKnowledgeUpdateReason(title: string, correctness: AssessmentCorrectness, hintLevel: string): string {
  return `围绕「${title}」的本轮表现为 ${correctness}，提示等级为 ${hintLevel}。`
}
