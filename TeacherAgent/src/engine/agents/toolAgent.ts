import { searchLocalKnowledgeLazy } from "../../services/knowledge/localKnowledgeSearch"
import { searchKnowledgeFromDatabase } from "../../services/knowledge/knowledgeIndexer"
import { isCustomSubject } from "../../types/learning"
import { searchKnowledgeByVector, searchQuestionByVector } from "../../services/knowledge/vectorSearch"
import { getKnowledgeNodesByIds } from "../../services/tauri/commands"
import { searchLocalQuestionBankLazy } from "../../services/questions/localQuestionBankSearch"
import { createMathComputeToolContext, runMathCompute } from "../../services/tools/mathCompute"
import { runCodeRunner, createCodeRunnerToolContext } from "../../services/tools/codeRunner"
import { getPacksBySubject } from "../../services/knowledge/packManifest"
import { getApprovedEntityIds } from "../../services/knowledge/packLoader"
import { loadPrivateChunks, searchPrivateChunks } from "../../services/document/privateDocumentService"

/**
 * 学科领域短语词典——从自然语言问句中提取有意义的搜索 token。
 * 与 localKnowledgeSearch.ts 的 tokenize 共享同一套学科词表。
 */
const DOMAIN_PHRASES: string[] = [
  // 数学
  "极限", "连续", "左极限", "右极限", "无穷小", "无穷大", "不定式",
  "等价无穷小", "夹逼定理", "洛必达", "泰勒展开", "变量代换", "分段函数",
  "数列极限", "单调有界", "海涅定理", "初等函数", "复合函数",
  "可去间断", "跳跃间断", "无穷间断", "振荡间断", "介值定理", "最值定理",
  "渐近线", "三角函数", "导数", "积分", "矩阵", "线性代数", "概率论",
  "二项分布", "泊松分布", "几何分布", "正态分布", "均匀分布", "指数分布",
  "贝叶斯", "大数定律", "中心极限定理", "期望", "方差", "协方差",
  "秩", "向量空间", "线性无关", "线性相关", "特征值", "特征向量", "对角化",
  // CS408
  "数据结构", "线性表", "栈", "队列", "树", "图", "排序", "KMP", "哈希",
  "组成原理", "补码", "浮点数", "Cache", "流水线", "指令", "DMA", "总线",
  "操作系统", "进程", "线程", "调度", "信号量", "PV", "死锁", "分页", "虚拟内存",
  "计算机网络", "TCP/IP", "IP地址", "子网", "ARP", "ICMP", "TCP", "UDP",
  "拥塞控制", "DNS", "HTTP",
  // 物理
  "力学", "电磁学", "热学", "波动", "光学", "近代物理", "牛顿", "动量",
  "库仑", "电场", "磁场", "电磁感应", "麦克斯韦", "热力学", "熵",
  "干涉", "衍射", "偏振", "光电效应",
  // 英语
  "定语从句", "名词性从句", "非谓语动词", "虚拟语气", "长难句", "阅读理解",
  "翻译", "完形填空", "考研英语", "语法", "从句", "时态", "语态",
  // 政治
  "马克思主义", "唯物辩证法", "历史唯物主义", "认识论", "剩余价值", "资本积累",
  "毛泽东思想", "新民主主义", "社会主义改造", "实事求是", "群众路线",
  "近现代史", "鸦片战争", "辛亥革命", "五四运动", "抗日战争", "改革开放",
  "思想道德", "法治", "人生观", "价值观", "道德修养", "法治思维", "宪法",
  "政治", "考研", "大纲", "考试大纲", "考研大纲", "政治大纲",
  "思想政治", "思想政治理论", "毛概", "马原", "史纲", "思修",
]

/**
 * 从自然语言 query 中提取搜索关键词，避免将完整问句传给 LIKE 搜索。
 *
 * 策略：
 * 1. 从学科词典中匹配出现在 query 中的短语
 * 2. 提取 ≥2 字的 ASCII 字母/数字 token
 * 若无有效 token 则返回原始 query（转小写、去首尾空白）。
 */
function extractSearchKeywords(query: string): string {
  const lower = query.toLowerCase()
  const tokens: string[] = []

  // 从词典中匹配出现在 query 中的学科短语
  for (const phrase of DOMAIN_PHRASES) {
    const lp = phrase.toLowerCase()
    if (lower.includes(lp)) {
      tokens.push(lp)
    }
  }

  // ASCII 字母/数字 ≥2
  for (const m of lower.matchAll(/[a-z0-9]{2,}/g)) {
    tokens.push(m[0])
  }

  const unique = [...new Set(tokens)]
  return unique.length > 0 ? unique.join(" ") : lower.trim()
}

import type {
  CodeRunnerInput,
  CodeRunnerOutput,
  KnowledgeSearchOutput,
  MathComputeInput,
  MathComputeOutput,
  QuestionBankSearchInput,
  QuestionBankSearchOutput,
  RetrievalProvenance,
  ToolResult
} from "../../types/tool"
import type { SubjectCode } from "../../types/learning"
import type { LlmProviderConfig } from "../../services/llm/types"
import type { EmbeddingProviderConfig } from "../../stores/app"
import type { TutorKnowledgeContext } from "../prompts/tutorPromptBuilder"

