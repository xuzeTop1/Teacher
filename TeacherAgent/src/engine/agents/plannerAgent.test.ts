import { describe, expect, it } from "vitest"
import {
  shouldTriggerPlanner,
  planNextLearningStep,
  formatPlannerResult
} from "./plannerAgent"

describe("shouldTriggerPlanner", () => {
  it("triggers on 接下来学什么", () => {
    expect(shouldTriggerPlanner("接下来学什么")).toBe(true)
  })

  it("triggers on 学习计划", () => {
    expect(shouldTriggerPlanner("帮我制定学习计划")).toBe(true)
  })

  it("triggers on 复习计划", () => {
    expect(shouldTriggerPlanner("我的复习计划是什么")).toBe(true)
  })

  it("triggers on 薄弱点", () => {
    expect(shouldTriggerPlanner("我的薄弱点在哪里")).toBe(true)
  })

  it("does not trigger on ordinary question", () => {
    expect(shouldTriggerPlanner("什么是极限")).toBe(false)
  })

  it("does not trigger on practice request", () => {
    expect(shouldTriggerPlanner("给我一道练习题")).toBe(false)
  })
})

describe("planNextLearningStep", () => {
  const baseInput = {
    userMessage: "接下来学什么",
    subjectCode: "math" as const
  }

  it("returns a valid PlannerResult with default structure", () => {
    const result = planNextLearningStep(baseInput)
    expect(result.trigger).toBe("user_requested_next_step")
    expect(result.subjectCode).toBe("math")
    expect(result.summary).toContain("数学")
    expect(result.nextTasks.length).toBeGreaterThan(0)
    expect(result.nextTasks.length).toBeLessThanOrEqual(5)
    expect(result.planningHorizon).toBe("next_turn")
  })

  it("infers review_due trigger from review-related message", () => {
    const result = planNextLearningStep({
      ...baseInput,
      userMessage: "我的复习计划是什么"
    })
    expect(result.trigger).toBe("review_due")
  })

  it("infers user_requested_schedule from schedule-related message", () => {
    const result = planNextLearningStep({
      ...baseInput,
      userMessage: "怎么安排今天的学习"
    })
    expect(result.trigger).toBe("user_requested_schedule")
    expect(result.planningHorizon).toBe("today")
  })

  it("infers this_week horizon", () => {
    const result = planNextLearningStep({
      ...baseInput,
      userMessage: "这周怎么安排"
    })
    expect(result.planningHorizon).toBe("this_week")
  })

  it("produces mastery signals for weak知识点", () => {
    const result = planNextLearningStep({
      ...baseInput,
      studentKnowledge: [
        {
          knowledgeNodeId: "k1",
          title: "极限定义",
          masteryProbability: 0.3,
          attemptsCount: 3,
          correctCount: 1,
          updatedAt: new Date().toISOString()
        }
      ]
    })
    expect(result.masterySignals.length).toBeGreaterThan(0)
    expect(result.masterySignals[0]).toContain("极限定义")
  })

  it("produces prerequisite signals when prerequisites exist", () => {
    const result = planNextLearningStep({
      ...baseInput,
      knowledgePrerequisites: [
        {
          targetNodeId: "k2",
          prerequisiteNodeId: "k1",
          title: "极限定义",
          source: "knowledge_edges" as const
        }
      ]
    })
    expect(result.prerequisiteSignals.length).toBeGreaterThan(0)
    expect(result.prerequisiteSignals[0]).toContain("极限定义")
  })

  it("produces review due signals for overdue items", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString()
    const result = planNextLearningStep({
      ...baseInput,
      studentKnowledge: [
        {
          knowledgeNodeId: "k1",
          title: "导数定义",
          masteryProbability: 0.5,
          attemptsCount: 5,
          correctCount: 3,
          lastPracticedAt: tenDaysAgo,
          updatedAt: tenDaysAgo
        }
      ],
      nowIso: new Date().toISOString()
    })
    expect(result.reviewDueSignals.length).toBeGreaterThan(0)
    expect(result.reviewDueSignals[0]).toContain("导数定义")
    expect(result.reviewDueSignals[0]).toContain("天未复习")
  })

  it("does not produce review due signals for recently practiced items", () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const result = planNextLearningStep({
      ...baseInput,
      studentKnowledge: [
        {
          knowledgeNodeId: "k1",
          title: "导数定义",
          masteryProbability: 0.5,
          attemptsCount: 5,
          correctCount: 3,
          lastPracticedAt: oneHourAgo,
          updatedAt: oneHourAgo
        }
      ],
      nowIso: new Date().toISOString()
    })
    expect(result.reviewDueSignals.length).toBe(0)
  })

  it("uses higher threshold for high mastery items", () => {
    // mastery 0.85+ has 14-day threshold
    const twelveDaysAgo = new Date(Date.now() - 12 * 86_400_000).toISOString()
    const result = planNextLearningStep({
      ...baseInput,
      studentKnowledge: [
        {
          knowledgeNodeId: "k1",
          title: "基础极限",
          masteryProbability: 0.9,
          attemptsCount: 10,
          correctCount: 9,
          lastPracticedAt: twelveDaysAgo,
          updatedAt: twelveDaysAgo
        }
      ],
      nowIso: new Date().toISOString()
    })
    // 12 days < 14 day threshold for 0.85+ mastery, so no review due
    expect(result.reviewDueSignals.length).toBe(0)
  })

  it("returns conservative confidence when no data available", () => {
    const result = planNextLearningStep(baseInput)
    // With no knowledge, prerequisites, or review data, confidence should be low
    expect(result.confidence).toBeLessThanOrEqual(0.72)
  })

  it("returns higher confidence when prerequisite signals exist", () => {
    const result = planNextLearningStep({
      ...baseInput,
      knowledgePrerequisites: [
        {
          targetNodeId: "k2",
          prerequisiteNodeId: "k1",
          title: "极限定义",
          source: "knowledge_edges" as const
        }
      ]
    })
    expect(result.confidence).toBe(0.82)
  })

  it("includes memory focus from short-term misconceptions", () => {
    const result = planNextLearningStep({
      ...baseInput,
      memoryContext: {
        shortTermMemory: {
          lastMisconceptions: ["混淆连续与可导"],
          recentFocus: []
        },
        longTermMemories: []
      }
    })
    expect(result.reviewFocus).toContain("混淆连续与可导")
  })

  it("deduplicates review focus items", () => {
    const result = planNextLearningStep({
      ...baseInput,
      memoryContext: {
        shortTermMemory: {
          lastMisconceptions: ["极限定义", "极限定义"],
          recentFocus: ["极限定义"]
        },
        longTermMemories: []
      }
    })
    const limitFocus = result.reviewFocus.filter((f) => f === "极限定义")
    expect(limitFocus.length).toBe(1)
  })
})

describe("formatPlannerResult", () => {
  it("formats a basic result with tasks", () => {
    const result = planNextLearningStep({
      userMessage: "接下来学什么",
      subjectCode: "math"
    })
    const formatted = formatPlannerResult(result)
    // formatPlannerResult outputs horizon + tasks, summary is separate
    expect(formatted).toContain("下一步")
    expect(formatted).toContain("1.")
    expect(formatted).toContain("分钟")
  })

  it("includes review focus when present", () => {
    const result = planNextLearningStep({
      userMessage: "接下来学什么",
      subjectCode: "math",
      studentKnowledge: [
        {
          knowledgeNodeId: "k1",
          title: "极限定义",
          masteryProbability: 0.3,
          attemptsCount: 3,
          correctCount: 1,
          updatedAt: new Date().toISOString()
        }
      ]
    })
    const formatted = formatPlannerResult(result)
    expect(formatted).toContain("优先盯住")
  })
})
