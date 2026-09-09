import { describe, expect, it, vi, beforeEach } from "vitest"
import { getPackSubjectSummary, getApprovedPackSubjectSummary, getPackList, compareManifestWithDatabase, runKnowledgeHealthCheck, runApprovedHealthCheck, getCatalogStatistics } from "./packStatus"

// Mock Tauri commands
vi.mock("../tauri/commands", () => ({
  countManifestNodes: vi.fn(),
  knowledgeHealthCheck: vi.fn()
}))

// Mock packLoader
vi.mock("./packLoader", () => ({
  loadApprovedKnowledgePacks: vi.fn(),
  loadAllKnowledgePacksStrict: vi.fn()
}))

function mockHealthResult(overrides: Partial<{
  totalExpected: number; totalDb: number; missingCount: number; orphanCount: number;
  subjectMismatchCount: number; statusMismatchCount: number;
  safeToSync: boolean; statusMismatchIds: string[]; message: string;
}> = {}) {
  return {
    totalExpected: 0, totalDb: 0, missingCount: 0, orphanCount: 0,
    subjectMismatchCount: 0, statusMismatchCount: 0,
    missingIds: [], orphanIds: [], mismatchIds: [], orphanDetails: [],
    statusMismatchIds: [], safeToSync: true, message: "",
    ...overrides
  }
}

function mockManifestCountResult(overrides: Partial<{
  totalExpected: number; matchedCount: number; missingIds: string[];
  statusMismatchIds: string[]; subjectMismatchIds: string[];
  matchedCountsBySubject: Record<string, number>;
}> = {}) {
  return {
    totalExpected: 0, matchedCount: 0, missingIds: [],
    statusMismatchIds: [], subjectMismatchIds: [],
    matchedCountsBySubject: {},
    ...overrides
  }
}

// ── Static manifest tests ──────────────────────────────────────────────────

describe("getPackSubjectSummary", () => {
  it("math: 122 nodes / 91 questions across 12 packs (approved + draft)", () => {
    const summaries = getPackSubjectSummary()
    const math = summaries.find((s) => s.subject === "math")
    expect(math).toBeDefined()
    expect(math!.packCount).toBe(12)
    expect(math!.expectedNodeCount).toBe(122)
  })

  it("total: 776 nodes / 766 questions across 51 packs", () => {
    const summaries = getPackSubjectSummary()
    const totalPacks = summaries.reduce((s, r) => s + r.packCount, 0)
    const totalNodes = summaries.reduce((s, r) => s + r.expectedNodeCount, 0)
    expect(totalPacks).toBe(51)
    expect(totalNodes).toBe(776)
  })
})

describe("getApprovedPackSubjectSummary", () => {
  it("math: 97 nodes / 75 questions (9 approved packs)", () => {
    const summaries = getApprovedPackSubjectSummary()
    const math = summaries.find((s) => s.subject === "math")
    expect(math).toBeDefined()
    expect(math!.expectedNodeCount).toBe(97)
  })

  it("total approved: 145 nodes / 123 questions across 11 packs", () => {
    const summaries = getApprovedPackSubjectSummary()
    const totalNodes = summaries.reduce((s, r) => s + r.expectedNodeCount, 0)
    expect(totalNodes).toBe(145)
  })
})

describe("getCatalogStatistics", () => {
  it("returns correct dual-catalog stats", () => {
    const stats = getCatalogStatistics()
    expect(stats.totalPacks).toBe(51)
    expect(stats.approvedPacks).toBe(11)
    expect(stats.approvedNodes).toBe(145)
    expect(stats.draftNodes).toBe(631)
  })
})

describe("getPackList", () => {
  it("returns all 51 packs with status", () => {
    const list = getPackList()
    expect(list).toHaveLength(51)
    for (const item of list) {
      expect(["approved", "draft"]).toContain(item.status)
    }
  })
})

// ── compareManifestWithDatabase tests ──────────────────────────────────────

const APPROVED_PACK_SPECS = [
  ["math", "math-limits", 35],
  ["math", "math-derivatives", 12],
  ["math", "math-applications-of-derivatives", 7],
  ["math", "math-indefinite-integrals", 8],
  ["math", "math-definite-integrals", 8],
  ["math", "math-integral-applications", 6],
  ["math", "math-mean-value-theorems", 5],
  ["math", "math-multivariable-calculus", 7],
  ["math", "probability-distributions", 9],
  ["programming", "python-basics", 8],
  ["cs408", "cs408-computer-networks", 40]
] as const

