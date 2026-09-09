/**
 * Graph Builder — 从 pack 节点构建知识图谱的 nodes/edges/layouts
 *
 * 安全处理 dangling prerequisites（引用不在 packNodes 中的节点），
 * 不会因数据异常而抛错。
 */

import type { KnowledgeSeedNode } from "./packLoader"
import type { StudentKnowledgeMastery } from "../../types/learning"
import { getMasteryColor } from "../../utils/mastery"

/** 单次渲染节点上限 */
export const MAX_GRAPH_NODES = 40

export interface GraphNode {
  name: string
}

export interface GraphNodes {
  [id: string]: GraphNode
}

export interface GraphEdge {
  source: string
  target: string
}

export interface GraphEdges {
  [id: string]: GraphEdge
}

export interface GraphPosition {
  x: number
  y: number
}

export interface GraphLayouts {
  nodes: Record<string, GraphPosition>
}

/**
 * 截断标题用于图谱标签。
 * 中文字符最多 maxLen 个，超出加省略号。
 */
export function truncateTitle(title: string, maxLen = 8): string {
  // 按 Unicode 字符数截断（中文字符 = 1 宽度）
  const chars = [...title]
  return chars.length > maxLen ? chars.slice(0, maxLen).join("") + "…" : title
}

/**
 * 从 pack 节点构建图谱节点。
 * 标签使用短标题（最多 8 字符），完整标题在详情面板显示。
 */
export function buildGraphNodes(packNodes: KnowledgeSeedNode[]): GraphNodes {
  const nodes: GraphNodes = {}
  for (const node of packNodes) {
    nodes[node.id] = { name: truncateTitle(node.title, 8) }
  }
  return nodes
}

/**
 * 从 pack 节点的 prerequisites 构建图谱边。
 * 安全跳过 dangling prerequisites（引用的 id 不在 packNodes 中）。
 * 不会抛错。
 */
export function buildGraphEdges(packNodes: KnowledgeSeedNode[]): GraphEdges {
  const nodeIds = new Set(packNodes.map((n) => n.id))
  const edges: GraphEdges = {}
  let i = 0

  for (const node of packNodes) {
    for (const prereqId of node.prerequisites ?? []) {
      if (nodeIds.has(prereqId) && prereqId !== node.id) {
        edges[`e-${i}`] = { source: prereqId, target: node.id }
        i++
      }
    }
  }

  return edges
}

/**
 * 构建层级布局。
 * 以无前置依赖的节点为第 0 层，逐层向上。
 * 同层节点超过 maxPerRow 时自动换行，避免横向重叠。
 * 安全处理循环依赖（visited 集合防止无限递归）。
 */
export function buildGraphLayout(
  packNodes: KnowledgeSeedNode[],
  containerWidth = 800
): GraphLayouts {
  if (packNodes.length === 0) {
    return { nodes: {} }
  }

  const nodeIds = new Set(packNodes.map((n) => n.id))
  const prereqMap = new Map<string, string[]>()
  for (const node of packNodes) {
    const validPrereqs = (node.prerequisites ?? []).filter(
      (id) => nodeIds.has(id) && id !== node.id
    )
    prereqMap.set(node.id, validPrereqs)
  }

  const levels = new Map<string, number>()
  const visited = new Set<string>()

  function getLevel(id: string, path: Set<string>): number {
    if (levels.has(id)) return levels.get(id)!
    if (visited.has(id) || path.has(id)) {
      // 循环依赖，返回 0
      return 0
    }
    path.add(id)
    visited.add(id)

    const prereqs = prereqMap.get(id) ?? []
    if (prereqs.length === 0) {
      levels.set(id, 0)
      path.delete(id)
      return 0
    }

    const maxPrereqLevel = Math.max(
      ...prereqs.map((pid) => getLevel(pid, path))
    )
    const level = maxPrereqLevel + 1
    levels.set(id, level)
    path.delete(id)
    return level
  }

  for (const node of packNodes) {
    getLevel(node.id, new Set())
  }

  // 按层级分组
  const byLevel = new Map<number, string[]>()
  for (const [id, level] of levels) {
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level)!.push(id)
  }

  // 布局参数：同层超过 maxPerRow 时自动换行
  const nodeSpacing = 100
  const rowSpacing = 60
  const levelSpacing = 120
  const maxPerRow = Math.max(3, Math.floor(containerWidth / nodeSpacing))

  const positions: Record<string, GraphPosition> = {}

  for (const [level, ids] of byLevel) {
    const rowCount = Math.ceil(ids.length / maxPerRow)
    for (let row = 0; row < rowCount; row++) {
      const rowIds = ids.slice(row * maxPerRow, (row + 1) * maxPerRow)
      const totalWidth = (rowIds.length - 1) * nodeSpacing
      const startX = containerWidth / 2 - totalWidth / 2
      const y = 50 + level * levelSpacing + row * rowSpacing
      rowIds.forEach((id, i) => {
        positions[id] = { x: startX + i * nodeSpacing, y }
      })
    }
  }

  return { nodes: positions }
}

/**
 * 构建节点颜色映射。
 * 已学习节点用掌握度着色，冷启动/未学习节点为灰色。
 *
 * 冷启动判断：attemptsCount === 0 的记录视为冷启动，不按 masteryProbability 着色。
 */
export function buildNodeColors(
  packNodes: KnowledgeSeedNode[],
  studentKnowledge: StudentKnowledgeMastery[]
): Record<string, string> {
  const colors: Record<string, string> = {}
  const knowledgeMap = new Map<string, StudentKnowledgeMastery>()
  for (const k of studentKnowledge) {
    knowledgeMap.set(k.knowledgeNodeId, k)
  }
  for (const node of packNodes) {
    const record = knowledgeMap.get(node.id)
    colors[node.id] = getMasteryColor(record)
  }
  return colors
}
