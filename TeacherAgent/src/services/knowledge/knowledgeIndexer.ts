/**
 * Knowledge Indexer — 将 JSON seed 数据入库到 SQLite knowledge_nodes 表
 *
 * approved/draft 隔离契约：
 * - 默认 Seed 通过 syncApprovedManifest 执行（后端内置 registry，不可被调用方篡改）
 * - draft 入库必须通过显式 seedDraftKnowledgeNodes 维护入口
 * - 普通 JSON seed command 只能 InsertOnly
 */

import {
  seedKnowledgeNodesFromJson,
  syncApprovedManifest,
  countKnowledgeNodes,
  searchKnowledgeFromDb,
  type KnowledgeNodeSearchResult,
  type SeedResult
} from "../tauri/commands"
import {
  loadKnowledgePacksBySubject,
  type KnowledgeSeed
} from "./packLoader"

export interface IndexerStatus {
  subjectCounts: Record<string, number>
  totalNodes: number
  seeded: boolean
}

/**
 * Seed approved knowledge nodes into SQLite.
 *
 * Uses syncApprovedManifest: the backend loads the approved manifest from
 * its built-in registry, validates all IDs, and repairs review_status
 * and subject_id in a transaction. The frontend does NOT provide node IDs.
 */
export async function seedAllKnowledgeNodes(): Promise<SeedResult> {
  return syncApprovedManifest()
}

/**
 * Seed knowledge nodes for a specific subject into SQLite.
 * Uses InsertOnly mode: never modifies existing nodes.
 *
 * 注意：此函数按学科加载所有 pack（含 draft），用于学科级维护。
 * 启动默认 Seed 应使用 seedAllKnowledgeNodes。
 */
export async function seedKnowledgeNodesBySubject(subject: string): Promise<SeedResult[]> {
  const results: SeedResult[] = []

  // Get expected count for this subject
  const { getPacksBySubject } = await import("./packManifest")
  const subjectPacks = getPacksBySubject(subject)
  const expectedCount = subjectPacks.reduce((sum, pack) => sum + pack.expectedNodeCount, 0)

  // Check if already seeded
  if (expectedCount > 0) {
    try {
      const currentCount = await countKnowledgeNodes(subject)
      if (currentCount >= expectedCount) {
        return results
      }
    } catch {
      // Count failed, proceed with seeding
    }
  }

  const knowledgeSeeds = await loadKnowledgePacksBySubject(subject)

  for (const seed of knowledgeSeeds) {
    try {
      const result = await seedKnowledgeNodesFromJson(JSON.stringify(seed))
      results.push(result)
    } catch (error) {
      results.push({
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: [`${subject}: ${error instanceof Error ? error.message : String(error)}`]
      })
    }
  }

  return results
}

/**
 * Explicit maintenance entry: seed draft knowledge nodes for a specific subject.
 *
 * 此函数是显式维护入口，不会被普通启动或"正式内容同步"默认触发。
 * Uses InsertOnly mode: never modifies existing nodes.
 *
 * @param subject - 学科代码
 */
export async function seedDraftKnowledgeNodes(subject: string): Promise<SeedResult[]> {
  const results: SeedResult[] = []

  const knowledgeSeeds = await loadKnowledgePacksBySubject(subject)
  const draftSeeds = knowledgeSeeds.filter((s) => s.status === "draft")

  for (const seed of draftSeeds) {
    try {
      const result = await seedKnowledgeNodesFromJson(JSON.stringify(seed))
      results.push(result)
    } catch (error) {
      results.push({
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: [`${seed.subject ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`]
      })
    }
  }

  return results
}

/**
 * Get current knowledge node counts per subject.
 */
export async function getKnowledgeIndexStatus(): Promise<IndexerStatus> {
  const subjects = ["math", "english", "law", "accounting", "programming", "cs408", "physics"]
  const subjectCounts: Record<string, number> = {}
  let totalNodes = 0

  for (const subject of subjects) {
    try {
      const count = await countKnowledgeNodes(subject)
      subjectCounts[subject] = count
      totalNodes += count
    } catch {
      subjectCounts[subject] = 0
    }
  }

  return { subjectCounts, totalNodes, seeded: totalNodes > 0 }
}

/**
 * Search knowledge nodes from SQLite database.
 */
export async function searchKnowledgeFromDatabase(
  subjectCode: string,
  query: string,
  limit = 5
): Promise<KnowledgeNodeSearchResult[]> {
  try {
    return await searchKnowledgeFromDb(subjectCode, query, limit)
  } catch (error) {
    console.warn("[TeacherAgent] database knowledge search failed:", error)
    return []
  }
}
