/**
 * 考试体系 Registry（ExamTaxonomy Registry）
 *
 * 数据驱动：从 data/exam-taxonomy/catalog.json 加载目录，并与
 * PACK_MANIFEST 交叉校验（questionScope 引用的 pack 必须真实存在）。
 *
 * 硬约束：
 * - 只有叶子 SUBJECT / MODULE 可以作为「具体出题范围」与「掌握度范围」；
 * - 父级 EXAM_TRACK 只用于聚合、统计、导航与「综合复习」，不得伪装成具体课程；
 * - 同名课程在不同考试组拥有不同 stableId（如 408.data-structures 与
 *   自命题.xxx.data-structures），不得仅凭中文标题全局混淆；
 * - 用户自定义、未知与模糊科目不得被错误映射（见 resolveByPhoneName）。
 */

import catalog from "../../../data/exam-taxonomy/catalog.json"
import type { ExamCatalogFile, ExamCatalogNode } from "./catalogTypes"
import { getPackById } from "../../services/knowledge/packManifest"

/** 目录数据（静态导入，构建时打包；目录体量小，不需要懒加载） */
export const EXAM_CATALOG: ExamCatalogFile = catalog as ExamCatalogFile

export interface RegistryIssue {
  stableId: string
  message: string
}

export interface RegistryLoadResult {
  ok: boolean
  issues: RegistryIssue[]
}

/** 运行时构建的目录索引 */
let cachedIndex: {
  byId: Map<string, ExamCatalogNode>
  children: Map<string, ExamCatalogNode[]>
  aliasIndex: Map<string, ExamCatalogNode[]>
  legacyCodeIndex: Map<string, ExamCatalogNode[]>
  leaves: ExamCatalogNode[]
} | null = null

function buildIndex() {
  const byId = new Map<string, ExamCatalogNode>()
  const children = new Map<string, ExamCatalogNode[]>()
  const aliasIndex = new Map<string, ExamCatalogNode[]>()
  const legacyCodeIndex = new Map<string, ExamCatalogNode[]>()
  for (const node of EXAM_CATALOG.nodes) {
    byId.set(node.stableId, node)
    const siblings = children.get(node.parentId ?? "") ?? []
    siblings.push(node)
    children.set(node.parentId ?? "", siblings)
    for (const alias of normalizeAliases([node.displayName, node.shortName, ...node.aliases])) {
      const hits = aliasIndex.get(alias) ?? []
      hits.push(node)
      aliasIndex.set(alias, hits)
    }
    if (node.legacySubjectCode) {
      const hits = legacyCodeIndex.get(node.legacySubjectCode) ?? []
      hits.push(node)
      legacyCodeIndex.set(node.legacySubjectCode, hits)
    }
  }
  const leaves = EXAM_CATALOG.nodes.filter((node) => isLeafNode(node, children))
  cachedIndex = { byId, children, aliasIndex, legacyCodeIndex, leaves }
}

function ensureIndex() {
  if (!cachedIndex) buildIndex()
  return cachedIndex!
}

