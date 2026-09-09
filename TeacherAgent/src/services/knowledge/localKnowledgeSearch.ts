/**
 * Local Knowledge Search — 基于 JSON seed 的知识库搜索
 *
 * 使用 pack loader 懒加载 seed 数据，避免静态导入所有 JSON。
 * 当数据库搜索不可用时，作为 fallback 方案。
 *
 * 对于自建学科（custom-*），直接搜索 SQLite 数据库中的 knowledge_nodes。
 */


import type { KnowledgeSearchInput, KnowledgeSearchOutput, SourceRef, ToolResult } from "../../types/tool"
import { isCustomSubject } from "../../types/learning"
import { searchKnowledgeFromDb } from "../tauri/commands"
import {
  loadKnowledgePacksBySubject,
  loadKnowledgePacksByIds,
  loadAllKnowledgePacks,
  type KnowledgeSeed,
  type KnowledgeSeedNode
} from "./packLoader"

// ── 搜索接口 ──────────────────────────────────────────────────────────────

/**
 * 懒加载版本的知识库搜索
 *
 * 只加载与搜索相关的 pack，而非全部加载。
 * 如果指定了学科，只加载该学科的 pack。
 * 如果指定了 enabledPackIds，只加载这些 pack。
 *
 * 对于自建学科（custom-*），直接搜索 SQLite 数据库。
 */
