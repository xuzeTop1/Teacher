/**
 * 练习提交答案的服务函数
 * 抽出供测试和 PracticeView 共用，避免逻辑散落在 Vue 组件中
 */

import type { QuestionBankSearchOutput } from "../../types/tool"
import type { SubjectCode } from "../../types/learning"
import type { DiagnosticProvenance } from "../../types/assessment"
import { evaluateAnswer, buildKnowledgeSnapshots, type PracticeBktDelta, type PracticeSaveResult } from "./practiceLogic"

export interface SubmitPracticeAnswerInput {
  question: QuestionBankSearchOutput["questions"][number]
  studentAnswer: string
  subjectCode: SubjectCode
  studentId: string
  revealedHintsCount: number
  studentKnowledge: Array<{
    knowledgeNodeId: string
    masteryProbability: number
    attemptsCount: number
    correctCount: number
    title: string
  }>
  conversationId: string | null
  /** Only AlertTime sync diagnostic passes this; ordinary PracticeView omits it. */
  diagnosticProvenance?: DiagnosticProvenance
  bktUpdateMastery: (pKnow: number, correct: boolean) => Promise<{ pKnow: number }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saveAssessmentResult: (result: any) => Promise<any>
}

/**
 * 提交练习答案：评估 → BKT → 保存 assessment
 * 返回 PracticeSaveResult 供 UI 展示保存状态
 */
export async function submitPracticeAnswer(input: SubmitPracticeAnswerInput): Promise<PracticeSaveResult> {
  const {
    question,
    studentAnswer,
    subjectCode,
    studentId,
    revealedHintsCount,
    studentKnowledge,
    conversationId,
    diagnosticProvenance,
    bktUpdateMastery,
    saveAssessmentResult
  } = input

  const correct = evaluateAnswer(studentAnswer, question.answer)
  const knowledgeDeltas: PracticeBktDelta[] = []
  let bktOk = true

  // BKT 计算每个知识节点的掌握度变化
  for (const nodeId of question.knowledgeNodeIds) {
    const existing = studentKnowledge.find((k) => k.knowledgeNodeId === nodeId)
    const currentPknow = existing?.masteryProbability ?? 0.5
    try {
      const bktResult = await bktUpdateMastery(currentPknow, correct)
      const delta = bktResult.pKnow - currentPknow
      knowledgeDeltas.push({ knowledgeNodeId: nodeId, masteryDelta: delta })
    } catch {
      bktOk = false
      knowledgeDeltas.push({ knowledgeNodeId: nodeId, masteryDelta: correct ? 0.1 : -0.05 })
    }
  }

  // 构建 conversationId：优先使用已确保存在的 practice conversation
  const effectiveConversationId = conversationId ?? `local-default-conversation-${subjectCode}`

  // 保存 assessment 结果
  try {
    await saveAssessmentResult({
      id: `practice-${question.questionId}-${Date.now()}`,
      studentId,
      conversationId: effectiveConversationId,
      subjectCode,
      assessmentMode: "turn_assessment",
      correctness: correct ? "correct" : "incorrect",
      confidence: correct ? 0.8 : 0.3,
      evidence: JSON.stringify({
        questionId: question.questionId,
        correct,
        hintsUsed: revealedHintsCount,
        // 归属证据只来自已通过 questionScope 门禁并随题返回的字段；
        // 不从 UI 范围或 legacy subjectCode 推断考试叶子。
        examTrackId: question.examTrackId ?? null,
        subjectId: question.subjectId ?? null,
        moduleId: question.moduleId ?? null,
        packId: question.packId ?? null
      }),
      knowledgeUpdates: knowledgeDeltas.map((d) => ({
        knowledgeNodeId: d.knowledgeNodeId,
        masteryDelta: d.masteryDelta,
        reason: correct ? "练习正确" : "练习错误"
      })),
      knowledgeSnapshots: buildKnowledgeSnapshots(question, subjectCode),
      detectedMisconceptions: correct ? [] : ["练习中出现错误"],
      suggestedNextAction: correct ? "continue" : "review",
      ...(diagnosticProvenance ? { diagnosticProvenance } : {}),
      createdAt: new Date().toISOString()
    })
    // Only reflect the new values after the durable assessment write succeeds.
    for (const delta of knowledgeDeltas) {
      const existing = studentKnowledge.find((item) => item.knowledgeNodeId === delta.knowledgeNodeId)
      if (existing) {
        existing.masteryProbability = Math.max(0.001, Math.min(0.999, existing.masteryProbability + delta.masteryDelta))
        existing.attemptsCount++
        if (correct) existing.correctCount++
      }
    }
    return { success: true, correct, bktUpdated: bktOk, assessmentSaved: true, knowledgeUpdated: true }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    return { success: false, correct, bktUpdated: bktOk, assessmentSaved: false, knowledgeUpdated: false, error: errorMsg }
  }
}
