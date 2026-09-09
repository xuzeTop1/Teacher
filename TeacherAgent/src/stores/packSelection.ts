/**
 * Pack Selection Store — Pack 启用范围管理
 *
 * 只维护各学科的 Pack 启用状态，当前学科由 appStore.selectedSubject 管理。
 * 启用状态保存在 localStorage，不影响 seed 文件本身。
 *
 * Storage schema:
 *   v1 (legacy): Record<subject, packId[]> — no version field
 *   v2 (current): { version: 2, packs: Record<subject, packId[]> }
 *
 * Migration: v1 data is migrated to v2 on first read.
 * Only approved pack IDs from the current manifest are retained;
 * historical draft IDs are discarded (not treated as user authorization under new contract).
 */

import { defineStore } from "pinia"
import { ref } from "vue"
import type { SubjectCode } from "../types/learning"
import { PACK_MANIFEST, getPacksBySubject, type KnowledgePack } from "../services/knowledge/packManifest"

const STORAGE_KEY_ENABLED_PACKS = "teacher-agent-enabled-packs"
const STORAGE_VERSION = 2

/**
 * 学科 label 映射表。
 * 新增学科时只需在此表添加 label，AVAILABLE_SUBJECTS 自动从 PACK_MANIFEST 派生。
 */
const SUBJECT_LABEL_MAP: Record<string, string> = {
  math: "数学",
  cs408: "408考研",
  physics: "物理",
  english: "考研英语",
  politics: "政治",
  management: "管理类联考",
  education: "教育学311",
  psychology: "心理学312",
  lawmaster: "法律硕士",
  xingce: "行测",
  shenlun: "申论"
}

/** 可用学科列表 — 从 PACK_MANIFEST 的 subject 自动去重派生，保持 manifest 中首次出现的顺序 */
export const AVAILABLE_SUBJECTS: Array<{ code: SubjectCode; label: string }> = [
  ...new Set(PACK_MANIFEST.map((p) => p.subject))
].map((subject) => ({
  code: subject as SubjectCode,
  label: SUBJECT_LABEL_MAP[subject] ?? subject
}))

/**
 * Set of all valid pack IDs in the current manifest (for migration validation).
 */
const VALID_PACK_IDS = new Set(PACK_MANIFEST.map((p) => p.id))

/**
 * Set of approved pack IDs (for migration: only keep approved).
 */
const APPROVED_PACK_IDS = new Set(
  PACK_MANIFEST.filter((p) => p.status === "approved").map((p) => p.id)
)

/**
 * 安全访问 localStorage（测试环境中可能不可用）
 */
function getLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null
  } catch {
    return null
  }
}

/**
 * Raw stored data — could be v1 (plain Record) or v2 (versioned envelope).
 */
type RawStorageData = Record<string, string[]> | { version: number; packs: Record<string, string[]> }

/**
 * Migrate and validate stored pack data.
 *
 * Migration rules:
 * - v1 (no version field): legacy — only keep approved pack IDs, discard historical draft
 * - v2 (version === 2): keep manifest-valid IDs for correct subject (approved + user-enabled draft)
 * - Unknown version: discard and return empty
 *
 * During migration:
 * - v1: Only approved pack IDs are retained (historical draft IDs are discarded)
 * - v2: Pack IDs that exist in the current manifest AND belong to the correct subject are retained
 *   (both approved and user-enabled draft are preserved)
 * - Malformed data, unknown pack IDs, and cross-subject IDs are silently dropped
 */
