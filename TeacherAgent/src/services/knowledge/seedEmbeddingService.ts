/**
 * Seed Embedding Service
 *
 * Orchestrates batch generation of embeddings for all built-in knowledge nodes.
 * Uses the OpenAI-compatible /embeddings endpoint via Rust backend.
 *
 * Model consistency guarantee: the query model always equals the generation
 * model (from EmbeddingProviderConfig.embeddingModel). Before regenerating,
 * stale vectors from any OTHER model are cleaned for the approved entity set.
 */

import type { EmbeddingProviderConfig } from "../../stores/app"
import { loadApprovedKnowledgePacks, loadApprovedQuestionPacks, loadAllKnowledgePacksStrict, loadAllQuestionPacksStrict } from "./packLoader"
import {
  generateEmbedding,
  generateEmbeddingsBatch,
  storeVectorEmbedding,
  countVectorEmbeddings,
  deleteEmbeddingsByModelAndIds,
  type EmbeddingBatchProgress
} from "../tauri/commands"

const ENTITY_TYPE_KNOWLEDGE = "knowledge_node"
const ENTITY_TYPE_QUESTION = "question"
const MAX_TEXT_LENGTH = 8000

/**
 * Known embedding models that may have stale vectors in the DB.
 * When regenerating with a new model, vectors from these models are cleaned
 * for the approved entity set only.
 */
export const KNOWN_EMBEDDING_MODELS = [
  "text-embedding-3-small",
  "text-embedding-3-large",
  "bge-m3",
  "bge-large-zh-v1.5",
  "nomic-embed-text",
  "mxbai-embed-large"
]

export interface EmbeddingModelInventory {
  model: string
  knowledge: number
  questions: number
  total: number
}

export type SeedEmbeddingCoverageState = "empty" | "complete" | "incomplete" | "drift"

export function classifySeedEmbeddingCoverage(
  actualTotal: number,
  expectedTotal: number
): SeedEmbeddingCoverageState {
  if (actualTotal <= 0) return "empty"
  if (expectedTotal > 0 && actualTotal === expectedTotal) return "complete"
  if (expectedTotal > 0 && actualTotal < expectedTotal) return "incomplete"
  return "drift"
}

export interface SeedEmbeddingProgress {
  phase: "loading_nodes" | "cleaning_stale" | "generating" | "storing" | "done"
  current: number
  total: number
  stored: number
  failed: number
  message: string
}

export interface SeedEmbeddingResult {
  stored: number
  failed: number
  totalNodes: number
  cleanedStale: number
}

/**
 * Pre-flight check: test if the embedding endpoint is reachable and supports the model.
 */
export async function preflightEmbeddingCheck(
  embeddingConfig: EmbeddingProviderConfig
): Promise<string | null> {
  if (!embeddingConfig.apiKeyRef || !embeddingConfig.baseUrl) {
    return "Provider API key and base URL are required"
  }
  try {
    await generateEmbedding(
      embeddingConfig.baseUrl,
      embeddingConfig.apiKeyRef,
      embeddingConfig.embeddingModel,
      "test"
    )
    return null // success
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("404") || msg.includes("Not Found")) {
      return "当前 Provider 不支持 Embedding 接口（返回 404）。知识库 keyword 检索仍可正常使用。如使用 OpenAI，请配置支持 /v1/embeddings 的 Base URL 和 embedding 模型；如使用 Ollama，请优先使用 bge-m3 等 embedding 模型。"
    }
    if (msg.includes("401") || msg.includes("Unauthorized")) {
      return "Embedding 接口认证失败（401）。请检查 API Key 是否正确。"
    }
    if (msg.includes("400") || msg.includes("model")) {
      return `Embedding 模型 "${embeddingConfig.embeddingModel}" 不被当前 Provider 支持。请检查模型名称是否正确。`
    }
    return `Embedding 接口预检失败: ${msg}。知识库 keyword 检索仍可正常使用。`
  }
}

/**
 * Generate embeddings for approved built-in knowledge nodes AND questions, store them in DB.
 *
 * Steps:
 * 1. Load ONLY approved knowledge packs to get node IDs and summaries
 * 2. Load ONLY approved question packs to get question IDs and content
 * 3. Clean stale vectors from other models for the approved entity set
 * 4. Build embedding text for each item
 * 5. Call batch embedding API
 * 6. Store each embedding via storeVectorEmbedding
 *
 * 只处理 approved Pack。draft 内容不会被发送给 Provider 或存储向量。
 * 清理限定 entity_type、embedding_model 和 approved manifest 范围，不误删用户私有向量。
 */
