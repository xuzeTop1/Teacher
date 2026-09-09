/**
 * 冷启动判断与 mastery 展示工具
 *
 * 冷启动 mastery=0.5 是 BKT 算法的初始先验，不代表真实掌握程度。
 * UI 层必须区分"冷启动初始估计"和"真实学习掌握度"。
 */

import type { StudentKnowledgeMastery } from "../types/learning"

/**
 * 判断是否为冷启动知识记录
 * 冷启动条件：attemptsCount === 0（无真实答题记录）
 */
export function isColdStartKnowledge(record: StudentKnowledgeMastery): boolean {
  return record.attemptsCount === 0
}

/**
 * 判断 mastery 是否为冷启动默认值（0.5 且无真实学习记录）
 */
export function isColdStartMastery(record: StudentKnowledgeMastery): boolean {
  return record.attemptsCount === 0 && Math.abs(record.masteryProbability - 0.5) < 0.01
}

export type MasteryDisplayStatus = "cold_start" | "insufficient_data" | "real_mastery"
export type MasteryVisualState = "not_started" | "needs_work" | "learning" | "mastered"

/**
 * 是否存在足以改变 mastery 展示的有效学习证据。
 *
 * 历史版本会把 outcome=unknown 的评估累计为 attempts，但 mastery 仍停留在
 * 0.5 且 correctCount=0。这样的记录不是“发展中 50%”，仍应视为待评估。
 */
export function hasInformativeMasteryEvidence(record: StudentKnowledgeMastery): boolean {
  if (record.attemptsCount <= 0) return false
  const isUntouchedPrior = Math.abs(record.masteryProbability - 0.5) < 0.01
    && record.correctCount === 0
  return !isUntouchedPrior
}

/**
 * 获取 mastery 展示状态
 */
export function getMasteryDisplayStatus(record: StudentKnowledgeMastery): MasteryDisplayStatus {
  if (record.attemptsCount === 0) return "cold_start"
  if (!hasInformativeMasteryEvidence(record)) return "insufficient_data"
  if (record.attemptsCount < 3) return "insufficient_data"
  return "real_mastery"
}

/**
 * 获取 mastery 展示标签（用于列表/图谱）
 */
export function getMasteryLabel(record: StudentKnowledgeMastery): string {
  const status = getMasteryDisplayStatus(record)
  const percent = Math.round(record.masteryProbability * 100)

  if (status === "cold_start") return "未开始"
  if (status === "insufficient_data") {
    if (!hasInformativeMasteryEvidence(record)) return "待评估"
    if (percent >= 80) return `${percent}% · 初始评估`
    if (percent >= 40) return `${percent}% · 数据较少`
    return `${percent}% · 待学习`
  }
  // real_mastery
  if (percent >= 80) return `${percent}% · 已掌握`
  if (percent >= 40) return `${percent}% · 学习中`
  if (percent > 0) return `${percent}% · 待加强`
  return "未学习"
}

/**
 * 获取 mastery 状态 badge 文本（用于详情面板）
 */
export function getMasteryBadgeText(record: StudentKnowledgeMastery): string {
  const status = getMasteryDisplayStatus(record)
  const percent = Math.round(record.masteryProbability * 100)

  if (status === "cold_start") return "未开始"
  if (status === "insufficient_data") {
    return hasInformativeMasteryEvidence(record) ? `${percent}% · 初始评估` : "待评估"
  }
  if (percent >= 80) return `${percent}% · 已掌握`
  if (percent >= 40) return `${percent}% · 学习中`
  if (percent > 0) return `${percent}% · 待加强`
  return "未学习"
}

/**
 * 获取 mastery badge 样式类名
 */
export function getMasteryBadgeClass(record: StudentKnowledgeMastery): string {
  const status = getMasteryDisplayStatus(record)
  if (status === "cold_start") return "status-cold"
  if (status === "insufficient_data") return "status-insufficient"

  const percent = Math.round(record.masteryProbability * 100)
  if (percent >= 80) return "status-mastered"
  if (percent >= 40) return "status-learning"
  return "status-weak"
}

/**
 * 获取 mastery 颜色（用于图谱节点着色）
 * 冷启动节点显示灰色（未解锁）
 */
export function getMasteryColor(record: StudentKnowledgeMastery | undefined): string {
  if (!record || !hasInformativeMasteryEvidence(record)) return "#9e9e9e"
  const v = record.masteryProbability
  if (v >= 0.8) return "#4caf50"
  if (v >= 0.4) return "#ff9800"
  if (v > 0) return "#f44336"
  return "#9e9e9e"
}

/**
 * 判断是否为冷启动整体（所有记录都没有真实学习）
 */
export function isColdStartOverall(knowledge: StudentKnowledgeMastery[]): boolean {
  if (!knowledge.length) return true
  return knowledge.every((k) => !hasInformativeMasteryEvidence(k))
}

/**
 * 获取整体掌握度（排除冷启动默认值）
 * 如果所有记录都是冷启动，返回 0
 */
export function getRealOverallMastery(knowledge: StudentKnowledgeMastery[]): number {
  const realRecords = knowledge.filter(hasInformativeMasteryEvidence)
  if (!realRecords.length) return 0
  const sum = realRecords.reduce((acc, k) => acc + k.masteryProbability, 0)
  return sum / realRecords.length
}

/** 获取天赋树节点的视觉状态。 */
export function getMasteryVisualState(
  record: StudentKnowledgeMastery | undefined
): MasteryVisualState {
  if (!record || !hasInformativeMasteryEvidence(record)) return "not_started"
  if (record.masteryProbability >= 0.8) return "mastered"
  if (record.masteryProbability >= 0.4) return "learning"
  return "needs_work"
}

/** 获取天赋树节点中心图标。 */
export function getMasteryVisualIcon(
  record: StudentKnowledgeMastery | undefined
): string {
  const state = getMasteryVisualState(record)
  if (state === "mastered") return "✓"
  if (state === "learning") return "↗"
  if (state === "needs_work") return "!"
  return "◇"
}