export interface ToolAgentInput {
  userMessage: string
  subjectCode: SubjectCode
  /** 已启用的 pack IDs 列表，用于过滤搜索结果 */
  enabledPackIds?: string[]
  /** 考试体系范围（可选）：指定后题库检索强制按叶子范围过滤并标注归属 */
  examScope?: {
    examTrackId: string | null
    subjectId: string | null
    moduleId: string | null
  }
  /** 当前对话中最近导入/选中的私有资料，用于解析"这份资料"等指代 */
  recentPrivateDocument?: RecentPrivateDocumentRef
  /** 最近的对话消息，用于从历史中提取代码块（如"运行上一段代码"） */
  recentMessages?: Array<{ role: string; content: string }>
  enableLocalKnowledgeSearch?: boolean
  enableMathCompute?: boolean
  providerConfig?: LlmProviderConfig
  /** Dedicated embedding provider config for vector search (model-consistent with generation) */
  embeddingConfig?: EmbeddingProviderConfig | null
}

export interface RecentPrivateDocumentRef {
  id: string
  title: string
  fileName: string
}

export interface ToolAgentResult {
  knowledgeSearch?: ToolResult<KnowledgeSearchOutput>
  questionBankSearch?: ToolResult<QuestionBankSearchOutput>
  mathCompute?: ToolResult<MathComputeOutput>
  codeRunner?: ToolResult<CodeRunnerOutput>
  privateDocSearch?: ToolResult<KnowledgeSearchOutput>
  knowledgeContext?: TutorKnowledgeContext
  toolContextNotes: string[]
}

/**
 * Detect if the user message indicates a "tool debug" / "tool integration test" intent.
 * When detected, the system should prioritize direct tool results over teaching dialogue.
 *
 * Signals:
 * - "工具联调" / "tool integration test"
 * - "不按教学模式" / "not following teaching mode"
 * - "直接返回工具结果" / "return tool results directly"
 * - "测试" + "math_compute" or "工具"
 */
export function isToolDebugMode(userMessage: string): boolean {
  return /(?:工具联调|联调测试|tool\s*(?:debug|integration|test)|不按教学模式|直接返回(?:工具|计算|结果)|不按教学|测试.*(?:工具|math_compute|mathCompute)|调试模式)/i.test(
    userMessage
  )
}

export async function runToolAgent(input: ToolAgentInput): Promise<ToolAgentResult> {
  const knowledgeSearch = input.enableLocalKnowledgeSearch === false ? undefined : await runKnowledgeSearch(input)
  const questionBankInput = shouldSearchQuestionBank(input) ? createQuestionBankInput(input) : undefined
  const questionBankSearch = questionBankInput ? await runQuestionBankSearch(input, questionBankInput) : undefined

  // Math compute: check for unsupported types first, then route to engine
  let mathComputeInput: MathComputeInput | undefined
  let mathCompute: ToolResult<MathComputeOutput> | undefined

  if (shouldTryMathCompute(input) && input.enableMathCompute !== false) {
    // Check for unsupported input types (line integrals, etc.)
    const unsupportedCheck = createUnsupportedMathResult(input.userMessage)
    if (unsupportedCheck.unsupported) {
      // Still create mathComputeInput so createToolContextNotes generates the note
      mathComputeInput = { operation: "integrate", expression: extractLikelyExpression(input.userMessage) }
      mathCompute = unsupportedCheck.result
    } else {
      mathComputeInput = createMathComputeInput(input.userMessage)
      mathCompute = await runMathCompute(mathComputeInput)
    }
  }

  // 私有资料检索：在 built-in 搜索之外，额外搜索用户导入的资料
  const privateDocSearch = input.enableLocalKnowledgeSearch === false
    ? undefined
    : await runPrivateDocSearch(input)

  // Code runner: only for programming subject or when code intent detected
  let codeRunnerInput: CodeRunnerInput | undefined
  let codeRunner: ToolResult<CodeRunnerOutput> | undefined
  let codeRunnerMissingCode = false
  if (shouldRunCode(input)) {
    codeRunnerInput = createCodeRunnerInput(input.userMessage, input.recentMessages)
    if (codeRunnerInput) {
      codeRunner = await runCodeRunner(codeRunnerInput)
    } else {
      codeRunnerMissingCode = true
    }
  }

  return {
    knowledgeSearch,
    questionBankSearch,
    mathCompute,
    codeRunner,
    privateDocSearch,
    knowledgeContext: createMergedKnowledgeContext(knowledgeSearch, privateDocSearch, input.subjectCode),
    toolContextNotes: createToolContextNotes(mathComputeInput, mathCompute, questionBankInput, questionBankSearch, codeRunnerInput, codeRunner, codeRunnerMissingCode)
  }
}

/**
 * 判断 enabledPackIds 是否为当前 subject approved pack 全集的真子集。
 * "部分选择" = 有 approved pack 被禁用。此时 DB/vector 无法按 pack 过滤，需要 JSON 检索。
 * 如果所有 approved pack 都已启用（即使额外启用了 draft pack），vector/DB 搜索是安全的，
 * 因为 entity_ids 过滤确保只返回 approved 内容。
 */
function isPartialPackSelection(enabledPackIds: string[], subjectCode: SubjectCode): boolean {
  const approvedPackIds = getPacksBySubject(subjectCode)
    .filter((p) => p.status === "approved")
    .map((p) => p.id)
  const enabledSet = new Set(enabledPackIds)
  // 只要有 approved pack 未被启用，就是部分选择
  return !approvedPackIds.every((id) => enabledSet.has(id))
}

/**
 * Knowledge search: try vector search → database keyword → JSON seed.
 *
 * 当 enabledPackIds 是当前 subject 全部 pack 的真子集时，直接使用 JSON lazy search，
 * 因为 DB/vector 搜索当前无法按 pack 过滤。
 * 当 enabledPackIds 是全部 pack 时，保持原优先级：vector → DB → JSON。
 *
 * Vector search uses the dedicated embeddingConfig (model-consistent with generation)
 * and filters by approved entity IDs so draft/custom vectors never occupy TopK.
 */