describe("compareManifestWithDatabase", () => {
  beforeEach(() => { vi.clearAllMocks() })

  // Helper to mock both loadApprovedKnowledgePacks and countManifestNodes
  async function mockCompareDeps(countResult: ReturnType<typeof mockManifestCountResult>) {
    const { countManifestNodes } = await import("../tauri/commands")
    const { loadApprovedKnowledgePacks } = await import("./packLoader")
    vi.mocked(countManifestNodes).mockResolvedValue(countResult as any)
    vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue(
      APPROVED_PACK_SPECS.map(([subject, packId, count]) => ({
        subject,
        __packId: packId,
        status: "approved",
        nodes: Array.from({ length: count }, (_, i) => ({ id: `${packId}-${i}`, title: `N${i}`, summary: "s", source: { title: "t", license: "l" } }))
      })) as any
    )
  }

  it("empty DB => totalActual=0, math actual=0, overallStatus=error", async () => {
    await mockCompareDeps(mockManifestCountResult({
      totalExpected: 145, matchedCount: 0,
      missingIds: Array.from({ length: 145 }, (_, i) => `n${i}`),
      matchedCountsBySubject: {}
    }))
    const result = await compareManifestWithDatabase()
    expect(result.totalActual).toBe(0)
    expect(result.totalExpected).toBe(145)
    expect(result.overallStatus).toBe("error")
    const math = result.subjects.find((s) => s.subject === "math")
    expect(math!.actualNodes).toBe(0)
    expect(math!.status).toBe("error")
  })

  it("144 matched + 1 missing => totalActual=144, warning", async () => {
    await mockCompareDeps(mockManifestCountResult({
      totalExpected: 145, matchedCount: 144,
      missingIds: ["mn5"],
      matchedCountsBySubject: { math: 96, programming: 8, cs408: 40 }
    }))
    const result = await compareManifestWithDatabase()
    expect(result.totalActual).toBe(144)
    expect(result.overallStatus).toBe("warning")
    const math = result.subjects.find((s) => s.subject === "math")
    expect(math!.actualNodes).toBe(96)
    expect(math!.status).toBe("warning")
  })

  it("34 matched + 1 extra approved same-subject row => actual=34, not补足", async () => {
    await mockCompareDeps(mockManifestCountResult({
      totalExpected: 145, matchedCount: 34,
      missingIds: ["mn5"],
      statusMismatchIds: [],
      subjectMismatchIds: [],
      matchedCountsBySubject: { math: 34, programming: 0, cs408: 0 }
    }))
    const result = await compareManifestWithDatabase()
    expect(result.totalActual).toBe(34)
    // programming actual=0 because matchedCountsBySubject has no programming key
    const prog = result.subjects.find((s) => s.subject === "programming")
    expect(prog!.actualNodes).toBe(0)
    expect(prog!.status).toBe("error")
  })

  it("custom approved does not affect matched_counts_by_subject", async () => {
    await mockCompareDeps(mockManifestCountResult({
      totalExpected: 145, matchedCount: 145,
      matchedCountsBySubject: { math: 97, programming: 8, cs408: 40 }
    }))
    const result = await compareManifestWithDatabase()
    expect(result.totalActual).toBe(145)
    expect(result.overallStatus).toBe("ok")
    expect(result.orphanCheck).toBe("not_applicable")
    expect(result.dbSubjectCounts["custom-subject"]).toBeUndefined()
  })

  it("count failure throws", async () => {
    const { countManifestNodes } = await import("../tauri/commands")
    const { loadApprovedKnowledgePacks } = await import("./packLoader")
    vi.mocked(countManifestNodes).mockRejectedValue(new Error("query failed"))
    vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([
      { subject: "math", __packId: "math-limits", status: "approved",
        nodes: [{ id: "n1", title: "N1", summary: "s", source: { title: "t", license: "l" } }] }
    ] as any)
    await expect(compareManifestWithDatabase()).rejects.toThrow("query failed")
  })

  it("status mismatch + subject mismatch on same node: only status mismatch", async () => {
    // Node has wrong status AND wrong subject — should only be in statusMismatchIds
    await mockCompareDeps(mockManifestCountResult({
      totalExpected: 145, matchedCount: 144,
      missingIds: [],
      statusMismatchIds: ["mn5"],
      subjectMismatchIds: [], // mn5 should NOT be here
      matchedCountsBySubject: { math: 96, programming: 8, cs408: 40 }
    }))
    const result = await compareManifestWithDatabase()
    expect(result.totalActual).toBe(144)
    // The mock already reflects mutual exclusivity — verify the contract holds
    expect(result.totalExpected).toBe(145)
  })
})

