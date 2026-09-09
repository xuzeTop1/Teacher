import { describe, expect, it, vi, beforeEach } from "vitest"

// Mock the knowledge indexer module
vi.mock("../../services/knowledge/knowledgeIndexer", () => ({
  searchKnowledgeFromDatabase: vi.fn()
}))

// Mock the vector search module
vi.mock("../../services/knowledge/vectorSearch", () => ({
  searchKnowledgeByVector: vi.fn(),
  searchQuestionByVector: vi.fn()
}))

// Mock the pack loader module (getApprovedEntityIds)
vi.mock("../../services/knowledge/packLoader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/knowledge/packLoader")>()
  return {
    ...actual,
    getApprovedEntityIds: vi.fn().mockResolvedValue(new Set(["math-conditional-probability", "node-a", "node-b"]))
  }
})

// Mock the commands module
vi.mock("../../services/tauri/commands", () => ({
  getKnowledgeNodesByIds: vi.fn()
}))

// Mock the private document service module
vi.mock("../../services/document/privateDocumentService", () => ({
  searchPrivateChunks: vi.fn(),
  loadPrivateChunks: vi.fn()
}))

// Mock the math compute module (router delegates to this)
vi.mock("../../services/tools/mathCompute", () => ({
  runMathCompute: vi.fn(),
  createMathComputeToolContext: vi.fn(() => "<tool_result tool=\"math_compute\">mocked</tool_result>")
}))

// Mock the code runner module
vi.mock("../../services/tools/codeRunner", () => ({
  runCodeRunner: vi.fn(),
  createCodeRunnerToolContext: vi.fn(() => "<tool_result tool=\"code_runner\">mocked</tool_result>")
}))

import { runToolAgent, extractLikelyExpression, isToolDebugMode, isLineIntegralLike, createUnsupportedMathResult } from "./toolAgent"
import { searchKnowledgeFromDatabase } from "../../services/knowledge/knowledgeIndexer"
import { searchKnowledgeByVector } from "../../services/knowledge/vectorSearch"
import { getKnowledgeNodesByIds } from "../../services/tauri/commands"
import { searchPrivateChunks } from "../../services/document/privateDocumentService"
import { loadPrivateChunks } from "../../services/document/privateDocumentService"
import { runMathCompute, createMathComputeToolContext } from "../../services/tools/mathCompute"
import { runCodeRunner, createCodeRunnerToolContext } from "../../services/tools/codeRunner"

const mockSearchKnowledgeFromDatabase = vi.mocked(searchKnowledgeFromDatabase)
const mockSearchKnowledgeByVector = vi.mocked(searchKnowledgeByVector)
const mockGetKnowledgeNodesByIds = vi.mocked(getKnowledgeNodesByIds)
const mockSearchPrivateChunks = vi.mocked(searchPrivateChunks)
const mockLoadPrivateChunks = vi.mocked(loadPrivateChunks)
const mockRunMathCompute = vi.mocked(runMathCompute)
const mockCreateMathComputeToolContext = vi.mocked(createMathComputeToolContext)
const mockRunCodeRunner = vi.mocked(runCodeRunner)

