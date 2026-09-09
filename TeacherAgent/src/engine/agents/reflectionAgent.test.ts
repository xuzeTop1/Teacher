import { describe, expect, it, vi } from "vitest"
import { reflectOnTutorTurn } from "./reflectionAgent"
import type { ReflectionAgentInput } from "../../types/reflection"

const baseInput: ReflectionAgentInput = {
  conversationId: "test-conv",
  studentId: "test-student",
  subjectCode: "math",
  userMessage: "我觉得答案是 3/2",
  tutorReply: "方向是对的，但还差一步",
  mode: "guide",
  maxHintLevel: "L2",
  strategy: "probing_question"
}

describe("reflectOnTutorTurn", () => {
  describe("observations vs inferences", () => {
    it("includes student input as observation", () => {
      const result = reflectOnTutorTurn(baseInput)
      expect(result.record.observations.length).toBeGreaterThan(0)
      expect(result.record.observations[0]).toContain("我觉得答案是 3/2")
    })

    it("includes knowledge node titles in observations when available", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        knowledgeNodes: [{ id: "k1", title: "极限定义", subjectCode: "math" }]
      })
      expect(result.record.observations.some((o) => o.includes("极限定义"))).toBe(true)
    })

    it("separates observations from inferences", () => {
      const result = reflectOnTutorTurn(baseInput)
      // Observations should be factual, inferences should be derived
      expect(result.record.observations).toBeDefined()
      expect(result.record.inferences).toBeDefined()
      expect(Array.isArray(result.record.observations)).toBe(true)
      expect(Array.isArray(result.record.inferences)).toBe(true)
    })
  })

  describe("uncertainty tracking", () => {
    it("reports uncertainty when no recent messages available", () => {
      const result = reflectOnTutorTurn(baseInput)
      expect(result.record.uncertainties.some((u) => u.includes("缺少更长对话历史"))).toBe(true)
    })

    it("reports uncertainty when misconception detected", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        mode: "diagnose",
        userMessage: "不会做，看不懂"
      })
      expect(result.record.uncertainties.some((u) => u.includes("误区"))).toBe(true)
    })

    it("does not report misconception uncertainty for normal conversation", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        userMessage: "什么是极限",
        recentMessages: [{ role: "user", content: "之前的问题" }]
      })
      expect(result.record.uncertainties.some((u) => u.includes("误区判断"))).toBe(false)
    })
  })

  describe("misconception extraction", () => {
    it("extracts misconceptions from knowledge nodes when in diagnose mode", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        mode: "diagnose",
        knowledgeNodes: [{
          id: "k1",
          title: "极限",
          subjectCode: "math",
          misconceptions: ["混淆无穷小与零"]
        }]
      })
      expect(result.record.misconceptions.length).toBeGreaterThan(0)
      expect(result.record.misconceptions[0].inference).toBe("混淆无穷小与零")
    })

    it("does not extract misconceptions for normal guide mode", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        mode: "guide",
        userMessage: "什么是极限"
      })
      expect(result.record.misconceptions.length).toBe(0)
    })

    it("extracts misconceptions when student expresses confusion", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        userMessage: "不会，看不懂这个"
      })
      expect(result.record.misconceptions.length).toBeGreaterThan(0)
    })
  })

  describe("strategy insight", () => {
    it("marks strategy as helpful when tutor asks a question", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        tutorReply: "你觉得第一步应该做什么？"
      })
      expect(result.record.strategyInsights[0].effect).toBe("helpful")
    })

    it("marks strategy as neutral for review mode", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        mode: "review",
        tutorReply: "这道题的解法是..."
      })
      expect(result.record.strategyInsights[0].effect).toBe("neutral")
    })

    it("maps strategy names correctly", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        strategy: "analogy_bridge"
      })
      expect(result.record.strategyInsights[0].strategy).toBe("analogy")
    })
  })

  describe("next best action", () => {
    it("suggests practice after review mode", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        mode: "review"
      })
      expect(result.record.nextBestAction.type).toBe("practice")
    })

    it("suggests explain_concept when misconception detected", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        mode: "diagnose",
        userMessage: "不会做"
      })
      expect(result.record.nextBestAction.type).toBe("explain_concept")
    })

    it("suggests continue_problem for normal guidance", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        mode: "guide",
        userMessage: "什么是极限"
      })
      expect(result.record.nextBestAction.type).toBe("continue_problem")
    })
  })

  describe("memory candidates", () => {
    it("generates learning goal memory when student states goal", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        userMessage: "我要通过考研数学"
      })
      const goalMemories = result.memoryCandidates.filter((m) => m.kind === "learning_goal")
      expect(goalMemories.length).toBeGreaterThan(0)
    })

    it("generates preference memory when student states preference", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        userMessage: "请简单点解释"
      })
      const prefMemories = result.memoryCandidates.filter((m) => m.kind === "preference")
      expect(prefMemories.length).toBeGreaterThan(0)
      expect(prefMemories[0].summary).toContain("通俗")
    })

    it("generates misconception memory when misconception detected", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        mode: "diagnose",
        userMessage: "不会做",
        knowledgeNodes: [{
          id: "k1",
          title: "极限",
          subjectCode: "math",
          misconceptions: ["混淆无穷小与零"]
        }]
      })
      const misMemories = result.memoryCandidates.filter((m) => m.kind === "misconception")
      expect(misMemories.length).toBeGreaterThan(0)
    })

    it("generates strategy signal memory when strategy is helpful", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        tutorReply: "你觉得第一步应该做什么？"
      })
      const stratMemories = result.memoryCandidates.filter((m) => m.kind === "strategy_signal")
      expect(stratMemories.length).toBeGreaterThan(0)
    })

    it("generates affective signal memory when student expresses distress", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        userMessage: "太难了，我学不会"
      })
      const affMemories = result.memoryCandidates.filter((m) => m.kind === "affective_signal")
      expect(affMemories.length).toBeGreaterThan(0)
    })
  })

  describe("profile updates", () => {
    it("extracts learning goals", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        userMessage: "我要考研"
      })
      expect(result.profileUpdates.learningGoals.length).toBeGreaterThan(0)
    })

    it("extracts explanation preferences", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        userMessage: "请详细一步一步解释"
      })
      expect(result.profileUpdates.explanationPreferences.some((p) => p.includes("分步骤"))).toBe(true)
    })

    it("includes effective strategies when strategy is helpful", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        tutorReply: "你觉得呢？"
      })
      expect(result.profileUpdates.effectiveStrategies.length).toBeGreaterThan(0)
    })
  })

  describe("confidence", () => {
    it("has base confidence of 0.35", () => {
      const result = reflectOnTutorTurn(baseInput)
      expect(result.record.confidence).toBeGreaterThanOrEqual(0.35)
    })

    it("has higher confidence with knowledge nodes", () => {
      const withNodes = reflectOnTutorTurn({
        ...baseInput,
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      const withoutNodes = reflectOnTutorTurn(baseInput)
      expect(withNodes.record.confidence).toBeGreaterThan(withoutNodes.record.confidence)
    })

    it("caps confidence at 0.72", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }],
        recentMessages: [{ role: "user", content: "之前" }],
        mode: "diagnose",
        userMessage: "不会做"
      })
      expect(result.record.confidence).toBeLessThanOrEqual(0.72)
    })
  })

  describe("conversation summary", () => {
    it("includes topic from knowledge node", () => {
      const result = reflectOnTutorTurn({
        ...baseInput,
        knowledgeNodes: [{ id: "k1", title: "极限定义", subjectCode: "math" }]
      })
      expect(result.record.conversationSummary).toContain("极限定义")
    })

    it("falls back to subject label", () => {
      const result = reflectOnTutorTurn(baseInput)
      expect(result.record.conversationSummary).toContain("数学")
    })
  })
})
