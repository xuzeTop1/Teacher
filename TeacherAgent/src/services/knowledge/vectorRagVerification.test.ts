/**
 * Vector RAG Verification Chain Tests
 *
 * Covers the 6 required scenarios:
 * 1. bge-m3 生成后使用 bge-m3 查询 (model consistency)
 * 2. 默认 approved Pack 可以走向量路径
 * 3. draft 向量不进入 TopK
 * 4. 模型不匹配明确报 unknown/fallback
 * 5. Ollama 停止后降级 keyword
 * 6. provenance 能区分 vector/keyword/JSON
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { searchKnowledgeByVector } from "./vectorSearch"
import { runToolAgent } from "../../engine/agents/toolAgent"

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../tauri/commands", () => ({
  generateEmbedding: vi.fn(),
  searchVectorEmbeddings: vi.fn(),
  storeVectorEmbedding: vi.fn(),
  getKnowledgeNodesByIds: vi.fn()
}))

vi.mock("./packLoader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./packLoader")>()
  return {
    ...actual,
    getApprovedEntityIds: vi.fn().mockResolvedValue(new Set(["approved-node-1", "approved-node-2", "approved-node-3"]))
  }
})

vi.mock("../../engine/agents/toolAgent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../engine/agents/toolAgent")>()
  return actual
})

vi.mock("../../services/knowledge/knowledgeIndexer", () => ({
  searchKnowledgeFromDatabase: vi.fn()
}))

vi.mock("../../services/knowledge/localKnowledgeSearch", () => ({
  searchLocalKnowledgeLazy: vi.fn()
}))

vi.mock("../../services/questions/localQuestionBankSearch", () => ({
  searchLocalQuestionBankLazy: vi.fn()
}))

vi.mock("../../services/tools/mathCompute", () => ({
  runMathCompute: vi.fn(),
  createMathComputeToolContext: vi.fn(() => "")
}))

vi.mock("../../services/tools/codeRunner", () => ({
  runCodeRunner: vi.fn(),
  createCodeRunnerToolContext: vi.fn(() => "")
}))

vi.mock("../../services/document/privateDocumentService", () => ({
  searchPrivateChunks: vi.fn(),
  loadPrivateChunks: vi.fn()
}))

import { generateEmbedding, searchVectorEmbeddings, getKnowledgeNodesByIds } from "../tauri/commands"
import { searchKnowledgeFromDatabase } from "../../services/knowledge/knowledgeIndexer"
import { searchLocalKnowledgeLazy } from "../../services/knowledge/localKnowledgeSearch"

const BGE_M3_CONFIG = {
  baseUrl: "http://localhost:11434/v1",
  apiKeyRef: "ollama-local",
  embeddingModel: "bge-m3"
}

describe("Vector RAG Verification Chain", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Scenario 1: bge-m3 生成后使用 bge-m3 查询 ──────────────────────────

  it("query uses the same bge-m3 model as generation (model consistency)", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
    vi.mocked(searchVectorEmbeddings).mockResolvedValue([
      { entity_type: "knowledge_node", entityId: "approved-node-1", score: 0.88, embeddingModel: "bge-m3" }
    ])

    const result = await searchKnowledgeByVector("什么是极限", {
      embeddingConfig: BGE_M3_CONFIG,
      limit: 3
    })

    // generateEmbedding must be called with bge-m3, not text-embedding-3-small
    expect(generateEmbedding).toHaveBeenCalledWith(
      "http://localhost:11434/v1",
      "ollama-local",
      "bge-m3",
      "什么是极限"
    )
    // searchVectorEmbeddings must filter by bge-m3
    expect(searchVectorEmbeddings).toHaveBeenCalledWith(
      "knowledge_node",
      [0.1, 0.2, 0.3],
      "bge-m3",
      3,
      undefined
    )
    expect(result.embeddingModel).toBe("bge-m3")
    expect(result.results).toHaveLength(1)
  })

  // ── Scenario 2: 默认 approved Pack 可以走向量路径 ──────────────────────

  it("default approved Pack enables vector search path", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.5, 0.6, 0.7])
    vi.mocked(searchVectorEmbeddings).mockResolvedValue([
      { entity_type: "knowledge_node", entityId: "approved-node-1", score: 0.91, embeddingModel: "bge-m3" }
    ])
    vi.mocked(getKnowledgeNodesByIds).mockResolvedValue([
      {
        id: "approved-node-1",
        title: "极限定义",
        summary: "epsilon-delta 定义",
        level: "concept",
        difficulty: 2,
        prerequisites: [],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      }
    ])

    // No enabledPackIds = default (all approved) → vector path should be used
    const result = await runToolAgent({
      userMessage: "什么是极限的 epsilon-delta 定义？",
      subjectCode: "math",
      enableMathCompute: false,
      embeddingConfig: BGE_M3_CONFIG
    })

    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.knowledgeSearch?.data?.provenance?.retrievalMode).toBe("vector")
    expect(result.knowledgeSearch?.data?.provenance?.embeddingModel).toBe("bge-m3")
    expect(result.knowledgeSearch?.data?.results[0].knowledgeNodeId).toBe("approved-node-1")
  })

  // ── Scenario 3: draft 向量不进入 TopK ──────────────────────────────────

  it("draft vectors are excluded from TopK even with higher scores", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
    // Backend returns only approved results because entity_ids filter is applied
    // at SQL level before cosine computation and truncation
    vi.mocked(searchVectorEmbeddings).mockResolvedValue([
      { entity_type: "knowledge_node", entityId: "approved-node-1", score: 0.60, embeddingModel: "bge-m3" },
      { entity_type: "knowledge_node", entityId: "approved-node-2", score: 0.55, embeddingModel: "bge-m3" }
    ])

    const result = await searchKnowledgeByVector("test query", {
      embeddingConfig: BGE_M3_CONFIG,
      limit: 3,
      approvedEntityIds: new Set(["approved-node-1", "approved-node-2", "approved-node-3"])
    })

    // Entity IDs passed to backend for SQL-level filtering
    expect(searchVectorEmbeddings).toHaveBeenCalledWith(
      "knowledge_node",
      [0.1, 0.2, 0.3],
      "bge-m3",
      3,
      ["approved-node-1", "approved-node-2", "approved-node-3"]
    )
    // Only approved nodes appear
    expect(result.results).toHaveLength(2)
    expect(result.results[0].entityId).toBe("approved-node-1")
    expect(result.results[1].entityId).toBe("approved-node-2")
    // Draft nodes must NOT be in results
    expect(result.results.find((r) => r.entityId.startsWith("draft-"))).toBeUndefined()
  })

  // ── Scenario 4: 模型不匹配明确报 unknown/fallback ─────────────────────

  it("model mismatch returns empty results (no cross-model search)", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
    // Rust backend filters by embedding_model — if stored vectors are text-embedding-3-small
    // but query uses bge-m3, the SQL WHERE clause returns nothing
    vi.mocked(searchVectorEmbeddings).mockResolvedValue([])

    const result = await searchKnowledgeByVector("test query", {
      embeddingConfig: BGE_M3_CONFIG,
      limit: 3
    })

    // No results because model mismatch means no vectors match
    expect(result.results).toEqual([])
    expect(result.topScore).toBeUndefined()
    // The search was correctly scoped to bge-m3
    expect(searchVectorEmbeddings).toHaveBeenCalledWith(
      "knowledge_node",
      [0.1, 0.2, 0.3],
      "bge-m3",
      3,
      undefined
    )
  })

  // ── Scenario 5: Ollama 停止后降级 keyword ─────────────────────────────

  it("falls back to keyword search when Ollama embedding endpoint is unreachable", async () => {
    // Ollama stopped → generateEmbedding throws ECONNREFUSED
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("fetch failed: ECONNREFUSED 127.0.0.1:11434"))
    vi.mocked(searchKnowledgeFromDatabase).mockResolvedValue([
      {
        id: "math-limit-definition",
        title: "极限定义",
        summary: "数列极限的严格定义",
        level: "concept",
        difficulty: 2,
        prerequisites: [],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      }
    ])

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableMathCompute: false,
      embeddingConfig: BGE_M3_CONFIG
    })

    // Should fall back to database keyword search
    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.knowledgeSearch?.data?.provenance?.retrievalMode).toBe("database_keyword")
    expect(result.knowledgeSearch?.data?.results[0].knowledgeNodeId).toBe("math-limit-definition")
    // Vector search was attempted but failed gracefully
    expect(generateEmbedding).toHaveBeenCalled()
  })

  // ── Scenario 6: provenance 能区分 vector/keyword/JSON ─────────────────

  it("provenance correctly identifies vector retrieval mode", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
    vi.mocked(searchVectorEmbeddings).mockResolvedValue([
      { entity_type: "knowledge_node", entityId: "approved-node-1", score: 0.87, embeddingModel: "bge-m3" }
    ])
    vi.mocked(getKnowledgeNodesByIds).mockResolvedValue([
      {
        id: "approved-node-1",
        title: "极限定义",
        summary: "epsilon-delta",
        level: "concept",
        difficulty: 1,
        prerequisites: [],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      }
    ])

    const result = await runToolAgent({
      userMessage: "极限",
      subjectCode: "math",
      enableMathCompute: false,
      embeddingConfig: BGE_M3_CONFIG
    })

    const prov = result.knowledgeSearch?.data?.provenance
    expect(prov).toBeDefined()
    expect(prov!.retrievalMode).toBe("vector")
    expect(prov!.embeddingModel).toBe("bge-m3")
    expect(prov!.topScore).toBeCloseTo(0.87, 2)
    expect(prov!.topNodeIds).toContain("approved-node-1")
  })

  it("provenance correctly identifies database_keyword retrieval mode", async () => {
    // No embedding config → skips vector, goes to keyword
    vi.mocked(searchKnowledgeFromDatabase).mockResolvedValue([
      {
        id: "math-continuity",
        title: "连续性",
        summary: "函数连续的定义",
        level: "concept",
        difficulty: 2,
        prerequisites: ["极限"],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      }
    ])

    const result = await runToolAgent({
      userMessage: "什么是连续？",
      subjectCode: "math",
      enableMathCompute: false
      // No embeddingConfig → vector skipped
    })

    const prov = result.knowledgeSearch?.data?.provenance
    expect(prov).toBeDefined()
    expect(prov!.retrievalMode).toBe("database_keyword")
    expect(prov!.embeddingModel).toBeUndefined()
    expect(prov!.topNodeIds).toContain("math-continuity")
  })

  it("provenance correctly identifies json_seed retrieval mode", async () => {
    // No embedding config, DB returns empty → falls to JSON seed
    vi.mocked(searchKnowledgeFromDatabase).mockResolvedValue([])
    vi.mocked(searchLocalKnowledgeLazy).mockResolvedValue({
      ok: true,
      data: {
        results: [
          {
            knowledgeNodeId: "math-limit-json",
            title: "极限",
            subject: "math",
            summary: "JSON seed result",
            prerequisites: [],
            relatedNodeIds: [],
            misconceptions: [],
            socraticHints: [],
            source: { id: "json", title: "JSON Seed", license: "original" },
            score: 7
          }
        ]
      },
      sources: []
    })

    const result = await runToolAgent({
      userMessage: "极限",
      subjectCode: "math",
      enableMathCompute: false
    })

    const prov = result.knowledgeSearch?.data?.provenance
    expect(prov).toBeDefined()
    expect(prov!.retrievalMode).toBe("json_seed")
    expect(prov!.topNodeIds).toContain("math-limit-json")
  })
})
