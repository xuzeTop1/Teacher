import { describe, it, expect } from "vitest"
import { recommendDifficulty, recommendNextQuestion, getHintScaffoldingText } from "./questionRecommender"
import type { StudentKnowledgeMastery } from "../../types/learning"
import type { QuestionBankSearchOutput } from "../../types/tool"

describe("recommendDifficulty", () => {
  it("returns difficulty 1 for very low mastery (< 0.3)", () => {
    const range = recommendDifficulty(0.2)
    expect(range.min).toBe(1)
    expect(range.max).toBe(1)
  })

  it("returns difficulty 1-2 for low mastery (0.3-0.5)", () => {
    const range = recommendDifficulty(0.4)
    expect(range.min).toBe(1)
    expect(range.max).toBe(2)
  })

  it("returns difficulty 2-3 for medium mastery (0.5-0.7)", () => {
    const range = recommendDifficulty(0.6)
    expect(range.min).toBe(2)
    expect(range.max).toBe(3)
  })

  it("returns difficulty 3 for higher mastery (>= 0.7)", () => {
    const range = recommendDifficulty(0.75)
    expect(range.min).toBe(3)
    expect(range.max).toBe(3)
  })

  it("returns difficulty 3 for very high mastery (> 0.85)", () => {
    const range = recommendDifficulty(0.9)
    expect(range.min).toBe(3)
    expect(range.max).toBe(3)
  })

  it("increases difficulty when recent results are all correct with few hints", () => {
    const results = [
      { correct: true, hintsUsed: 0 },
      { correct: true, hintsUsed: 1 }
    ]
    const range = recommendDifficulty(0.6, results)
    // Base was 2-3, should increase to 3 (capped)
    expect(range.min).toBe(3)
    expect(range.max).toBe(3)
  })

  it("decreases difficulty when recent results are all wrong", () => {
    const results = [
      { correct: false, hintsUsed: 0 },
      { correct: false, hintsUsed: 0 }
    ]
    const range = recommendDifficulty(0.6, results)
    // Base was 2-3, should decrease to 1-2
    expect(range.min).toBe(1)
    expect(range.max).toBe(2)
  })

  it("decreases max difficulty when many hints used", () => {
    const results = [
      { correct: true, hintsUsed: 3 },
      { correct: false, hintsUsed: 2 }
    ]
    const range = recommendDifficulty(0.6, results)
    // avgHints >= 2, should decrease max
    expect(range.max).toBeLessThanOrEqual(2)
  })

  it("does not go below difficulty 1", () => {
    const results = [
      { correct: false, hintsUsed: 0 },
      { correct: false, hintsUsed: 0 }
    ]
    const range = recommendDifficulty(0.1, results)
    expect(range.min).toBeGreaterThanOrEqual(1)
    expect(range.max).toBeGreaterThanOrEqual(1)
  })

  it("never exceeds difficulty 3", () => {
    const results = [
      { correct: true, hintsUsed: 0 },
      { correct: true, hintsUsed: 0 }
    ]
    const range = recommendDifficulty(0.95, results)
    expect(range.min).toBeLessThanOrEqual(3)
    expect(range.max).toBeLessThanOrEqual(3)
  })
})

