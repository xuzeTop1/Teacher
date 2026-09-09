import { describe, it, expect, vi } from "vitest"
import { evaluateAnswer, buildKnowledgeSnapshots } from "../services/practice/practiceLogic"
import { submitPracticeAnswer } from "../services/practice/submitPracticeAnswer"
import type { QuestionBankSearchOutput } from "../types/tool"

/**
 * 练习模块核心逻辑测试
 * 覆盖：答案评估（含数值比较）、知识节点快照构建、BKT 掌握度更新链路、submitAnswer 流程
 */

// ─── evaluateAnswer ────────────────────────────────────────────────────────────

describe("evaluateAnswer", () => {
  describe("纯数字答案：严格数值比较", () => {
    it("correctAnswer=0, studentAnswer=10 => false", () => {
      expect(evaluateAnswer("10", "0")).toBe(false)
    })

    it("correctAnswer=2, studentAnswer=12 => false", () => {
      expect(evaluateAnswer("12", "2")).toBe(false)
    })

    it("correctAnswer=0, studentAnswer=0 => true", () => {
      expect(evaluateAnswer("0", "0")).toBe(true)
    })

    it("correctAnswer=42, studentAnswer=42 => true", () => {
      expect(evaluateAnswer("42", "42")).toBe(true)
    })

    it("correctAnswer=3.14, studentAnswer=3.14 => true", () => {
      expect(evaluateAnswer("3.14", "3.14")).toBe(true)
    })

    it("correctAnswer=-1, studentAnswer=-1 => true", () => {
      expect(evaluateAnswer("-1", "-1")).toBe(true)
    })

    it("correctAnswer=1, studentAnswer=1.0 => true (数值等价)", () => {
      expect(evaluateAnswer("1.0", "1")).toBe(true)
    })

    it("correctAnswer=0.5, studentAnswer=1/2 => false (表达式不做解析)", () => {
      expect(evaluateAnswer("1/2", "0.5")).toBe(false)
    })
  })

  describe("数字出现在文本中：不应误判", () => {
    it("correctAnswer=0, studentAnswer=10 => false (10 包含 0 但数值不同)", () => {
      expect(evaluateAnswer("10", "0")).toBe(false)
    })

    it("correctAnswer=2, studentAnswer=答案是12 => false", () => {
      expect(evaluateAnswer("答案是12", "2")).toBe(false)
    })

    it("correctAnswer=42, studentAnswer=答案是 42 => true (文本中提取到 42)", () => {
      // 当前实现：studentAnswer 提取出 "42"，与 correctAnswer "42" 数值匹配
      expect(evaluateAnswer("答案是 42", "42")).toBe(true)
    })
  })

  describe("文本答案：规范化精确匹配", () => {
    it("exact match returns true", () => {
      expect(evaluateAnswer("limit", "limit")).toBe(true)
    })

    it("case insensitive match", () => {
      expect(evaluateAnswer("Yes", "yes")).toBe(true)
    })

    it("allows a harmless answer label", () => {
      expect(evaluateAnswer("the answer is limit", "limit")).toBe(true)
    })

    it("does not accept a partial substring", () => {
      expect(evaluateAnswer("lim", "limit")).toBe(false)
    })

    it("does not accept a negated answer", () => {
      expect(evaluateAnswer("不是 x=2", "x=2")).toBe(false)
    })

    it("wrong text answer returns false", () => {
      expect(evaluateAnswer("continuous", "limit")).toBe(false)
    })
  })

  describe("边界情况", () => {
    it("empty student answer returns false", () => {
      expect(evaluateAnswer("", "42")).toBe(false)
    })

    it("undefined correct answer returns false", () => {
      expect(evaluateAnswer("42", undefined)).toBe(false)
    })

    it("whitespace-only answer returns false", () => {
      expect(evaluateAnswer("   ", "42")).toBe(false)
    })

    it("whitespace is trimmed", () => {
      expect(evaluateAnswer("  42  ", "42")).toBe(true)
    })

    it("student answer with prefix = sign is parsed as number", () => {
      expect(evaluateAnswer("=42", "42")).toBe(true)
    })
  })
})

// ─── buildKnowledgeSnapshots ──────────────────────────────────────────────────

describe("buildKnowledgeSnapshots", () => {
  it("builds snapshots from question with knowledgeNodeIds", () => {
    const question = {
      questionId: "q1",
      title: "夹逼定理练习",
      content: "求极限",
      type: "solution" as const,
      difficulty: 3,
      knowledgeNodeIds: ["limit-definition", "squeeze-theorem"],
      hints: [],
      answer: "0",
      solutionSteps: [],
      source: { id: "test", title: "test", license: "MIT" },
      score: 10
    }

    const snapshots = buildKnowledgeSnapshots(question, "math")
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0].id).toBe("limit-definition")
    expect(snapshots[0].subjectCode).toBe("math")
    expect(snapshots[1].id).toBe("squeeze-theorem")
  })

  it("returns empty array for question without knowledgeNodeIds", () => {
    const question = {
      questionId: "q2",
      title: "通用题",
      content: "计算",
      type: "solution" as const,
      difficulty: 1,
      knowledgeNodeIds: [],
      hints: [],
      answer: "1",
      solutionSteps: [],
      source: { id: "test", title: "test", license: "MIT" },
      score: 5
    }

    const snapshots = buildKnowledgeSnapshots(question, "math")
    expect(snapshots).toHaveLength(0)
  })
})

