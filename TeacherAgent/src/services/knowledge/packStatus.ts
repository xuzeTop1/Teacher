/**
 * Pack Status — 知识库 Pack 状态统计服务
 *
 * 提供 Pack 汇总、DB 对比、orphan 检测等功能，用于设置页的知识库管理面板。
 *
 * approved/draft 隔离：
 * - 正式健康检查只看 approved Pack / approved 节点
 * - Catalog 校验可验证全部 Pack 的 JSON 结构和一致性
 * - draft 节点在 DB 中是正常状态，不是健康错误
 */

import {
  getApprovedExpectedNodeCount,
  getApprovedExpectedQuestionCount,
  getDraftExpectedNodeCount,
  getDraftExpectedQuestionCount,
  getTotalExpectedNodeCount,
  getTotalExpectedQuestionCount,
  PACK_MANIFEST,
  getPacksBySubject
} from "./packManifest"
import {
  countManifestNodes,
  knowledgeHealthCheck,
  type HealthCheckResult
} from "../tauri/commands"
import { loadApprovedKnowledgePacks, loadAllKnowledgePacksStrict } from "./packLoader"

// Re-export for consumers
export type { HealthCheckResult } from "../tauri/commands"

// ── 类型定义 ──────────────────────────────────────────────────────────────

export interface PackSummary {
  subject: string
  packCount: number
  expectedNodeCount: number
  expectedQuestionCount: number
}

export interface PackListItem {
  id: string
  subject: string
  chapter: string
  expectedNodeCount: number
  expectedQuestionCount: number
  status: "approved" | "draft"
}

export interface SubjectDatabaseStatus {
  subject: string
  expectedNodes: number
  actualNodes: number
  status: "ok" | "warning" | "error"
  message: string
}

export interface PackDatabaseComparison {
  subjects: SubjectDatabaseStatus[]
  totalExpected: number
  totalActual: number
  orphanCheck: "not_applicable"
  dbSubjectCounts: Record<string, number>
  overallStatus: "ok" | "warning" | "error"
  /** Per-subject matched counts from Rust (manifest-ID scoped). */
  matchedCountsBySubject: Record<string, number>
}

export interface CatalogStatistics {
  /** 总 pack 数 */
  totalPacks: number
  /** approved pack 数 */
  approvedPacks: number
  /** draft pack 数 */
  draftPacks: number
  /** 总知识节点数 */
  totalNodes: number
  /** approved 知识节点数 */
  approvedNodes: number
  /** draft 知识节点数 */
  draftNodes: number
  /** 总题目数 */
  totalQuestions: number
  /** approved 题目数 */
  approvedQuestions: number
  /** draft 题目数 */
  draftQuestions: number
}

// ── 统计函数 ──────────────────────────────────────────────────────────────

/**
 * 获取 catalog 双口径统计：approved 正式可检索量 + draft 待审核量
 */
export function getCatalogStatistics(): CatalogStatistics {
  const approvedPacks = PACK_MANIFEST.filter((p) => p.status === "approved").length
  const draftPacks = PACK_MANIFEST.filter((p) => p.status === "draft").length

  return {
    totalPacks: PACK_MANIFEST.length,
    approvedPacks,
    draftPacks,
    totalNodes: getTotalExpectedNodeCount(),
    approvedNodes: getApprovedExpectedNodeCount(),
    draftNodes: getDraftExpectedNodeCount(),
    totalQuestions: getTotalExpectedQuestionCount(),
    approvedQuestions: getApprovedExpectedQuestionCount(),
    draftQuestions: getDraftExpectedQuestionCount()
  }
}

/**
 * 按 subject 汇总 pack 数、节点数、题目数（仅 approved）
 */
export function getApprovedPackSubjectSummary(): PackSummary[] {
  const subjectMap = new Map<string, PackSummary>()

  for (const pack of PACK_MANIFEST.filter((p) => p.status === "approved")) {
    const existing = subjectMap.get(pack.subject)
    if (existing) {
      existing.packCount++
      existing.expectedNodeCount += pack.expectedNodeCount
      existing.expectedQuestionCount += pack.expectedQuestionCount
    } else {
      subjectMap.set(pack.subject, {
        subject: pack.subject,
        packCount: 1,
        expectedNodeCount: pack.expectedNodeCount,
        expectedQuestionCount: pack.expectedQuestionCount
      })
    }
  }

  return Array.from(subjectMap.values())
}

/**
 * 按 subject 汇总全部 pack 数、节点数、题目数（含 draft）
 */
export function getPackSubjectSummary(): PackSummary[] {
  const subjectMap = new Map<string, PackSummary>()

  for (const pack of PACK_MANIFEST) {
    const existing = subjectMap.get(pack.subject)
    if (existing) {
      existing.packCount++
      existing.expectedNodeCount += pack.expectedNodeCount
      existing.expectedQuestionCount += pack.expectedQuestionCount
    } else {
      subjectMap.set(pack.subject, {
        subject: pack.subject,
        packCount: 1,
        expectedNodeCount: pack.expectedNodeCount,
        expectedQuestionCount: pack.expectedQuestionCount
      })
    }
  }

  return Array.from(subjectMap.values())
}

/**
 * 返回每个 pack 的详细信息列表
 */
