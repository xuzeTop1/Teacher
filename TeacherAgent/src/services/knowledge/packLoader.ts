/**
 * Knowledge Pack Loader — 懒加载知识库和题库数据
 *
 * 使用 import.meta.glob 按需加载 seed JSON 文件。
 * Vite 会将匹配的 JSON 文件作为独立 chunk 打包，
 * 运行时按需加载，避免初始 bundle 膨胀。
 */

import type { KnowledgePack } from "./packManifest"
import { getPackById, getPacksBySubject, PACK_MANIFEST } from "./packManifest"

// ── Approved-only Pack IDs ────────────────────────────────────────────────

/** All approved knowledge pack IDs (computed once from manifest) */
const APPROVED_KNOWLEDGE_PACK_IDS: string[] = PACK_MANIFEST
  .filter((p) => p.status === "approved")
  .map((p) => p.id)

/** All approved question pack IDs (computed once from manifest) */
const APPROVED_QUESTION_PACK_IDS: string[] = PACK_MANIFEST
  .filter((p) => p.status === "approved")
  .map((p) => p.id)

// ── 类型定义 ──────────────────────────────────────────────────────────────

export interface KnowledgeSeedNode {
  id: string
  title: string
  summary: string
  difficulty?: number
  prerequisites?: string[]
  misconceptions?: string[]
  socraticHints?: Array<{
    level: "L1" | "L2" | "L3"
    text: string
  }>
  source: {
    title: string
    license: string
    url?: string
    sourceType?: string
  }
}

export interface KnowledgeSeed {
  /** Runtime-only provenance added by packLoader; not stored in JSON seed files. */
  __packId?: string
  subject: string
  course?: string
  chapter?: string
  status?: string
  nodes: KnowledgeSeedNode[]
}

export interface QuestionSeedItem {
  id: string
  title?: string
  content: string
  type: string
  difficulty: number
  knowledgeNodeIds: string[]
  answer?: string
  solutionSteps?: string[]
  hints?: Array<{
    level: "L1" | "L2" | "L3"
    text: string
  }>
  source: {
    title: string
    license: string
    url?: string
    sourceType?: string
  }
}

export interface QuestionSeed {
  /** Runtime-only provenance added by packLoader; not stored in JSON seed files. */
  __packId?: string
  subject: string
  course?: string
  chapter?: string
  status?: string
  questions: QuestionSeedItem[]
}

// ── import.meta.glob 映射 ─────────────────────────────────────────────────
//
// Vite 在构建时静态分析这些 glob 模式，将匹配的 JSON 文件
// 打包为独立 chunk。运行时调用返回的函数才会触发懒加载。

type GlobModule = { default: KnowledgeSeed | QuestionSeed }
type GlobMap = Record<string, () => Promise<GlobModule>>

const knowledgeGlob: GlobMap = import.meta.glob(
  "../../../data/knowledge/*.seed.json"
) as GlobMap

const questionGlob: GlobMap = import.meta.glob(
  "../../../data/questions/*.seed.json"
) as GlobMap

/**
 * 从 glob 路径提取 pack ID（文件名去掉 .seed.json 后缀）。
 *
 * 例："../../../data/knowledge/math-limits.seed.json" → "math-limits"
 */
function extractPackId(globPath: string): string {
  const match = globPath.match(/\/([^/]+)\.seed\.json$/)
  return match?.[1] ?? globPath
}

// 构建 packId → glob loader 的映射
const knowledgeLoaders = new Map<string, () => Promise<GlobModule>>()
for (const [path, loader] of Object.entries(knowledgeGlob)) {
  knowledgeLoaders.set(extractPackId(path), loader)
}

const questionLoaders = new Map<string, () => Promise<GlobModule>>()
for (const [path, loader] of Object.entries(questionGlob)) {
  questionLoaders.set(extractPackId(path), loader)
}

// ── 缓存 ────────────────────────────────────────────────────────────────

const knowledgeCache = new Map<string, KnowledgeSeed>()
const questionCache = new Map<string, QuestionSeed>()

// ── 知识库加载 ──────────────────────────────────────────────────────────

/**
 * 懒加载单个知识库 pack
 *
 * @param packId - pack 唯一标识符
 * @returns 知识库 seed 数据
 */