function migrateStorageData(raw: RawStorageData, isV2: boolean): Record<string, string[]> {
  let packs: Record<string, string[]>

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if ("version" in raw && (raw as { version: number }).version === STORAGE_VERSION) {
      // v2: trusted format
      packs = (raw as { packs: Record<string, string[]> }).packs ?? {}
    } else if (!("version" in raw)) {
      // v1: legacy format — treat entire object as packs
      packs = raw as Record<string, string[]>
    } else {
      // Unknown version: discard
      return {}
    }
  } else {
    return {}
  }

  const migrated: Record<string, string[]> = {}
  for (const [subject, packIds] of Object.entries(packs)) {
    if (!Array.isArray(packIds)) continue

    let validIds: string[]
    if (isV2) {
      // v2: keep manifest-valid IDs for correct subject (approved + user-enabled draft)
      validIds = packIds.filter((id) => {
        if (!VALID_PACK_IDS.has(id)) return false
        // Verify the pack belongs to this subject
        const pack = PACK_MANIFEST.find((p) => p.id === id)
        return pack?.subject === subject
      })
    } else {
      // v1: only keep approved (discard historical draft)
      validIds = packIds.filter((id) =>
        VALID_PACK_IDS.has(id) && APPROVED_PACK_IDS.has(id)
      )
    }

    if (validIds.length > 0) {
      migrated[subject] = validIds
    }
  }

  return migrated
}

/**
 * 从 localStorage 读取已启用的 pack IDs（带迁移）
 */
function loadEnabledPacksFromStorage(): Record<string, string[]> {
  try {
    const storage = getLocalStorage()
    if (!storage) return {}
    const stored = storage.getItem(STORAGE_KEY_ENABLED_PACKS)
    if (stored) {
      const raw: RawStorageData = JSON.parse(stored)
      const isV2 = raw && typeof raw === "object" && "version" in raw && (raw as { version: number }).version === STORAGE_VERSION
      return migrateStorageData(raw, isV2)
    }
  } catch {
    // ignore parse errors — return empty
  }
  return {}
}

/**
 * 保存已启用的 pack IDs 到 localStorage（v2 format）
 */
function saveEnabledPacksToStorage(enabledPacks: Record<string, string[]>): void {
  try {
    const storage = getLocalStorage()
    if (storage) {
      const data: { version: number; packs: Record<string, string[]> } = {
        version: STORAGE_VERSION,
        packs: enabledPacks
      }
      storage.setItem(STORAGE_KEY_ENABLED_PACKS, JSON.stringify(data))
    }
  } catch {
    // ignore storage errors
  }
}

/**
 * 获取指定学科的默认启用 pack IDs（仅 approved 状态的 pack）
 */
function getDefaultEnabledPackIds(subject: SubjectCode): string[] {
  return getPacksBySubject(subject)
    .filter((pack) => pack.status === "approved")
    .map((pack) => pack.id)
}

