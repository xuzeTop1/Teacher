import { describe, expect, it } from "vitest"
import {
  isColdStartKnowledge,
  isColdStartMastery,
  getMasteryDisplayStatus,
  getMasteryLabel,
  getMasteryBadgeText,
  getMasteryBadgeClass,
  getMasteryColor,
  getMasteryVisualIcon,
  getMasteryVisualState,
  hasInformativeMasteryEvidence,
  isColdStartOverall,
  getRealOverallMastery
} from "./mastery"
import type { StudentKnowledgeMastery } from "../types/learning"

function makeRecord(overrides: Partial<StudentKnowledgeMastery> = {}): StudentKnowledgeMastery {
  return {
    knowledgeNodeId: "test-node",
    title: "Test Node",
    masteryProbability: 0.5,
    attemptsCount: 0,
    correctCount: 0,
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides
  }
}

describe("isColdStartKnowledge", () => {
  it("returns true when attemptsCount is 0", () => {
    expect(isColdStartKnowledge(makeRecord({ attemptsCount: 0 }))).toBe(true)
  })

  it("returns false when attemptsCount > 0", () => {
    expect(isColdStartKnowledge(makeRecord({ attemptsCount: 1 }))).toBe(false)
  })
})

describe("isColdStartMastery", () => {
  it("returns true when mastery=0.5 and no attempts", () => {
    expect(isColdStartMastery(makeRecord({ masteryProbability: 0.5, attemptsCount: 0 }))).toBe(true)
  })

  it("returns false when mastery=0.5 but has attempts", () => {
    expect(isColdStartMastery(makeRecord({ masteryProbability: 0.5, attemptsCount: 3 }))).toBe(false)
  })

  it("returns false when mastery!=0.5 and no attempts", () => {
    expect(isColdStartMastery(makeRecord({ masteryProbability: 0.3, attemptsCount: 0 }))).toBe(false)
  })
})

describe("getMasteryDisplayStatus", () => {
  it("returns cold_start for 0 attempts", () => {
    expect(getMasteryDisplayStatus(makeRecord({ attemptsCount: 0 }))).toBe("cold_start")
  })

  it("returns insufficient_data for 1-2 attempts", () => {
    expect(getMasteryDisplayStatus(makeRecord({ attemptsCount: 1 }))).toBe("insufficient_data")
    expect(getMasteryDisplayStatus(makeRecord({ attemptsCount: 2 }))).toBe("insufficient_data")
  })

  it("returns real_mastery for 3+ attempts with informative mastery", () => {
    expect(getMasteryDisplayStatus(makeRecord({
      attemptsCount: 3,
      masteryProbability: 0.6
    }))).toBe("real_mastery")
  })

  it("keeps untouched 50% unknown evidence out of real mastery", () => {
    const record = makeRecord({
      attemptsCount: 19,
      correctCount: 0,
      masteryProbability: 0.5
    })
    expect(hasInformativeMasteryEvidence(record)).toBe(false)
    expect(getMasteryDisplayStatus(record)).toBe("insufficient_data")
  })
})

describe("getMasteryLabel", () => {
  it("returns '未开始' for cold start", () => {
    expect(getMasteryLabel(makeRecord({ attemptsCount: 0, masteryProbability: 0.5 }))).toBe("未开始")
  })

  it("shows '数据较少' for insufficient data with high mastery", () => {
    expect(getMasteryLabel(makeRecord({ attemptsCount: 1, masteryProbability: 0.75 }))).toContain("数据较少")
  })

  it("shows '待学习' for insufficient data with low mastery", () => {
    expect(getMasteryLabel(makeRecord({ attemptsCount: 1, masteryProbability: 0.3 }))).toContain("待学习")
  })

  it("shows percentage for real mastery", () => {
    expect(getMasteryLabel(makeRecord({ attemptsCount: 5, masteryProbability: 0.85 }))).toBe("85% · 已掌握")
  })

  it("shows '学习中' for mid-range real mastery", () => {
    expect(getMasteryLabel(makeRecord({ attemptsCount: 5, masteryProbability: 0.6 }))).toBe("60% · 学习中")
  })
})

describe("getMasteryBadgeText", () => {
  it("returns '未开始' for cold start", () => {
    expect(getMasteryBadgeText(makeRecord({ attemptsCount: 0 }))).toBe("未开始")
  })

  it("shows '待评估' instead of 50% for untouched prior records", () => {
    expect(getMasteryBadgeText(makeRecord({
      attemptsCount: 1,
      correctCount: 0,
      masteryProbability: 0.5
    }))).toBe("待评估")
  })
})