export async function searchLocalKnowledgeLazy(
  input: KnowledgeSearchInput
): Promise<ToolResult<KnowledgeSearchOutput>> {
  const query = input.query.trim()

  if (!query) {
    return {
      ok: false,
      errorCode: "UNSUPPORTED_INPUT",
      error: "Knowledge search query is required."
    }
  }

  try {
    // 对于自建学科，直接搜索 SQLite 数据库
    if (input.subject && isCustomSubject(input.subject)) {
      return await searchCustomSubjectKnowledge(input)
    }

    // 根据 enabledPackIds 或 subject 决定加载哪些 pack
    // 必须有 subject 或 enabledPackIds，防止跨学科搜索
    let knowledgeSeeds: KnowledgeSeed[]
    if (input.enabledPackIds && input.enabledPackIds.length > 0) {
      knowledgeSeeds = await loadKnowledgePacksByIds(input.enabledPackIds)
    } else if (input.subject) {
      knowledgeSeeds = await loadKnowledgePacksBySubject(input.subject)
    } else {
      // 防御：不指定 subject 时不搜索，避免跨学科泄漏
      console.warn("[TeacherAgent] knowledge search called without subject or enabledPackIds, returning empty")
      return { ok: true, data: { results: [] } }
    }

    // Filter to only approved packs (draft packs are excluded by default)
    const approvedSeeds = knowledgeSeeds.filter((seed) => seed.status !== "draft")

    // 执行搜索
    const candidates = approvedSeeds
      .flatMap((seed) =>
        seed.nodes.map((node) => ({
          seed,
          node,
          score: scoreKnowledgeNode(query, node)
        }))
      )
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, input.topK))

    if (candidates.length === 0) {
      return {
        ok: true,
        data: { results: [] }
      }
    }

    return {
      ok: true,
      data: {
        results: candidates.map(({ seed, node, score }) => ({
          knowledgeNodeId: node.id,
          title: node.title,
          subject: seed.subject,
          course: seed.course,
          summary: node.summary,
          prerequisites: node.prerequisites ?? [],
          relatedNodeIds: [],
          misconceptions: input.includeMisconceptions ? (node.misconceptions ?? []) : [],
          socraticHints: input.includeSocraticHints ? (node.socraticHints ?? []) : [],
          source: toSourceRef(node.source),
          score
        }))
      },
      sources: candidates.map(({ node }) => toSourceRef(node.source))
    }
  } catch (error) {
    console.warn("[TeacherAgent] lazy knowledge search failed:", error)
    return {
      ok: false,
      errorCode: "EXECUTION_ERROR",
      error: `Knowledge search failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Search knowledge nodes for custom subjects from SQLite database.
 * Custom subjects store their knowledge nodes in the knowledge_nodes table
 * with subject_id matching the custom subject ID.
 */
async function searchCustomSubjectKnowledge(
  input: KnowledgeSearchInput
): Promise<ToolResult<KnowledgeSearchOutput>> {
  const subject = input.subject!
  const query = input.query.trim()
  const limit = Math.max(1, input.topK ?? 5)

  try {
    // Search the database for matching knowledge nodes
    const dbResults = await searchKnowledgeFromDb(subject, query, limit)

    if (dbResults.length === 0) {
      return {
        ok: true,
        data: { results: [] }
      }
    }

    // Convert database results to the expected output format
    const results = dbResults.map((node) => ({
      knowledgeNodeId: node.id,
      title: node.title,
      subject: subject,
      course: "",
      summary: node.summary ?? "",
      prerequisites: [] as string[],
      relatedNodeIds: [] as string[],
      misconceptions: input.includeMisconceptions ? (node.misconceptions ?? []) : [],
      socraticHints: input.includeSocraticHints
        ? (node.socraticHints as Array<{ level: "L1" | "L2" | "L3"; text: string }> ?? [])
        : [],
      source: {
        id: node.sourceId ?? "custom",
        title: node.sourceTitle ?? "自建学科资料",
        license: node.licenseSnapshot ?? "user_confirmed"
      } as SourceRef,
      score: 1.0 // Database search returns ranked results
    }))

    return {
      ok: true,
      data: { results },
      sources: results.map((r) => r.source)
    }
  } catch (error) {
    console.warn("[TeacherAgent] custom subject knowledge search failed:", error)
    return {
      ok: false,
      errorCode: "EXECUTION_ERROR",
      error: `Custom subject search failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// ── 同步版本（兼容现有代码） ──────────────────────────────────────────────

/**
 * 同步版本的知识库搜索（已废弃，使用 searchLocalKnowledgeLazy）
 *
 * @deprecated 使用 searchLocalKnowledgeLazy 替代
 */
export function searchLocalKnowledge(input: KnowledgeSearchInput): ToolResult<KnowledgeSearchOutput> {
  // 注意：这个同步版本会触发异步加载，但返回时可能数据还未加载完成
  // 建议使用 searchLocalKnowledgeLazy 替代
  console.warn(
    "[TeacherAgent] searchLocalKnowledge is deprecated, use searchLocalKnowledgeLazy instead"
  )

  // 为了保持向后兼容，我们返回一个空结果，并在后台触发加载
  // 调用者应该迁移到 searchLocalKnowledgeLazy
  setTimeout(() => {
    void searchLocalKnowledgeLazy(input)
  }, 0)

  return {
    ok: true,
    data: { results: [] }
  }
}

// ── 评分函数 ──────────────────────────────────────────────────────────────

function scoreKnowledgeNode(query: string, node: KnowledgeSeedNode): number {
  const normalizedQuery = normalizeText(query)
  const searchable = normalizeText(
    [
      node.title,
      node.summary,
      ...(node.prerequisites ?? []),
      ...(node.misconceptions ?? []),
      ...(node.socraticHints ?? []).map((hint) => hint.text)
    ].join(" ")
  )

  let score = searchable.includes(normalizedQuery) ? 8 : 0
  const tokens = tokenize(normalizedQuery)

  for (const token of tokens) {
    if (normalizeText(node.title).includes(token)) {
      score += 4
    } else if (normalizeText(node.summary).includes(token)) {
      score += 2
    } else if (searchable.includes(token)) {
      score += 1
    }
  }

  return score
}

function tokenize(value: string): string[] {
  const asciiTokens = value.match(/[a-z0-9_+-]{2,}/g) ?? []
  const chineseTokens = value.match(/[一-鿿]{2,}/g) ?? []
  const phraseTokens = [
    "极限",
    "连续",
    "左极限",
    "右极限",
    "左右极限",
    "无穷小",
    "无穷大",
    "不定式",
    "等价无穷小",
    "夹逼定理",
    "洛必达",
    "泰勒展开",
    "变量代换",
    "分段函数",
    "数列极限",
    "单调有界",
    "海涅定理",
    "初等函数",
    "复合函数",
    "可去间断",
    "跳跃间断",
    "无穷间断",
    "振荡间断",
    "介值定理",
    "最值定理",
    "渐近线",
    "三角函数",
    "导数",
    "积分",
    "矩阵",
    // Probability distributions
    "二项分布", "泊松分布", "几何分布", "正态分布", "均匀分布", "指数分布",
    "贝叶斯", "大数定律", "中心极限定理", "期望", "方差", "协方差",
    // Linear algebra expanded
    "秩", "向量空间", "线性无关", "线性相关", "基", "维数",
    "特征值", "特征向量", "对角化", "正交", "投影",
    // CS408: 数据结构
    "数据结构", "线性表", "栈", "队列", "树", "图", "排序", "KMP", "哈希", "B树", "AVL",
    // CS408: 计算机组成原理
    "组成原理", "补码", "浮点数", "Cache", "流水线", "指令", "DMA", "总线",
    // CS408: 操作系统
    "操作系统", "进程", "线程", "调度", "信号量", "PV", "死锁", "分页", "虚拟内存", "LRU", "磁盘调度",
    // CS408: 计算机网络
    "计算机网络", "OSI", "TCP/IP", "IP地址", "子网", "ARP", "ICMP", "TCP", "UDP", "拥塞控制", "DNS", "HTTP",
    // Physics
    "力学", "电磁学", "热学", "波动", "光学", "近代物理", "牛顿", "动量", "能量", "库仑", "电场", "磁场",
    "电磁感应", "麦克斯韦", "热力学", "熵", "卡诺", "干涉", "衍射", "偏振", "光电效应", "波粒二象性",
    // English
    "定语从句", "名词性从句", "非谓语动词", "虚拟语气", "长难句", "阅读理解", "翻译", "完形填空",
    "考研英语", "语法", "从句", "时态", "语态",
    // Politics
    "马克思主义", "唯物辩证法", "历史唯物主义", "认识论", "剩余价值", "资本积累",
    "毛泽东思想", "新民主主义", "社会主义改造", "实事求是", "群众路线",
    "近现代史", "鸦片战争", "辛亥革命", "五四运动", "抗日战争", "改革开放",
    "思想道德", "法治", "人生观", "价值观", "道德修养", "法治思维", "宪法"
  ].filter((token) => value.includes(token))

  return [...new Set([...asciiTokens, ...chineseTokens, ...phraseTokens])]
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function toSourceRef(source: KnowledgeSeedNode["source"]): SourceRef {
  return {
    id: source.title,
    title: source.title,
    license: source.license,
    url: source.url
  }
}