async function runKnowledgeSearch(input: ToolAgentInput): Promise<ToolResult<KnowledgeSearchOutput>> {
  // 当 enabledPackIds 是真子集时，直接使用 JSON lazy search（支持 pack 过滤）
  // DB/vector 搜索当前无法按 pack 过滤，跳过以避免返回禁用 pack 的内容
  if (input.enabledPackIds && isPartialPackSelection(input.enabledPackIds, input.subjectCode)) {
    const jsonResult = await searchLocalKnowledgeLazy({
      query: input.userMessage,
      subject: input.subjectCode,
      enabledPackIds: input.enabledPackIds,
      topK: 3,
      searchMode: "hybrid",
      includePrerequisites: true,
      includeMisconceptions: true,
      includeSocraticHints: true
    })
    // Attach provenance
    if (jsonResult.ok && jsonResult.data) {
      jsonResult.data.provenance = {
        retrievalMode: "json_seed",
        topNodeIds: jsonResult.data.results.map((r) => r.knowledgeNodeId)
      }
    }
    return jsonResult
  }

  // Priority 1: Vector search (if embedding provider is configured)
  const embConfig = input.embeddingConfig
  if (embConfig?.apiKeyRef && embConfig?.baseUrl) {
    try {
      const approvedIds = await getApprovedEntityIds()
      const { results: vectorResults, embeddingModel, topScore } = await searchKnowledgeByVector(
        input.userMessage,
        {
          embeddingConfig: embConfig,
          limit: 3,
          approvedEntityIds: approvedIds
        }
      )
      if (vectorResults.length > 0) {
        // Build score map keyed by entityId for correct score association
        const scoreMap = new Map<string, number>()
        const nodeIds: string[] = []
        for (const vr of vectorResults) {
          scoreMap.set(vr.entityId, vr.score)
          if (!nodeIds.includes(vr.entityId)) {
            nodeIds.push(vr.entityId)
          }
        }

        // Fetch full node details directly by IDs (not via keyword search)
        const matchedNodes = await getKnowledgeNodesByIds(input.subjectCode, nodeIds)
        if (matchedNodes.length > 0) {
          const provenance: RetrievalProvenance = {
            retrievalMode: "vector",
            embeddingModel,
            topScore,
            topNodeIds: matchedNodes.map((r) => r.id)
          }
          return {
            ok: true,
            data: {
              results: matchedNodes.map((r) => ({
                knowledgeNodeId: r.id,
                title: r.title,
                subject: input.subjectCode,
                course: undefined,
                summary: r.summary,
                prerequisites: r.prerequisites,
                relatedNodeIds: [],
                misconceptions: r.misconceptions,
                socraticHints: r.socraticHints as KnowledgeSearchOutput["results"][number]["socraticHints"],
                source: { id: "vector", title: "Vector Search", license: "original", sourceType: "built_in_pack" },
                score: Math.round((scoreMap.get(r.id) ?? 0.8) * 10)
              })),
              provenance
            },
            sources: matchedNodes.map((r) => ({ id: "vector", title: r.title, license: "original", sourceType: "built_in_pack" as const }))
          }
        }
      }
    } catch (error) {
      console.warn("[TeacherAgent] vector knowledge retrieval failed, falling back:", error)
    }
  }

  // Priority 2: Database keyword search
  try {
    const dbResults = await searchKnowledgeFromDatabase(input.subjectCode, input.userMessage, 3)
    if (dbResults.length > 0) {
      const provenance: RetrievalProvenance = {
        retrievalMode: "database_keyword",
        topNodeIds: dbResults.map((r) => r.id)
      }
      return {
        ok: true,
        data: {
          results: dbResults.map((r) => ({
            knowledgeNodeId: r.id,
            title: r.title,
            subject: input.subjectCode,
            course: undefined,
            summary: r.summary,
            prerequisites: r.prerequisites,
            relatedNodeIds: [],
            misconceptions: r.misconceptions,
            socraticHints: r.socraticHints as KnowledgeSearchOutput["results"][number]["socraticHints"],
            source: { id: "database", title: "Local Database", license: "original", sourceType: "built_in_pack" },
            score: 8
          })),
          provenance
        },
        sources: dbResults.map((r) => ({ id: "database", title: r.title, license: "original", sourceType: "built_in_pack" as const }))
      }
    }
  } catch {
    // Database not available, fall through
  }

  // Priority 3: JSON seed search (fallback, lazy loaded)
  const jsonResult = await searchLocalKnowledgeLazy({
    query: input.userMessage,
    subject: input.subjectCode,
    topK: 3,
    searchMode: "hybrid",
    includePrerequisites: true,
    includeMisconceptions: true,
    includeSocraticHints: true
  })
  if (jsonResult.ok && jsonResult.data) {
    jsonResult.data.provenance = {
      retrievalMode: "json_seed",
      topNodeIds: jsonResult.data.results.map((r) => r.knowledgeNodeId)
    }
  }
  return jsonResult
}

/**
 * Question bank search: try vector search → lazy JSON seed.
 *
 * 当 enabledPackIds 是当前 subject 全部 pack 的真子集时，直接使用 JSON lazy search，
 * 因为 vector 搜索当前无法按 pack 过滤。
 * 当 enabledPackIds 是全部 pack 时，保持原优先级：vector → JSON。
 */