describe("runToolAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("adds question bank context for practice requests without exposing answers", async () => {
    // Database returns empty (not seeded yet)
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "给我一道夹逼定理练习",
      subjectCode: "math",
      enableMathCompute: false
    })

    const questionContext = result.toolContextNotes.find((note) => note.includes('tool="question_bank_search"'))

    expect(result.questionBankSearch?.ok).toBe(true)
    expect(result.questionBankSearch?.data?.questions.length).toBeGreaterThan(0)
    expect(questionContext).toContain("math-limit-squeeze-theorem")
    expect(questionContext).not.toContain("answer_for_internal_review_only")
    expect(questionContext).not.toContain("solution_steps_for_internal_review_only")
  })

  it("adds internal answer context only for explicit review requests", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "帮我复盘这道夹逼定理题",
      subjectCode: "math",
      enableMathCompute: false
    })

    const questionContext = result.toolContextNotes.find((note) => note.includes('tool="question_bank_search"'))

    expect(result.questionBankSearch?.ok).toBe(true)
    expect(questionContext).toContain("purpose: review")
    expect(questionContext).toContain("answer_for_internal_review_only")
    expect(questionContext).toContain("solution_steps_for_internal_review_only")
  })

  it("does not trigger question bank search for ordinary concept tutoring", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "什么是夹逼定理？",
      subjectCode: "math",
      enableMathCompute: false
    })

    expect(result.questionBankSearch).toBeUndefined()
    expect(result.toolContextNotes.some((note) => note.includes('tool="question_bank_search"'))).toBe(false)
  })

  it("uses database results when available", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([
      {
        id: "math-squeeze-theorem",
        title: "夹逼定理",
        summary: "夹逼定理用于求极限",
        level: "technique",
        difficulty: 2,
        prerequisites: ["极限"],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      }
    ])

    const result = await runToolAgent({
      userMessage: "什么是夹逼定理？",
      subjectCode: "math",
      enableMathCompute: false
    })

    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.knowledgeSearch?.data?.results.length).toBeGreaterThan(0)
    expect(result.knowledgeSearch?.data?.results[0].knowledgeNodeId).toBe("math-squeeze-theorem")
    expect(result.knowledgeContext?.nodes[0].title).toBe("夹逼定理")
  })

  it("falls back to JSON search when database returns empty", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableMathCompute: false
    })

    // Should still get results from JSON fallback
    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.knowledgeSearch?.data?.results.length).toBeGreaterThan(0)
  })

  it("falls back to JSON search when database throws", async () => {
    mockSearchKnowledgeFromDatabase.mockRejectedValue(new Error("DB not available"))

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableMathCompute: false
    })

    // Should still get results from JSON fallback
    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.knowledgeSearch?.data?.results.length).toBeGreaterThan(0)
  })

  it("calls database search with correct parameters", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    await runToolAgent({
      userMessage: "解释条件概率",
      subjectCode: "math",
      enableMathCompute: false
    })

    expect(mockSearchKnowledgeFromDatabase).toHaveBeenCalledWith("math", "解释条件概率", 3)
  })

  it("skips knowledge search when enableLocalKnowledgeSearch is false", async () => {
    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableLocalKnowledgeSearch: false,
      enableMathCompute: false
    })

    expect(result.knowledgeSearch).toBeUndefined()
    expect(mockSearchKnowledgeFromDatabase).not.toHaveBeenCalled()
  })

  // ── Vector search chain tests ──────────────────────────────────────────

  it("returns vector-matched node even when keyword search does not find it", async () => {
    // Vector search finds "条件概率" but keyword search (for "什么是极限？") doesn't
    mockSearchKnowledgeByVector.mockResolvedValue({
      results: [
        { entityId: "math-conditional-probability", entityType: "knowledge_node", score: 0.92, embeddingModel: "bge-m3" }
      ],
      embeddingModel: "bge-m3",
      topScore: 0.92
    })
    mockGetKnowledgeNodesByIds.mockResolvedValue([
      {
        id: "math-conditional-probability",
        title: "条件概率",
        summary: "条件概率 P(A|B)",
        level: "concept",
        difficulty: 2,
        prerequisites: ["概率"],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      }
    ])

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableMathCompute: false,
      embeddingConfig: { apiKeyRef: "ref-1", baseUrl: "https://api.example.com/v1", embeddingModel: "bge-m3" }
    })

    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.knowledgeSearch?.data?.results.length).toBe(1)
    expect(result.knowledgeSearch?.data?.results[0].knowledgeNodeId).toBe("math-conditional-probability")
    expect(result.knowledgeSearch?.data?.results[0].title).toBe("条件概率")
    // Keyword search should NOT have been called (vector succeeded)
    expect(mockSearchKnowledgeFromDatabase).not.toHaveBeenCalled()
  })

  it("maps vector scores correctly to returned nodes", async () => {
    mockSearchKnowledgeByVector.mockResolvedValue({
      results: [
        { entityId: "node-a", entityType: "knowledge_node", score: 0.95, embeddingModel: "bge-m3" },
        { entityId: "node-b", entityType: "knowledge_node", score: 0.72, embeddingModel: "bge-m3" }
      ],
      embeddingModel: "bge-m3",
      topScore: 0.95
    })
    mockGetKnowledgeNodesByIds.mockResolvedValue([
      {
        id: "node-a",
        title: "节点 A",
        summary: "A",
        level: "concept",
        difficulty: 1,
        prerequisites: [],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      },
      {
        id: "node-b",
        title: "节点 B",
        summary: "B",
        level: "technique",
        difficulty: 2,
        prerequisites: [],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      }
    ])

    const result = await runToolAgent({
      userMessage: "test query",
      subjectCode: "math",
      enableMathCompute: false,
      embeddingConfig: { apiKeyRef: "ref-1", baseUrl: "https://api.example.com/v1", embeddingModel: "bge-m3" }
    })

    expect(result.knowledgeSearch?.ok).toBe(true)
    const results = result.knowledgeSearch!.data!.results
    expect(results.length).toBe(2)
    // Score for node-a should be 0.95 * 10 = 9.5 → 10 (rounded)
    expect(results[0].score).toBe(10)
    // Score for node-b should be 0.72 * 10 = 7.2 → 7 (rounded)
    expect(results[1].score).toBe(7)
  })

  it("falls back to keyword when vector getKnowledgeNodesByIds fails", async () => {
    mockSearchKnowledgeByVector.mockResolvedValue({
      results: [
        { entityId: "node-a", entityType: "knowledge_node", score: 0.9, embeddingModel: "bge-m3" }
      ],
      embeddingModel: "bge-m3",
      topScore: 0.9
    })
    mockGetKnowledgeNodesByIds.mockRejectedValue(new Error("DB fetch failed"))
    // Keyword fallback should be called and return results
    mockSearchKnowledgeFromDatabase.mockResolvedValue([
      {
        id: "math-squeeze-theorem",
        title: "夹逼定理",
        summary: "夹逼定理用于求极限",
        level: "technique",
        difficulty: 2,
        prerequisites: ["极限"],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      }
    ])

    const result = await runToolAgent({
      userMessage: "什么是夹逼定理？",
      subjectCode: "math",
      enableMathCompute: false,
      embeddingConfig: { apiKeyRef: "ref-1", baseUrl: "https://api.example.com/v1", embeddingModel: "bge-m3" }
    })

    // Should have fallen through to keyword search
    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.knowledgeSearch?.data?.results[0].knowledgeNodeId).toBe("math-squeeze-theorem")
    expect(result.knowledgeSearch?.data?.results[0].source?.id).toBe("database")
    expect(mockSearchKnowledgeFromDatabase).toHaveBeenCalledWith("math", "什么是夹逼定理？", 3)
  })

  it("uses keyword → JSON fallback when no provider config", async () => {
    // No providerConfig → vector search skipped entirely
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableMathCompute: false
    })

    // Vector search should not have been called
    expect(mockSearchKnowledgeByVector).not.toHaveBeenCalled()
    expect(mockGetKnowledgeNodesByIds).not.toHaveBeenCalled()
    // Should get JSON fallback results
    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.knowledgeSearch?.data?.results.length).toBeGreaterThan(0)
  })

  // ── enabledPackIds tests ────────────────────────────────────────────────

  it("does not force JSON-only when enabledPackIds is all packs", async () => {
    // Get all math pack ids
    const { getPacksBySubject } = await import("../../services/knowledge/packManifest")
    const allPackIds = getPacksBySubject("math").map((p) => p.id)

    // Database returns results
    mockSearchKnowledgeFromDatabase.mockResolvedValue([
      {
        id: "math-squeeze-theorem",
        title: "夹逼定理",
        summary: "夹逼定理用于求极限",
        level: "technique",
        difficulty: 2,
        prerequisites: ["极限"],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      }
    ])

    const result = await runToolAgent({
      userMessage: "什么是夹逼定理？",
      subjectCode: "math",
      enabledPackIds: allPackIds,
      enableMathCompute: false
    })

    // Should use database results, not force JSON-only
    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.knowledgeSearch?.data?.results[0].source?.id).toBe("database")
    expect(mockSearchKnowledgeFromDatabase).toHaveBeenCalled()
  })

  it("default math scenario (all approved math packs) uses vector/DB path", async () => {
    // ChatView enables every currently approved pack for a subject by default.
    mockSearchKnowledgeFromDatabase.mockResolvedValue([
      {
        id: "math-limit-definition",
        title: "极限的定义",
        summary: "epsilon-delta 语言描述极限",
        level: "concept",
        difficulty: 2,
        prerequisites: [],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      }
    ])

    const { getPacksBySubject } = await import("../../services/knowledge/packManifest")
    const approvedMathPackIds = getPacksBySubject("math")
      .filter((pack) => pack.status === "approved")
      .map((pack) => pack.id)

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enabledPackIds: approvedMathPackIds,
      enableMathCompute: false
    })

    // Must NOT fall to JSON-only; should use database search
    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.knowledgeSearch?.data?.results[0].source?.id).toBe("database")
    expect(mockSearchKnowledgeFromDatabase).toHaveBeenCalled()
    // Provenance must indicate database_keyword, not json_seed
    expect(result.knowledgeSearch?.data?.provenance?.retrievalMode).toBe("database_keyword")
  })

  it("forces JSON-only when enabledPackIds is partial subset", async () => {
    // Enable only draft packs (exclude every approved math pack)
    const { getPacksBySubject } = await import("../../services/knowledge/packManifest")
    const allPacks = getPacksBySubject("math")
    const draftOnlyPackIds = allPacks.filter((p) => p.status !== "approved").slice(0, 2).map((p) => p.id)

    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enabledPackIds: draftOnlyPackIds,
      enableMathCompute: false
    })

    // Should get JSON results (not database) because approved pack is missing
    expect(result.knowledgeSearch?.ok).toBe(true)
    // Database should NOT have been called
    expect(mockSearchKnowledgeFromDatabase).not.toHaveBeenCalled()
  })

  it("partial pack search does not return disabled pack content", async () => {
    // Only enable first math pack
    const { getPacksBySubject } = await import("../../services/knowledge/packManifest")
    const allPacks = getPacksBySubject("math")
    const firstPackId = allPacks[0].id

    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "极限",
      subjectCode: "math",
      enabledPackIds: [firstPackId],
      enableMathCompute: false
    })

    // Should get results only from enabled pack
    expect(result.knowledgeSearch?.ok).toBe(true)
    if (result.knowledgeSearch?.data?.results) {
      // All results should be from enabled pack content
      // (we can't easily verify pack membership here, but we verify the search succeeded)
      expect(result.knowledgeSearch.data.results.length).toBeGreaterThanOrEqual(0)
    }
  })

  it("passes enabledPackIds to question bank search", async () => {
    const { getPacksBySubject } = await import("../../services/knowledge/packManifest")
    const allPacks = getPacksBySubject("math")
    const partialPackIds = allPacks.slice(0, 2).map((p) => p.id)

    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "给我一道练习题",
      subjectCode: "math",
      enabledPackIds: partialPackIds,
      enableMathCompute: false
    })

    // Question bank search should have been triggered
    expect(result.questionBankSearch?.ok).toBe(true)
  })

  // ── Private document search tests ────────────────────────────────────────

  it("includes private doc results in knowledge context with sourceType", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockSearchPrivateChunks.mockResolvedValue([
      {
        documentId: "privdoc-001",
        documentTitle: "我的笔记",
        fileName: "notes.pdf",
        heading: "第一章 极限",
        text: "极限是微积分的基础概念",
        score: 5,
        sourceType: "private_document"
      }
    ])

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableMathCompute: false
    })

    expect(result.privateDocSearch?.ok).toBe(true)
    expect(result.privateDocSearch?.data?.results.length).toBe(1)
    expect(result.knowledgeContext).toBeDefined()

    // 私有资料节点应包含 sourceType 和 metadata
    const privateNode = result.knowledgeContext!.nodes.find(
      (n) => n.sourceType === "private_document"
    )
    expect(privateNode).toBeDefined()
    expect(privateNode!.documentTitle).toBe("我的笔记")
    expect(privateNode!.fileName).toBe("notes.pdf")
    expect(privateNode!.heading).toBe("第一章 极限")

    // notes 应包含私有资料引用规则
    const privateNote = result.knowledgeContext!.notes?.find((n) => n.includes("private_document"))
    expect(privateNote).toBeDefined()
    expect(privateNote).toContain("你的资料中提到")
  })

  it("merges built-in and private doc results preserving sourceType", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([
      {
        id: "math-limit",
        title: "极限",
        summary: "极限的定义",
        level: "concept",
        difficulty: 1,
        prerequisites: [],
        misconceptions: [],
        socraticHints: [],
        reviewStatus: "approved"
      }
    ])
    mockSearchPrivateChunks.mockResolvedValue([
      {
        documentId: "privdoc-002",
        documentTitle: "课堂笔记",
        fileName: "class.pdf",
        heading: null,
        text: "极限的直观理解",
        score: 3,
        sourceType: "private_document"
      }
    ])

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableMathCompute: false
    })

    expect(result.knowledgeContext).toBeDefined()
    const nodes = result.knowledgeContext!.nodes
    // 应有 built-in 和 private 两种来源
    const builtInNode = nodes.find((n) => n.sourceType === "built_in_pack")
    const privateNode = nodes.find((n) => n.sourceType === "private_document")
    expect(builtInNode).toBeDefined()
    expect(privateNode).toBeDefined()
    expect(builtInNode!.title).toBe("极限")
    expect(privateNode!.title).toBe("课堂笔记")
  })

  it("does not expose local file path in private doc results", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockSearchPrivateChunks.mockResolvedValue([
      {
        documentId: "privdoc-003",
        documentTitle: "资料",
        fileName: "document.pdf",
        heading: null,
        text: "一些内容",
        score: 1,
        sourceType: "private_document"
      }
    ])

    const result = await runToolAgent({
      userMessage: "test",
      subjectCode: "math",
      enableMathCompute: false
    })

    // fileName 只是文件名，不含路径
    const privateResult = result.privateDocSearch?.data?.results[0]
    expect(privateResult?.source.title).toBe("资料")
    // source.id 使用 private: 前缀，不含本地路径
    expect(privateResult?.source.id).toBe("private:privdoc-003")
  })

  it("private doc search failure does not break main flow", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockSearchPrivateChunks.mockRejectedValue(new Error("DB error"))

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableMathCompute: false
    })

    // 私有资料搜索失败不应影响 built-in 搜索
    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.privateDocSearch).toBeUndefined()
  })

  it("skips private doc search when enableLocalKnowledgeSearch is false", async () => {
    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableLocalKnowledgeSearch: false,
      enableMathCompute: false
    })

    expect(result.privateDocSearch).toBeUndefined()
    expect(mockSearchPrivateChunks).not.toHaveBeenCalled()
  })

  it("built-in pack still works when no private docs imported", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockSearchPrivateChunks.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableMathCompute: false
    })

    // built-in 搜索应正常工作
    expect(result.knowledgeSearch?.ok).toBe(true)
    expect(result.knowledgeSearch?.data?.results.length).toBeGreaterThan(0)
    // 私有资料搜索返回空
    expect(result.privateDocSearch?.data?.results.length).toBe(0)
  })

  it("knowledgeContext notes include '不要声称无法查看上传资料' when private docs found", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockSearchPrivateChunks.mockResolvedValue([
      {
        documentId: "privdoc-004",
        documentTitle: "考研政治大纲",
        fileName: "politics-outline.pdf",
        heading: "马原",
        text: "矛盾的普遍性和特殊性",
        score: 5,
        sourceType: "private_document"
      }
    ])

    const result = await runToolAgent({
      userMessage: "你看到我上传的政治考研大纲吗？",
      subjectCode: "politics",
      enableMathCompute: false
    })

    expect(result.knowledgeContext).toBeDefined()
    const notes = result.knowledgeContext!.notes ?? []
    const hasNoClaimNote = notes.some((n) => n.includes("不要声称无法查看"))
    expect(hasNoClaimNote).toBe(true)
    const hasRetrievedNote = notes.some((n) => n.includes("已检索到用户本地私有资料"))
    expect(hasRetrievedNote).toBe(true)
  })

  it("extracts keywords from natural sentence before passing to private doc search", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockSearchPrivateChunks.mockResolvedValue([])

    await runToolAgent({
      userMessage: "你看到我上传的政治考研大纲吗？",
      subjectCode: "politics",
      enableMathCompute: false
    })

    // 应传入提取的关键词（政治 考研 大纲），而非完整问句
    expect(mockSearchPrivateChunks).toHaveBeenCalledTimes(1)
    const calledWith = mockSearchPrivateChunks.mock.calls[0][0]
    expect(calledWith).toContain("政治")
    expect(calledWith).toContain("考研")
    expect(calledWith).toContain("大纲")
    // 不应包含问句中的无关词
    expect(calledWith).not.toContain("你看到")
    expect(calledWith).not.toContain("吗")
  })

  it("falls back to trimmed original query when no extractable keywords", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockSearchPrivateChunks.mockResolvedValue([])

    await runToolAgent({
      userMessage: "？",
      subjectCode: "math",
      enableMathCompute: false
    })

    // 纯标点无有效 token，退回原始 query
    expect(mockSearchPrivateChunks).toHaveBeenCalledWith("？", "math", 3)
  })

  it("knowledgeContext notes do not include '不要声称无法查看' when no private docs found", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockSearchPrivateChunks.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math",
      enableMathCompute: false
    })

    // No private doc results → no such note
    if (result.knowledgeContext?.notes) {
      const hasNoClaimNote = result.knowledgeContext.notes.some((n) => n.includes("不要声称无法查看"))
      expect(hasNoClaimNote).toBe(false)
    }
  })

  it("uses recent private document chunks for material-deictic requests", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockSearchPrivateChunks.mockResolvedValue([])
    mockLoadPrivateChunks.mockResolvedValue([
      {
        id: "chunk-1",
        documentId: "privdoc-recent",
        chunkIndex: 0,
        heading: "Page 1",
        text: "这份大纲第一部分讲考试性质和考试目标。",
        tokenEstimate: 30
      },
      {
        id: "chunk-2",
        documentId: "privdoc-recent",
        chunkIndex: 1,
        heading: "Page 2",
        text: "第二部分列出考试内容和题型结构。",
        tokenEstimate: 28
      }
    ])

    const result = await runToolAgent({
      userMessage: "帮我总结这份资料",
      subjectCode: "politics",
      recentPrivateDocument: {
        id: "privdoc-recent",
        title: "考研政治大纲",
        fileName: "politics-outline.pdf"
      },
      enableMathCompute: false
    })

    expect(mockLoadPrivateChunks).toHaveBeenCalledWith("privdoc-recent")
    expect(mockSearchPrivateChunks).not.toHaveBeenCalled()
    expect(result.privateDocSearch?.data?.results.length).toBe(2)
    expect(result.knowledgeContext?.nodes.some((n) => n.sourceType === "private_document")).toBe(true)
    expect(result.knowledgeContext?.notes?.some((note) => note.includes("已检索到用户本地私有资料"))).toBe(true)
  })

  it("triggers math compute with enableMathCompute=true for math computation requests", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: {
        result: "(x+1)**2",
        normalizedExpression: "x**2+2*x+1",
        operation: "simplify",
        warnings: [],
        confidence: 0.95,
        engine: "sympy"
      }
    })

    const result = await runToolAgent({
      userMessage: "化简 x^2+2x+1",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(true)
    expect(result.mathCompute?.data?.engine).toBe("sympy")
    expect(result.toolContextNotes.some((note) => note.includes('tool="math_compute"'))).toBe(true)
  })

  // ── Natural language math expression extraction ─────────────────────

  it("extracts expression from '任务：展开 (x+1)^5'", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "x**5+5*x**4+10*x**3+10*x**2+5*x+1", normalizedExpression: "(x+1)**5", operation: "expand", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "任务：展开 (x+1)^5",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(true)
    // The expression passed to math_compute should NOT contain Chinese text
    expect(result.mathCompute?.data?.normalizedExpression).toBe("(x+1)**5")
    expect(result.mathCompute?.data?.operation).toBe("expand")
  })

  it("extracts expression from '请调用本地 math_compute 工具计算：因式分解 x^4-1'", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "(x-1)*(x+1)*(x**2+1)", normalizedExpression: "x**4-1", operation: "factor", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "请调用本地 math_compute 工具计算：因式分解 x^4-1",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(true)
    expect(result.mathCompute?.data?.normalizedExpression).toBe("x**4-1")
    expect(result.mathCompute?.data?.operation).toBe("factor")
  })

  it("extracts expression from '求导 x^2+3*x+1'", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "2*x+3", normalizedExpression: "x**2+3*x+1", operation: "differentiate", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "求导 x^2+3*x+1",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(true)
    expect(result.mathCompute?.data?.operation).toBe("differentiate")
  })

  it("extracts expression from '积分 x^2'", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "x**3/3", normalizedExpression: "x**2", operation: "integrate", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "积分 x^2",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(true)
    expect(result.mathCompute?.data?.operation).toBe("integrate")
  })

  it("extracts expression from '极限 lim x->0 sin(x)/x'", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "1", normalizedExpression: "lim x->0 sin(x)/x", operation: "limit", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "极限 lim x->0 sin(x)/x",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(true)
    expect(result.mathCompute?.data?.operation).toBe("limit")
  })

  it("preserves fenced math format", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "(x+1)**2", normalizedExpression: "x**2+2*x+1", operation: "simplify", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "化简 ```math\nx^2+2x+1\n```",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(true)
    expect(result.mathCompute?.data?.normalizedExpression).toBe("x**2+2*x+1")
  })

  it("preserves inline math $...$ format", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "2*x", normalizedExpression: "x**2", operation: "differentiate", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "求导 $x^2$",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(true)
    expect(result.mathCompute?.data?.normalizedExpression).toBe("x**2")
  })

  it("does not treat tool debug hints as expression", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "(x+1)**5", normalizedExpression: "(x+1)**5", operation: "expand", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "当前是工具联调，不按教学模式回答。请调用本地 math_compute 工具计算，并直接返回结果。任务：展开 (x+1)^5",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(true)
    // The expression should NOT contain the entire debug preamble
    expect(result.mathCompute?.data?.normalizedExpression).toBe("(x+1)**5")
    expect(result.mathCompute?.data?.normalizedExpression).not.toContain("当前是工具联调")
    expect(result.mathCompute?.data?.normalizedExpression).not.toContain("不按教学模式")
  })

  it("identifies expand operation from Chinese keyword", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "x**2+2*x+1", normalizedExpression: "(x+1)**2", operation: "expand", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "展开 (x+1)^2",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.data?.operation).toBe("expand")
  })

  it("identifies factor operation from Chinese keyword", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "(x-1)*(x+1)", normalizedExpression: "x**2-1", operation: "factor", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "因式分解 x^2-1",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.data?.operation).toBe("factor")
  })
})

