import type { EmbeddingProviderConfig } from "../../stores/app"
import {
  generateEmbedding,
  searchVectorEmbeddings,
  storeVectorEmbedding,
  type VectorSearchResult
} from "../tauri/commands"

const ENTITY_TYPE_KNOWLEDGE = "knowledge_node"
const ENTITY_TYPE_QUESTION = "question"

export interface VectorSearchOptions {
  embeddingConfig: EmbeddingProviderConfig
  limit?: number
  /**
   * When provided, only entity IDs in this set are returned.
   * The search over-fetches (limit * 3) then filters, ensuring draft/custom
   * vectors never occupy approved TopK slots.
   */
  approvedEntityIds?: Set<string>
}

export interface VectorSearchWithProvenance {
  results: VectorSearchResult[]
  embeddingModel: string
  topScore: number | undefined
}

/**
 * Search for similar knowledge nodes using vector similarity.
 * Falls back to empty results if embedding generation fails.
 *
 * The query embedding is generated with the SAME model that was used to
 * generate the stored vectors (from embeddingConfig.embeddingModel).
 * This guarantees vector space consistency — never reuse a chat model or
 * hardcode a different embedding model.
 */
export async function searchKnowledgeByVector(
  query: string,
  options: VectorSearchOptions
): Promise<VectorSearchWithProvenance> {
  const { embeddingConfig, limit = 10, approvedEntityIds } = options
  const model = embeddingConfig.embeddingModel

  if (!embeddingConfig.apiKeyRef || !embeddingConfig.baseUrl) {
    return { results: [], embeddingModel: model, topScore: undefined }
  }

  try {
    const queryEmbedding = await generateEmbedding(
      embeddingConfig.baseUrl,
      embeddingConfig.apiKeyRef,
      model,
      query
    )

    if (!queryEmbedding.length) {
      return { results: [], embeddingModel: model, topScore: undefined }
    }

    // Pass approved entity IDs to the backend for SQL-level filtering BEFORE
    // cosine computation and truncation. This prevents draft vectors from
    // starving approved results in TopK (critical when draft:approved ratio is 17:1).
    const entityIdArray = approvedEntityIds ? [...approvedEntityIds] : undefined
    const results = await searchVectorEmbeddings(
      ENTITY_TYPE_KNOWLEDGE,
      queryEmbedding,
      model,
      limit,
      entityIdArray
    )

    return {
      results,
      embeddingModel: model,
      topScore: results.length > 0 ? results[0].score : undefined
    }
  } catch (error) {
    console.warn("[TeacherAgent] vector search failed, falling back:", error)
    return { results: [], embeddingModel: model, topScore: undefined }
  }
}

/**
 * Search for similar questions using vector similarity.
 * Falls back to empty results if embedding generation fails.
 */
export async function searchQuestionByVector(
  query: string,
  options: VectorSearchOptions
): Promise<VectorSearchWithProvenance> {
  const { embeddingConfig, limit = 10, approvedEntityIds } = options
  const model = embeddingConfig.embeddingModel

  if (!embeddingConfig.apiKeyRef || !embeddingConfig.baseUrl) {
    return { results: [], embeddingModel: model, topScore: undefined }
  }

  try {
    const queryEmbedding = await generateEmbedding(
      embeddingConfig.baseUrl,
      embeddingConfig.apiKeyRef,
      model,
      query
    )

    if (!queryEmbedding.length) {
      return { results: [], embeddingModel: model, topScore: undefined }
    }

    // SQL-level filtering before truncation (same as knowledge search)
    const entityIdArray = approvedEntityIds ? [...approvedEntityIds] : undefined
    const results = await searchVectorEmbeddings(
      ENTITY_TYPE_QUESTION,
      queryEmbedding,
      model,
      limit,
      entityIdArray
    )

    return {
      results,
      embeddingModel: model,
      topScore: results.length > 0 ? results[0].score : undefined
    }
  } catch (error) {
    console.warn("[TeacherAgent] question vector search failed, falling back:", error)
    return { results: [], embeddingModel: model, topScore: undefined }
  }
}

/**
 * Store an embedding for a knowledge node.
 */
export async function storeKnowledgeEmbedding(
  nodeId: string,
  text: string,
  embeddingConfig: EmbeddingProviderConfig
): Promise<boolean> {
  if (!embeddingConfig.apiKeyRef || !embeddingConfig.baseUrl) {
    return false
  }

  try {
    const embedding = await generateEmbedding(
      embeddingConfig.baseUrl,
      embeddingConfig.apiKeyRef,
      embeddingConfig.embeddingModel,
      text
    )

    if (!embedding.length) {
      return false
    }

    return await storeVectorEmbedding(
      `emb-${nodeId}`,
      ENTITY_TYPE_KNOWLEDGE,
      nodeId,
      embedding,
      embeddingConfig.embeddingModel
    )
  } catch (error) {
    console.warn(`[TeacherAgent] failed to store embedding for ${nodeId}:`, error)
    return false
  }
}

/**
 * Batch store embeddings for multiple knowledge nodes.
 * Processes sequentially to avoid rate limiting.
 */
export async function batchStoreKnowledgeEmbeddings(
  nodes: Array<{ id: string; text: string }>,
  embeddingConfig: EmbeddingProviderConfig,
  onProgress?: (current: number, total: number) => void
): Promise<{ stored: number; failed: number }> {
  let stored = 0
  let failed = 0

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const ok = await storeKnowledgeEmbedding(node.id, node.text, embeddingConfig)
    if (ok) {
      stored++
    } else {
      failed++
    }
    onProgress?.(i + 1, nodes.length)
  }

  return { stored, failed }
}