async function runQuestionBankSearch(
  input: ToolAgentInput,
  questionBankInput: QuestionBankSearchInput
): Promise<ToolResult<QuestionBankSearchOutput>> {
  // 当 enabledPackIds 是真子集时，直接使用 JSON lazy search（支持 pack 过滤）
  if (input.enabledPackIds && isPartialPackSelection(input.enabledPackIds, input.subjectCode)) {
    return searchLocalQuestionBankLazy(questionBankInput)
  }

  // Priority 1: Vector search (if embedding provider is configured)
  const embConfig = input.embeddingConfig
  if (embConfig?.apiKeyRef && embConfig?.baseUrl) {
    try {
      const approvedIds = await getApprovedEntityIds()
      const { results: vectorResults } = await searchQuestionByVector(input.userMessage, {
        embeddingConfig: embConfig,
        limit: questionBankInput.topK ?? 3,
        approvedEntityIds: approvedIds
      })
      if (vectorResults.length > 0) {
        // Get question IDs from vector results
        const questionIds = vectorResults.map((vr) => vr.entityId)

        // Fetch full question details via lazy search and filter by IDs
        const lazyResult = await searchLocalQuestionBankLazy({
          ...questionBankInput,
          query: input.userMessage
        })

        if (lazyResult.ok && lazyResult.data) {
          // Filter to only vector-matched questions, preserving vector score order
          const idSet = new Set(questionIds)
          const vectorMatched = lazyResult.data.questions
            .filter((q) => idSet.has(q.questionId))
            .map((q) => {
              const vr = vectorResults.find((v) => v.entityId === q.questionId)
              return { ...q, score: Math.round((vr?.score ?? 0.8) * 10) }
            })

          if (vectorMatched.length > 0) {
            return {
              ok: true,
              data: { questions: vectorMatched },
              sources: vectorMatched.map((q) => ({
                id: `vector:${q.questionId}`,
                title: q.title ?? q.questionId,
                license: "original",
                sourceType: "built_in_pack" as const
              }))
            }
          }
        }
      }
    } catch {
      // Vector search not available, fall through
    }
  }

  // Priority 2: JSON seed search (fallback)
  return searchLocalQuestionBankLazy(questionBankInput)
}

/**
 * 搜索用户导入的私有资料。
 * 最多返回 3 条结果，避免注入过多私有文本。
 */
async function runPrivateDocSearch(input: ToolAgentInput): Promise<ToolResult<KnowledgeSearchOutput> | undefined> {
  try {
    if (input.recentPrivateDocument && referencesSpecificPrivateMaterial(input.userMessage)) {
      return await loadRecentPrivateDocumentContext(input)
    }

    const keywords = extractSearchKeywords(input.userMessage)
    const results = await searchPrivateChunks(keywords, input.subjectCode, 3)
    if (results.length === 0) {
      return { ok: true, data: { results: [] } }
    }

    return {
      ok: true,
      data: {
        results: results.map((r) => ({
          knowledgeNodeId: r.documentId,
          title: r.documentTitle,
          subject: input.subjectCode,
          course: undefined,
          summary: r.text.slice(0, 500),
          prerequisites: [],
          relatedNodeIds: [],
          misconceptions: [],
          socraticHints: [],
          source: {
            id: `private:${r.documentId}`,
            title: r.documentTitle,
            license: "private_user_import",
            sourceType: "private_document" as const
          },
          score: r.score,
          // 附加私有资料元数据，供 prompt 注入使用
          _privateMeta: {
            sourceType: "private_document" as const,
            documentTitle: r.documentTitle,
            fileName: r.fileName,
            heading: r.heading
          }
        }))
      },
      sources: results.map((r) => ({
        id: `private:${r.documentId}`,
        title: r.documentTitle,
        license: "private_user_import",
        sourceType: "private_document" as const
      }))
    }
  } catch {
    // 私有资料搜索失败不影响主流程
    return undefined
  }
}

async function loadRecentPrivateDocumentContext(input: ToolAgentInput): Promise<ToolResult<KnowledgeSearchOutput>> {
  const recent = input.recentPrivateDocument!
  const chunks = await loadPrivateChunks(recent.id)
  const selectedChunks = chunks.slice(0, 5)

  if (selectedChunks.length === 0) {
    return { ok: true, data: { results: [] } }
  }

  return {
    ok: true,
    data: {
      results: selectedChunks.map((chunk, index) => ({
        knowledgeNodeId: `${recent.id}#${chunk.chunkIndex}`,
        title: recent.title,
        subject: input.subjectCode,
        course: undefined,
        summary: chunk.text.slice(0, 500),
        prerequisites: [],
        relatedNodeIds: [],
        misconceptions: [],
        socraticHints: [],
        source: {
          id: `private:${recent.id}`,
          title: recent.title,
          license: "private_user_import",
          sourceType: "private_document" as const
        },
        score: Math.max(10 - index, 1),
        _privateMeta: {
          sourceType: "private_document" as const,
          documentTitle: recent.title,
          fileName: recent.fileName,
          heading: chunk.heading ?? `Chunk ${chunk.chunkIndex + 1}`
        }
      }))
    },
    sources: [
      {
        id: `private:${recent.id}`,
        title: recent.title,
        license: "private_user_import",
        sourceType: "private_document" as const
      }
    ]
  }
}

function referencesSpecificPrivateMaterial(message: string): boolean {
  return /(?:这份|这个|刚才|刚刚|最近|上传|导入|我的|本地).{0,12}(?:资料|文档|pdf|PDF|文件|讲义|笔记|大纲)|(?:总结|概括|梳理|提炼|看看|分析).{0,8}(?:资料|文档|pdf|PDF|文件|讲义|笔记|大纲)/i.test(
    message
  )
}

