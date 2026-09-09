/**
 * 展示层 label helpers — 将英文 ID 映射为中文显示名
 *
 * 内部 ID 保持英文稳定，UI 对用户显示中文 title / shortTitle / label。
 * 所有 map 为静态常量，不依赖运行时数据。
 */
import { PACK_MANIFEST, getPackById } from "../services/knowledge/packManifest"
import { subjectLabel } from "./subject"

/** 获取学科的中文显示名 */
export { subjectLabel as getSubjectLabel } from "./subject"

/**
 * 获取 Pack 的中文显示全名
 * 例：math-limits → "极限与连续"
 */
export function getPackDisplayName(packId: string): string {
  const pack = getPackById(packId)
  return pack?.title ?? packId
}

/**
 * 获取 Pack 的中文短标题（用于按钮等窄空间）
 * 例：math-limits → "极限连续"
 */
export function getPackShortTitle(packId: string): string {
  const pack = getPackById(packId)
  return pack?.shortTitle ?? pack?.title ?? packId
}

/**
 * 将节点 ID 映射为中文标题
 * @param nodeId 知识节点 ID
 * @param nodesMap 已加载的节点映射（id → title）
 */
export function getNodeDisplayTitle(nodeId: string, nodesMap: Map<string, string>): string {
  return nodesMap.get(nodeId) ?? nodeId
}

/**
 * 格式化前置依赖 ID 列表为中文标题列表
 * @param prerequisiteIds 前置依赖 ID 数组
 * @param nodesMap 已加载的节点映射（id → title）
 */
export function formatPrerequisiteLabels(
  prerequisiteIds: string[],
  nodesMap: Map<string, string>
): string[] {
  return prerequisiteIds.map((id) => nodesMap.get(id) ?? id)
}