describe("getMasteryBadgeClass", () => {
  it("returns status-cold for cold start", () => {
    expect(getMasteryBadgeClass(makeRecord({ attemptsCount: 0 }))).toBe("status-cold")
  })

  it("returns status-insufficient for insufficient data", () => {
    expect(getMasteryBadgeClass(makeRecord({ attemptsCount: 1 }))).toBe("status-insufficient")
  })

  it("returns status-mastered for high real mastery", () => {
    expect(getMasteryBadgeClass(makeRecord({ attemptsCount: 5, masteryProbability: 0.9 }))).toBe("status-mastered")
  })
})

describe("getMasteryColor", () => {
  it("returns gray for undefined record", () => {
    expect(getMasteryColor(undefined)).toBe("#9e9e9e")
  })

  it("returns gray for cold start record", () => {
    expect(getMasteryColor(makeRecord({ attemptsCount: 0, masteryProbability: 0.5 }))).toBe("#9e9e9e")
  })

  it("returns gray for unknown attempts that never changed the 50% prior", () => {
    expect(getMasteryColor(makeRecord({
      attemptsCount: 4,
      correctCount: 0,
      masteryProbability: 0.5
    }))).toBe("#9e9e9e")
  })

  it("returns green for high mastery with attempts", () => {
    expect(getMasteryColor(makeRecord({ attemptsCount: 5, masteryProbability: 0.9 }))).toBe("#4caf50")
  })

  it("returns orange for mid mastery with attempts", () => {
    expect(getMasteryColor(makeRecord({ attemptsCount: 3, masteryProbability: 0.6 }))).toBe("#ff9800")
  })
})

describe("isColdStartOverall", () => {
  it("returns true for empty array", () => {
    expect(isColdStartOverall([])).toBe(true)
  })

  it("returns true when all records have 0 attempts", () => {
    expect(isColdStartOverall([
      makeRecord({ attemptsCount: 0 }),
      makeRecord({ attemptsCount: 0 })
    ])).toBe(true)
  })

  it("returns false when any record has informative evidence", () => {
    expect(isColdStartOverall([
      makeRecord({ attemptsCount: 0 }),
      makeRecord({ attemptsCount: 1, masteryProbability: 0.35 })
    ])).toBe(false)
  })

  it("returns true when attempts contain only untouched 50% unknown evidence", () => {
    expect(isColdStartOverall([
      makeRecord({ attemptsCount: 4, correctCount: 0, masteryProbability: 0.5 }),
      makeRecord({ attemptsCount: 1, correctCount: 0, masteryProbability: 0.5 })
    ])).toBe(true)
  })
})

describe("getRealOverallMastery", () => {
  it("returns 0 for empty array", () => {
    expect(getRealOverallMastery([])).toBe(0)
  })

  it("returns 0 when all records are cold start", () => {
    expect(getRealOverallMastery([
      makeRecord({ attemptsCount: 0, masteryProbability: 0.5 }),
      makeRecord({ attemptsCount: 0, masteryProbability: 0.5 })
    ])).toBe(0)
  })

  it("calculates average of real records only", () => {
    expect(getRealOverallMastery([
      makeRecord({ attemptsCount: 0, masteryProbability: 0.5 }), // cold start, excluded
      makeRecord({ attemptsCount: 5, masteryProbability: 0.8 }),
      makeRecord({ attemptsCount: 3, masteryProbability: 0.6 })
    ])).toBe(0.7) // (0.8 + 0.6) / 2
  })
})

describe("talent tree visual state", () => {
  it("maps mastery states to meaningful node icons", () => {
    expect(getMasteryVisualState(undefined)).toBe("not_started")
    expect(getMasteryVisualIcon(undefined)).toBe("◇")
    expect(getMasteryVisualIcon(makeRecord({
      attemptsCount: 2,
      masteryProbability: 0.25
    }))).toBe("!")
    expect(getMasteryVisualIcon(makeRecord({
      attemptsCount: 2,
      masteryProbability: 0.65
    }))).toBe("↗")
    expect(getMasteryVisualIcon(makeRecord({
      attemptsCount: 2,
      masteryProbability: 0.9
    }))).toBe("✓")
  })
})
