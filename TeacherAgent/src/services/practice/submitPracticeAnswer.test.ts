/**
 * submitPracticeAnswer 单元测试
 */

import { describe, expect, it, vi } from "vitest"
import { submitPracticeAnswer } from "./submitPracticeAnswer"

const mockQuestion = {
  questionId: "q-001",
  title: "测试题目",
  content: "1+1=?",
  type: "concept_check" as const,
  difficulty: 1 as const,
  knowledgeNodeIds: ["node-001"],
  hints: [
    { level: "L1" as const, text: "提示1" },
    { level: "L2" as const, text: "提示2" },
    { level: "L3" as const, text: "提示3" }
  ],
  answer: "2",
  source: { id: "test", title: "test", license: "MIT" },
  score: 10
}

const mockBktUpdate = vi.fn(async (pKnow: number, _correct: boolean) => ({
  pKnow: pKnow + 0.1
}))

const mockSaveAssessment = vi.fn(async () => ({}))

describe("submitPracticeAnswer", () => {
  it("答对时 correct=true", async () => {
    const result = await submitPracticeAnswer({
      question: mockQuestion,
      studentAnswer: "2",
      subjectCode: "math",
      studentId: "test-student",
      revealedHintsCount: 0,
      studentKnowledge: [{ knowledgeNodeId: "node-001", masteryProbability: 0.5, attemptsCount: 0, correctCount: 0, title: "test" }],
      conversationId: "conv-001",
      bktUpdateMastery: mockBktUpdate,
      saveAssessmentResult: mockSaveAssessment
    })

    expect(result.correct).toBe(true)
    expect(result.success).toBe(true)
    expect(result.assessmentSaved).toBe(true)
  })

  it("答错时 correct=false，但保存成功时 success=true", async () => {
    const result = await submitPracticeAnswer({
      question: mockQuestion,
      studentAnswer: "3",
      subjectCode: "math",
      studentId: "test-student",
      revealedHintsCount: 0,
      studentKnowledge: [{ knowledgeNodeId: "node-001", masteryProbability: 0.5, attemptsCount: 0, correctCount: 0, title: "test" }],
      conversationId: "conv-001",
      bktUpdateMastery: mockBktUpdate,
      saveAssessmentResult: mockSaveAssessment
    })

    expect(result.correct).toBe(false)
    expect(result.success).toBe(true)
    expect(result.bktUpdated).toBe(true)
  })

  it("未知节点冷启动默认掌握度为 0.5", async () => {
    const bktCapture = vi.fn(async (pKnow: number, _correct: boolean) => ({
      pKnow: pKnow + 0.05
    }))

    await submitPracticeAnswer({
      question: mockQuestion,
      studentAnswer: "2",
      subjectCode: "math",
      studentId: "test-student",
      revealedHintsCount: 0,
      studentKnowledge: [],
      conversationId: "conv-001",
      bktUpdateMastery: bktCapture,
      saveAssessmentResult: mockSaveAssessment
    })

    // BKT 应以 0.5 作为冷启动默认值
    expect(bktCapture).toHaveBeenCalledWith(0.5, true)
  })

  it("保存失败时 correct 仍有值", async () => {
    const failSave = vi.fn(async () => { throw new Error("DB error") })

    const result = await submitPracticeAnswer({
      question: mockQuestion,
      studentAnswer: "wrong",
      subjectCode: "math",
      studentId: "test-student",
      revealedHintsCount: 0,
      studentKnowledge: [{ knowledgeNodeId: "node-001", masteryProbability: 0.5, attemptsCount: 0, correctCount: 0, title: "test" }],
      conversationId: "conv-001",
      bktUpdateMastery: mockBktUpdate,
      saveAssessmentResult: failSave
    })

    expect(result.correct).toBe(false)
    expect(result.success).toBe(false)
    expect(result.assessmentSaved).toBe(false)
  })

  it("考试叶子题把自身 questionScope 归属写入 evidence", async () => {
    await submitPracticeAnswer({
      question: {
        ...mockQuestion,
        examTrackId: "exam-408",
        subjectId: "408-operating-systems",
        moduleId: "408-operating-systems.concurrency",
        packId: "pack-408-operating-systems"
      },
      studentAnswer: "2",
      subjectCode: "cs408",
      studentId: "test-student",
      revealedHintsCount: 1,
      studentKnowledge: [],
      conversationId: "conv-001",
      bktUpdateMastery: mockBktUpdate,
      saveAssessmentResult: mockSaveAssessment
    })

    const saved = mockSaveAssessment.mock.calls.at(-1)?.[0]
    expect(JSON.parse(saved.evidence)).toMatchObject({
      questionId: "q-001",
      examTrackId: "exam-408",
      subjectId: "408-operating-systems",
      moduleId: "408-operating-systems.concurrency",
      packId: "pack-408-operating-systems"
    })
  })

  it("旧平面题保留稳定的 null 归属字段", async () => {
    await submitPracticeAnswer({
      question: mockQuestion,
      studentAnswer: "2",
      subjectCode: "math",
      studentId: "test-student",
      revealedHintsCount: 0,
      studentKnowledge: [],
      conversationId: "conv-001",
      bktUpdateMastery: mockBktUpdate,
      saveAssessmentResult: mockSaveAssessment
    })

    const saved = mockSaveAssessment.mock.calls.at(-1)?.[0]
    expect(JSON.parse(saved.evidence)).toMatchObject({
      examTrackId: null,
      subjectId: null,
      moduleId: null,
      packId: null
    })
  })

  it("不会从 legacy subjectCode 推断跨叶子归属", async () => {
    await submitPracticeAnswer({
      question: mockQuestion,
      studentAnswer: "2",
      subjectCode: "cs408",
      studentId: "test-student",
      revealedHintsCount: 0,
      studentKnowledge: [],
      conversationId: "conv-001",
      bktUpdateMastery: mockBktUpdate,
      saveAssessmentResult: mockSaveAssessment
    })

    const saved = mockSaveAssessment.mock.calls.at(-1)?.[0]
    const evidence = JSON.parse(saved.evidence)
    expect(evidence.subjectId).toBeNull()
    expect(evidence.examTrackId).toBeNull()
    expect(evidence.moduleId).toBeNull()
    expect(evidence.packId).toBeNull()
    expect(evidence.subjectId).not.toBe("cs408")
  })

  it("诊断 provenance 是类型化可选字段，普通练习不写入", async () => {
    await submitPracticeAnswer({
      question: mockQuestion,
      studentAnswer: "2",
      subjectCode: "cs408",
      studentId: "test-student",
      revealedHintsCount: 0,
      studentKnowledge: [],
      conversationId: "conv-001",
      diagnosticProvenance: {
        origin: "alerttime_sync_diagnostic_v1",
        questionId: "q-001",
        alertSubjectRemoteId: "alert-cn",
        examTrackId: "408",
        examSubjectId: "408.computer-networks",
        examModuleId: null
      },
      bktUpdateMastery: mockBktUpdate,
      saveAssessmentResult: mockSaveAssessment
    })

    const diagnosticSaved = mockSaveAssessment.mock.calls.at(-1)?.[0]
    expect(diagnosticSaved.diagnosticProvenance).toEqual({
      origin: "alerttime_sync_diagnostic_v1",
      questionId: "q-001",
      alertSubjectRemoteId: "alert-cn",
      examTrackId: "408",
      examSubjectId: "408.computer-networks",
      examModuleId: null
    })

    await submitPracticeAnswer({
      question: mockQuestion,
      studentAnswer: "2",
      subjectCode: "math",
      studentId: "test-student",
      revealedHintsCount: 0,
      studentKnowledge: [],
      conversationId: "conv-001",
      bktUpdateMastery: mockBktUpdate,
      saveAssessmentResult: mockSaveAssessment
    })
    const ordinarySaved = mockSaveAssessment.mock.calls.at(-1)?.[0]
    expect(ordinarySaved.diagnosticProvenance).toBeUndefined()
  })
})