// ─── BKT integration ──────────────────────────────────────────────────────────

describe("Practice BKT integration", () => {
  function bktUpdate(pKnow: number, correct: boolean): number {
    const pT = 0.1, pG = 0.25, pS = 0.1
    const pKnowClamped = Math.max(0.001, Math.min(0.999, pKnow))
    const pKnowAfterTransition = pKnowClamped + (1 - pKnowClamped) * pT
    const pObsGivenKnow = correct ? (1 - pS) : pS
    const pObsGivenNotKnow = correct ? pG : (1 - pG)
    const pObs = pObsGivenKnow * pKnowAfterTransition + pObsGivenNotKnow * (1 - pKnowAfterTransition)
    return Math.max(0.001, Math.min(0.999, pObs > 0 ? (pObsGivenKnow * pKnowAfterTransition) / pObs : pKnowAfterTransition))
  }

  it("correct answer increases mastery via BKT", () => {
    const delta = bktUpdate(0.3, true) - 0.3
    expect(delta).toBeGreaterThan(0)
  })

  it("incorrect answer decreases mastery via BKT", () => {
    const delta = bktUpdate(0.7, false) - 0.7
    expect(delta).toBeLessThan(0)
  })

  it("evaluate + BKT: correct numeric answer increases mastery", () => {
    const isCorrect = evaluateAnswer("42", "42")
    const delta = bktUpdate(0.4, isCorrect) - 0.4
    expect(isCorrect).toBe(true)
    expect(delta).toBeGreaterThan(0)
  })

  it("evaluate + BKT: '10' vs '0' does NOT increase mastery", () => {
    // 关键：旧实现会误判为 correct，新实现不会
    const isCorrect = evaluateAnswer("10", "0")
    const delta = bktUpdate(0.4, isCorrect) - 0.4
    expect(isCorrect).toBe(false)
    expect(delta).toBeLessThan(0)
  })

  it("evaluate + BKT: '12' vs '2' does NOT increase mastery", () => {
    const isCorrect = evaluateAnswer("12", "2")
    expect(isCorrect).toBe(false)
  })
})

// ─── submitPracticeAnswer 流程测试 ────────────────────────────────────────────

