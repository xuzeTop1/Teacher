import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  loadAllKnowledgePacks,
  loadAllKnowledgePacksStrict,
  loadKnowledgePacksByIdsStrict,
  clearPackCache
} from "./packLoader"

// Mock the packManifest module
vi.mock("./packManifest", () => ({
  PACK_MANIFEST: [
    { id: "pack-a", subject: "math", chapter: "ch-a", knowledgePath: "", questionPath: "", expectedNodeCount: 5, expectedQuestionCount: 3 },
    { id: "pack-b", subject: "math", chapter: "ch-b", knowledgePath: "", questionPath: "", expectedNodeCount: 4, expectedQuestionCount: 2 }
  ],
  getPackById: (id: string) => {
    const packs = [
      { id: "pack-a", subject: "math", chapter: "ch-a", knowledgePath: "", questionPath: "", expectedNodeCount: 5, expectedQuestionCount: 3 },
      { id: "pack-b", subject: "math", chapter: "ch-b", knowledgePath: "", questionPath: "", expectedNodeCount: 4, expectedQuestionCount: 2 }
    ]
    return packs.find((p) => p.id === id)
  },
  getPacksBySubject: (subject: string) => {
    const packs = [
      { id: "pack-a", subject: "math", chapter: "ch-a", knowledgePath: "", questionPath: "", expectedNodeCount: 5, expectedQuestionCount: 3 },
      { id: "pack-b", subject: "math", chapter: "ch-b", knowledgePath: "", questionPath: "", expectedNodeCount: 4, expectedQuestionCount: 2 }
    ]
    return packs.filter((p) => p.subject === subject)
  }
}))

describe("packLoader exports", () => {
  it("exports loadAllKnowledgePacks", () => {
    expect(typeof loadAllKnowledgePacks).toBe("function")
  })

  it("exports loadAllKnowledgePacksStrict", () => {
    expect(typeof loadAllKnowledgePacksStrict).toBe("function")
  })

  it("exports loadKnowledgePacksByIdsStrict", () => {
    expect(typeof loadKnowledgePacksByIdsStrict).toBe("function")
  })

  it("exports clearPackCache", () => {
    expect(typeof clearPackCache).toBe("function")
  })
})

describe("strict vs non-strict loader behavior", () => {
  beforeEach(() => {
    clearPackCache()
  })

  it("loadKnowledgePacksByIdsStrict rejects when given an unknown pack id", async () => {
    await expect(loadKnowledgePacksByIdsStrict(["nonexistent-pack"])).rejects.toThrow()
  })

  it("loadAllKnowledgePacksStrict rejects when any pack fails to load", async () => {
    // PACK_MANIFEST has pack-a and pack-b, but glob won't find them in test env
    // so loadKnowledgePack will throw for both → strict should reject
    await expect(loadAllKnowledgePacksStrict()).rejects.toThrow()
  })
})
