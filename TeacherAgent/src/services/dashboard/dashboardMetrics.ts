/**
 * Dashboard Metrics — 按 pack/chapter 汇总掌握度数据
 *
 * 用于仪表盘雷达图：将已学知识点按所属 pack 聚合，
 * 展示全大纲各章节的整体掌握度，而非仅显示已学节点 top N。
 */

import type { KnowledgePack } from "../knowledge/packManifest"
import type { KnowledgeSeedNode } from "../knowledge/packLoader"
import type { StudentKnowledgeMastery } from "../../types/learning"

export interface PackMasterySummary {
  /** pack 唯一标识 */
  packId: string
  /** 章节标识（用于显示） */
  chapter: string
  /** 该 pack 总节点数 */
  totalNodes: number
  /** 已学习的节点数 */
  learnedNodes: number
  /** 平均掌握度（已学习节点取实际值，未学习节点取 0） */
  averageMastery: number
}

/**
 * 将 chapter id 转成人类可读标题。
 * 例：math-limits → 极限与连续，cs408-data-structures → 数据结构
 */
export function chapterToLabel(chapter: string): string {
  const labels: Record<string, string> = {
    "math-limits": "极限与连续",
    "linear-algebra-basics": "线性代数基础",
    "probability-basics": "概率统计基础",
    "math-derivatives": "导数与微分",
    "math-applications-of-derivatives": "导数应用",
    "math-indefinite-integrals": "不定积分",
    "math-definite-integrals": "定积分",
    "math-integral-applications": "积分应用",
    "math-mean-value-theorems": "微分中值定理",
    "math-multivariable-calculus": "多元函数微分",
    "probability-distributions": "概率分布",
    "linear-algebra-expanded": "线性代数进阶",
    "cs408-data-structures": "数据结构",
    "cs408-computer-organization": "组成原理",
    "cs408-operating-systems": "操作系统",
    "cs408-computer-networks": "计算机网络",
    "physics-mechanics": "力学",
    "physics-electromagnetism": "电磁学",
    "physics-thermodynamics": "热学",
    "physics-waves-optics": "波动与光学",
    "physics-modern": "近代物理",
    "english-grammar": "长难句语法",
    "english-reading": "阅读逻辑",
    "english-translation": "翻译得分点",
    "english-cloze": "完形填空"
  }
  return labels[chapter] ?? chapter
}

/**
 * 按 pack 汇总掌握度，用于雷达图展示。
 *
 * @param packs - 当前学科的 pack 列表（来自 getPacksBySubject）
 * @param packNodesMap - packId → 该 pack 的知识节点列表
 * @param studentKnowledge - 学生掌握度数据
 * @returns 每个 pack 的掌握度摘要，按 pack 在 manifest 中的顺序排列
 */
export function buildPackMasteryRadar(
  packs: KnowledgePack[],
  packNodesMap: Map<string, KnowledgeSeedNode[]>,
  studentKnowledge: StudentKnowledgeMastery[]
): PackMasterySummary[] {
  const masteryMap = new Map<string, number>()
  for (const k of studentKnowledge) {
    masteryMap.set(k.knowledgeNodeId, k.masteryProbability)
  }

  return packs.map((pack) => {
    const nodes = packNodesMap.get(pack.id) ?? []
    const totalNodes = nodes.length
    let learnedNodes = 0
    let masterySum = 0

    for (const node of nodes) {
      const mastery = masteryMap.get(node.id)
      if (mastery !== undefined) {
        learnedNodes++
        masterySum += mastery
      }
    }

    return {
      packId: pack.id,
      chapter: pack.chapter,
      totalNodes,
      learnedNodes,
      averageMastery: totalNodes > 0 ? masterySum / totalNodes : 0
    }
  })
}