/**
 * Detect line integral / curve integral / path integral inputs that the current
 * math_compute pipeline cannot handle.
 *
 * Uses two-layer detection with short-circuits:
 * - Inherently line-integral terms (∫_L, ∮, 线积分, 曲线积分) → true immediately
 * - Ordinary "积分" only triggers when combined with a path signal
 * - Endpoint/curve descriptions alone (no integral context) → false
 */
export function isLineIntegralLike(userMessage: string): boolean {
  // Short-circuit: these terms ARE line integrals by definition
  if (/(?:线积分|曲线积分|路径积分)/.test(userMessage)) return true

  // Short-circuit: ∮ is always a closed curve integral — no path subscript needed
  if (/∮/.test(userMessage)) return true

  // Short-circuit: ∫ with explicit path subscript (∫_L, ∫_C) — underscore marks the subscript
  // Plain ∫ followed by a variable (like ∫ x^2 dx) is a normal integral, not a line integral
  if (/∫_[A-Za-z]/.test(userMessage)) return true

  // Short-circuit: OCR approximation with differential (fL + dx, fC + dy)
  if (/\bf[A-Z]\b/.test(userMessage) && /(?:dx|dy|ds|dt|dz)/.test(userMessage)) return true

  // For ordinary "积分" keyword, need BOTH integral context AND path signal
  if (/(?:积分)/.test(userMessage) && hasPathSignal(userMessage)) return true

  return false
}

/** Check for path/curve-related signals in the message. */
function hasPathSignal(msg: string): boolean {
  // Named path variable: "其中 L 为...", "L 为..."
  if (/(?:其中|where)\s*[A-Za-zαβγ]\s*(?:为|是|=)/i.test(msg)) return true
  if (/[A-Za-zαβγ]\s*(?:为|是|=)\s*.{0,15}(?:曲线|弧|路径|parabola|curve|path)/i.test(msg)) return true

  // Endpoint pattern: "从 A(1,-1) 到 B(1,1)"
  if (/(?:从|from)\s*[A-Z]\s*\([^)]+\)\s*(?:到|to)\s*[A-Z]\s*\([^)]+\)/.test(msg)) return true

  // Curve on an arc: "...上的弧", "...上的曲线"
  if (/.{0,10}(?:上的弧|上的曲线|上的路径)/.test(msg)) return true

  return false
}

/**
 * Reject unsupported math input types early, returning a structured error
 * result instead of passing to the engine pipeline.
 */
export function createUnsupportedMathResult(
  userMessage: string
): { unsupported: true; result: ToolResult<MathComputeOutput> } | { unsupported: false } {
  if (isLineIntegralLike(userMessage)) {
    return {
      unsupported: true,
      result: {
        ok: false,
        errorCode: "UNSUPPORTED_INPUT",
        error: "Line integrals / curve integrals are not supported by the current math_compute pipeline.",
        data: {
          result: "",
          normalizedExpression: userMessage,
          operation: "integrate",
          warnings: [
            "Line integrals are not supported.",
            "detectedType: line_integral",
            "suggestion: parameterize the curve first, then pass the resulting ordinary integral to math_compute."
          ],
          confidence: 0,
          engine: "unavailable",
          isFallback: false
        }
      }
    }
  }
  return { unsupported: false }
}

function shouldTryMathCompute(input: ToolAgentInput): boolean {
  if (input.subjectCode !== "math") {
    return false
  }

  // Pure concept questions without any expression: skip math compute
  if (asksForMathConcept(input.userMessage) && !hasExplicitMathExpression(input.userMessage)) {
    return false
  }

  // Must match a compute intent keyword OR contain an explicit expression
  const hasComputeIntent = /(?:求|算|计算|化简|展开|因式分解|极限|lim\b|导数|求导|积分|矩阵|行列式|特征值|解方程|limit|derivative|integral|matrix|simplify|expand|factor)/i.test(
    input.userMessage
  )

  return hasComputeIntent || hasExplicitMathExpression(input.userMessage)
}

function shouldSearchQuestionBank(input: ToolAgentInput): boolean {
  return /(?:练习|习题|题目|例题|类似题|变式|测验|检测|考考我|复盘|解析|巩固|practice|quiz|exercise|similar|review)/i.test(
    input.userMessage
  )
}

/**
 * Determine whether the student explicitly requests code execution.
 *
 * Security principle: code_runner is a teaching guardrail, NOT a sandbox.
 * Ordinary chat or model inference must NOT auto-execute unknown code.
 * Only trigger when the student clearly requests running/executing code.
 *
 * Allowed triggers:
 * - Explicit "run code" / "execute" / "运行" / "执行" / "跑" requests
 * - "编译" / "解释器" / "工具连调" requests with code present
 * - "帮我运行" / "帮我执行" / "帮我编译" (direct help requests)
 *
 * NOT triggers:
 * - Traceback / SyntaxError alone (student asking "输出是什么" or "为什么报错")
 * - Bare code fence without run intent (student may be sharing for review)
 * - "这段代码是什么意思" (asking for explanation, not execution)
 * - "上一段代码的逻辑" (asking about code, not requesting run)
 */