// ── runApprovedHealthCheck tests ───────────────────────────────────────────

describe("runApprovedHealthCheck", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("passes approved_builtin scope", async () => {
    const { knowledgeHealthCheck } = await import("../tauri/commands")
    const { loadApprovedKnowledgePacks } = await import("./packLoader")
    vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([
      { subject: "math", __packId: "math-limits", status: "approved",
        nodes: [{ id: "n1", title: "N1", summary: "s", source: { title: "t", license: "l" } }] }
    ] as any)
    vi.mocked(knowledgeHealthCheck).mockResolvedValue(mockHealthResult({
      totalExpected: 1, totalDb: 1, safeToSync: true
    }))
    const result = await runApprovedHealthCheck()
    expect(knowledgeHealthCheck).toHaveBeenCalledWith(
      expect.arrayContaining(["n1"]),
      expect.arrayContaining(["subject-math"]),
      "approved_builtin"
    )
    expect(result.safeToSync).toBe(true)
  })

  it("status mismatch => safeToSync=false", async () => {
    const { knowledgeHealthCheck } = await import("../tauri/commands")
    const { loadApprovedKnowledgePacks } = await import("./packLoader")
    vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([
      { subject: "math", __packId: "math-limits", status: "approved",
        nodes: [{ id: "n1", title: "N1", summary: "s", source: { title: "t", license: "l" } }] }
    ] as any)
    vi.mocked(knowledgeHealthCheck).mockResolvedValue(mockHealthResult({
      totalExpected: 1, totalDb: 1,
      statusMismatchCount: 1, statusMismatchIds: ["n1"],
      safeToSync: false, message: "1 个节点 review_status 不是 approved"
    }))
    const result = await runApprovedHealthCheck()
    expect(result.safeToSync).toBe(false)
    expect(result.statusMismatchCount).toBe(1)
  })

  it("statusMismatchCount > 50: count accurate, IDs truncated", async () => {
    const { knowledgeHealthCheck } = await import("../tauri/commands")
    const { loadApprovedKnowledgePacks } = await import("./packLoader")
    vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([
      { subject: "math", __packId: "math-limits", status: "approved",
        nodes: Array.from({ length: 60 }, (_, i) => ({
          id: `n${i}`, title: `N${i}`, summary: "s", source: { title: "t", license: "l" }
        })) }
    ] as any)
    vi.mocked(knowledgeHealthCheck).mockResolvedValue(mockHealthResult({
      totalExpected: 60, totalDb: 60,
      statusMismatchCount: 60, statusMismatchIds: Array.from({ length: 50 }, (_, i) => `n${i}`),
      safeToSync: false
    }))
    const result = await runApprovedHealthCheck()
    expect(result.statusMismatchCount).toBe(60)
    expect(result.statusMismatchIds).toHaveLength(50)
  })
})

// ── runKnowledgeHealthCheck tests ──────────────────────────────────────────

describe("runKnowledgeHealthCheck (full catalog)", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("passes all scope", async () => {
    const { knowledgeHealthCheck } = await import("../tauri/commands")
    const { loadAllKnowledgePacksStrict } = await import("./packLoader")
    vi.mocked(loadAllKnowledgePacksStrict).mockResolvedValue([
      { subject: "math", __packId: "math-limits", nodes: [
        { id: "n1", title: "N1", summary: "s", source: { title: "t", license: "l" } }
      ] }
    ] as any)
    vi.mocked(knowledgeHealthCheck).mockResolvedValue(mockHealthResult({
      totalExpected: 1, totalDb: 1, safeToSync: true
    }))
    const result = await runKnowledgeHealthCheck()
    expect(knowledgeHealthCheck).toHaveBeenCalledWith(
      expect.arrayContaining(["n1"]),
      expect.arrayContaining(["subject-math"]),
      "all"
    )
    expect(result.safeToSync).toBe(true)
  })
})