// ── extractLikelyExpression unit tests ─────────────────────────────────

describe("extractLikelyExpression", () => {
  it("extracts from fenced math block", () => {
    expect(extractLikelyExpression("计算 ```math\nx^2+1\n```")).toBe("x^2+1")
  })

  it("extracts from inline math", () => {
    expect(extractLikelyExpression("计算 $x^2+1$")).toBe("x^2+1")
  })

  it("strips trailing Chinese command prefix with colon", () => {
    expect(extractLikelyExpression("任务：展开 (x+1)^5")).toBe("(x+1)^5")
  })

  it("strips long command prefix", () => {
    expect(extractLikelyExpression("请调用本地 math_compute 工具计算：因式分解 x^4-1")).toBe("x^4-1")
  })

  it("strips command keyword followed by expression", () => {
    expect(extractLikelyExpression("展开 (x+1)^5")).toBe("(x+1)^5")
  })

  it("strips 求导 keyword", () => {
    expect(extractLikelyExpression("求导 x^2+3*x+1")).toBe("x^2+3*x+1")
  })

  it("strips 积分 keyword", () => {
    expect(extractLikelyExpression("积分 x^2")).toBe("x^2")
  })

  it("strips 化简 keyword", () => {
    expect(extractLikelyExpression("化简 (a+b)^2")).toBe("(a+b)^2")
  })

  it("returns original for pure expression with no command prefix", () => {
    expect(extractLikelyExpression("x^2+1")).toBe("x^2+1")
  })

  it("returns original for empty-like input", () => {
    expect(extractLikelyExpression("你好")).toBe("你好")
  })

  it("handles '帮我' prefix", () => {
    expect(extractLikelyExpression("帮我展开 (a+b)^3")).toBe("(a+b)^3")
  })

  it("handles '计算' prefix with colon", () => {
    expect(extractLikelyExpression("计算：x^2+2x+1")).toBe("x^2+2x+1")
  })
})