function shouldRunCode(input: ToolAgentInput): boolean {
  if (input.subjectCode !== "programming") return false

  // Explicit run/execute intent with code keywords present
  if (/(?:运行|执行|跑一下|run|execute|试一下).{0,20}(?:代码|程序|code|script)/i.test(input.userMessage)) return true
  if (/(?:代码|程序|code|script).{0,20}(?:运行|执行|跑一下|run|execute|试一下)/i.test(input.userMessage)) return true

  // "编译" / "解释器" with code keywords or run intent
  if (/(?:编译|compile|解释器|interpreter).{0,20}(?:代码|程序|code|script|运行|执行|run|execute)/i.test(input.userMessage)) return true

  // Direct help requests: "帮我运行" / "帮我执行" / "帮我编译"
  if (/(?:帮我|请|帮忙).{0,6}(?:运行|执行|跑|编译)/i.test(input.userMessage)) return true

  // "这段代码" must be paired with explicit run/execute intent (not just explanation)
  if (/(?:这段|这个|上面的).{0,4}代码/i.test(input.userMessage) && /(?:运行|执行|跑|run|execute)/i.test(input.userMessage)) return true

  // "工具连调" / "工具联调" (tool integration debug)
  if (/工具[连联]调/i.test(input.userMessage)) return true

  // "上一段代码" / "前面的代码" — must have explicit run intent
  if (/(?:上一段|前面的|刚才的|之前的).{0,2}代码/i.test(input.userMessage) && /(?:运行|执行|跑|run|execute|编译|compile)/i.test(input.userMessage)) return true

  return false
}

/**
 * Extract code and test cases from user message for code_runner.
 *
 * Priority:
 * 1. Python code fence in current message
 * 2. Small inline Python snippet in current message
 * 3. Python code in recent student messages (search backwards)
 * 4. Return undefined (never execute raw Chinese text as code)
 */
function createCodeRunnerInput(
  userMessage: string,
  recentMessages?: Array<{ role: string; content: string }>
): CodeRunnerInput | undefined {
  const currentCode = extractPythonCodeSnippet(userMessage)
  if (currentCode) {
    return { code: currentCode, language: "python", timeoutMs: 5000 }
  }

  // Search recent student messages backwards for Python code.
  // Avoid executing assistant-generated examples when the student says "run the previous code".
  if (recentMessages) {
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i]
      if (msg.role !== "user") continue
      const code = extractPythonCodeSnippet(msg.content)
      if (code) {
        return { code, language: "python", timeoutMs: 5000 }
      }
    }
  }

  // No code found — return undefined so the LLM can ask the student to provide code
  return undefined
}

function extractPythonCodeSnippet(message: string): string | undefined {
  const fenced = message.match(/```(?:python|py)?\s*\n?([\s\S]*?)```/)
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim()
  }

  const inline = message.match(/`([^`\n]*(?:print|input|range|len|def|for|while|if)\b[^`]*)`/)
  if (inline?.[1]?.trim()) {
    return inline[1].trim()
  }

  // Narrow beginner-code fallback: "print(\"hello\") 是不是输出 hello".
  const printCall = message.match(/\bprint\s*\([^\r\n]*?\)/)
  if (printCall?.[0]?.trim()) {
    return printCall[0].trim()
  }

  return undefined
}

function createQuestionBankInput(input: ToolAgentInput): QuestionBankSearchInput {
  return {
    query: input.userMessage,
    subject: input.subjectCode,
    enabledPackIds: input.enabledPackIds,
    examScope: input.examScope,
    difficulty: inferQuestionDifficulty(input.userMessage),
    purpose: inferQuestionPurpose(input.userMessage),
    topK: 3,
    excludeRecentlyUsed: true
  }
}

function inferQuestionPurpose(userMessage: string): QuestionBankSearchInput["purpose"] {
  if (/(?:测验|检测|考考我|quiz|assessment)/i.test(userMessage)) return "assessment"
  if (/(?:复盘|讲解|解析|review)/i.test(userMessage)) return "review"
  if (/(?:类似题|变式|例题|similar)/i.test(userMessage)) return "similar_example"
  return "practice"
}

function inferQuestionDifficulty(userMessage: string): QuestionBankSearchInput["difficulty"] {
  if (/(?:简单|基础|入门|easy)/i.test(userMessage)) {
    return { min: 1, max: 2 }
  }

  if (/(?:难|拔高|挑战|hard|challenge)/i.test(userMessage)) {
    return { min: 2, max: 3 }
  }

  return { min: 1, max: 3 }
}

function asksForMathConcept(userMessage: string): boolean {
  return /(?:什么是|为什么|解释|定义|原理|区别|概念|怎么理解|how|why|what is|explain)/i.test(userMessage)
}

/**
 * Detect if the user message contains an explicit math expression.
 * Covers fenced/inline math, operators, exponents, function notation,
 * and natural language math commands with expressions.
 */