export async function generateSeedEmbeddings(
  embeddingConfig: EmbeddingProviderConfig,
  onProgress?: (progress: SeedEmbeddingProgress) => void
): Promise<SeedEmbeddingResult> {
  if (!embeddingConfig.apiKeyRef || !embeddingConfig.baseUrl) {
    throw new Error("Provider API key and base URL are required for embedding generation")
  }

  const model = embeddingConfig.embeddingModel

  // Pre-flight: test embedding endpoint before batch
  const preflightError = await preflightEmbeddingCheck(embeddingConfig)
  if (preflightError) {
    throw new Error(preflightError)
  }

  // Phase 1: Load ONLY approved knowledge nodes and questions
  onProgress?.({
    phase: "loading_nodes",
    current: 0,
    total: 0,
    stored: 0,
    failed: 0,
    message: "正在加载已审核知识库节点和题库..."
  })

  const items: Array<{ id: string; text: string; entityType: string }> = []

  // Load ONLY approved knowledge nodes (fail-closed)
  const packs = await loadApprovedKnowledgePacks()
  for (const pack of packs) {
    for (const node of pack.nodes) {
      const title = node.title ?? ""
      const summary = node.summary ?? ""
      let text = `${title}: ${summary}`
      if (text.length > MAX_TEXT_LENGTH) {
        text = text.slice(0, MAX_TEXT_LENGTH)
      }
      if (text.trim().length > 0) {
        items.push({ id: node.id, text, entityType: ENTITY_TYPE_KNOWLEDGE })
      }
    }
  }

  // Load ONLY approved questions (fail-closed)
  const questionPacks = await loadApprovedQuestionPacks()
  for (const pack of questionPacks) {
    for (const question of pack.questions) {
      const title = question.title ?? ""
      const content = question.content ?? ""
      const answer = question.answer ?? ""
      let text = `${title}: ${content}`
      if (answer) {
        text += ` 答案: ${answer}`
      }
      if (text.length > MAX_TEXT_LENGTH) {
        text = text.slice(0, MAX_TEXT_LENGTH)
      }
      if (text.trim().length > 0) {
        items.push({ id: question.id, text, entityType: ENTITY_TYPE_QUESTION })
      }
    }
  }

  if (items.length === 0) {
    onProgress?.({
      phase: "done",
      current: 0,
      total: 0,
      stored: 0,
      failed: 0,
      message: "没有找到需要生成 Embedding 的知识节点或题目"
    })
    return { stored: 0, failed: 0, totalNodes: 0, cleanedStale: 0 }
  }

  // Phase 2: Clean stale vectors from OTHER models for the approved entity set
  onProgress?.({
    phase: "cleaning_stale",
    current: 0,
    total: items.length,
    stored: 0,
    failed: 0,
    message: "正在清理过期向量..."
  })

  let cleanedStale = 0
  const knowledgeIds = items.filter((i) => i.entityType === ENTITY_TYPE_KNOWLEDGE).map((i) => i.id)
  const questionIds = items.filter((i) => i.entityType === ENTITY_TYPE_QUESTION).map((i) => i.id)

  for (const staleModel of KNOWN_EMBEDDING_MODELS) {
    if (staleModel === model) continue // don't delete current model's vectors
    try {
      if (knowledgeIds.length > 0) {
        cleanedStale += await deleteEmbeddingsByModelAndIds(ENTITY_TYPE_KNOWLEDGE, staleModel, knowledgeIds)
      }
      if (questionIds.length > 0) {
        cleanedStale += await deleteEmbeddingsByModelAndIds(ENTITY_TYPE_QUESTION, staleModel, questionIds)
      }
    } catch {
      // Non-fatal: stale cleanup is best-effort
    }
  }

  // Also converge the CURRENT model's vectors to approved-only:
  // Derive the set of built-in draft entity IDs from the full manifest (strict),
  // then delete only those specific IDs. This preserves custom subject vectors
  // (which are NOT in the built-in manifest) and user private vectors.
  //
  // FAIL-CLOSED: convergence is a mandatory phase. If manifest loading fails,
  // ID validation fails, or deletion fails, the entire operation fails.
  // We must never report "generation complete" while stale draft vectors remain.
  const allKnowledgePacks = await loadAllKnowledgePacksStrict()
  const allKnowledgeIds = new Set<string>()
  for (const pack of allKnowledgePacks) {
    for (const node of pack.nodes) {
      if (allKnowledgeIds.has(node.id)) {
        throw new Error(`向量收敛失败：知识节点 ID 重复 "${node.id}"，manifest 数据异常。请检查知识库 Pack 配置。`)
      }
      allKnowledgeIds.add(node.id)
    }
  }

  const approvedKnowledgeSet = new Set(knowledgeIds)
  const draftKnowledgeIds = [...allKnowledgeIds].filter((id) => !approvedKnowledgeSet.has(id))

  // Integrity check: draft set must not overlap with approved set
  for (const id of draftKnowledgeIds) {
    if (approvedKnowledgeSet.has(id)) {
      throw new Error(`向量收敛失败：draft ID "${id}" 与 approved ID 重叠，数据边界异常。`)
    }
  }

  const allQuestionPacks = await loadAllQuestionPacksStrict()
  const allQuestionIds = new Set<string>()
  for (const pack of allQuestionPacks) {
    for (const q of pack.questions) {
      if (allQuestionIds.has(q.id)) {
        throw new Error(`向量收敛失败：题目 ID 重复 "${q.id}"，manifest 数据异常。请检查题库 Pack 配置。`)
      }
      allQuestionIds.add(q.id)
    }
  }

  const approvedQuestionSet = new Set(questionIds)
  const draftQuestionIds = [...allQuestionIds].filter((id) => !approvedQuestionSet.has(id))

  for (const id of draftQuestionIds) {
    if (approvedQuestionSet.has(id)) {
      throw new Error(`向量收敛失败：draft 题目 ID "${id}" 与 approved ID 重叠，数据边界异常。`)
    }
  }

  if (draftKnowledgeIds.length > 0) {
    cleanedStale += await deleteEmbeddingsByModelAndIds(ENTITY_TYPE_KNOWLEDGE, model, draftKnowledgeIds)
  }
  if (draftQuestionIds.length > 0) {
    cleanedStale += await deleteEmbeddingsByModelAndIds(ENTITY_TYPE_QUESTION, model, draftQuestionIds)
  }

  // Phase 3: Generate embeddings in batch
  onProgress?.({
    phase: "generating",
    current: 0,
    total: items.length,
    stored: 0,
    failed: 0,
    message: `正在生成 Embedding（共 ${items.length} 项：${knowledgeIds.length} 节点 + ${questionIds.length} 题目）...`
  })

  let embeddings: number[][]
  try {
    embeddings = await generateEmbeddingsBatch(
      embeddingConfig.baseUrl,
      embeddingConfig.apiKeyRef,
      model,
      items.map((n) => n.text),
      64,  // batch size
      200, // delay ms
      (progress: EmbeddingBatchProgress) => {
        onProgress?.({
          phase: "generating",
          current: progress.completed,
          total: progress.total,
          stored: 0,
          failed: 0,
          message: `正在生成 Embedding（${progress.completed}/${progress.total}）...`
        })
      }
    )
  } catch (error) {
    throw new Error(`Embedding 生成失败: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (embeddings.length !== items.length) {
    throw new Error(
      `Embedding 数量不匹配: 期望 ${items.length}，实际 ${embeddings.length}`
    )
  }

  // Phase 4: Store embeddings
  onProgress?.({
    phase: "storing",
    current: 0,
    total: items.length,
    stored: 0,
    failed: 0,
    message: "正在存储 Embedding..."
  })

  let stored = 0
  let failed = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const embedding = embeddings[i]

    if (!embedding || embedding.length === 0) {
      failed++
      continue
    }

    try {
      const ok = await storeVectorEmbedding(
        `emb-${item.id}`,
        item.entityType,
        item.id,
        embedding,
        model
      )
      if (ok) {
        stored++
      } else {
        failed++
      }
    } catch {
      failed++
    }

    if ((i + 1) % 50 === 0 || i === items.length - 1) {
      onProgress?.({
        phase: "storing",
        current: i + 1,
        total: items.length,
        stored,
        failed,
        message: `正在存储 Embedding（${i + 1}/${items.length}）...`
      })
    }
  }

  onProgress?.({
    phase: "done",
    current: items.length,
    total: items.length,
    stored,
    failed,
    message: `完成: ${stored} 个已存储，${failed} 个失败，清理过期 ${cleanedStale} 条`
  })

  return { stored, failed, totalNodes: items.length, cleanedStale }
}

/**
 * Get the current embedding count for knowledge nodes.
 */
export async function getKnowledgeEmbeddingCount(
  embeddingModel: string
): Promise<number> {
  try {
    return await countVectorEmbeddings(ENTITY_TYPE_KNOWLEDGE, embeddingModel)
  } catch {
    return 0
  }
}

/**
 * Get the current embedding count for questions.
 */
export async function getQuestionEmbeddingCount(
  embeddingModel: string
): Promise<number> {
  try {
    return await countVectorEmbeddings(ENTITY_TYPE_QUESTION, embeddingModel)
  } catch {
    return 0
  }
}

/**
 * Get total embedding count (knowledge nodes + questions).
 */
export async function getTotalEmbeddingCount(
  embeddingModel: string
): Promise<{ knowledge: number; questions: number; total: number }> {
  const knowledge = await getKnowledgeEmbeddingCount(embeddingModel)
  const questions = await getQuestionEmbeddingCount(embeddingModel)
  return { knowledge, questions, total: knowledge + questions }
}

/**
 * Discover vector models already present in the local DB.
 * The Tauri API currently counts by known model name, so callers may append
 * the persisted/current model to avoid silently overlooking an existing store.
 */
export async function getEmbeddingModelInventory(
  models: readonly string[] = KNOWN_EMBEDDING_MODELS
): Promise<EmbeddingModelInventory[]> {
  const uniqueModels = [...new Set(models.map((model) => model.trim()).filter(Boolean))]
  const inventories = await Promise.all(
    uniqueModels.map(async (model) => ({
      model,
      ...(await getTotalEmbeddingCount(model))
    }))
  )
  return inventories.filter((item) => item.total > 0).sort((a, b) => b.total - a.total)
}
