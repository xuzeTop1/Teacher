import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  generateSeedEmbeddings,
  preflightEmbeddingCheck,
  getKnowledgeEmbeddingCount,
  getQuestionEmbeddingCount,
  getTotalEmbeddingCount,
  getEmbeddingModelInventory,
  classifySeedEmbeddingCoverage,
  type SeedEmbeddingProgress
} from "./seedEmbeddingService"

// Mock dependencies
vi.mock("./packLoader", () => ({
  loadApprovedKnowledgePacks: vi.fn(),
  loadApprovedQuestionPacks: vi.fn(),
  loadAllKnowledgePacksStrict: vi.fn(),
  loadAllQuestionPacksStrict: vi.fn()
}))

vi.mock("../tauri/commands", () => ({
  generateEmbedding: vi.fn(),
  generateEmbeddingsBatch: vi.fn(),
  storeVectorEmbedding: vi.fn(),
  countVectorEmbeddings: vi.fn(),
  deleteEmbeddingsByModelAndIds: vi.fn()
}))

import { loadApprovedKnowledgePacks, loadApprovedQuestionPacks, loadAllKnowledgePacksStrict, loadAllQuestionPacksStrict } from "./packLoader"
import { generateEmbedding, generateEmbeddingsBatch, storeVectorEmbedding, countVectorEmbeddings, deleteEmbeddingsByModelAndIds } from "../tauri/commands"

const TEST_EMBEDDING_CONFIG = {
  baseUrl: "https://api.test.com/v1",
  apiKeyRef: "test-ref",
  embeddingModel: "bge-m3"
}