describe("submitPracticeAnswer flow", () => {
  const sampleQuestion: QuestionBankSearchOutput["questions"][number] = {
    questionId: "q-flow-test",
    title: "测试题",
    content: "求 lim(x→0) sin(x)/x",
    type: "solution",
    difficulty: 2,
    knowledgeNodeIds: ["limit-definition", "equivalent-infinitesimal"],
    hints: [{ level: "L1", text: "想想等价无穷小" }],
    answer: "1",
    solutionSteps: ["等价无穷小替换"],
    source: { id: "test", title: "test", license: "MIT" },
    score: 5
  }

  function makeMocks(overrides?: {
    bktFails?: boolean
    saveFails?: boolean
  }) {
    const bktUpdateMastery = overrides?.bktFails
      ? vi.fn().mockRejectedValue(new Error("bkt failed"))
      : vi.fn().mockResolvedValue({ pKnow: 0.55, learned: false, observationLikelihood: 0.8 })

    const saveAssessmentResult = overrides?.saveFails
      ? vi.fn().mockRejectedValue(new Error("save failed"))
      : vi.fn().mockResolvedValue({ id: "saved" })

    return { bktUpdateMastery, saveAssessmentResult }
  }

  it("calls bktUpdateMastery and saveAssessmentResult with correct params", async () => {
    const mocks = makeMocks()
    const studentKnowledge: Array<{ knowledgeNodeId: string; masteryProbability: number; attemptsCount: number; correctCount: number; title: string }> = [
      { knowledgeNodeId: "limit-definition", masteryProbability: 0.4, attemptsCount: 3, correctCount: 1, title: "极限定义" },
      { knowledgeNodeId: "equivalent-infinitesimal", masteryProbability: 0.5, attemptsCount: 2, correctCount: 1, title: "等价无穷小" }
    ]

    const result = await submitPracticeAnswer({
      question: sampleQuestion,
      studentAnswer: "1",
      subjectCode: "math",
      studentId: "local-default-student",
      revealedHintsCount: 0,
      studentKnowledge,
      conversationId: "local-default-conversation-math",
      ...mocks
    })

    // BKT 被调用两次（每个知识节点一次）
    expect(mocks.bktUpdateMastery).toHaveBeenCalledTimes(2)
    expect(mocks.bktUpdateMastery).toHaveBeenCalledWith(0.4, true)
    expect(mocks.bktUpdateMastery).toHaveBeenCalledWith(0.5, true)

    // saveAssessmentResult 被调用一次
    expect(mocks.saveAssessmentResult).toHaveBeenCalledTimes(1)
    const saveCall = mocks.saveAssessmentResult.mock.calls[0][0]

    // conversationId 来自 ensureDefaultConversation
    expect(saveCall.conversationId).toBe("local-default-conversation-math")

    // knowledgeSnapshots 非空
    expect(saveCall.knowledgeSnapshots.length).toBeGreaterThan(0)
    expect(saveCall.knowledgeSnapshots[0].id).toBe("limit-definition")

    // knowledgeUpdates 使用 BKT 计算的 delta
    expect(saveCall.knowledgeUpdates).toHaveLength(2)
    expect(saveCall.knowledgeUpdates[0].knowledgeNodeId).toBe("limit-definition")
    expect(saveCall.knowledgeUpdates[0].masteryDelta).toBeGreaterThan(0)

    // 结果
    expect(result.success).toBe(true)
    expect(result.assessmentSaved).toBe(true)
  })

  it("uses provided conversationId in saveAssessmentResult", async () => {
    const mocks = makeMocks()
    const studentKnowledge: Array<{ knowledgeNodeId: string; masteryProbability: number; attemptsCount: number; correctCount: number; title: string }> = []

    await submitPracticeAnswer({
      question: sampleQuestion,
      studentAnswer: "1",
      subjectCode: "math",
      studentId: "local-default-student",
      revealedHintsCount: 0,
      studentKnowledge,
      conversationId: "custom-conversation-id",
      ...mocks
    })

    // saveAssessmentResult 使用传入的 conversationId
    const saveCall = mocks.saveAssessmentResult.mock.calls[0][0]
    expect(saveCall.conversationId).toBe("custom-conversation-id")
  })

  it("falls back to default conversationId when null", async () => {
    const mocks = makeMocks()
    const studentKnowledge: Array<{ knowledgeNodeId: string; masteryProbability: number; attemptsCount: number; correctCount: number; title: string }> = []

    await submitPracticeAnswer({
      question: sampleQuestion,
      studentAnswer: "1",
      subjectCode: "math",
      studentId: "local-default-student",
      revealedHintsCount: 0,
      studentKnowledge,
      conversationId: null,
      ...mocks
    })

    // conversationId 为 null 时 fallback 到默认 id
    const saveCall = mocks.saveAssessmentResult.mock.calls[0][0]
    expect(saveCall.conversationId).toBe("local-default-conversation-math")
  })

  it("reports failure when saveAssessmentResult throws", async () => {
    const mocks = makeMocks({ saveFails: true })
    const studentKnowledge: Array<{ knowledgeNodeId: string; masteryProbability: number; attemptsCount: number; correctCount: number; title: string }> = []

    const result = await submitPracticeAnswer({
      question: sampleQuestion,
      studentAnswer: "1",
      subjectCode: "math",
      studentId: "local-default-student",
      revealedHintsCount: 0,
      studentKnowledge,
      conversationId: "local-default-conversation-math",
      ...mocks
    })

    expect(result.success).toBe(false)
    expect(result.assessmentSaved).toBe(false)
    expect(result.error).toContain("save failed")
  })

  it("still reports bkt failure but continues save", async () => {
    const mocks = makeMocks({ bktFails: true })
    const studentKnowledge: Array<{ knowledgeNodeId: string; masteryProbability: number; attemptsCount: number; correctCount: number; title: string }> = []

    const result = await submitPracticeAnswer({
      question: sampleQuestion,
      studentAnswer: "1",
      subjectCode: "math",
      studentId: "local-default-student",
      revealedHintsCount: 0,
      studentKnowledge,
      conversationId: "local-default-conversation-math",
      ...mocks
    })

    // BKT 失败但 save 仍被调用（使用 fallback delta）
    expect(mocks.saveAssessmentResult).toHaveBeenCalledTimes(1)
    expect(result.bktUpdated).toBe(false)
    // save 成功
    expect(result.assessmentSaved).toBe(true)
  })

  it("knowledgeSnapshots always non-empty when question has knowledgeNodeIds", async () => {
    const mocks = makeMocks()
    const studentKnowledge: Array<{ knowledgeNodeId: string; masteryProbability: number; attemptsCount: number; correctCount: number; title: string }> = []

    await submitPracticeAnswer({
      question: sampleQuestion,
      studentAnswer: "1",
      subjectCode: "math",
      studentId: "local-default-student",
      revealedHintsCount: 0,
      studentKnowledge,
      conversationId: "local-default-conversation-math",
      ...mocks
    })

    const saveCall = mocks.saveAssessmentResult.mock.calls[0][0]
    expect(saveCall.knowledgeSnapshots.length).toBe(sampleQuestion.knowledgeNodeIds.length)
    for (const snapshot of saveCall.knowledgeSnapshots) {
      expect(snapshot.id).toBeTruthy()
      expect(snapshot.subjectCode).toBe("math")
    }
  })
})