describe("recommendNextQuestion", () => {
  const sampleQuestions: QuestionBankSearchOutput["questions"] = [
    {
      questionId: "q-easy",
      title: "基础题",
      content: "简单题目",
      type: "solution",
      difficulty: 1,
      knowledgeNodeIds: ["node-a"],
      hints: [{ level: "L1", text: "提示1" }],
      answer: "42",
      solutionSteps: ["步骤1"],
      source: { id: "test", title: "test", license: "original" },
      score: 5
    },
    {
      questionId: "q-medium",
      title: "中等题",
      content: "中等题目",
      type: "solution",
      difficulty: 3,
      knowledgeNodeIds: ["node-b"],
      hints: [{ level: "L1", text: "提示1" }],
      answer: "100",
      solutionSteps: ["步骤1"],
      source: { id: "test", title: "test", license: "original" },
      score: 5
    },
    {
      questionId: "q-hard",
      title: "难题",
      content: "困难题目",
      type: "solution",
      difficulty: 5,
      knowledgeNodeIds: ["node-c"],
      hints: [],
      answer: "0",
      solutionSteps: ["步骤1"],
      source: { id: "test", title: "test", license: "original" },
      score: 5
    }
  ]

  it("returns null for empty question pool", () => {
    const context = {
      studentKnowledge: [],
      recentResults: [],
      subjectCode: "math"
    }
    expect(recommendNextQuestion(context, [])).toBeNull()
  })

  it("cold start: empty studentKnowledge defaults to 0.5 mastery, recommends difficulty 2-3", () => {
    const context = {
      studentKnowledge: [],
      recentResults: [],
      subjectCode: "math"
    }
    const recommended = recommendNextQuestion(context, sampleQuestions)
    expect(recommended).not.toBeNull()
    // Default mastery 0.5 → difficulty range 2-3, so should pick medium question
    expect(recommended!.difficulty).toBeGreaterThanOrEqual(2)
    expect(recommended!.difficulty).toBeLessThanOrEqual(3)
  })

  it("recommends easy question for low mastery student", () => {
    const context = {
      studentKnowledge: [
        { knowledgeNodeId: "node-a", title: "A", masteryProbability: 0.2, attemptsCount: 1, correctCount: 0, updatedAt: "" },
        { knowledgeNodeId: "node-b", title: "B", masteryProbability: 0.3, attemptsCount: 1, correctCount: 0, updatedAt: "" }
      ],
      recentResults: [],
      subjectCode: "math"
    }
    const recommended = recommendNextQuestion(context, sampleQuestions)
    expect(recommended).not.toBeNull()
    // Should prefer easy or medium (weak nodes)
    expect(recommended!.difficulty).toBeLessThanOrEqual(2)
  })

  it("recommends hard question for high mastery student", () => {
    const context = {
      studentKnowledge: [
        { knowledgeNodeId: "node-a", title: "A", masteryProbability: 0.9, attemptsCount: 10, correctCount: 9, updatedAt: "" },
        { knowledgeNodeId: "node-b", title: "B", masteryProbability: 0.85, attemptsCount: 10, correctCount: 8, updatedAt: "" }
      ],
      recentResults: [
        { correct: true, hintsUsed: 0 },
        { correct: true, hintsUsed: 0 }
      ],
      subjectCode: "math"
    }
    const recommended = recommendNextQuestion(context, sampleQuestions)
    expect(recommended).not.toBeNull()
    // High mastery with recent correct answers should get harder questions
    expect(recommended!.difficulty).toBeGreaterThanOrEqual(3)
  })

  it("prioritizes questions on weak knowledge nodes", () => {
    const context = {
      studentKnowledge: [
        { knowledgeNodeId: "node-a", title: "A", masteryProbability: 0.9, attemptsCount: 10, correctCount: 9, updatedAt: "" },
        { knowledgeNodeId: "node-b", title: "B", masteryProbability: 0.2, attemptsCount: 2, correctCount: 0, updatedAt: "" }
      ],
      recentResults: [],
      subjectCode: "math"
    }
    const recommended = recommendNextQuestion(context, sampleQuestions)
    expect(recommended).not.toBeNull()
    // node-b has low mastery, so q-medium (which has node-b) should be preferred
    expect(recommended!.knowledgeNodeIds).toContain("node-b")
  })
})

describe("getHintScaffoldingText", () => {
  it("returns correct label for L1", () => {
    expect(getHintScaffoldingText("L1")).toContain("方向提示")
  })

  it("returns correct label for L2", () => {
    expect(getHintScaffoldingText("L2")).toContain("方法提示")
  })

  it("returns correct label for L3", () => {
    expect(getHintScaffoldingText("L3")).toContain("关键步骤")
  })
})