describe("seedEmbeddingService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: preflight succeeds (generateEmbedding returns a non-empty vector)
    vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
    vi.mocked(deleteEmbeddingsByModelAndIds).mockResolvedValue(0)
    // Default: strict loaders return same as approved (no draft packs to converge)
    vi.mocked(loadAllKnowledgePacksStrict).mockResolvedValue([])
    vi.mocked(loadAllQuestionPacksStrict).mockResolvedValue([])
  })

  describe("generateSeedEmbeddings", () => {
    it("throws when provider config is incomplete", async () => {
      await expect(
        generateSeedEmbeddings({ baseUrl: "", apiKeyRef: "", embeddingModel: "bge-m3" })
      ).rejects.toThrow("Provider API key and base URL are required")
    })

    it("returns zero when no items found", async () => {
      vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([])
      vi.mocked(loadApprovedQuestionPacks).mockResolvedValue([])

      const result = await generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)
      expect(result).toEqual({ stored: 0, failed: 0, totalNodes: 0, cleanedStale: 0 })
    })

    it("processes knowledge nodes and questions together", async () => {
      vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([
        {
          __packId: "math-limits",
          subject: "math",
          nodes: [
            { id: "kn-1", title: "Limit", summary: "A limit is...", source: { title: "t", license: "l" } }
          ]
        }
      ] as any)

      vi.mocked(loadApprovedQuestionPacks).mockResolvedValue([
        {
          __packId: "math-limits",
          subject: "math",
          questions: [
            { id: "q-1", title: "Q1", content: "What is a limit?", type: "choice", difficulty: 1, knowledgeNodeIds: [], source: { title: "t", license: "l" } }
          ]
        }
      ] as any)

      vi.mocked(generateEmbeddingsBatch).mockResolvedValue([[0.1, 0.2], [0.3, 0.4]])
      vi.mocked(storeVectorEmbedding).mockResolvedValue(true)

      const progressHistory: SeedEmbeddingProgress[] = []
      const result = await generateSeedEmbeddings(TEST_EMBEDDING_CONFIG, (p) => progressHistory.push(p))

      expect(result.stored).toBe(2)
      expect(result.failed).toBe(0)
      expect(result.totalNodes).toBe(2)

      // Check store calls - should use bge-m3 model from config
      expect(storeVectorEmbedding).toHaveBeenCalledTimes(2)
      expect(storeVectorEmbedding).toHaveBeenCalledWith(
        "emb-kn-1",
        "knowledge_node",
        "kn-1",
        [0.1, 0.2],
        "bge-m3"
      )
      expect(storeVectorEmbedding).toHaveBeenCalledWith(
        "emb-q-1",
        "question",
        "q-1",
        [0.3, 0.4],
        "bge-m3"
      )

      // Check progress was reported
      expect(progressHistory.some((p) => p.phase === "loading_nodes")).toBe(true)
      expect(progressHistory.some((p) => p.phase === "generating")).toBe(true)
      expect(progressHistory.some((p) => p.phase === "storing")).toBe(true)
      expect(progressHistory.some((p) => p.phase === "done")).toBe(true)
    })

    it("cleans stale vectors from other models before generating", async () => {
      vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([
        {
          __packId: "math-limits",
          subject: "math",
          nodes: [
            { id: "kn-1", title: "Limit", summary: "A limit is...", source: { title: "t", license: "l" } }
          ]
        }
      ] as any)
      vi.mocked(loadApprovedQuestionPacks).mockResolvedValue([])
      vi.mocked(generateEmbeddingsBatch).mockResolvedValue([[0.1, 0.2]])
      vi.mocked(storeVectorEmbedding).mockResolvedValue(true)
      vi.mocked(deleteEmbeddingsByModelAndIds).mockResolvedValue(3)

      const result = await generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)

      // Should have called delete for other known models (not bge-m3)
      expect(deleteEmbeddingsByModelAndIds).toHaveBeenCalledWith(
        "knowledge_node",
        "text-embedding-3-small",
        ["kn-1"]
      )
      expect(result.cleanedStale).toBeGreaterThan(0)
    })

    it("handles store failures gracefully", async () => {
      vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([
        {
          __packId: "math-limits",
          subject: "math",
          nodes: [
            { id: "kn-1", title: "Limit", summary: "A limit is...", source: { title: "t", license: "l" } }
          ]
        }
      ] as any)

      vi.mocked(loadApprovedQuestionPacks).mockResolvedValue([])
      vi.mocked(generateEmbeddingsBatch).mockResolvedValue([[0.1, 0.2]])
      vi.mocked(storeVectorEmbedding).mockResolvedValue(false)

      const result = await generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)
      expect(result.stored).toBe(0)
      expect(result.failed).toBe(1)
    })

    it("rejects when knowledge pack loader fails", async () => {
      vi.mocked(loadApprovedKnowledgePacks).mockRejectedValue(new Error("pack load failed"))
      vi.mocked(loadApprovedQuestionPacks).mockResolvedValue([])

      await expect(generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)).rejects.toThrow("pack load failed")
    })

    it("rejects when question pack loader fails", async () => {
      vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([
        {
          __packId: "math-limits",
          subject: "math",
          nodes: [
            { id: "kn-1", title: "Limit", summary: "A limit is...", source: { title: "t", license: "l" } }
          ]
        }
      ] as any)
      vi.mocked(loadApprovedQuestionPacks).mockRejectedValue(new Error("question pack load failed"))

      await expect(generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)).rejects.toThrow("question pack load failed")
    })

    it("does not generate partial embeddings when one pack fails", async () => {
      vi.mocked(loadApprovedKnowledgePacks).mockRejectedValue(new Error("partial failure"))
      vi.mocked(loadApprovedQuestionPacks).mockResolvedValue([])
      vi.mocked(generateEmbeddingsBatch).mockResolvedValue([[0.1, 0.2]])

      await expect(generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)).rejects.toThrow()
      expect(storeVectorEmbedding).not.toHaveBeenCalled()
    })

    it("only processes approved packs (no draft entities in batch)", async () => {
      vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([
        {
          __packId: "math-limits",
          subject: "math",
          status: "approved",
          nodes: [
            { id: "approved-node-1", title: "Limit", summary: "A limit is...", source: { title: "t", license: "l" } }
          ]
        }
      ] as any)

      vi.mocked(loadApprovedQuestionPacks).mockResolvedValue([
        {
          __packId: "math-limits",
          subject: "math",
          status: "approved",
          questions: [
            { id: "approved-q-1", title: "Q1", content: "What?", type: "choice", difficulty: 1, knowledgeNodeIds: [], source: { title: "t", license: "l" } }
          ]
        }
      ] as any)

      vi.mocked(generateEmbeddingsBatch).mockResolvedValue([[0.1, 0.2], [0.3, 0.4]])
      vi.mocked(storeVectorEmbedding).mockResolvedValue(true)

      const result = await generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)

      expect(result.totalNodes).toBe(2)
      expect(result.stored).toBe(2)

      const storedIds = vi.mocked(storeVectorEmbedding).mock.calls.map((c) => c[2])
      expect(storedIds).toContain("approved-node-1")
      expect(storedIds).toContain("approved-q-1")
      expect(storedIds).not.toContain("draft-node-1")
      expect(storedIds).not.toContain("draft-q-1")
    })

    it("does not start batch when embedding endpoint returns 404", async () => {
      vi.mocked(generateEmbedding).mockRejectedValue(new Error("embedding API returned 404 Not Found: openresty HTML"))
      vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([
        { __packId: "math-limits", subject: "math", nodes: [{ id: "kn-1", title: "T", summary: "S", source: { title: "t", license: "l" } }] }
      ] as any)
      vi.mocked(loadApprovedQuestionPacks).mockResolvedValue([])

      await expect(generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)).rejects.toThrow("不支持 Embedding 接口")
      expect(generateEmbeddingsBatch).not.toHaveBeenCalled()
      expect(storeVectorEmbedding).not.toHaveBeenCalled()
    })

    it("returns user-friendly error when embedding endpoint returns 404", async () => {
      vi.mocked(generateEmbedding).mockRejectedValue(new Error("embedding API returned 404 Not Found"))

      await expect(generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)).rejects.toThrow(/keyword 检索仍可正常使用/)
    })

    it("returns user-friendly error when embedding model not supported", async () => {
      vi.mocked(generateEmbedding).mockRejectedValue(new Error("embedding API returned 400 Bad Request: model not found"))

      await expect(generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)).rejects.toThrow(/不被当前 Provider 支持/)
    })
  })

  describe("preflightEmbeddingCheck", () => {
    it("returns null on success", async () => {
      vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2])
      const result = await preflightEmbeddingCheck(TEST_EMBEDDING_CONFIG)
      expect(result).toBeNull()
    })

    it("returns friendly message on 404", async () => {
      vi.mocked(generateEmbedding).mockRejectedValue(new Error("embedding API returned 404 Not Found: openresty HTML"))
      const result = await preflightEmbeddingCheck(TEST_EMBEDDING_CONFIG)
      expect(result).toContain("不支持 Embedding 接口")
      expect(result).toContain("keyword 检索仍可正常使用")
    })

    it("returns friendly message on 401", async () => {
      vi.mocked(generateEmbedding).mockRejectedValue(new Error("embedding API returned 401 Unauthorized"))
      const result = await preflightEmbeddingCheck(TEST_EMBEDDING_CONFIG)
      expect(result).toContain("认证失败")
    })

    it("returns error when config is incomplete", async () => {
      const result = await preflightEmbeddingCheck({ baseUrl: "", apiKeyRef: "", embeddingModel: "bge-m3" })
      expect(result).toContain("required")
    })
  })

  describe("getKnowledgeEmbeddingCount", () => {
    it("returns count from command", async () => {
      vi.mocked(countVectorEmbeddings).mockResolvedValue(42)
      const count = await getKnowledgeEmbeddingCount("bge-m3")
      expect(count).toBe(42)
      expect(countVectorEmbeddings).toHaveBeenCalledWith("knowledge_node", "bge-m3")
    })

    it("returns 0 on error", async () => {
      vi.mocked(countVectorEmbeddings).mockRejectedValue(new Error("fail"))
      const count = await getKnowledgeEmbeddingCount("bge-m3")
      expect(count).toBe(0)
    })
  })

  describe("getQuestionEmbeddingCount", () => {
    it("returns count from command", async () => {
      vi.mocked(countVectorEmbeddings).mockResolvedValue(20)
      const count = await getQuestionEmbeddingCount("bge-m3")
      expect(count).toBe(20)
      expect(countVectorEmbeddings).toHaveBeenCalledWith("question", "bge-m3")
    })
  })

  describe("getTotalEmbeddingCount", () => {
    it("returns combined counts", async () => {
      vi.mocked(countVectorEmbeddings)
        .mockResolvedValueOnce(42)  // knowledge
        .mockResolvedValueOnce(20)  // questions

      const result = await getTotalEmbeddingCount("bge-m3")
      expect(result).toEqual({ knowledge: 42, questions: 20, total: 62 })
    })
  })

  describe("convergence reliability (fail-closed)", () => {
    const approvedPack = {
      __packId: "math-limits",
      subject: "math",
      status: "approved",
      nodes: [
        { id: "kn-approved-1", title: "T1", summary: "S1", source: { title: "t", license: "l" } },
        { id: "kn-approved-2", title: "T2", summary: "S2", source: { title: "t", license: "l" } }
      ]
    }
    const approvedQuestionPack = {
      __packId: "math-limits",
      subject: "math",
      status: "approved",
      questions: [
        { id: "q-approved-1", title: "Q1", content: "C1", type: "choice", difficulty: 1, knowledgeNodeIds: [], source: { title: "t", license: "l" } }
      ]
    }
    const draftPack = {
      __packId: "cs408-ds",
      subject: "cs408",
      status: "draft",
      nodes: [
        { id: "kn-draft-1", title: "D1", summary: "DS1", source: { title: "t", license: "l" } },
        { id: "kn-draft-2", title: "D2", summary: "DS2", source: { title: "t", license: "l" } },
        { id: "kn-draft-3", title: "D3", summary: "DS3", source: { title: "t", license: "l" } }
      ]
    }
    const draftQuestionPack = {
      __packId: "cs408-ds",
      subject: "cs408",
      status: "draft",
      questions: [
        { id: "q-draft-1", title: "DQ1", content: "DC1", type: "choice", difficulty: 1, knowledgeNodeIds: [], source: { title: "t", license: "l" } },
        { id: "q-draft-2", title: "DQ2", content: "DC2", type: "choice", difficulty: 1, knowledgeNodeIds: [], source: { title: "t", license: "l" } }
      ]
    }

    function setupNormalPath() {
      vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([approvedPack] as any)
      vi.mocked(loadApprovedQuestionPacks).mockResolvedValue([approvedQuestionPack] as any)
      vi.mocked(loadAllKnowledgePacksStrict).mockResolvedValue([approvedPack, draftPack] as any)
      vi.mocked(loadAllQuestionPacksStrict).mockResolvedValue([approvedQuestionPack, draftQuestionPack] as any)
      vi.mocked(generateEmbeddingsBatch).mockResolvedValue([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]])
      vi.mocked(storeVectorEmbedding).mockResolvedValue(true)
      vi.mocked(deleteEmbeddingsByModelAndIds).mockResolvedValue(3)
    }

    it("strict loader failure propagates — delete not called, operation fails", async () => {
      vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([approvedPack] as any)
      vi.mocked(loadApprovedQuestionPacks).mockResolvedValue([approvedQuestionPack] as any)
      vi.mocked(loadAllKnowledgePacksStrict).mockRejectedValue(new Error("pack cs408-os failed to load"))
      vi.mocked(generateEmbeddingsBatch).mockResolvedValue([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]])
      vi.mocked(storeVectorEmbedding).mockResolvedValue(true)

      await expect(generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)).rejects.toThrow("pack cs408-os failed to load")
      // Embedding generation must NOT have started (no generation on partial/failed convergence)
      expect(generateEmbeddingsBatch).not.toHaveBeenCalled()
      expect(storeVectorEmbedding).not.toHaveBeenCalled()
    })

    it("delete command failure propagates — operation fails, no false success", async () => {
      setupNormalPath()
      vi.mocked(deleteEmbeddingsByModelAndIds).mockRejectedValue(new Error("SQLite disk I/O error"))

      await expect(generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)).rejects.toThrow("SQLite disk I/O error")
      // Embedding generation must NOT have started
      expect(generateEmbeddingsBatch).not.toHaveBeenCalled()
    })

    it("derives correct draft IDs: all minus approved", async () => {
      setupNormalPath()

      await generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)

      // Draft knowledge IDs = all(5) - approved(2) = 3 draft nodes
      const deleteCalls = vi.mocked(deleteEmbeddingsByModelAndIds).mock.calls
      const knowledgeDeleteCall = deleteCalls.find((c) => c[0] === "knowledge_node" && c[1] === "bge-m3")
      expect(knowledgeDeleteCall).toBeDefined()
      const deletedKnowledgeIds = knowledgeDeleteCall![2]
      expect(deletedKnowledgeIds).toContain("kn-draft-1")
      expect(deletedKnowledgeIds).toContain("kn-draft-2")
      expect(deletedKnowledgeIds).toContain("kn-draft-3")
      expect(deletedKnowledgeIds).not.toContain("kn-approved-1")
      expect(deletedKnowledgeIds).not.toContain("kn-approved-2")
      expect(deletedKnowledgeIds.length).toBe(3)

      // Draft question IDs = all(3) - approved(1) = 2 draft questions
      const questionDeleteCall = deleteCalls.find((c) => c[0] === "question" && c[1] === "bge-m3")
      expect(questionDeleteCall).toBeDefined()
      const deletedQuestionIds = questionDeleteCall![2]
      expect(deletedQuestionIds).toContain("q-draft-1")
      expect(deletedQuestionIds).toContain("q-draft-2")
      expect(deletedQuestionIds).not.toContain("q-approved-1")
      expect(deletedQuestionIds.length).toBe(2)
    })

    it("draft set has zero intersection with approved set", async () => {
      setupNormalPath()

      await generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)

      const deleteCalls = vi.mocked(deleteEmbeddingsByModelAndIds).mock.calls
      const approvedKnowledgeIds = new Set(["kn-approved-1", "kn-approved-2"])
      const approvedQuestionIds = new Set(["q-approved-1"])

      for (const call of deleteCalls) {
        if (call[1] !== "bge-m3") continue // only current model convergence
        const deletedIds = call[2] as string[]
        const approvedSet = call[0] === "knowledge_node" ? approvedKnowledgeIds : approvedQuestionIds
        for (const id of deletedIds) {
          expect(approvedSet.has(id)).toBe(false)
        }
      }
    })

    it("duplicate node ID in manifest causes failure", async () => {
      const dupPack = {
        __packId: "dup-pack",
        subject: "math",
        status: "draft",
        nodes: [
          { id: "kn-dup", title: "D1", summary: "S1", source: { title: "t", license: "l" } },
          { id: "kn-dup", title: "D2", summary: "S2", source: { title: "t", license: "l" } }
        ]
      }
      vi.mocked(loadApprovedKnowledgePacks).mockResolvedValue([approvedPack] as any)
      vi.mocked(loadApprovedQuestionPacks).mockResolvedValue([approvedQuestionPack] as any)
      vi.mocked(loadAllKnowledgePacksStrict).mockResolvedValue([approvedPack, dupPack] as any)
      vi.mocked(loadAllQuestionPacksStrict).mockResolvedValue([approvedQuestionPack] as any)
      vi.mocked(generateEmbeddingsBatch).mockResolvedValue([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]])
      vi.mocked(storeVectorEmbedding).mockResolvedValue(true)

      await expect(generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)).rejects.toThrow(/ID 重复/)
      expect(generateEmbeddingsBatch).not.toHaveBeenCalled()
      expect(storeVectorEmbedding).not.toHaveBeenCalled()
    })

    it("normal path completes approved 2+1 generation after convergence", async () => {
      setupNormalPath()

      const result = await generateSeedEmbeddings(TEST_EMBEDDING_CONFIG)

      // 2 approved knowledge nodes + 1 approved question = 3 items generated
      expect(result.totalNodes).toBe(3)
      expect(result.stored).toBe(3)
      expect(result.failed).toBe(0)
      // Convergence deleted draft vectors
      expect(result.cleanedStale).toBeGreaterThan(0)
      // Embeddings stored with correct model
      expect(storeVectorEmbedding).toHaveBeenCalledWith(
        "emb-kn-approved-1", "knowledge_node", "kn-approved-1", expect.any(Array), "bge-m3"
      )
    })
  })

  describe("existing embedding inventory", () => {
    it("classifies empty, complete, incomplete, and drifted stores", () => {
      expect(classifySeedEmbeddingCoverage(0, 63)).toBe("empty")
      expect(classifySeedEmbeddingCoverage(63, 63)).toBe("complete")
      expect(classifySeedEmbeddingCoverage(42, 63)).toBe("incomplete")
      expect(classifySeedEmbeddingCoverage(1542, 63)).toBe("drift")
    })

    it("discovers existing models and sorts by total vector count", async () => {
      vi.mocked(countVectorEmbeddings).mockImplementation(async (entityType, model) => {
        if (model === "bge-m3") return entityType === "knowledge_node" ? 776 : 766
        if (model === "text-embedding-3-small") return entityType === "knowledge_node" ? 43 : 20
        return 0
      })

      const inventory = await getEmbeddingModelInventory([
        "text-embedding-3-small",
        "bge-m3",
        "bge-m3",
        "unused"
      ])

      expect(inventory).toEqual([
        { model: "bge-m3", knowledge: 776, questions: 766, total: 1542 },
        { model: "text-embedding-3-small", knowledge: 43, questions: 20, total: 63 }
      ])
    })
  })
})