function hasExplicitMathExpression(userMessage: string): boolean {
  // Fenced or inline math
  if (/(?:```|\$[^$]+\$)/.test(userMessage)) return true
  // LaTeX commands
  if (/\\(?:frac|lim|int|sum|prod|sqrt|partial)/.test(userMessage)) return true
  // Integral symbols: ∫, ∮, fL (OCR approximation)
  if (/[∫∮]/.test(userMessage) || /\bf[A-Z]\b/.test(userMessage)) return true
  // Exponent or operators between terms
  if (/\^|[a-zA-Z]\s*(?:->|→|趋近)|\d+\s*[+\-*/]\s*\d+/.test(userMessage)) return true
  // Parenthesized expressions with operators: (x+1)^5, (a+b)^2
  if (/\([^)]*[+\-*/][^)]*\)\s*(?:\^|\*\*)/.test(userMessage)) return true
  // Math function calls: sin(x), cos(x), log(x), etc.
  if (/(?:sin|cos|tan|log|ln|exp|sqrt|abs)\s*\(/.test(userMessage)) return true
  // Simple polynomial-like patterns: x^2, 2x, 3*x
  if (/[a-zA-Z]\s*(?:\^|\*\*)\s*\d/.test(userMessage)) return true
  // Chinese math commands that imply an expression follows
  if (/(?:展开|因式分解|分解|化简|求导|积分|极限|解方程)\s+\S/.test(userMessage)) return true
  return false
}

function createMathComputeInput(userMessage: string): MathComputeInput {
  const operation = inferMathOperation(userMessage)

  return {
    operation,
    expression: extractLikelyExpression(userMessage),
    variable: inferVariable(userMessage, operation),
    showStepsRequested: false
  }
}

function inferMathOperation(userMessage: string): MathComputeInput["operation"] {
  if (/(?:极限|limit)/i.test(userMessage)) return "limit"
  if (/(?:求导|导数|derivative|differentiate)/i.test(userMessage)) return "differentiate"
  // Integral: text keywords OR mathematical symbols (∫, ∮)
  if (/(?:积分|integral|integrate)/i.test(userMessage) || /[∫∮]/.test(userMessage)) return "integrate"
  if (/(?:矩阵|行列式|特征值|matrix)/i.test(userMessage)) return "matrix"
  if (/(?:解方程|solve)/i.test(userMessage)) return "solve"
  if (/(?:级数|泰勒|series)/i.test(userMessage)) return "series"
  if (/(?:展开|expand)/i.test(userMessage)) return "expand"
  if (/(?:因式分解|分解|factor)/i.test(userMessage)) return "factor"

  return "simplify"
}

function inferVariable(userMessage: string, operation: MathComputeInput["operation"]): string | undefined {
  if (!["limit", "differentiate", "integrate", "series"].includes(operation)) {
    return undefined
  }

  // Try to find explicit variable declaration: "对 x 求导", "d/dx", "x->0", "x→0", "x 趋近"
  const variableMatch = userMessage.match(/(?:对|关于)\s*([a-zA-Z])|d\/d([a-zA-Z])|([a-zA-Z])\s*(?:趋近|->|→)/)

  return variableMatch?.[1] ?? variableMatch?.[2] ?? variableMatch?.[3] ?? "x"
}

/**
 * Extract the mathematical expression from a user message.
 *
 * Priority:
 * 1. Fenced math block: ```math ... ```
 * 2. Inline math: $...$
 * 3. Natural language with trailing expression (e.g., "任务：展开 (x+1)^5")
 * 4. Natural language with leading expression (e.g., "x^2+1 化简")
 * 5. Fallback: strip Chinese command prefixes and return remaining text
 */
export function extractLikelyExpression(userMessage: string): string {
  // 1. Fenced math block
  const fenced = userMessage.match(/```(?:math|tex|text)?\s*([\s\S]*?)```/)
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim()
  }

  // 2. Inline math $...$
  const inlineMath = userMessage.match(/\$([^$]+)\$/)
  if (inlineMath?.[1]?.trim()) {
    return inlineMath[1].trim()
  }

  // 3. Natural language with trailing expression
  //    e.g., "任务：展开 (x+1)^5" → "(x+1)^5"
  //    e.g., "请调用本地 math_compute 工具计算：因式分解 x^4-1" → "x^4-1"
  //    e.g., "求导 x^2+3*x+1" → "x^2+3*x+1"
  //    e.g., "极限 lim x->0 sin(x)/x" → "lim x->0 sin(x)/x"
  const trailingExpr = userMessage.match(
    /(?:任务|请|帮我|帮忙|计算|计算一下|调用|执行)[^：:]*?[：:]\s*(?:展开|因式分解|化简|求导|导数|积分|极限|解方程|simplify|expand|factor|differentiate|integrate|limit|solve)?\s*(.+)/i
  )
  if (trailingExpr?.[1]?.trim()) {
    return trailingExpr[1].trim()
  }

  // 4. Command keyword followed by expression directly (no colon)
  //    e.g., "展开 (x+1)^5" → "(x+1)^5"
  //    e.g., "因式分解 x^4-1" → "x^4-1"
  //    e.g., "求导 x^2+3*x+1" → "x^2+3*x+1"
  //    e.g., "积分 x^2" → "x^2"
  const commandExpr = userMessage.match(
    /(?:展开|因式分解|分解|化简|求导|导数|积分|极限|解方程|expand|factor|differentiate|integrate|limit|simplify|solve)\s+(.+)/i
  )
  if (commandExpr?.[1]?.trim()) {
    return commandExpr[1].trim()
  }

  // 5. Strip Chinese command prefixes and return remaining text
  //    e.g., "请计算 x^2+1" → "x^2+1"
  //    e.g., "帮我化简 (a+b)^2" → "(a+b)^2"
  const stripped = userMessage
    .replace(/^(?:任务|请|帮我|帮忙|计算|计算一下|调用|执行|测试)[^：:]*?[：:]?\s*/i, "")
    .trim()

  if (stripped && stripped !== userMessage.trim()) {
    return stripped
  }

  return userMessage
}

function createToolContextNotes(
  mathComputeInput: MathComputeInput | undefined,
  mathCompute: ToolResult<MathComputeOutput> | undefined,
  questionBankInput: QuestionBankSearchInput | undefined,
  questionBankSearch: ToolResult<QuestionBankSearchOutput> | undefined,
  codeRunnerInput?: CodeRunnerInput | undefined,
  codeRunner?: ToolResult<CodeRunnerOutput> | undefined,
  codeRunnerMissingCode?: boolean
): string[] {
  const notes: string[] = []

  if (codeRunnerMissingCode) {
    notes.push(
      '<tool_result tool="code_runner">\n' +
      "status: NO_CODE_FOUND\n" +
      "message: code_runner was triggered but no Python code block was found in the current or recent messages.\n" +
      'teaching_guidance: ask the student "你想运行哪段代码？请贴上代码或用 ```python 包裹。" Do not execute the student\'s natural language request as code.\n' +
      "</tool_result>"
    )
  }

  if (mathComputeInput && mathCompute) {
    notes.push(createMathComputeToolContext(mathComputeInput, mathCompute))
  }

  if (questionBankInput && questionBankSearch) {
    notes.push(createQuestionBankToolContext(questionBankInput, questionBankSearch))
  }

  if (codeRunnerInput && codeRunner) {
    notes.push(createCodeRunnerToolContext(codeRunnerInput, codeRunner))
  }

  return notes
}