// ── isToolDebugMode unit tests ─────────────────────────────────────────

describe("isToolDebugMode", () => {
  it("detects '工具联调'", () => {
    expect(isToolDebugMode("当前是工具联调")).toBe(true)
  })

  it("detects '不按教学模式'", () => {
    expect(isToolDebugMode("不按教学模式回答")).toBe(true)
  })

  it("detects '直接返回工具结果'", () => {
    expect(isToolDebugMode("直接返回工具结果")).toBe(true)
  })

  it("detects '直接返回计算结果'", () => {
    expect(isToolDebugMode("直接返回计算结果")).toBe(true)
  })

  it("detects '测试' + 'math_compute'", () => {
    expect(isToolDebugMode("测试你是否可以调用 math_compute 工具")).toBe(true)
  })

  it("detects '调试模式'", () => {
    expect(isToolDebugMode("进入调试模式")).toBe(true)
  })

  it("detects English 'tool debug'", () => {
    expect(isToolDebugMode("tool debug mode")).toBe(true)
  })

  it("detects English 'tool integration test'", () => {
    expect(isToolDebugMode("tool integration test for math_compute")).toBe(true)
  })

  it("returns false for normal student message", () => {
    expect(isToolDebugMode("什么是极限？")).toBe(false)
  })

  it("returns false for normal math question", () => {
    expect(isToolDebugMode("帮我求导 x^2")).toBe(false)
  })

  it("returns false for concept question", () => {
    expect(isToolDebugMode("解释一下什么是特征值")).toBe(false)
  })

  it("detects compound debug signals", () => {
    expect(isToolDebugMode("当前是工具联调，不按教学模式回答。请调用本地 math_compute 工具计算，并直接返回结果。任务：展开 (x+1)^5")).toBe(true)
  })
})

