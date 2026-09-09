/**
 * 题目归属与范围校验（Question Scope Attribution & Validation）
 *
 * 检索链（硬约束）：
 * 1. 先按 approved 状态过滤（白名单式：PACK_MANIFEST.status === "approved" 才允许出题，
 *    不依赖 seed JSON 的黑名单判断，防止目录状态与 Manifest 漂移）；
 * 2. 再按 examTrackId / subjectId / moduleId 过滤（Pack → 叶子节点归属，必须匹配请求叶子）；
 * 3. 最后按知识点、掌握度和今日计划排序（由 questionRecommender / 调用方完成）。
 *
 * 出题门禁（运行时硬校验，三者缺一不可）：
 * - PACK_MANIFEST.status === "approved"（Manifest 是权威源）；
 * - 叶子节点.status === "approved"（catalog 权威）；
 * - 题目归属于当前请求的叶子节点（attribution.subjectId === filter.subjectId）。
 *
 * 任何不满足具体叶子 subjectId 的题目必须被拒绝（fail-closed）。
 * 不允许仅有「考试组」标签（如只有 408）的题目绕过筛选进入结果；
 * 不允许跨考试组、跨具体科目混入题目。
 */

import { getExamLeaves, getExamNode, getExamPath, getLeafPackIds, isQuestionScopeNode } from "./registry"
import { getPackById } from "../../services/knowledge/packManifest"
import type { ExamCatalogNode } from "./catalogTypes"
import type { QuestionAttribution, ExamScopeFilter } from "../../types/examTaxonomy"
import type { QuestionSeed, QuestionSeedItem } from "../../services/knowledge/packLoader"
import { loadKnowledgePacksByIdsStrict } from "../../services/knowledge/packLoader"

export type { ExamScopeFilter, QuestionAttribution }

/**
 * Pack 级 approved 门禁（白名单式）：只有 PACK_MANIFEST.status === "approved" 才允许出题。
 * 不依赖 seed JSON 的 status 字段（防止目录/seed 与 Manifest 状态漂移导致
 * review/pending 等未知状态内容进入出题链路）。
 */
export function isPackApproved(packId: string): boolean {
  return getPackById(packId)?.status === "approved"
}

/**
 * 叶子的 moduleId 推导：
 * 叶子本身是 MODULE 时返回自身 stableId；叶子是 SUBJECT 时返回 null。
 * 不会把父级 Subject 错误赋值为 moduleId（三层路径 EXAM_TRACK → SUBJECT → MODULE
 * 时，path[path.length-2] 是父级 SUBJECT，不得用作 moduleId）。
 */
export function deriveModuleId(leaf: ExamCatalogNode, path: ExamCatalogNode[]): string | null {
  if (leaf.nodeType === "MODULE") return leaf.stableId
  return null
}

/**
 * 由 pack 推导叶子归属：在目录中查找声明了该 pack 的叶子节点。
 * 同一 pack 出现在多个叶子（多考试组共用题源）时返回全部，调用方按请求范围过滤。
 */
export function attributionsForPack(packId: string): QuestionAttribution[] {
  const result: QuestionAttribution[] = []
  for (const leafId of allLeafIds()) {
    if (getLeafPackIds(leafId).includes(packId)) {
      const path = getExamPath(leafId)
      const leaf = getExamNode(leafId)!
      result.push({
        examTrackId: path[0]?.stableId ?? null,
        subjectId: leafId,
        moduleId: deriveModuleId(leaf, path),
        packId,
        // 叶子 approved 且 pack（Manifest 权威）approved 才允许出题。
        leafApproved: leaf.status === "approved" && isPackApproved(packId)
      })
    }
  }
  return result
}

function allLeafIds(): string[] {
  // 直接遍历目录，避免 registry 缓存状态依赖。
  return listLeafIds()
}

function listLeafIds(): string[] {
  return getExamLeaves().map((node) => node.stableId)
}

/**
 * 判断 pack 是否在请求范围内（叶子归属等于请求的 subjectId）。
 * subjectId 为 null 时视为未限定（调用方应显式拒绝父级范围）。
 */
export function isPackInScope(packId: string, filter: ExamScopeFilter): boolean {
  if (!filter.subjectId) return false
  const attributions = attributionsForPack(packId)
  return attributions.some((attr) => attr.subjectId === filter.subjectId)
}

/** 是否允许该叶子出题：叶子 approved + 其 questionScope 的 pack 全部 approved。 */
export function isLeafApprovedForQuestions(stableId: string): boolean {
  const node = getExamNode(stableId)
  if (!node) return false
  if (node.status !== "approved") return false
  const packIds = getLeafPackIds(stableId)
  return packIds.length > 0 && packIds.every((packId) => isPackApproved(packId))
}

