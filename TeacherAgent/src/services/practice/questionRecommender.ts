/**
 * 自适应题目推荐引擎
 *
 * 基于维果茨基"最近发展区"原理（难度范围 1-3）：
 * - 掌握度极低 (< 0.3) → 推荐难度 1 基础题
 * - 掌握度低 (0.3-0.5) → 推荐难度 1-2 基础题
 * - 掌握度中等 (0.5-0.7) → 推荐难度 2-3 中等题
 * - 掌握度较高 (> 0.7) → 推荐难度 3 进阶题
 *
 * 额外因素：
 * - 连续正确 → 适当提升难度（上限 3）
 * - 连续错误 → 降低难度（下限 1）
 * - 使用提示多 → 降低难度
 */

import type { StudentKnowledgeMastery } from "../../types/learning"
import type { QuestionBankSearchOutput } from "../../types/tool"

export interface RecommendationContext {
  studentKnowledge: StudentKnowledgeMastery[]
  recentResults: Array<{ correct: boolean; hintsUsed: number }>
  subjectCode: string
}

export interface DifficultyRange {
  min: number
  max: number
}

/**
 * 根据掌握度推荐题目难度范围
 */
export function recommendDifficulty(
  masteryProbability: number,
  recentResults: Array<{ correct: boolean; hintsUsed: number }> = []
): DifficultyRange {
  // 基础难度映射（基于掌握度，全局范围 1-3）
  let baseMin: number
  let baseMax: number

  if (masteryProbability < 0.3) {
    baseMin = 1
    baseMax = 1
  } else if (masteryProbability < 0.5) {
    baseMin = 1
    baseMax = 2
  } else if (masteryProbability < 0.7) {
    baseMin = 2
    baseMax = 3
  } else {
    // 掌握度 >= 0.7 → 最高难度 3
    baseMin = 3
    baseMax = 3
  }

  // 根据最近答题结果调整
  if (recentResults.length >= 2) {
    const lastTwo = recentResults.slice(-2)
    const allCorrect = lastTwo.every((r) => r.correct)
    const allWrong = lastTwo.every((r) => !r.correct)
    const avgHints = lastTwo.reduce((sum, r) => sum + r.hintsUsed, 0) / lastTwo.length

    if (allCorrect && avgHints <= 1) {
      // 连续正确且提示少 → 提升难度（上限 3）
      baseMin = Math.min(3, baseMin + 1)
      baseMax = Math.min(3, baseMax + 1)
    } else if (allWrong) {
      // 连续错误 → 降低难度（下限 1）
      baseMin = Math.max(1, baseMin - 1)
      baseMax = Math.max(1, baseMax - 1)
    } else if (avgHints >= 2) {
      // 提示使用多 → 降低难度
      baseMax = Math.max(1, baseMax - 1)
    }
  }

  return { min: baseMin, max: baseMax }
}

/**
 * 从题目池中推荐最佳下一题
 *
 * 优先选择：
 * 1. 弱点知识点的题目（掌握度低的优先）
 * 2. 难度匹配推荐范围的题目
 * 3. 最近未做过的题目
 */
export function recommendNextQuestion(
  context: RecommendationContext,
  questionPool: QuestionBankSearchOutput["questions"]
): QuestionBankSearchOutput["questions"][number] | null {
  if (questionPool.length === 0) return null

  // 计算每个知识点的掌握度
  const masteryMap = new Map<string, number>()
  for (const node of context.studentKnowledge) {
    masteryMap.set(node.knowledgeNodeId, node.masteryProbability)
  }

  // 计算平均掌握度（用于推荐难度）；冷启动默认 0.5（中等水平）
  const avgMastery = context.studentKnowledge.length > 0
    ? context.studentKnowledge.reduce((sum, n) => sum + n.masteryProbability, 0) / context.studentKnowledge.length
    : 0.5

  const difficultyRange = recommendDifficulty(avgMastery, context.recentResults)

  // 对每个题目评分
  const scored = questionPool.map((q) => {
    let score = 0

    // 1. 弱点知识点加分（掌握度越低加分越多）
    for (const nodeId of q.knowledgeNodeIds) {
      const mastery = masteryMap.get(nodeId) ?? 0.5
      if (mastery < 0.5) {
        score += (0.5 - mastery) * 20 // 最多 +10
      }
    }

    // 2. 难度匹配加分
    if (q.difficulty >= difficultyRange.min && q.difficulty <= difficultyRange.max) {
      score += 10
    } else if (q.difficulty < difficultyRange.min) {
      score -= 5 // 太简单扣分
    } else {
      score -= 10 // 太难扣分
    }

    // 3. 题目质量加分（有提示的题目优先）
    if (q.hints && q.hints.length > 0) {
      score += 3
    }

    return { question: q, score }
  })

  // 按分数排序，返回最佳题目
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.question ?? null
}

/**
 * 获取提示阶梯文案
 *
 * L1: 方向提示 - 引导学生思考方向
 * L2: 方法提示 - 提示具体方法或公式
 * L3: 接近答案 - 给出关键步骤
 */
export function getHintScaffoldingText(level: "L1" | "L2" | "L3"): string {
  switch (level) {
    case "L1":
      return "💡 方向提示"
    case "L2":
      return "📝 方法提示"
    case "L3":
      return "🔑 关键步骤"
  }
}