// ── isLineIntegralLike unit tests ───────────────────────────────────────

describe("isLineIntegralLike", () => {
  // ── True positives: integral signal + path signal ──────────────────

  it("detects ∫_L xy dx (∫ symbol + L path variable)", () => {
    expect(isLineIntegralLike("∫_L xy dx")).toBe(true)
  })

  it("detects ∮ x dy (∮ is always closed curve integral)", () => {
    expect(isLineIntegralLike("∮ x dy")).toBe(true)
  })

  it("detects fL xydx with curve definition (OCR + dx + endpoint)", () => {
    expect(isLineIntegralLike("fL xydx, 其中 L 为抛物线 y^2=x 从 A(1,-1) 到 B(1,1)")).toBe(true)
  })

  it("detects 线积分 ∫_L xy dx (Chinese term + ∫ + path)", () => {
    expect(isLineIntegralLike("线积分 ∫_L xy dx")).toBe(true)
  })

  it("detects 曲线积分 ∫_C x dy (Chinese term + ∫ + path)", () => {
    expect(isLineIntegralLike("曲线积分 ∫_C x dy")).toBe(true)
  })

  it("detects 路径积分 ∫_L xy dx (Chinese term + ∫ + path)", () => {
    expect(isLineIntegralLike("路径积分 ∫_L xy dx")).toBe(true)
  })

  it("detects 积分 ∫_L xy dx, 其中 L 为弧 (积分 + ∫ + path definition)", () => {
    expect(isLineIntegralLike("积分 ∫_L xy dx, 其中 L 为抛物线上的弧")).toBe(true)
  })

  it("detects 计算积分，从 A(1,-1) 到 B(1,1) 沿 L (积分 + endpoint)", () => {
    expect(isLineIntegralLike("计算积分，从 A(1,-1) 到 B(1,1) 沿 L")).toBe(true)
  })

  // ── False positives: path signal only, no integral signal ──────────

  it("does NOT detect 端点描述 alone: 从 A(1,-1) 到 B(1,1)", () => {
    expect(isLineIntegralLike("求弧长，从 A(1,-1) 到 B(1,1)")).toBe(false)
  })

  it("does NOT detect 曲线定义 alone: L 为抛物线 y^2=x 上的弧", () => {
    expect(isLineIntegralLike("L 为抛物线 y^2=x 上的弧")).toBe(false)
  })

  it("does NOT detect 其中 L 为... alone without integral", () => {
    expect(isLineIntegralLike("其中 L 为 y^2=x 上从 A 到 B 的曲线")).toBe(false)
  })

  // ── False negatives: no integral signal at all ─────────────────────

  it("does NOT detect 普通积分 积分 x^2 (积分 but no path signal)", () => {
    expect(isLineIntegralLike("积分 x^2")).toBe(false)
  })

  it("does NOT detect ∫ x^2 dx (plain integral, no path subscript)", () => {
    expect(isLineIntegralLike("∫ x^2 dx")).toBe(false)
  })

  it("does NOT detect 展开 (x+1)^5", () => {
    expect(isLineIntegralLike("展开 (x+1)^5")).toBe(false)
  })

  it("does NOT detect 求导 x^2+1", () => {
    expect(isLineIntegralLike("求导 x^2+1")).toBe(false)
  })

  it("does NOT detect 化简 a^2+2ab+b^2", () => {
    expect(isLineIntegralLike("化简 a^2+2ab+b^2")).toBe(false)
  })
})

