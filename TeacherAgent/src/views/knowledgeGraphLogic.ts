/**
 * KnowledgeGraphView 纯逻辑函数
 *
 * 从 KnowledgeGraphView.vue 中提取的可测试逻辑。
 * 包含列表渐进渲染和视图模式切换的纯函数。
 */

import type { KnowledgeSeedNode } from "../services/knowledge/packLoader"

/** 每次"显示更多"追加的节点数 */
export const VISIBLE_STEP = 30

/**
 * 计算可见节点切片。
 * @param allSorted - 排序后的全量节点
 * @param limit - 当前可见上限
 * @returns 截断后的可见节点
 */
export function getVisibleNodes(
  allSorted: KnowledgeSeedNode[],
  limit: number
): KnowledgeSeedNode[] {
  return allSorted.slice(0, limit)
}

/**
 * 计算下一次 visible limit。
 * @param currentLimit - 当前 limit
 * @param totalCount - 全量节点数
 * @returns 新的 limit（不超过 totalCount）
 */
export function nextVisibleLimit(currentLimit: number, totalCount: number): number {
  return Math.min(currentLimit + VISIBLE_STEP, totalCount)
}

/**
 * 判断是否还有更多节点可显示。
 */
export function hasMoreNodes(visibleCount: number, totalCount: number): boolean {
  return visibleCount < totalCount
}

/**
 * 确定列表模式下应展示的节点。
 * @param showAll - true=全部节点，false=当前 pack 节点
 * @param allNodes - 全部 pack 节点平铺
 * @param filteredNodes - 当前 pack 过滤后的节点
 */
export function resolveListNodeSource(
  showAll: boolean,
  allNodes: KnowledgeSeedNode[],
  filteredNodes: KnowledgeSeedNode[]
): KnowledgeSeedNode[] {
  return showAll ? allNodes : filteredNodes
}