/**
 * 合并 built-in Pack 和私有资料的检索结果为统一的 TutorKnowledgeContext。
 * 私有资料结果附加 sourceType / documentTitle / fileName / heading 元数据，
 * 供 prompt builder 区分来源并使用"你的资料中提到..."等引导式表达。
 */
function createMergedKnowledgeContext(
  knowledgeSearch: ToolResult<KnowledgeSearchOutput> | undefined,
  privateDocSearch: ToolResult<KnowledgeSearchOutput> | undefined,
  subjectCode: SubjectCode
): TutorKnowledgeContext | undefined {
  const builtInMatches = knowledgeSearch?.data?.results ?? []
  const privateMatches = privateDocSearch?.data?.results ?? []

  if (builtInMatches.length === 0 && privateMatches.length === 0) {
    return undefined
  }

  const builtInNodes = builtInMatches.map((match) => ({
    id: match.knowledgeNodeId,
    title: match.title,
    subjectCode,
    summary: match.summary,
    misconceptions: match.misconceptions,
    socraticHints: match.socraticHints,
    sourceType: "built_in_pack" as const
  }))

  const privateNodes = privateMatches.map((match) => ({
    id: match.knowledgeNodeId,
    title: match.title,
    subjectCode,
    summary: match.summary,
    misconceptions: match.misconceptions,
    socraticHints: match.socraticHints,
    sourceType: "private_document" as const,
    documentTitle: match._privateMeta?.documentTitle,
    fileName: match._privateMeta?.fileName,
    heading: match._privateMeta?.heading
  }))

  const allNodes = [...builtInNodes, ...privateNodes]

  const notes: string[] = [
    "本地知识库检索结果只用于教学参考；不要逐字照搬，也不要暴露内部来源字段。"
  ]
  if (privateNodes.length > 0) {
    notes.push(
      `本轮已检索到用户本地私有资料（sourceType: private_document）。引用时请使用"你的资料中提到..."等表达，不要伪装成公共知识。不要暴露本地文件路径。不要大段复述原文，优先摘要、提问、引导。`
    )
    notes.push(
      "不要声称无法查看用户上传的资料——你已经检索到本地私有资料内容，应基于这些内容进行辅导。"
    )
  }
  if (isCustomSubject(subjectCode)) {
    notes.push(
      "当前使用用户自建学科的学习资料，内容可能处于草稿/未审核状态。引用时保持谨慎，不要断言资料的权威性，优先引导学生验证关键定义和结论。"
    )
  }

  const firstScore = builtInMatches[0]?.score ?? privateMatches[0]?.score ?? 0

  return {
    retrievalPurpose: "support_tutoring",
    topic: allNodes.map((n) => n.title).join(" / "),
    confidence: firstScore >= 6 ? "high" : "medium",
    nodes: allNodes,
    notes
  }
}

function createQuestionBankToolContext(
  input: QuestionBankSearchInput,
  result: ToolResult<QuestionBankSearchOutput>
): string {
  const questions = result.data?.questions ?? []

  if (!result.ok || questions.length === 0) {
    return [
      "<tool_result tool=\"question_bank_search\">",
      `status: ${result.ok ? "EMPTY_RESULT" : result.errorCode ?? "EXECUTION_ERROR"}`,
      `purpose: ${input.purpose}`,
      `query: ${input.query ?? ""}`,
      "student_visible_policy: ask what topic or difficulty the student wants; do not invent local questions.",
      "</tool_result>"
    ].join("\n")
  }

  return [
    "<tool_result tool=\"question_bank_search\">",
    "status: success",
    `purpose: ${input.purpose}`,
    ...questions.map((question, index) =>
      [
        `question_${index + 1}: ${question.title ?? question.questionId}`,
        `content: ${question.content}`,
        `difficulty: ${question.difficulty}`,
        `knowledge_nodes: ${question.knowledgeNodeIds.join(", ")}`,
        question.hints.length ? `hints: ${question.hints.map((hint) => `${hint.level}: ${hint.text}`).join(" | ")}` : "",
        input.purpose === "review" && question.answer ? `answer_for_internal_review_only: ${question.answer}` : "",
        input.purpose === "review" && question.solutionSteps?.length
          ? `solution_steps_for_internal_review_only: ${question.solutionSteps.join(" | ")}`
          : ""
      ]
        .filter(Boolean)
        .join("\n")
    ),
    "student_visible_policy: for practice or assessment, show at most one question first and only an L1 hint; reveal answers or solution steps only in explicit review mode.",
    "</tool_result>"
  ].join("\n")
}