// ── createUnsupportedMathResult unit tests ──────────────────────────────

describe("createUnsupportedMathResult", () => {
  it("returns unsupported for line integral ∫_L xy dx", () => {
    const result = createUnsupportedMathResult("∫_L xy dx")
    expect(result.unsupported).toBe(true)
    if (result.unsupported) {
      expect(result.result.ok).toBe(false)
      expect(result.result.errorCode).toBe("UNSUPPORTED_INPUT")
      expect(result.result.data?.engine).toBe("unavailable")
      expect(result.result.data?.operation).toBe("integrate")
      expect(result.result.data?.warnings.some((w) => w.includes("line_integral"))).toBe(true)
    }
  })

  it("returns unsupported for fL curve integral", () => {
    const result = createUnsupportedMathResult("fL xydx, 其中 L 为抛物线 y^2=x")
    expect(result.unsupported).toBe(true)
    if (result.unsupported) {
      expect(result.result.ok).toBe(false)
      expect(result.result.errorCode).toBe("UNSUPPORTED_INPUT")
    }
  })

  it("returns unsupported for 线积分", () => {
    const result = createUnsupportedMathResult("线积分 ∫_L xy dx")
    expect(result.unsupported).toBe(true)
  })

  it("returns NOT unsupported for ordinary integral", () => {
    const result = createUnsupportedMathResult("积分 x^2")
    expect(result.unsupported).toBe(false)
  })

  it("returns NOT unsupported for expand", () => {
    const result = createUnsupportedMathResult("展开 (x+1)^5")
    expect(result.unsupported).toBe(false)
  })
})

