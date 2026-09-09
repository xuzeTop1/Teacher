import { describe, expect, it } from "vitest"
import { assessTutorTurn } from "./assessmentAgent"
import type { AssessmentAgentInput } from "../../types/assessment"

const baseInput: AssessmentAgentInput = {
  studentId: "test-student",
  conversationId: "test-conv",
  subjectCode: "math",
  userMessage: "我觉得答案是 3/2",
  tutorReply: "你的思路是对的",
  maxHintLevel: "L2"
}

describe("assessTutorTurn", () => {
  describe("correctness classification", () => {
    it("classifies correct when tutor confirms", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "因为等价无穷小，所以答案是 3/2",
        tutorReply: "完全正确，你的推理是正确的"
      })
      expect(result.correctness).toBe("correct")
    })

    it("classifies partially_correct when tutor says direction is right", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "我觉得答案是 3/2",
        tutorReply: "方向是对的，但还差一步"
      })
      expect(result.correctness).toBe("partially_correct")
    })

    it("classifies incorrect when tutor points out error", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "我算出来是 0",
        tutorReply: "不对，这里有一个关键错误"
      })
      expect(result.correctness).toBe("incorrect")
    })

    it("classifies unknown when student says they don't understand", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "不会，看不懂这个题",
        tutorReply: "我们来一步步分析"
      })
      expect(result.correctness).toBe("unknown")
    })

    it("classifies unknown for general messages without attempt", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "什么是极限",
        tutorReply: "极限是..."
      })
      expect(result.correctness).toBe("unknown")
    })

    it("classifies incorrect when tutor identifies specific problem", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "我算错了，哪里错",
        tutorReply: "问题在于第三步的变形"
      })
      // "问题在于" matches the incorrect pattern in tutor reply
      expect(result.correctness).toBe("incorrect")
    })

    it("classifies partially_correct when student asks about error but tutor is vague", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "我算错了，哪里错",
        tutorReply: "我们再看看这一步"
      })
      expect(result.correctness).toBe("partially_correct")
    })
  })

  describe("mastery delta", () => {
    it("gives positive delta for correct answer with low hint level", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "因为等价无穷小，所以答案是 3/2",
        tutorReply: "完全正确",
        maxHintLevel: "L1",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      expect(result.knowledgeUpdates[0].masteryDelta).toBe(0.08)
    })

    it("gives smaller positive delta for correct answer with high hint level", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "因为等价无穷小，所以答案是 3/2",
        tutorReply: "完全正确",
        maxHintLevel: "L3",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      expect(result.knowledgeUpdates[0].masteryDelta).toBe(0.05)
    })

    it("gives small positive delta for partially correct", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "我觉得是 3/2",
        tutorReply: "方向是对的",
        maxHintLevel: "L2",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      expect(result.knowledgeUpdates[0].masteryDelta).toBe(0.04)
    })

    it("gives negative delta for incorrect answer", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "答案是 0",
        tutorReply: "不对，关键错误",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      expect(result.knowledgeUpdates[0].masteryDelta).toBe(-0.04)
    })

    it("gives zero delta for unknown correctness", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "不会做",
        tutorReply: "我们来分析",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      // unknown produces empty knowledgeUpdates — no updates at all
      expect(result.knowledgeUpdates).toHaveLength(0)
    })
  })

  describe("data pollution fix", () => {
    it("returns empty knowledgeUpdates for unknown correctness (普通聊天不污染练习统计)", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "什么是极限",
        tutorReply: "极限是...",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      expect(result.correctness).toBe("unknown")
      expect(result.knowledgeUpdates).toHaveLength(0)
    })

    it("returns empty knowledgeUpdates when student says they don't understand", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "不会做",
        tutorReply: "我们来一步步分析",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      expect(result.correctness).toBe("unknown")
      expect(result.knowledgeUpdates).toHaveLength(0)
    })

    it("includes correctness field in knowledge updates for correct", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "因为等价无穷小，所以答案是 3/2",
        tutorReply: "完全正确",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      expect(result.knowledgeUpdates).toHaveLength(1)
      expect(result.knowledgeUpdates[0].correctness).toBe("correct")
    })

    it("includes correctness field in knowledge updates for partially_correct", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "我觉得是 3/2",
        tutorReply: "方向是对的",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      expect(result.knowledgeUpdates).toHaveLength(1)
      expect(result.knowledgeUpdates[0].correctness).toBe("partially_correct")
    })

    it("includes correctness field in knowledge updates for incorrect", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "答案是 0",
        tutorReply: "不对，关键错误",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      expect(result.knowledgeUpdates).toHaveLength(1)
      expect(result.knowledgeUpdates[0].correctness).toBe("incorrect")
    })
  })

  describe("suggested next action", () => {
    it("suggests practice after correct answer", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "答案是 3/2",
        tutorReply: "完全正确"
      })
      expect(result.suggestedNextAction).toBe("practice")
    })

    it("suggests explain_concept after incorrect answer", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "答案是 0",
        tutorReply: "不对"
      })
      expect(result.suggestedNextAction).toBe("explain_concept")
    })

    it("suggests hint for partially correct with low hint level", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "我觉得是 3/2",
        tutorReply: "方向是对的，还差一步",
        maxHintLevel: "L2"
      })
      expect(result.suggestedNextAction).toBe("hint")
    })

    it("suggests continue for partially correct with high hint level", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "我觉得是 3/2",
        tutorReply: "方向是对的",
        maxHintLevel: "L3"
      })
      expect(result.suggestedNextAction).toBe("continue")
    })

    it("suggests explain_concept when misconception detected", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "答案是 0",
        tutorReply: "不对",
        mode: "diagnose",
        knowledgeNodes: [{
          id: "k1",
          title: "极限",
          subjectCode: "math",
          misconceptions: ["混淆无穷小与零"]
        }]
      })
      expect(result.suggestedNextAction).toBe("explain_concept")
    })
  })

  describe("confidence", () => {
    it("has higher confidence with knowledge nodes", () => {
      const withNodes = assessTutorTurn({
        ...baseInput,
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      const withoutNodes = assessTutorTurn(baseInput)
      expect(withNodes.confidence).toBeGreaterThan(withoutNodes.confidence)
    })

    it("has higher confidence with recent messages", () => {
      const withHistory = assessTutorTurn({
        ...baseInput,
        recentMessages: [{ role: "user", content: "之前的问题" }]
      })
      const withoutHistory = assessTutorTurn(baseInput)
      expect(withHistory.confidence).toBeGreaterThan(withoutHistory.confidence)
    })

    it("caps confidence at 0.68", () => {
      const result = assessTutorTurn({
        ...baseInput,
        tutorReply: "完全正确，答案是对的",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }],
        recentMessages: [{ role: "user", content: "之前" }]
      })
      expect(result.confidence).toBeLessThanOrEqual(0.68)
    })
  })

  describe("evidence and metadata", () => {
    it("includes topic from knowledge node", () => {
      const result = assessTutorTurn({
        ...baseInput,
        knowledgeNodes: [{ id: "k1", title: "极限定义", subjectCode: "math" }]
      })
      expect(result.evidence).toContain("极限定义")
    })

    it("falls back to subject label when no knowledge nodes", () => {
      const result = assessTutorTurn(baseInput)
      expect(result.evidence).toContain("数学")
    })

    it("creates knowledge updates for provided nodes when correctness is assessable", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "因为等价无穷小，所以答案是 3/2",
        tutorReply: "完全正确",
        knowledgeNodes: [
          { id: "k1", title: "极限", subjectCode: "math" },
          { id: "k2", title: "连续", subjectCode: "math" }
        ]
      })
      expect(result.knowledgeUpdates.length).toBe(2)
      expect(result.knowledgeUpdates[0].knowledgeNodeId).toBe("k1")
      expect(result.knowledgeUpdates[1].knowledgeNodeId).toBe("k2")
    })

    it("limits knowledge snapshots to 3", () => {
      const nodes = Array.from({ length: 5 }, (_, i) => ({
        id: `k${i}`,
        title: `Node ${i}`,
        subjectCode: "math" as const
      }))
      const result = assessTutorTurn({
        ...baseInput,
        knowledgeNodes: nodes
      })
      expect(result.knowledgeSnapshots.length).toBe(3)
    })

    it("includes knowledge update reason with correctness and hint level", () => {
      const result = assessTutorTurn({
        ...baseInput,
        userMessage: "答案是 3/2",
        tutorReply: "完全正确",
        maxHintLevel: "L2",
        knowledgeNodes: [{ id: "k1", title: "极限", subjectCode: "math" }]
      })
      expect(result.knowledgeUpdates[0].reason).toContain("correct")
      expect(result.knowledgeUpdates[0].reason).toContain("L2")
    })
  })
})