export const usePackSelectionStore = defineStore("packSelection", () => {
  // ── 状态 ──────────────────────────────────────────────────────────────

  /** 已启用的 pack IDs（按 subject 分组），已迁移并仅含 approved ID */
  const enabledPacksBySubject = ref<Record<string, string[]>>(loadEnabledPacksFromStorage())

  // ── 查询方法 ──────────────────────────────────────────────────────────

  /**
   * 获取指定学科的全部 pack
   */
  function getSubjectPacks(subject: SubjectCode): KnowledgePack[] {
    return getPacksBySubject(subject)
  }

  /**
   * 获取指定学科已启用的 pack IDs
   * 如果没有保存配置，返回 approved 状态的 pack IDs（默认只启用 approved）
   */
  function getEnabledPackIds(subject: SubjectCode): string[] {
    const allPacks = getPacksBySubject(subject)
    const stored = enabledPacksBySubject.value[subject]
    if (stored && stored.length > 0) {
      // 过滤掉可能已不存在的 pack ID
      const validIds = new Set(allPacks.map((p) => p.id))
      return stored.filter((id) => validIds.has(id))
    }
    // 默认只启用 approved 状态的 pack
    return allPacks
      .filter((pack) => pack.status !== "draft")
      .map((pack) => pack.id)
  }

  /**
   * 获取指定学科已启用的 pack 列表
   */
  function getEnabledPacks(subject: SubjectCode): KnowledgePack[] {
    const enabledSet = new Set(getEnabledPackIds(subject))
    return getPacksBySubject(subject).filter((pack) => enabledSet.has(pack.id))
  }

  /**
   * 获取指定学科已启用的节点数
   */
  function getEnabledNodeCount(subject: SubjectCode): number {
    return getEnabledPacks(subject).reduce((sum, pack) => sum + pack.expectedNodeCount, 0)
  }

  /**
   * 获取指定学科已启用的题目数
   */
  function getEnabledQuestionCount(subject: SubjectCode): number {
    return getEnabledPacks(subject).reduce((sum, pack) => sum + pack.expectedQuestionCount, 0)
  }

  /**
   * 检查指定 pack 是否启用
   */
  function isPackEnabled(subject: SubjectCode, packId: string): boolean {
    return getEnabledPackIds(subject).includes(packId)
  }

  /**
   * 检查指定学科是否有启用的 pack
   */
  function hasEnabledPacks(subject: SubjectCode): boolean {
    return getEnabledPackIds(subject).length > 0
  }

  // ── 操作方法 ──────────────────────────────────────────────────────────

  /**
   * 启用指定 pack（approved 或 draft 均可显式启用）
   */
  function enablePack(subject: SubjectCode, packId: string): void {
    const current = [...getEnabledPackIds(subject)]
    if (!current.includes(packId)) {
      current.push(packId)
      updateEnabledPacks(subject, current)
    }
  }

  /**
   * 禁用指定 pack
   * 如果是最后一个 pack，拒绝禁用并返回 false
   */
  function disablePack(subject: SubjectCode, packId: string): boolean {
    const current = [...getEnabledPackIds(subject)]
    const index = current.indexOf(packId)
    if (index === -1) return true // 已经是禁用状态

    // 不能禁用最后一个 pack
    if (current.length <= 1) {
      return false
    }

    current.splice(index, 1)
    updateEnabledPacks(subject, current)
    return true
  }

  /**
   * 切换指定 pack 的启用状态
   * 如果是最后一个 pack，拒绝禁用并返回 false
   */
  function togglePack(subject: SubjectCode, packId: string): boolean {
    if (isPackEnabled(subject, packId)) {
      return disablePack(subject, packId)
    } else {
      enablePack(subject, packId)
      return true
    }
  }

  /**
   * 显式启用指定学科全部 pack（包括 draft）。
   *
   * 默认状态仍然只启用 approved；用户点击“启用全部”属于对当前学科
   * draft pack 的明确授权，因此不能再复用 approved-only 默认集合。
   */
  function enableAllPacks(subject: SubjectCode): void {
    const allIds = getPacksBySubject(subject).map((pack) => pack.id)
    updateEnabledPacks(subject, allIds)
  }

  /**
   * 禁用指定学科全部 pack（保留最后一个）
   */
  function disableAllPacks(subject: SubjectCode): void {
    const currentIds = getEnabledPackIds(subject)
    if (currentIds.length > 0) {
      // 只保留第一个
      updateEnabledPacks(subject, [currentIds[0]])
    }
  }

  /**
   * 恢复默认（启用全部 approved）
   */
  function resetToDefault(subject: SubjectCode): void {
    updateEnabledPacks(subject, getDefaultEnabledPackIds(subject))
  }

  // ── 内部函数 ──────────────────────────────────────────────────────────

  /**
   * 更新指定学科的启用 pack 列表并保存到 localStorage
   */
  function updateEnabledPacks(subject: SubjectCode, enabledIds: string[]): void {
    const newEnabledPacks = { ...enabledPacksBySubject.value }
    newEnabledPacks[subject] = enabledIds
    enabledPacksBySubject.value = newEnabledPacks
    saveEnabledPacksToStorage(newEnabledPacks)
  }

  return {
    // 状态
    enabledPacksBySubject,

    // 查询方法
    getSubjectPacks,
    getEnabledPackIds,
    getEnabledPacks,
    getEnabledNodeCount,
    getEnabledQuestionCount,
    isPackEnabled,
    hasEnabledPacks,

    // 操作方法
    enablePack,
    disablePack,
    togglePack,
    enableAllPacks,
    disableAllPacks,
    resetToDefault
  }
})