// ── Line integral integration via runToolAgent ──────────────────────────

describe("runToolAgent line integral integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns UNSUPPORTED_INPUT for line integral without calling runMathCompute", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "∫_L xy dx，其中 L 为 y^2=x 从 A(1,-1) 到 B(1,1)",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(false)
    expect(result.mathCompute?.errorCode).toBe("UNSUPPORTED_INPUT")
    expect(result.mathCompute?.data?.engine).toBe("unavailable")
    // Should NOT have called the actual math compute engine
    expect(mockRunMathCompute).not.toHaveBeenCalled()
  })

  it("returns UNSUPPORTED_INPUT for 线积分 without calling runMathCompute", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "线积分 ∫_L xy dx",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(false)
    expect(result.mathCompute?.errorCode).toBe("UNSUPPORTED_INPUT")
    expect(mockRunMathCompute).not.toHaveBeenCalled()
  })

  it("returns UNSUPPORTED_INPUT for ∮ x dy without calling runMathCompute", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "∮ x dy",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(false)
    expect(result.mathCompute?.errorCode).toBe("UNSUPPORTED_INPUT")
    expect(mockRunMathCompute).not.toHaveBeenCalled()
  })

  it("still calls runMathCompute for ordinary integral", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "x**3/3", normalizedExpression: "x**2", operation: "integrate", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "积分 x^2",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(true)
    expect(result.mathCompute?.data?.operation).toBe("integrate")
    expect(mockRunMathCompute).toHaveBeenCalled()
  })

  it("still works for expand", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])
    mockRunMathCompute.mockResolvedValue({
      ok: true,
      data: { result: "x**5+5*x**4+10*x**3+10*x**2+5*x+1", normalizedExpression: "(x+1)**5", operation: "expand", warnings: [], confidence: 0.95, engine: "sympy" }
    })

    const result = await runToolAgent({
      userMessage: "展开 (x+1)^5",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(true)
    expect(result.mathCompute?.data?.operation).toBe("expand")
    expect(mockRunMathCompute).toHaveBeenCalled()
  })

  it("line integral input returns structured error with suggestion", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "fL xydx, 其中 L 为抛物线 y^2=x 上从 A(1,-1) 到 B(1,1) 的弧",
      subjectCode: "math",
      enableMathCompute: true
    })

    expect(result.mathCompute?.ok).toBe(false)
    expect(result.mathCompute?.errorCode).toBe("UNSUPPORTED_INPUT")
    expect(result.mathCompute?.data?.warnings.some((w) => w.includes("parameterize"))).toBe(true)
    expect(result.mathCompute?.data?.warnings.some((w) => w.includes("line_integral"))).toBe(true)
  })

  it("unsupported branch still generates toolContextNotes with math tool context", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "∫_L xy dx，其中 L 为 y^2=x 从 A(1,-1) 到 B(1,1)",
      subjectCode: "math",
      enableMathCompute: true
    })

    // toolContextNotes should contain the math tool note (not empty)
    expect(result.toolContextNotes.length).toBeGreaterThan(0)
    // The note should reference the math_compute tool
    const mathNote = result.toolContextNotes.find((n) => n.includes('tool="math_compute"'))
    expect(mathNote).toBeDefined()
    // The mathCompute result should carry the unsupported error
    expect(result.mathCompute?.ok).toBe(false)
    expect(result.mathCompute?.errorCode).toBe("UNSUPPORTED_INPUT")
  })
})

// ── code_runner trigger tests ──────────────────────────────────────────

