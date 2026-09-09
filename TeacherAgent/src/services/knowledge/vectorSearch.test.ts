import { describe, it, expect, vi, beforeEach } from "vitest"
import { searchKnowledgeByVector, searchQuestionByVector } from "./vectorSearch"

// Mock dependencies
vi.mock("../tauri/commands", () => ({
  generateEmbedding: vi.fn(),
  searchVectorEmbeddings: vi.fn(),
  storeVectorEmbedding: vi.fn()
}))

import { generateEmbedding, searchVectorEmbeddings } from "../tauri/commands"

const TEST_EMBEDDING_CONFIG = {
  baseUrl: "https://api.test.com/v1",
  apiKeyRef: "test-ref",
  embeddingModel: "bge-m3"
}

describe("vectorSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("searchKnowledgeByVector", () => {
    it("returns empty when embedding config is incomplete", async () => {
      const result = await searchKnowledgeByVector("test", {
        embeddingConfig: { baseUrl: "", apiKeyRef: "", embeddingModel: "bge-m3" }
      })
      expect(result.results).toEqual([])
      expect(result.embeddingModel).toBe("bge-m3")
    })

    it("returns empty when embedding generation fails", async () => {
      vi.mocked(generateEmbedding).mockRejectedValue(new Error("fail"))
      const result = await searchKnowledgeByVector("test", { embeddingConfig: TEST_EMBEDDING_CONFIG })
      expect(result.results).toEqual([])
    })

    it("returns empty when no embedding generated", async () => {
      vi.mocked(generateEmbedding).mockResolvedValue([])
      const result = await searchKnowledgeByVector("test", { embeddingConfig: TEST_EMBEDDING_CONFIG })
      expect(result.results).toEqual([])
    })

    it("searches with knowledge_node entity type and config model", async () => {
      vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
      vi.mocked(searchVectorEmbeddings).mockResolvedValue([
        { entity_type: "knowledge_node", entityId: "kn-1", score: 0.9, embeddingModel: "bge-m3" }
      ])

      const result = await searchKnowledgeByVector("test query", { embeddingConfig: TEST_EMBEDDING_CONFIG })
      expect(searchVectorEmbeddings).toHaveBeenCalledWith("knowledge_node", [0.1, 0.2, 0.3], "bge-m3", 10, undefined)
      expect(result.results).toHaveLength(1)
      expect(result.embeddingModel).toBe("bge-m3")
      expect(result.topScore).toBe(0.9)
    })

    it("passes approved entity IDs to backend for SQL-level filtering", async () => {
      vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
      // Backend returns only approved results (draft already excluded at SQL level)
      vi.mocked(searchVectorEmbeddings).mockResolvedValue([
        { entity_type: "knowledge_node", entityId: "approved-1", score: 0.9, embeddingModel: "bge-m3" },
        { entity_type: "knowledge_node", entityId: "approved-2", score: 0.7, embeddingModel: "bge-m3" }
      ])

      const approvedIds = new Set(["approved-1", "approved-2"])
      const result = await searchKnowledgeByVector("test", {
        embeddingConfig: TEST_EMBEDDING_CONFIG,
        limit: 3,
        approvedEntityIds: approvedIds
      })

      // Entity IDs passed to backend for SQL-level filtering (no over-fetch needed)
      expect(searchVectorEmbeddings).toHaveBeenCalledWith(
        "knowledge_node", [0.1, 0.2, 0.3], "bge-m3", 3, ["approved-1", "approved-2"]
      )
      expect(result.results).toHaveLength(2)
      expect(result.results[0].entityId).toBe("approved-1")
      expect(result.results[1].entityId).toBe("approved-2")
    })

    it("draft vectors cannot starve approved TopK (backend filters before truncation)", async () => {
      vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
      // Backend only returns approved results because entity_ids filter is applied
      // before cosine computation and truncation in Rust
      vi.mocked(searchVectorEmbeddings).mockResolvedValue([
        { entity_type: "knowledge_node", entityId: "approved-1", score: 0.6, embeddingModel: "bge-m3" }
      ])

      const approvedIds = new Set(["approved-1"])
      const result = await searchKnowledgeByVector("test", {
        embeddingConfig: TEST_EMBEDDING_CONFIG,
        limit: 3,
        approvedEntityIds: approvedIds
      })

      expect(searchVectorEmbeddings).toHaveBeenCalledWith(
        "knowledge_node", [0.1, 0.2, 0.3], "bge-m3", 3, ["approved-1"]
      )
      expect(result.results).toHaveLength(1)
      expect(result.results[0].entityId).toBe("approved-1")
      expect(result.topScore).toBe(0.6)
    })
  })

  describe("searchQuestionByVector", () => {
    it("returns empty when embedding config is incomplete", async () => {
      const result = await searchQuestionByVector("test", {
        embeddingConfig: { baseUrl: "", apiKeyRef: "", embeddingModel: "bge-m3" }
      })
      expect(result.results).toEqual([])
    })

    it("returns empty when embedding generation fails", async () => {
      vi.mocked(generateEmbedding).mockRejectedValue(new Error("fail"))
      const result = await searchQuestionByVector("test", { embeddingConfig: TEST_EMBEDDING_CONFIG })
      expect(result.results).toEqual([])
    })

    it("searches with question entity type and config model", async () => {
      vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
      vi.mocked(searchVectorEmbeddings).mockResolvedValue([
        { entity_type: "question", entityId: "q-1", score: 0.85, embeddingModel: "bge-m3" }
      ])

      const result = await searchQuestionByVector("test query", { embeddingConfig: TEST_EMBEDDING_CONFIG })
      expect(searchVectorEmbeddings).toHaveBeenCalledWith("question", [0.1, 0.2, 0.3], "bge-m3", 10, undefined)
      expect(result.results).toHaveLength(1)
      expect(result.embeddingModel).toBe("bge-m3")
    })

    it("uses custom limit", async () => {
      vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
      vi.mocked(searchVectorEmbeddings).mockResolvedValue([])

      await searchQuestionByVector("test", { embeddingConfig: TEST_EMBEDDING_CONFIG, limit: 5 })
      expect(searchVectorEmbeddings).toHaveBeenCalledWith("question", [0.1, 0.2, 0.3], "bge-m3", 5, undefined)
    })
  })
})