/**
 * 收集 approved 考试叶子对应的知识点白名单。
 *
 * 诊断/薄弱点查询必须把该白名单传给 Rust，不能因为范围没有知识点而退回
 * teacherSubjectId 全学科查询。任一范围不合法或 approved pack 加载失败均返回空，
 * 由调用方按空范围 fail-closed。
 */
export async function collectApprovedKnowledgeNodeIdsForScope(scope: {
  examTrackId?: string | null
  subjectId: string | null
  moduleId?: string | null
}): Promise<string[]> {
  const leafId = scope.moduleId ?? scope.subjectId
  if (!leafId || !isQuestionScopeNode(leafId) || !isLeafApprovedForQuestions(leafId)) return []

  const path = getExamPath(leafId)
  if (scope.examTrackId && path[0]?.stableId !== scope.examTrackId) return []
  if (scope.subjectId && !path.some((node) => node.stableId === scope.subjectId)) return []

  const packIds = [...new Set(getLeafPackIds(leafId).filter((packId) => isPackApproved(packId)))]
  if (packIds.length === 0) return []

  try {
    const seeds = await loadKnowledgePacksByIdsStrict(packIds)
    return [...new Set(seeds.flatMap((seed) => seed.nodes.map((node) => node.id)))].sort()
  } catch {
    return []
  }
}

/**
 * 题目结构化校验：题目（及其 pack）的归属必须等于请求的叶子范围。
 * 返回 ok=false 时调用方必须拒绝该题（fail-closed），不允许进入结果。
 */
export function validateQuestionScope(
  packId: string,
  question: QuestionSeedItem,
  filter: ExamScopeFilter
): { ok: boolean; attribution: QuestionAttribution | null; reason: string } {
  if (!filter.subjectId) {
    return { ok: false, attribution: null, reason: "请求范围缺少具体叶子 subjectId，拒绝出题" }
  }
  // 门禁 1：PACK_MANIFEST approved 白名单（权威源，防状态漂移）。
  if (!isPackApproved(packId)) {
    return {
      ok: false,
      attribution: null,
      reason: `题目 pack「${packId}」不是 approved（Manifest 状态非 approved），拒绝出题`
    }
  }
  const attributions = attributionsForPack(packId)
  // 门禁 3：归属必须匹配当前请求的叶子（共享 pack 场景下取匹配项，而非任意第一条）。
  const match = attributions.find((attr) => attr.subjectId === filter.subjectId)
  if (!match) {
    return {
      ok: false,
      attribution: null,
      reason: `题目 pack「${packId}」不属于请求的叶子「${filter.subjectId}」，拒绝跨科目混入`
    }
  }
  // 门禁 2：叶子 approved（attributionsForPack 已并入 pack 白名单校验）。
  if (!match.leafApproved) {
    return {
      ok: false,
      attribution: match,
      reason: `叶子「${filter.subjectId}」不是 approved（题库待审核），拒绝出题`
    }
  }
  return { ok: true, attribution: match, reason: "" }
}

/**
 * 给题目标注归属（在 QuestionSeedItem 上追加推导字段）。
 * 必须传入当前请求范围匹配到的 [attribution]——共享 Pack 被多个考试组/子科目复用时，
 * 只有匹配的归属才是用户实际选择的科目；不得取 attributionsForPack 的第一条。
 */
export function attributedQuestion(
  packId: string,
  question: QuestionSeedItem,
  attribution: QuestionAttribution
): QuestionSeedItem & QuestionAttribution {
  return {
    ...question,
    examTrackId: attribution.examTrackId,
    subjectId: attribution.subjectId,
    moduleId: attribution.moduleId,
    packId,
    leafApproved: attribution.leafApproved
  }
}

/**
 * 按叶子范围加载并校验题目集合（approved 白名单 + 归属匹配校验）。
 * 返回 { questions, rejected }：被拒绝的题目必须被明确统计，不能静默丢失。
 */
export function filterSeedsToScope(
  seeds: QuestionSeed[],
  filter: ExamScopeFilter
): { questions: Array<QuestionSeedItem & QuestionAttribution>; rejected: string[] } {
  const questions: Array<QuestionSeedItem & QuestionAttribution> = []
  const rejected: string[] = []
  for (const seed of seeds) {
    const packId = seed.__packId ?? ""
    // 硬约束 1：PACK_MANIFEST approved 白名单（不依赖 seed.status 黑名单）。
    if (!isPackApproved(packId)) continue
    for (const question of seed.questions) {
      const check = validateQuestionScope(packId, question, filter)
      if (!check.ok || !check.attribution) {
        rejected.push(`${question.id}: ${check.reason}`)
        continue
      }
      questions.push(attributedQuestion(packId, question, check.attribution))
    }
  }
  return { questions, rejected }
}
