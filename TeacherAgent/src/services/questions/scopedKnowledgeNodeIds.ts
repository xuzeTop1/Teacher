import type { ExamScopeFilter } from "../../types/examTaxonomy"
import { getLeafPackIds } from "../../engine/examTaxonomy/registry"
import { filterSeedsToScope } from "../../engine/examTaxonomy/questionScope"
import {
  loadQuestionPacksByIdsStrict,
  type QuestionSeed
} from "../knowledge/packLoader"

/**
 * 从已经加载的题库中收集当前叶子的知识点。
 *
 * filterSeedsToScope 是唯一门禁：Manifest approved、叶子 approved 与 attribution
 * 必须全部通过。调用方不得直接信任 seed.status 或未校验的题目字段。
 */
export function collectApprovedKnowledgeNodeIdsFromSeeds(
  seeds: QuestionSeed[],
  examScope: ExamScopeFilter
): string[] {
  const { questions } = filterSeedsToScope(seeds, examScope)
  const seen = new Set<string>()
  const knowledgeNodeIds: string[] = []

  for (const question of questions) {
    for (const rawId of question.knowledgeNodeIds) {
      const id = rawId.trim()
      if (id && !seen.has(id)) {
        seen.add(id)
        knowledgeNodeIds.push(id)
      }
    }
  }

  return knowledgeNodeIds
}

/**
 * 收集当前考试叶子全部合规题目的唯一 knowledgeNodeIds。
 *
 * 使用严格加载：任一声明 pack 加载或 status 契约失败时整体 reject，避免用部分题库
 * 生成看似完整的掌握度白名单。显式空数组表示该叶子没有合规知识点。
 */
export async function collectApprovedKnowledgeNodeIdsForScope(
  examScope: ExamScopeFilter
): Promise<string[]> {
  if (!examScope.subjectId) return []
  const packIds = getLeafPackIds(examScope.subjectId)
  if (packIds.length === 0) return []
  const seeds = await loadQuestionPacksByIdsStrict(packIds)
  return collectApprovedKnowledgeNodeIdsFromSeeds(seeds, examScope)
}