export async function loadKnowledgePack(packId: string): Promise<KnowledgeSeed> {
  const cached = knowledgeCache.get(packId)
  if (cached) {
    return cached
  }

  const pack = getPackById(packId)
  if (!pack) {
    throw new Error(`[packLoader] Unknown knowledge pack: ${packId}`)
  }

  const loader = knowledgeLoaders.get(packId)
  if (!loader) {
    throw new Error(
      `[packLoader] No glob match for knowledge pack "${packId}". ` +
      `Available: ${[...knowledgeLoaders.keys()].join(", ")}`
    )
  }

  try {
    const module = await loader()
    const rawSeed = module.default as KnowledgeSeed

    // 验证数据结构
    if (!rawSeed.nodes || !Array.isArray(rawSeed.nodes)) {
      throw new Error(`Invalid knowledge seed structure for pack: ${packId}`)
    }

    // 验证审核状态契约：manifest status 必须与 seed JSON status 一致
    const seedStatus = rawSeed.status as string | undefined
    if (!seedStatus) {
      throw new Error(
        `[packLoader] Knowledge pack "${packId}" seed JSON is missing required "status" field. ` +
        `Every seed file must declare status as "approved" or "draft".`
      )
    }
    if (seedStatus !== "approved" && seedStatus !== "draft") {
      throw new Error(
        `[packLoader] Knowledge pack "${packId}" has invalid status "${seedStatus}". ` +
        `Must be "approved" or "draft".`
      )
    }
    if (seedStatus !== pack.status) {
      throw new Error(
        `[packLoader] Knowledge pack "${packId}" status mismatch: ` +
        `manifest says "${pack.status}" but seed JSON says "${seedStatus}". ` +
        `These must be consistent.`
      )
    }

    const seed: KnowledgeSeed = { ...rawSeed, __packId: packId }
    knowledgeCache.set(packId, seed)
    return seed
  } catch (error) {
    throw new Error(
      `[packLoader] Failed to load knowledge pack "${packId}": ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * 懒加载单个题库 pack
 *
 * @param packId - pack 唯一标识符
 * @returns 题库 seed 数据
 */
export async function loadQuestionPack(packId: string): Promise<QuestionSeed> {
  const cached = questionCache.get(packId)
  if (cached) {
    return cached
  }

  const pack = getPackById(packId)
  if (!pack) {
    throw new Error(`[packLoader] Unknown question pack: ${packId}`)
  }

  const loader = questionLoaders.get(packId)
  if (!loader) {
    throw new Error(
      `[packLoader] No glob match for question pack "${packId}". ` +
      `Available: ${[...questionLoaders.keys()].join(", ")}`
    )
  }

  try {
    const module = await loader()
    const rawSeed = module.default as QuestionSeed

    // 验证数据结构
    if (!rawSeed.questions || !Array.isArray(rawSeed.questions)) {
      throw new Error(`Invalid question seed structure for pack: ${packId}`)
    }

    // 验证审核状态契约：manifest status 必须与 seed JSON status 一致
    const seedStatus = rawSeed.status as string | undefined
    if (!seedStatus) {
      throw new Error(
        `[packLoader] Question pack "${packId}" seed JSON is missing required "status" field. ` +
        `Every seed file must declare status as "approved" or "draft".`
      )
    }
    if (seedStatus !== "approved" && seedStatus !== "draft") {
      throw new Error(
        `[packLoader] Question pack "${packId}" has invalid status "${seedStatus}". ` +
        `Must be "approved" or "draft".`
      )
    }
    if (seedStatus !== pack.status) {
      throw new Error(
        `[packLoader] Question pack "${packId}" status mismatch: ` +
        `manifest says "${pack.status}" but seed JSON says "${seedStatus}". ` +
        `These must be consistent.`
      )
    }

    const seed: QuestionSeed = { ...rawSeed, __packId: packId }
    questionCache.set(packId, seed)
    return seed
  } catch (error) {
    throw new Error(
      `[packLoader] Failed to load question pack "${packId}": ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

// ── 批量加载 ──────────────────────────────────────────────────────────────

/**
 * 按学科加载所有知识库 pack
 *
 * @param subject - 学科代码
 * @returns 该学科下所有知识库 seed 数据
 */
export async function loadKnowledgePacksBySubject(subject: string): Promise<KnowledgeSeed[]> {
  const packs = getPacksBySubject(subject)
  const results: KnowledgeSeed[] = []

  for (const pack of packs) {
    try {
      const seed = await loadKnowledgePack(pack.id)
      results.push(seed)
    } catch (error) {
      console.warn(`[packLoader] Failed to load knowledge pack ${pack.id}:`, error)
      // 继续加载其他 pack，不中断
    }
  }

  return results
}

/**
 * 按学科加载所有题库 pack
 *
 * @param subject - 学科代码
 * @returns 该学科下所有题库 seed 数据
 */
export async function loadQuestionPacksBySubject(subject: string): Promise<QuestionSeed[]> {
  const packs = getPacksBySubject(subject)
  const results: QuestionSeed[] = []

  for (const pack of packs) {
    try {
      const seed = await loadQuestionPack(pack.id)
      results.push(seed)
    } catch (error) {
      console.warn(`[packLoader] Failed to load question pack ${pack.id}:`, error)
      // 继续加载其他 pack，不中断
    }
  }

  return results
}

/**
 * 按 pack IDs 加载知识库 pack
 *
 * @param packIds - 要加载的 pack ID 列表
 * @returns 指定 pack 的知识库 seed 数据
 */
export async function loadKnowledgePacksByIds(packIds: string[]): Promise<KnowledgeSeed[]> {
  const settled = await Promise.allSettled(packIds.map((id) => loadKnowledgePack(id)))
  const results: KnowledgeSeed[] = []
  for (let i = 0; i < settled.length; i++) {
    const item = settled[i]
    if (item.status === "fulfilled") {
      results.push(item.value)
    } else {
      console.warn(`[packLoader] Failed to load knowledge pack ${packIds[i]}:`, item.reason)
    }
  }
  return results
}

/**
 * 按 pack IDs 加载题库 pack
 *
 * @param packIds - 要加载的 pack ID 列表
 * @returns 指定 pack 的题库 seed 数据
 */
export async function loadQuestionPacksByIds(packIds: string[]): Promise<QuestionSeed[]> {
  const results: QuestionSeed[] = []

  for (const packId of packIds) {
    try {
      const seed = await loadQuestionPack(packId)
      results.push(seed)
    } catch (error) {
      console.warn(`[packLoader] Failed to load question pack ${packId}:`, error)
    }
  }

  return results
}

/**
 * 加载所有知识库 pack
 *
 * @returns 所有知识库 seed 数据
 */
export async function loadAllKnowledgePacks(): Promise<KnowledgeSeed[]> {
  const ids = PACK_MANIFEST.map((p) => p.id)
  return loadKnowledgePacksByIds(ids)
}

/**
 * 严格加载所有知识库 pack — 任何一个 pack 加载失败则 reject。
 * 用于健康检查和清理操作，不能返回部分 manifest。
 */
export async function loadAllKnowledgePacksStrict(): Promise<KnowledgeSeed[]> {
  const ids = PACK_MANIFEST.map((p) => p.id)
  return loadKnowledgePacksByIdsStrict(ids)
}

/**
 * 严格按 pack IDs 加载知识库 pack — 任何一个 pack 加载失败则 reject。
 * 用于健康检查和清理操作，避免部分 manifest 导致误删。
 */
export async function loadKnowledgePacksByIdsStrict(packIds: string[]): Promise<KnowledgeSeed[]> {
  return Promise.all(packIds.map((id) => loadKnowledgePack(id)))
}

/**
 * 加载所有题库 pack
 *
 * @returns 所有题库 seed 数据
 */
export async function loadAllQuestionPacks(): Promise<QuestionSeed[]> {
  const settled = await Promise.allSettled(PACK_MANIFEST.map((p) => loadQuestionPack(p.id)))
  const results: QuestionSeed[] = []
  for (let i = 0; i < settled.length; i++) {
    const item = settled[i]
    if (item.status === "fulfilled") {
      results.push(item.value)
    } else {
      console.warn(`[packLoader] Failed to load question pack ${PACK_MANIFEST[i].id}:`, item.reason)
    }
  }
  return results
}

/**
 * 严格加载所有题库 pack — 任何一个 pack 加载失败则 reject。
 * 用于全库 embedding 生成，不能返回部分 manifest。
 */
export async function loadAllQuestionPacksStrict(): Promise<QuestionSeed[]> {
  const ids = PACK_MANIFEST.map((p) => p.id)
  return loadQuestionPacksByIdsStrict(ids)
}

/**
 * 严格按 pack IDs 加载题库 pack — 任何一个 pack 加载失败则 reject。
 */
export async function loadQuestionPacksByIdsStrict(packIds: string[]): Promise<QuestionSeed[]> {
  return Promise.all(packIds.map((id) => loadQuestionPack(id)))
}

// ── Approved-only 加载 ────────────────────────────────────────────────────
//
// 启动 Seed、全库验证、Embedding 必须使用这些 fail-closed 路径。
// 任何一个 approved pack 加载失败则整体 reject，不允许部分成功伪装完成。

/**
 * 严格加载所有 approved 知识库 pack。
 * 任一 approved pack 加载失败则 reject（fail-closed）。
 * 用于启动默认 Seed、全库验证和 Embedding 批处理。
 */
export async function loadApprovedKnowledgePacks(): Promise<KnowledgeSeed[]> {
  return loadKnowledgePacksByIdsStrict(APPROVED_KNOWLEDGE_PACK_IDS)
}

/**
 * 严格加载所有 approved 题库 pack。
 * 任一 approved pack 加载失败则 reject（fail-closed）。
 * 用于启动默认 Seed、全库验证和 Embedding 批处理。
 */
export async function loadApprovedQuestionPacks(): Promise<QuestionSeed[]> {
  return loadQuestionPacksByIdsStrict(APPROVED_QUESTION_PACK_IDS)
}

/**
 * 获取所有 approved knowledge pack IDs。
 */
export function getApprovedKnowledgePackIds(): string[] {
  return [...APPROVED_KNOWLEDGE_PACK_IDS]
}

/**
 * 获取所有 approved question pack IDs。
 */
export function getApprovedQuestionPackIds(): string[] {
  return [...APPROVED_QUESTION_PACK_IDS]
}

/**
 * Collect all approved entity IDs (knowledge nodes + questions) into a Set.
 * Used by vector search to ensure draft/custom vectors never occupy approved TopK.
 * Cached after first call for the session.
 */
let approvedEntityIdsCache: Set<string> | null = null

export async function getApprovedEntityIds(): Promise<Set<string>> {
  if (approvedEntityIdsCache) return approvedEntityIdsCache

  const ids = new Set<string>()
  const knowledgePacks = await loadApprovedKnowledgePacks()
  for (const pack of knowledgePacks) {
    for (const node of pack.nodes) {
      ids.add(node.id)
    }
  }
  const questionPacks = await loadApprovedQuestionPacks()
  for (const pack of questionPacks) {
    for (const q of pack.questions) {
      ids.add(q.id)
    }
  }
  approvedEntityIdsCache = ids
  return ids
}

// ── 缓存管理 ──────────────────────────────────────────────────────────────

/**
 * 清除所有缓存（用于测试或内存清理）
 */
export function clearPackCache(): void {
  knowledgeCache.clear()
  questionCache.clear()
}

/**
 * 获取缓存统计信息
 */
export function getPackCacheStats(): {
  knowledgePacksCached: number
  questionPacksCached: number
  cachedKnowledgePackIds: string[]
  cachedQuestionPackIds: string[]
} {
  return {
    knowledgePacksCached: knowledgeCache.size,
    questionPacksCached: questionCache.size,
    cachedKnowledgePackIds: Array.from(knowledgeCache.keys()),
    cachedQuestionPackIds: Array.from(questionCache.keys())
  }
}

// ── 预加载 ──────────────────────────────────────────────────────────────

/**
 * 预加载指定学科的数据（后台执行，不阻塞）
 *
 * @param subject - 学科代码
 */
export function preloadSubject(subject: string): void {
  // 使用 setTimeout 确保不阻塞当前执行
  setTimeout(() => {
    void loadKnowledgePacksBySubject(subject)
    void loadQuestionPacksBySubject(subject)
  }, 0)
}