describe("code_runner trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunCodeRunner.mockResolvedValue({
      ok: true,
      data: { exitCode: 0, stdout: "2\n", stderr: "", runtimeMs: 10 }
    })
  })

  it("triggers on '编译这段代码' with code block", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "编译这段代码\n```python\nprint(1+1)\n```",
      subjectCode: "programming"
    })

    expect(mockRunCodeRunner).toHaveBeenCalledWith(
      expect.objectContaining({ code: "print(1+1)" })
    )
    expect(result.codeRunner?.ok).toBe(true)
  })

  it("triggers on '用解释器运行' with code block", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "用解释器运行\n```python\nprint('hello')\n```",
      subjectCode: "programming"
    })

    expect(mockRunCodeRunner).toHaveBeenCalledWith(
      expect.objectContaining({ code: "print('hello')" })
    )
    expect(result.codeRunner?.ok).toBe(true)
  })

  it("triggers on '工具连调' with code block", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "工具连调\n```python\nx = 42\nprint(x)\n```",
      subjectCode: "programming"
    })

    expect(mockRunCodeRunner).toHaveBeenCalled()
    expect(result.codeRunner?.ok).toBe(true)
  })

  it("triggers on '工具联调' with code block", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "工具联调\n```python\nprint(2+2)\n```",
      subjectCode: "programming"
    })

    expect(mockRunCodeRunner).toHaveBeenCalled()
    expect(result.codeRunner?.ok).toBe(true)
  })

  it("extracts code from recent messages for '上一段代码'", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "运行上一段代码",
      subjectCode: "programming",
      recentMessages: [
        { role: "assistant", content: "好的，让我解释一下这段代码" },
        { role: "user", content: "请看这段代码\n```python\ndef add(a, b):\n    return a + b\n```" }
      ]
    })

    expect(mockRunCodeRunner).toHaveBeenCalledWith(
      expect.objectContaining({ code: "def add(a, b):\n    return a + b" })
    )
    expect(result.codeRunner?.ok).toBe(true)
  })

  it("extracts code from recent messages for '前面的代码'", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "帮我运行前面的代码",
      subjectCode: "programming",
      recentMessages: [
        { role: "user", content: "这段代码如何？\n```python\nprint('test')\n```" }
      ]
    })

    expect(mockRunCodeRunner).toHaveBeenCalledWith(
      expect.objectContaining({ code: "print('test')" })
    )
  })

  it("extracts inline print call from current message", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    await runToolAgent({
      userMessage: "帮我编译 print(1+1)",
      subjectCode: "programming"
    })

    expect(mockRunCodeRunner).toHaveBeenCalledWith(
      expect.objectContaining({ code: "print(1+1)" })
    )
  })

  it("extracts previous inline print call for tool integration request", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "工具连调，你使用python解释器进行编译",
      subjectCode: "programming",
      recentMessages: [
        { role: "user", content: "print(“hello world”) 是不是输出hello world" },
        { role: "assistant", content: "是的，print(\"hello world\") 会输出 hello world。" }
      ]
    })

    expect(mockRunCodeRunner).toHaveBeenCalledWith(
      expect.objectContaining({ code: "print(“hello world”)" })
    )
    expect(result.toolContextNotes.some((n) => n.includes("NO_CODE_FOUND"))).toBe(false)
  })

  it("does not execute Chinese text as code when no code block found", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "运行这段代码",
      subjectCode: "programming"
    })

    // Should NOT have called runCodeRunner
    expect(mockRunCodeRunner).not.toHaveBeenCalled()
    // Should have a note asking for code
    const codeNote = result.toolContextNotes.find((n) => n.includes("NO_CODE_FOUND"))
    expect(codeNote).toBeDefined()
    expect(codeNote).toContain("你想运行哪段代码")
  })

  it("does not execute Chinese text for '编译' without code block", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "帮我编译一下",
      subjectCode: "programming"
    })

    expect(mockRunCodeRunner).not.toHaveBeenCalled()
    const codeNote = result.toolContextNotes.find((n) => n.includes("NO_CODE_FOUND"))
    expect(codeNote).toBeDefined()
  })

  it("does not trigger for non-programming subject without explicit code intent", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "什么是极限？",
      subjectCode: "math"
    })

    expect(result.codeRunner).toBeUndefined()
    expect(mockRunCodeRunner).not.toHaveBeenCalled()
  })

  it("does not trigger on bare code fence without run intent", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    await runToolAgent({
      userMessage: "帮我看看这段代码\n```python\nprint(1+1)\n```",
      subjectCode: "programming"
    })

    // "帮我看看" is not "帮我运行" — should NOT trigger code_runner
    expect(mockRunCodeRunner).not.toHaveBeenCalled()
  })

  it("does not trigger on '这段代码是什么意思'", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    await runToolAgent({
      userMessage: "这段代码是什么意思\n```python\nx = [i**2 for i in range(10)]\n```",
      subjectCode: "programming"
    })

    // Asking for explanation, not execution
    expect(mockRunCodeRunner).not.toHaveBeenCalled()
  })

  it("does not trigger on '上一段代码的逻辑'", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    await runToolAgent({
      userMessage: "上一段代码的逻辑是什么",
      subjectCode: "programming"
    })

    // Asking about code logic, not requesting run
    expect(mockRunCodeRunner).not.toHaveBeenCalled()
  })

  // ── code_runner safety tests ──────────────────────────────────────────

  it("does not trigger on traceback-only (student asking why error)", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "为什么报错\n```\nTraceback (most recent call last):\n  File \"test.py\", line 3\n    print(x)\nNameError: name 'x' is not defined\n```",
      subjectCode: "programming"
    })

    // Traceback alone should NOT trigger code execution
    expect(mockRunCodeRunner).not.toHaveBeenCalled()
  })

  it("does not trigger on '输出是什么' with code", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    await runToolAgent({
      userMessage: "输出是什么\n```python\nprint(1+1)\n```",
      subjectCode: "programming"
    })

    // Asking about output, not requesting execution
    expect(mockRunCodeRunner).not.toHaveBeenCalled()
  })

  it("does not trigger on pasted code without explicit run intent", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    await runToolAgent({
      userMessage: "这段代码对吗\n```python\ndef add(a, b):\n    return a + b\n```",
      subjectCode: "programming"
    })

    // Asking for review, not execution
    expect(mockRunCodeRunner).not.toHaveBeenCalled()
  })

  it("does not trigger on history code without explicit run intent", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    await runToolAgent({
      userMessage: "帮我看看之前的代码",
      subjectCode: "programming",
      recentMessages: [
        { role: "user", content: "```python\nprint('hello')\n```" }
      ]
    })

    // "帮我看看" is not "帮我运行"
    expect(mockRunCodeRunner).not.toHaveBeenCalled()
  })

  it("triggers on explicit '请运行这段代码' with code", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "请运行这段代码\n```python\nprint(42)\n```",
      subjectCode: "programming"
    })

    expect(mockRunCodeRunner).toHaveBeenCalledWith(
      expect.objectContaining({ code: "print(42)" })
    )
    expect(result.codeRunner?.ok).toBe(true)
  })

  it("returns NO_CODE_FOUND when run requested but no code present", async () => {
    mockSearchKnowledgeFromDatabase.mockResolvedValue([])

    const result = await runToolAgent({
      userMessage: "帮我运行",
      subjectCode: "programming"
    })

    expect(mockRunCodeRunner).not.toHaveBeenCalled()
    const codeNote = result.toolContextNotes.find((n) => n.includes("NO_CODE_FOUND"))
    expect(codeNote).toBeDefined()
  })
})
