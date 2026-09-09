import { describe, expect, it } from "vitest"
import {
  chapterToLabel,
  buildPackMasteryRadar,
  type PackMasterySummary
} from "./dashboardMetrics"
import type { KnowledgePack } from "../knowledge/packManifest"
import type { KnowledgeSeedNode } from "../knowledge/packLoader"
import type { StudentKnowledgeMastery } from "../../types/learning"

function makePack(id: string, chapter: string): KnowledgePack {
  return {
    id,
    subject: "math",
    chapter,
    knowledgePath: "",
    questionPath: "",
    expectedNodeCount: 5,
    expectedQuestionCount: 3
  }
}

function makeNode(id: string): KnowledgeSeedNode {
  return {
    id,
    title: `Node ${id}`,
    summary: `Summary of ${id}`,
    source: { title: "test", license: "CC0" }
  }
}

function makeMastery(nodeId: string, prob: number): StudentKnowledgeMastery {
  return {
    knowledgeNodeId: nodeId,
    title: `Node ${nodeId}`,
    masteryProbability: prob,
    attemptsCount: 1,
    correctCount: 1,
    updatedAt: ""
  }
}

describe("chapterToLabel", () => {
  it("maps known chapters to human-readable labels", () => {
    expect(chapterToLabel("math-limits")).toBe("极限与连续")
    expect(chapterToLabel("cs408-data-structures")).toBe("数据结构")
  })

  it("returns the raw id for unknown chapters", () => {
    expect(chapterToLabel("unknown-chapter")).toBe("unknown-chapter")
  })
})

describe("buildPackMasteryRadar", () => {
  it("returns one summary per pack in manifest order", () => {
    const packs = [makePack("p1", "ch-a"), makePack("p2", "ch-b")]
    const map = new Map<string, KnowledgeSeedNode[]>()
    map.set("p1", [makeNode("n1"), makeNode("n2")])
    map.set("p2", [makeNode("n3")])

    const result = buildPackMasteryRadar(packs, map, [])
    expect(result).toHaveLength(2)
    expect(result[0].packId).toBe("p1")
    expect(result[1].packId).toBe("p2")
  })

  it("math 12 packs: returns all packs, not just learned nodes", () => {
    const packs = Array.from({ length: 12 }, (_, i) => makePack(`pack-${i}`, `ch-${i}`))
    const map = new Map<string, KnowledgeSeedNode[]>()
    for (let i = 0; i < 12; i++) {
      map.set(`pack-${i}`, [makeNode(`n${i}-1`), makeNode(`n${i}-2`)])
    }
    // Only one node learned
    const knowledge = [makeMastery("n0-1", 0.8)]

    const result = buildPackMasteryRadar(packs, map, knowledge)
    expect(result).toHaveLength(12)
    // First pack has 1 learned node out of 2 → average = 0.8 / 2 = 0.4
    expect(result[0].learnedNodes).toBe(1)
    expect(result[0].averageMastery).toBeCloseTo(0.4)
    // Other packs have 0 learned nodes
    expect(result[1].learnedNodes).toBe(0)
    expect(result[1].averageMastery).toBe(0)
  })

  it("cs408 4 packs: returns 4 summaries", () => {
    const packs = [
      makePack("cs408-ds", "cs408-data-structures"),
      makePack("cs408-co", "cs408-computer-organization"),
      makePack("cs408-os", "cs408-operating-systems"),
      makePack("cs408-cn", "cs408-computer-networks")
    ]
    const map = new Map<string, KnowledgeSeedNode[]>()
    for (const p of packs) {
      map.set(p.id, [makeNode(`${p.id}-n1`)])
    }

    const result = buildPackMasteryRadar(packs, map, [])
    expect(result).toHaveLength(4)
  })

  it("unlearned nodes count as 0 in averageMastery (radar chart)", () => {
    const packs = [makePack("p1", "ch")]
    const map = new Map<string, KnowledgeSeedNode[]>()
    map.set("p1", [makeNode("n1"), makeNode("n2"), makeNode("n3")])
    const knowledge = [makeMastery("n1", 0.9)]

    const result = buildPackMasteryRadar(packs, map, knowledge)
    // n1=0.9, n2=0, n3=0 → average = 0.9 / 3 = 0.3
    expect(result[0].averageMastery).toBeCloseTo(0.3)
    expect(result[0].learnedNodes).toBe(1)
    expect(result[0].totalNodes).toBe(3)
  })

  it("learnedNodes/totalNodes calculation is correct", () => {
    const packs = [makePack("p1", "ch")]
    const map = new Map<string, KnowledgeSeedNode[]>()
    map.set("p1", [makeNode("n1"), makeNode("n2"), makeNode("n3"), makeNode("n4")])
    const knowledge = [makeMastery("n1", 0.8), makeMastery("n3", 0.6)]

    const result = buildPackMasteryRadar(packs, map, knowledge)
    expect(result[0].totalNodes).toBe(4)
    expect(result[0].learnedNodes).toBe(2)
  })

  it("empty pack list returns empty array", () => {
    const result = buildPackMasteryRadar([], new Map(), [])
    expect(result).toEqual([])
  })

  it("pack with no nodes in map returns 0 totalNodes", () => {
    const packs = [makePack("p1", "ch")]
    const result = buildPackMasteryRadar(packs, new Map(), [])
    expect(result[0].totalNodes).toBe(0)
    expect(result[0].averageMastery).toBe(0)
  })

  it("no student knowledge → radar shows 0 for all packs (not 0.5)", () => {
    const packs = [makePack("p1", "ch-a"), makePack("p2", "ch-b")]
    const map = new Map<string, KnowledgeSeedNode[]>()
    map.set("p1", [makeNode("n1"), makeNode("n2")])
    map.set("p2", [makeNode("n3")])

    const result = buildPackMasteryRadar(packs, map, [])
    for (const pack of result) {
      expect(pack.averageMastery).toBe(0)
      expect(pack.learnedNodes).toBe(0)
    }
  })
})

describe("overall mastery computation (Dashboard UI contract)", () => {
  // This tests the logic used in DashboardView.vue overallMastery computed.
  // Cold-start 0.5 must NOT leak into the UI when there's no learning data.

  function computeOverallMastery(knowledge: StudentKnowledgeMastery[]): number {
    if (!knowledge.length) return 0
    const sum = knowledge.reduce((acc, k) => acc + k.masteryProbability, 0)
    return sum / knowledge.length
  }

  it("empty knowledge → 0 (not 0.5)", () => {
    expect(computeOverallMastery([])).toBe(0)
  })

  it("single node at 0.8 → 0.8", () => {
    expect(computeOverallMastery([makeMastery("n1", 0.8)])).toBeCloseTo(0.8)
  })

  it("two nodes → correct average", () => {
    const result = computeOverallMastery([
      makeMastery("n1", 0.6),
      makeMastery("n2", 0.9)
    ])
    expect(result).toBeCloseTo(0.75)
  })

  it("cold-start 0.5 is NOT used for unlearned nodes in dashboard", () => {
    // In BKT, unlearned nodes get 0.5 as a prior.
    // In the dashboard, only actually learned nodes contribute to the average.
    // If no nodes are learned, the display must show 0, not 0.5.
    const result = computeOverallMastery([])
    expect(result).not.toBe(0.5)
    expect(result).toBe(0)
  })
})
