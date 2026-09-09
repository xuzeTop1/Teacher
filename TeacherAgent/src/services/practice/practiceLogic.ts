/**
 * 练习模块核心纯逻辑
 * - evaluateAnswer: 评估学生答案是否正确
 * - buildKnowledgeSnapshots: 为 assessment 构建知识节点快照（确保 knowledge_nodes 存在）
 */

import type { KnowledgeNodeRef, SubjectCode } from "../../types/learning"
import type { QuestionBankSearchOutput } from "../../types/tool"

/** 评估学生答案是否正确 */
export function evaluateAnswer(studentAnswer: string, correctAnswer: string | undefined): boolean {
  if (!correctAnswer) return false
  const normalized = studentAnswer.trim().toLowerCase()
  const answer = correctAnswer.trim().toLowerCase()
  if (!normalized) return false

  // 数字答案做严格数值比较
  const correctNum = tryParseNumber(answer)
  if (correctNum !== null) {
    // correctAnswer 是纯数字 → 从 studentAnswer 中提取数字做严格比较
    const studentNum = tryParseNumber(normalized)
    if (studentNum !== null) {
      return studentNum === correctNum
    }
    // studentAnswer 包含文本，尝试提取嵌入的数字
    const embeddedNums = extractNumbers(normalized)
    return embeddedNums.some((n) => n === correctNum)
  }

  // Textual answers must match after only harmless answer-label punctuation is
  // stripped. Substring matching accepts negations such as “不是 x=2”.
  const normalizeTextAnswer = (value: string) => value
    .replace(/^(?:答案(?:是|为)?|(?:the\s+)?answer(?:\s+is)?)[：:=\s]*/i, "")
    .replace(/[。！!？?\s]+$/g, "")
    .trim()
  return normalizeTextAnswer(normalized) === normalizeTextAnswer(answer)
}

/** 尝试解析纯数字（支持整数、小数、负数、科学记数法） */
function tryParseNumber(value: string): number | null {
  // 去掉常见的非数字前缀/后缀
  const cleaned = value.replace(/^[=＝:：\s]+/, "").replace(/[?？.。!！\s]+$/, "")
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** 从文本中提取所有数字（整数、小数、负数） */
function extractNumbers(value: string): number[] {
  const matches = value.match(/-?\d+(?:\.\d+)?/g)
  if (!matches) return []
  return matches.map((m) => Number(m)).filter((n) => Number.isFinite(n))
}

/** 从题库题目构建知识节点快照，用于 saveAssessmentResult 的 knowledgeSnapshots 字段 */
export function buildKnowledgeSnapshots(
  question: QuestionBankSearchOutput["questions"][number],
  subjectCode: SubjectCode
): KnowledgeNodeRef[] {
  return question.knowledgeNodeIds.map((nodeId) => ({
    id: nodeId,
    title: nodeId,
    subjectCode,
    summary: `练习题关联知识点：${question.title ?? question.content.slice(0, 60)}`
  }))
}

/** 练习保存结果 */
export interface PracticeSaveResult {
  success: boolean
  /** 本次答题是否正确（由 evaluateAnswer 判定） */
  correct: boolean
  bktUpdated: boolean
  assessmentSaved: boolean
  knowledgeUpdated: boolean
  error?: string
}

/** 练习 BKT 计算结果 */
export interface PracticeBktDelta {
  knowledgeNodeId: string
  masteryDelta: number
}