export function getPackList(): PackListItem[] {
  return PACK_MANIFEST.map((pack) => ({
    id: pack.id,
    subject: pack.subject,
    chapter: pack.chapter,
    expectedNodeCount: pack.expectedNodeCount,
    expectedQuestionCount: pack.expectedQuestionCount,
    status: pack.status
  }))
}

/**
 * 比较 approved manifest expectedNodeCount 与 DB 实际节点数。
 *
 * 使用 count_manifest_nodes 按 manifest ID 级精确统计：
 * totalActual = 同时满足 ID 存在 + review_status=approved + subject_id 正确 的行数。
 * 同一 subject 的额外 approved 旧节点不补足缺失 manifest 节点。
 *
 * - ok: totalActual >= totalExpected（每个 manifest 节点都匹配）
 * - warning: 有 manifest 节点未匹配
 * - error: 有 manifest 节点完全缺失
 */
export async function compareManifestWithDatabase(): Promise<PackDatabaseComparison> {
  const summaries = getApprovedPackSubjectSummary()

  // Build manifest node ID + subject lists from approved packs
  const packs = await loadApprovedKnowledgePacks()
  const manifestNodeIds: string[] = []
  const manifestSubjectIds: string[] = []
  for (const pack of packs) {
    const subjectId = `subject-${pack.subject}`
    for (const node of pack.nodes) {
      manifestNodeIds.push(node.id)
      manifestSubjectIds.push(subjectId)
    }
  }

  // Use manifest-ID-scoped count — fail-closed on error
  const result = await countManifestNodes(manifestNodeIds, manifestSubjectIds)

  // Use matched_counts_by_subject directly from Rust (no frontend re-derivation)
  const dbSubjectCounts = result.matchedCountsBySubject

  const subjects: SubjectDatabaseStatus[] = summaries.map((summary) => {
    const actual = dbSubjectCounts[summary.subject] ?? 0
    const expected = summary.expectedNodeCount

    if (actual === expected) {
      return {
        subject: summary.subject,
        expectedNodes: expected,
        actualNodes: actual,
        status: "ok",
        message: "节点数匹配"
      }
    }

    if (actual > expected) {
      return {
        subject: summary.subject,
        expectedNodes: expected,
        actualNodes: actual,
        status: "warning",
        message: `DB 有 ${actual} 个正式节点，多于正式预期 ${expected}`
      }
    }

    // actual < expected
    return {
      subject: summary.subject,
      expectedNodes: expected,
      actualNodes: actual,
      status: actual === 0 ? "error" : "warning",
      message: actual === 0
        ? `DB 无正式节点，正式预期 ${expected}（未 seed）`
        : `DB 有 ${actual} 个正式节点，少于正式预期 ${expected}`
    }
  })

  const totalExpected = summaries.reduce((s, r) => s + r.expectedNodeCount, 0)

  // overallStatus: must check both per-subject and total
  const hasError = subjects.some((s) => s.status === "error") || result.matchedCount === 0
  const hasWarning = subjects.some((s) => s.status === "warning") || result.missingIds.length > 0
  const overallStatus = hasError ? "error" : hasWarning ? "warning" : "ok"

  return {
    subjects,
    totalExpected,
    totalActual: result.matchedCount,
    orphanCheck: "not_applicable",
    dbSubjectCounts,
    overallStatus,
    matchedCountsBySubject: result.matchedCountsBySubject
  }
}

// ── 健康检查 ──────────────────────────────────────────────────────────────

/**
 * 正式运行健康检查：只检查 approved Pack 的节点。
 *
 * 预期只包含 approved Pack / approved 节点。
 * DB 实际值只统计对应 approved manifest 节点。
 * 已存在的 draft 节点不被当作正式缺失或正式孤立。
 * fresh DB 执行默认 Seed 后必须显示健康、missing=0。
 */
export async function runApprovedHealthCheck(): Promise<HealthCheckResult> {
  const packs = await loadApprovedKnowledgePacks()

  const manifestNodeIds: string[] = []
  const manifestSubjectIds: string[] = []

  for (const pack of packs) {
    const subjectId = `subject-${pack.subject}`
    for (const node of pack.nodes) {
      manifestNodeIds.push(node.id)
      manifestSubjectIds.push(subjectId)
    }
  }

  return knowledgeHealthCheck(manifestNodeIds, manifestSubjectIds, "approved_builtin")
}

/**
 * 全 Catalog 健康检查：加载所有 pack seed，提取 nodeId → subject 映射，
 * 与 DB 比对，返回 missing / orphan / subject mismatch 详情。
 *
 * 使用严格加载：任何一个 pack 加载失败则 reject，避免部分 manifest 导致误判。
 * 用于 Catalog 校验，不用于正式运行健康检查。
 */
export async function runKnowledgeHealthCheck(): Promise<HealthCheckResult> {
  const packs = await loadAllKnowledgePacksStrict()

  const manifestNodeIds: string[] = []
  const manifestSubjectIds: string[] = []

  for (const pack of packs) {
    const subjectId = `subject-${pack.subject}`
    for (const node of pack.nodes) {
      manifestNodeIds.push(node.id)
      manifestSubjectIds.push(subjectId)
    }
  }

  return knowledgeHealthCheck(manifestNodeIds, manifestSubjectIds, "all")
}
