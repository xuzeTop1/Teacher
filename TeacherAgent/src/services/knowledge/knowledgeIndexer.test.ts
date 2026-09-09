import { describe, it, expect, vi, beforeEach } from "vitest"
import { seedAllKnowledgeNodes, seedDraftKnowledgeNodes } from "./knowledgeIndexer"

// Mock tauri commands
vi.mock("../tauri/commands", () => ({
  syncApprovedManifest: vi.fn(),
  seedKnowledgeNodesFromJson: vi.fn(),
  countKnowledgeNodes: vi.fn(),
  searchKnowledgeFromDb: vi.fn()
}))

// Mock packLoader
vi.mock("./packLoader", () => ({
  loadApprovedKnowledgePacks: vi.fn(),
  loadKnowledgePacksBySubject: vi.fn()
}))

import { syncApprovedManifest, seedKnowledgeNodesFromJson } from "../tauri/commands"
import { loadKnowledgePacksBySubject } from "./packLoader"

describe("seedAllKnowledgeNodes", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("calls syncApprovedManifest (backend-owned registry)", async () => {
    vi.mocked(syncApprovedManifest).mockResolvedValue({
      inserted: 0, updated: 1, skipped: 42, errors: []
    })
    const result = await seedAllKnowledgeNodes()
    expect(syncApprovedManifest).toHaveBeenCalled()
    expect(result.updated).toBe(1)
  })

  it("propagates sync errors", async () => {
    vi.mocked(syncApprovedManifest).mockRejectedValue(
      new Error("node xyz not in approved manifest")
    )
    await expect(seedAllKnowledgeNodes()).rejects.toThrow("not in approved manifest")
  })
})

describe("seedDraftKnowledgeNodes", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("only seeds draft packs for a subject", async () => {
    vi.mocked(loadKnowledgePacksBySubject).mockResolvedValue([
      {
        __packId: "math-limits",
        subject: "math",
        status: "approved",
        nodes: [{ id: "approved-node", title: "T", summary: "S", source: { title: "t", license: "l" } }]
      },
      {
        __packId: "math-derivatives",
        subject: "math",
        status: "draft",
        nodes: [{ id: "draft-node", title: "T2", summary: "S2", source: { title: "t", license: "l" } }]
      }
    ] as any)

    vi.mocked(seedKnowledgeNodesFromJson).mockResolvedValue({
      inserted: 1, updated: 0, skipped: 0, errors: []
    })

    const results = await seedDraftKnowledgeNodes("math")

    // Only draft pack was seeded (1 result)
    expect(results).toHaveLength(1)
    expect(results[0].inserted).toBe(1)

    // Verify only draft pack was seeded
    const seededJson = vi.mocked(seedKnowledgeNodesFromJson).mock.calls[0][0]
    const seededData = JSON.parse(seededJson)
    expect(seededData.nodes).toHaveLength(1)
    expect(seededData.nodes[0].id).toBe("draft-node")
  })
})
