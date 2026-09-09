/**
 * AlertTime 学科诊断编排（纯规则；题目全部来自 approved 题库）。
 *
 * 掌握度边界：
 * - 只使用 approved 题库的题目；题目来源与知识节点可追踪（question.source + knowledgeNodeIds）。
 * - 未答题不得更新 mastery；学习时长只影响投入度判断。
 * - 答题结果通过既有 submitPracticeAnswer 链路（BKT + assessment_results + student_knowledge）落库，
 *   不绕过 GuardrailAgent（本引擎不生成 LLM 内容）。
 */

import type { QuestionBankSearchOutput } from "../../types/tool"
import { evaluateAnswer } from "../../services/practice/practiceLogic"
import type { DiagnosticEvidence } from "./proposalPlanner"

export const DIAGNOSTIC_QUESTION_COUNT = 5

export interface DiagnosticQuestion {
  questionId: string
  content: string
  type: string
  difficulty: number
  knowledgeNodeIds: string[]
  sourceTitle: string
  /** 考试体系归属（考试叶子范围出题时随题返回，用于「本题属于」展示） */
  examTrackId?: string | null
  subjectId?: string | null
  moduleId?: string | null
  packId?: string | null
}

/** 本次诊断全部题目的知识点白名单；空结果必须保持为空，不得回退整学科。 */
export function collectDiagnosticKnowledgeNodeIds(questions: DiagnosticQuestion[]): string[] {
  return [...new Set(questions.flatMap((question) => question.knowledgeNodeIds))].sort()
}

export interface DiagnosticAnswerRecord {
  questionId: string
  studentAnswer: string
  correct: boolean
  answeredAtMs: number
}

export interface DiagnosticSummary {
  questionCount: number
  correctCount: number
  correctRate: number
}

/** 从 approved 题库结果中挑选诊断题：优先 diagnostic 类型与中等难度，控制数量。 */
export function selectDiagnosticQuestions(
  searchOutput: QuestionBankSearchOutput,
  count: number = DIAGNOSTIC_QUESTION_COUNT
): DiagnosticQuestion[] {
  const questions = [...searchOutput.questions]
    .sort((left, right) => {
      const leftScore = (left.type === "diagnostic" ? 2 : left.type === "concept_check" ? 1 : 0) +
        (left.difficulty === 2 ? 1 : 0)
      const rightScore = (right.type === "diagnostic" ? 2 : right.type === "concept_check" ? 1 : 0) +
        (right.difficulty === 2 ? 1 : 0)
      return rightScore - leftScore
    })
    .slice(0, count)
    .map((question) => ({
      questionId: question.questionId,
      content: question.content,
      type: question.type,
      difficulty: question.difficulty,
      knowledgeNodeIds: question.knowledgeNodeIds,
      sourceTitle: question.source?.title ?? "",
      examTrackId: question.examTrackId ?? null,
      subjectId: question.subjectId ?? null,
      moduleId: question.moduleId ?? null,
      packId: question.packId ?? null
    }))
  return questions
}

/** 判分：复用练习模块的评估逻辑（大小写/空白不敏感）。 */
export function isAnswerCorrect(studentAnswer: string, question: DiagnosticQuestion, answer: string): boolean {
  return evaluateAnswer(studentAnswer, answer)
}

export function summarizeDiagnostic(records: DiagnosticAnswerRecord[]): DiagnosticSummary {
  const correctCount = records.filter((record) => record.correct).length
  return {
    questionCount: records.length,
    correctCount,
    correctRate: records.length > 0 ? correctCount / records.length : 0
  }
}

/** 单题成功持久化的评估记录（evidence 只统计这些题）。 */
export interface DiagnosticSavedRecord {
  assessmentId: string
  questionId: string
  correct: boolean
}

export interface DiagnosticEvidenceContext {
  /** AlertTime 科目 remoteId；新证据的主归属键，不能由 teacherSubjectId 推导。 */
  alertSubjectRemoteId: string
  teacherSubjectId: string
  examTrackId?: string | null
  examSubjectId?: string | null
  examModuleId?: string | null
}

/**
 * 构建持久化诊断证据（fail-closed）：
 * - 只有真实保存成功的 assessment id 才能成为教学证据；
 * - questionCount/correctCount 只统计成功持久化的题（未落库的答题不得计入）；
 * - savedRecords 为空时返回 null（不允许用失败结果生成掌握度计划）；
 * - 不生成 synthetic assessmentId 充当持久化证据；
 * - assessmentIds 携带该批全部真实持久化 id，供 proposal sourceAssessmentIds 使用。
 */
export function buildDiagnosticEvidence(
  savedRecords: DiagnosticSavedRecord[],
  context: DiagnosticEvidenceContext,
  nowMs: number
): DiagnosticEvidence | null {
  if (savedRecords.length === 0) return null
  const assessmentIds = savedRecords.map((record) => record.assessmentId)
  return {
    assessmentId: assessmentIds[assessmentIds.length - 1],
    assessmentIds,
    alertSubjectRemoteId: context.alertSubjectRemoteId,
    teacherSubjectId: context.teacherSubjectId,
    examTrackId: context.examTrackId ?? null,
    examSubjectId: context.examSubjectId ?? null,
    examModuleId: context.examModuleId ?? null,
    questionCount: savedRecords.length,
    correctCount: savedRecords.filter((record) => record.correct).length,
    atMs: nowMs
  }
}