/** 归一化别名：去空白、转小写（用于精确匹配）。 */
export function normalizeAlias(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeAliases(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = normalizeAlias(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

/** 节点是否叶子：没有子节点（或子节点为空）。叶子才可作为出题/掌握度范围。 */
export function isLeafNode(
  node: ExamCatalogNode,
  childrenMap: Map<string, ExamCatalogNode[]> = ensureIndex().children
): boolean {
  const kids = childrenMap.get(node.stableId) ?? []
  return kids.length === 0
}

/** 目录整体校验（含 pack 引用）。测试与启动自检调用。 */
export function validateCatalog(): RegistryLoadResult {
  const issues: RegistryIssue[] = []
  const byId = new Map<string, ExamCatalogNode>()
  for (const node of EXAM_CATALOG.nodes) {
    byId.set(node.stableId, node)
  }

  for (const node of EXAM_CATALOG.nodes) {
    // 1. stableId 唯一性。
    if (byId.has(node.stableId) && byId.get(node.stableId) !== node) {
      issues.push({ stableId: node.stableId, message: "stableId 重复" })
    }
    // 2. 根节点必须没有 parentId；非根节点必须存在父级。
    if (node.parentId === null) {
      if (node.nodeType !== "EXAM_TRACK") {
        issues.push({ stableId: node.stableId, message: "根节点必须是 EXAM_TRACK" })
      }
    } else {
      const parent = byId.get(node.parentId)
      if (!parent) {
        issues.push({ stableId: node.stableId, message: `父级 ${node.parentId} 不存在` })
      } else if (parent.nodeType === "MODULE") {
        issues.push({ stableId: node.stableId, message: `父级 ${node.parentId} 不能是 MODULE（最多三层）` })
      }
    }
    // 3. 父级 EXAM_TRACK 不得作为具体题目归属：其 questionScope 必须为空。
    if (node.nodeType === "EXAM_TRACK" && node.questionScope.length > 0) {
      issues.push({ stableId: node.stableId, message: "EXAM_TRACK 不允许声明 questionScope" })
    }
    // 4. 只有叶子节点可以声明 questionScope；非叶子不得声明。
    const leaf = isLeafNode(node, buildChildrenMap())
    if (!leaf && node.questionScope.length > 0) {
      issues.push({ stableId: node.stableId, message: "非叶子节点不得声明 questionScope" })
    }
    if (leaf && node.nodeType === "EXAM_TRACK") {
      issues.push({ stableId: node.stableId, message: "EXAM_TRACK 不能是叶子出题节点" })
    }
    // 5. 叶子节点必须声明非空 questionScope（否则无题可出）。
    if (leaf && node.nodeType !== "EXAM_TRACK" && node.questionScope.length === 0) {
      issues.push({ stableId: node.stableId, message: "叶子节点缺少 questionScope" })
    }
    // 6. questionScope 引用的 pack 必须存在于 PACK_MANIFEST。
    for (const entry of node.questionScope) {
      for (const packId of entry.packIds) {
        if (!getPackById(packId)) {
          issues.push({ stableId: node.stableId, message: `questionScope 引用了不存在的 pack: ${packId}` })
        }
      }
    }
    // 6.5 叶子状态与 Pack Manifest 状态一致性（防漂移）：
    // 叶子 approved 时其 questionScope 的 pack 必须是 approved（运行时门禁会拒绝不一致，
    // 此处提前暴露维护问题）；叶子 draft 时 pack 必须不是 approved（未审核叶子不得包装已审核包）。
    for (const entry of node.questionScope) {
      for (const packId of entry.packIds) {
        const pack = getPackById(packId)
        if (!pack) continue
        if (node.status === "approved" && pack.status !== "approved") {
          issues.push({
            stableId: node.stableId,
            message: `叶子状态 approved 但 pack ${packId} 状态为 ${pack.status}，状态不一致`
          })
        }
        if (node.status === "draft" && pack.status === "approved") {
          issues.push({
            stableId: node.stableId,
            message: `叶子状态 draft 但 pack ${packId} 状态为 approved，状态不一致（未审核叶子不得包装已审核包）`
          })
        }
      }
    }
    // 7. legacySubjectCode 必须在索引中可解析（允许与其他节点共享同码，如 cs408 四个子科目）。
    if (node.legacySubjectCode && node.legacySubjectCode.length === 0) {
      issues.push({ stableId: node.stableId, message: "legacySubjectCode 不能为空字符串" })
    }
  }

  return { ok: issues.length === 0, issues }
}

function buildChildrenMap(): Map<string, ExamCatalogNode[]> {
  return ensureIndex().children
}

// ── 查询 API ─────────────────────────────────────────────────────────────

/** 按 stableId 获取节点。 */
export function getExamNode(stableId: string): ExamCatalogNode | null {
  return ensureIndex().byId.get(stableId) ?? null
}

/** 获取某节点的直接子节点（按目录顺序）。 */
export function getExamChildren(stableId: string): ExamCatalogNode[] {
  return ensureIndex().children.get(stableId) ?? []
}

/** 获取全部考试组（根节点）。 */
export function getExamTracks(): ExamCatalogNode[] {
  return ensureIndex().children.get("") ?? []
}

/** 获取全部叶子节点（可出题范围）。 */
export function getExamLeaves(): ExamCatalogNode[] {
  return ensureIndex().leaves
}

/** 获取从根到该节点的祖先链（含自身，根在前）。 */
export function getExamPath(stableId: string): ExamCatalogNode[] {
  const path: ExamCatalogNode[] = []
  let current = getExamNode(stableId)
  while (current) {
    path.unshift(current)
    current = current.parentId ? getExamNode(current.parentId) : null
  }
  return path
}

/** 获取某节点的全部叶子后代（聚合统计用；节点自身是叶子时返回自身）。 */
export function getDescendantLeaves(stableId: string): ExamCatalogNode[] {
  const node = getExamNode(stableId)
  if (!node) return []
  if (isLeafNode(node)) return [node]
  return getExamLeaves().filter((leaf) => {
    const path = getExamPath(leaf.stableId)
    return path.some((ancestor) => ancestor.stableId === stableId)
  })
}

/** 节点是否可以作为具体出题范围（叶子 SUBJECT/MODULE）。 */
export function isQuestionScopeNode(stableId: string): boolean {
  const node = getExamNode(stableId)
  if (!node) return false
  return isLeafNode(node) && node.nodeType !== "EXAM_TRACK"
}

/** 获取叶子节点的可出题 pack id 集合（仅 approved 时由调用方过滤）。 */
export function getLeafPackIds(stableId: string): string[] {
  const node = getExamNode(stableId)
  if (!node || !isQuestionScopeNode(stableId)) return []
  return node.questionScope.flatMap((entry) => entry.packIds)
}

/**
 * 按手机端科目名解析到考试体系叶子。
 *
 * 解析规则（用户映射表优先，别名匹配为补充，均在调用方处显式确认）：
 * - 返回多个候选（同名歧义）时不得自动选择，调用方必须进入「待用户确认」；
 * - 完全未命中返回 null（调用方标记 unresolved）；
 * - 命中 EXAM_TRACK（如「408」）或非叶子节点时返回该节点，调用方必须要求用户
 *   选择子科目或进入显式综合模式，不得把父级伪装成具体课程。
 */
export function resolveByPhoneName(name: string): ExamCatalogNode[] {
  const normalized = normalizeAlias(name)
  if (!normalized) return []
  return ensureIndex().aliasIndex.get(normalized) ?? []
}

/** 按旧平面学科代码解析（如 "cs408" → 408 的四个子科目叶子）。 */
export function resolveByLegacyCode(legacyCode: string): ExamCatalogNode[] {
  return ensureIndex().legacyCodeIndex.get(legacyCode) ?? []
}

/** 按旧平面学科代码找到唯一考试组（如 "cs408" → 408）。 */
export function getTrackByLegacyCode(legacyCode: string): ExamCatalogNode | null {
  const nodes = resolveByLegacyCode(legacyCode)
  return nodes.find((node) => node.nodeType === "EXAM_TRACK") ?? null
}

/** 叶子节点中文展示路径：考试组 / 子科目 / 模块。 */
export function formatExamPath(stableId: string): string {
  const path = getExamPath(stableId)
  if (path.length === 0) return ""
  return path.map((node) => node.displayName).join(" / ")
}

/** 考试组展示名（含考试代码时拼接，如 "408 · 计算机学科专业基础"）。 */
export function formatTrackLabel(track: ExamCatalogNode): string {
  return track.code ? `${track.code} · ${track.displayName}` : track.displayName
}
