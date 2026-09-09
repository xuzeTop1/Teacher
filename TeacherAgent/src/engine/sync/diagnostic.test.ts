import { describe, expect, it } from "vitest"
import {
  buildDiagnosticEvidence,
  collectDiagnosticKnowledgeNodeIds,
  isAnswerCorrect,
  selectDiagnosticQuestions,
  summarizeDiagnostic,
  type DiagnosticAnswerRecord,
  type DiagnosticQuestion
} from "./diagnostic"
import type { QuestionBankSearchOutput } from "../../types/tool"

function searchOutput(overrides: Partial<QuestionBankSearchOutput> = {}): QuestionBankSearchOutput {
  const base = (index: number, type: string, difficulty: number) => ({
    questionId: `q-${index}`,
    title: `题 ${index}`,
    content: `题目内容 ${index}`,
    type,
    difficulty,
    knowledgeNodeIds: [`n-${index}`],
    hints: [],
    answer: "42",
    source: { title: "来源", sourceType: "built_in_pack" as const },
    score: 1
  })
  return {
    questions: [
      base(1, "solution", 3),
      base(2, "diagnostic", 2),
      base(3, "concept_check", 2),
      base(4, "solution", 1),
      base(5, "diagnostic", 1),
      base(6, "solution", 3)
    ],
    ...overrides
  }
}

describe("selectDiagnosticQuestions", () => {
  it("优先 diagnostic 与中等难度，数量受限", () => {
    const selected = selectDiagnosticQuestions(searchOutput(), 3)
    expect(selected).toHaveLength(3)
    expect(selected[0].questionId).toBe("q-2") // diagnostic + difficulty 2
  })
  it("题目可追踪来源与知识节点", () => {
    const [question] = selectDiagnosticQuestions(searchOutput(), 1)
    expect(question.sourceTitle).toBeTruthy()
    expect(question.knowledgeNodeIds).toContain("n-2")
  })
})

describe("collectDiagnosticKnowledgeNodeIds", () => {
  it("只返回本次诊断题知识点的去重白名单，空题集保持为空", () => {
    const questions: DiagnosticQuestion[] = [
      { questionId: "q-cn", content: "计网", type: "diagnostic", difficulty: 2, knowledgeNodeIds: ["cn-b", "cn-a"], sourceTitle: "" },
      { questionId: "q-cn-2", content: "计网", type: "concept_check", difficulty: 1, knowledgeNodeIds: ["cn-a", "cn-c"], sourceTitle: "" }
    ]
    expect(collectDiagnosticKnowledgeNodeIds(questions)).toEqual(["cn-a", "cn-b", "cn-c"])
    expect(collectDiagnosticKnowledgeNodeIds([])).toEqual([])
  })
})

describe("isAnswerCorrect", () => {
  const question: DiagnosticQuestion = {
    questionId: "q-1",
    content: "题目",
    type: "diagnostic",
    difficulty: 2,
    knowledgeNodeIds: ["n-1"],
    sourceTitle: "来源"
  }
  it("判分忽略大小写与空白", () => {
    expect(isAnswerCorrect("42", question, "42")).toBe(true)
    expect(isAnswerCorrect(" 42 ", question, "42")).toBe(true)
    expect(isAnswerCorrect("43", question, "42")).toBe(false)
  })
})

describe("summarizeDiagnostic", () => {
  it("汇总正确率", () => {
    const records: DiagnosticAnswerRecord[] = [
      { questionId: "q-1", studentAnswer: "a", correct: true, answeredAtMs: 1 },
      { questionId: "q-2", studentAnswer: "b", correct: false, answeredAtMs: 2 },
      { questionId: "q-3", studentAnswer: "c", correct: true, answeredAtMs: 3 }
    ]
    const summary = summarizeDiagnostic(records)
    expect(summary.questionCount).toBe(3)
    expect(summary.correctCount).toBe(2)
    expect(summary.correctRate).toBeCloseTo(2 / 3)
  })
  it("空记录正确率为 0", () => {
    expect(summarizeDiagnostic([]).correctRate).toBe(0)
  })
})

describe("buildDiagnosticEvidence (fail-closed)", () => {
  it("没有任何真实保存成功的 assessment 时返回 null（不允许生成掌握度证据）", () => {
    expect(buildDiagnosticEvidence([], {
      alertSubjectRemoteId: "alert-english",
      teacherSubjectId: "english"
    }, 100)).toBeNull()
  })

  it("统计只包含成功持久化的题，不掺入未落库答题", () => {
    const savedRecords = [
      { assessmentId: "a1", questionId: "q1", correct: true },
      { assessmentId: "a2", questionId: "q2", correct: false }
    ]
    const evidence = buildDiagnosticEvidence(savedRecords, {
      alertSubjectRemoteId: "alert-english",
      teacherSubjectId: "english",
      examTrackId: "kaoyan-english",
      examSubjectId: "kaoyan-english.grammar",
      examModuleId: null
    }, 100)
    expect(evidence).not.toBeNull()
    expect(evidence!.assessmentId).toBe("a2")
    expect(evidence!.assessmentIds).toEqual(["a1", "a2"])
    expect(evidence!.alertSubjectRemoteId).toBe("alert-english")
    expect(evidence!.teacherSubjectId).toBe("english")
    expect(evidence!.examSubjectId).toBe("kaoyan-english.grammar")
    // 5 题作答但只 2 题落库成功：questionCount/correctCount 只统计成功持久化部分。
    expect(evidence!.questionCount).toBe(2)
    expect(evidence!.correctCount).toBe(1)
    expect(evidence!.atMs).toBe(100)
  })

  it("不会合成不存在的 assessmentId", () => {
    const evidence = buildDiagnosticEvidence(
      [{ assessmentId: "a1", questionId: "q1", correct: true }],
      { alertSubjectRemoteId: "alert-english", teacherSubjectId: "english" },
      100
    )
    expect(evidence!.assessmentId).toBe("a1") // 只使用真实保存的 id
    expect(evidence!.assessmentIds).toEqual(["a1"])
  })
})
