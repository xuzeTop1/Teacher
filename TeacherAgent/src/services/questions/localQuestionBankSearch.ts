/**
 * Local Question Bank Search — 基于 JSON seed 的题库搜索
 *
 * 使用 pack loader 懒加载 seed 数据，避免静态导入所有 JSON。
 * 当数据库搜索不可用时，作为 fallback 方案。
 */


import type {
  QuestionBankQuestionType,
  QuestionBankSearchInput,
  QuestionBankSearchOutput,
  SourceRef,
  ToolResult
} from "../../types/tool"
import {
  loadQuestionPacksBySubject,
  loadQuestionPacksByIds,
  loadAllQuestionPacks,
  type QuestionSeed,
  type QuestionSeedItem
} from "../knowledge/packLoader"
import { filterSeedsToScope, isPackApproved, type ExamScopeFilter } from "../../engine/examTaxonomy/questionScope"
import { getLeafPackIds } from "../../engine/examTaxonomy/registry"

const recentQuestionIds: string[] = []
const MAX_RECENT_QUESTION_IDS = 12

function rememberQuestionIds(ids: string[]) {
  for (const id of ids) {
    const existingIndex = recentQuestionIds.indexOf(id)
    if (existingIndex >= 0) recentQuestionIds.splice(existingIndex, 1)
    recentQuestionIds.unshift(id)
  }
  recentQuestionIds.splice(MAX_RECENT_QUESTION_IDS)
}

// ── 搜索接口 ──────────────────────────────────────────────────────────────

/**
 * 懒加载版本的题库搜索
 *
 * 只加载与搜索相关的 pack，而非全部加载。
 * 如果指定了 enabledPackIds，只加载这些 pack。
 * 否则按学科加载。
 */
export async function searchLocalQuestionBankLazy(
  input: QuestionBankSearchInput
): Promise<ToolResult<QuestionBankSearchOutput>> {
  const query = input.query?.trim() ?? ""
  const minDifficulty = input.difficulty?.min ?? 1
  const maxDifficulty = input.difficulty?.max ?? 5
  const allowedTypes = input.questionTypes?.length ? new Set(input.questionTypes) : undefined
  const requestedKnowledgeIds = new Set(input.knowledgeNodeIds ?? [])

  try {
    // 考试体系范围模式：严格按叶子范围加载与校验（approved + 归属校验 + 归属标注）。
    const examScope = input.examScope as ExamScopeFilter | undefined
    if (examScope) {
      // fail-closed：传入考试体系范围但缺少具体叶子 subjectId（例如只有考试组 408）
      // 时，直接拒绝出题——绝不回退到按学科码的通用检索（那可能返回任意 approved seed）。
      if (!examScope.subjectId) {
        return {
          ok: true,
          data: { questions: [] },
          sources: [],
          rejected: ["考试体系范围缺少具体叶子 subjectId（只有考试组），拒绝出题"]
        }
      }
      const leafPackIds = getLeafPackIds(examScope.subjectId)
      const questionSeeds = await loadQuestionPacksByIds(leafPackIds)
      const { questions: scoped, rejected } = filterSeedsToScope(questionSeeds, examScope)
      const candidates = scoped
        .map((question) => ({
          question,
          score: scoreQuestion(query, question, requestedKnowledgeIds, input.purpose)
        }))
        .filter(({ question, score }) => {
          if (score <= 0) return false
          if (input.excludeRecentlyUsed && recentQuestionIds.includes(question.id)) return false
          if (question.difficulty < minDifficulty || question.difficulty > maxDifficulty) return false
          if (allowedTypes && !allowedTypes.has(question.type as QuestionBankQuestionType)) return false
          return true
        })
        .sort((left, right) => right.score - left.score || left.question.difficulty - right.question.difficulty)
        .slice(0, Math.max(1, input.topK))

      const questions = candidates.map(({ question, score }) => ({
        questionId: question.id,
        title: question.title,
        content: question.content,
        type: question.type as QuestionBankQuestionType,
        difficulty: question.difficulty,
        knowledgeNodeIds: question.knowledgeNodeIds,
        hints: question.hints ?? [],
        answer: question.answer,
        solutionSteps: question.solutionSteps,
        source: toSourceRef(question.source),
        score,
        examTrackId: question.examTrackId ?? null,
        subjectId: question.subjectId ?? null,
        moduleId: question.moduleId ?? null,
        packId: question.packId ?? null
      }))
      if (input.excludeRecentlyUsed) rememberQuestionIds(questions.map((question) => question.questionId))
      return {
        ok: true,
        data: {
          questions
        },
        // 拒绝原因只用于诊断日志与 UI 提示，不进入 prompt。
        sources: candidates.map(({ question }) => toSourceRef(question.source)),
        rejected: rejected.length > 0 ? rejected : undefined
      }
    }

    // 根据 enabledPackIds 或 subject 决定加载哪些 pack
    let questionSeeds: QuestionSeed[]
    if (input.enabledPackIds && input.enabledPackIds.length > 0) {
      questionSeeds = await loadQuestionPacksByIds(input.enabledPackIds)
    } else {
      questionSeeds = await loadQuestionPacksBySubject(input.subject)
    }

    // Manifest 是发布状态的唯一权威源；seed.status 缺失或漂移时也必须拒绝。
    const approvedSeeds = questionSeeds.filter((seed) => isPackApproved(seed.__packId ?? ""))

    // 执行搜索
    const candidates = approvedSeeds
      .flatMap((seed) =>
        seed.questions.map((question) => ({
          question,
          score: scoreQuestion(query, question, requestedKnowledgeIds, input.purpose)
        }))
      )
      .filter(({ question, score }) => {
        if (score <= 0) return false
        if (input.excludeRecentlyUsed && recentQuestionIds.includes(question.id)) return false
        if (question.difficulty < minDifficulty || question.difficulty > maxDifficulty) return false
        if (allowedTypes && !allowedTypes.has(question.type as QuestionBankQuestionType)) return false
        return true
      })
      .sort((left, right) => right.score - left.score || left.question.difficulty - right.question.difficulty)
      .slice(0, Math.max(1, input.topK))

    const questions = candidates.map(({ question, score }) => ({
      questionId: question.id,
      title: question.title,
      content: question.content,
      type: question.type as QuestionBankQuestionType,
      difficulty: question.difficulty,
      knowledgeNodeIds: question.knowledgeNodeIds,
      hints: question.hints ?? [],
      answer: question.answer,
      solutionSteps: question.solutionSteps,
      source: toSourceRef(question.source),
      score
    }))
    if (input.excludeRecentlyUsed) rememberQuestionIds(questions.map((question) => question.questionId))
    return {
      ok: true,
      data: {
        questions
      },
      sources: candidates.map(({ question }) => toSourceRef(question.source))
    }
  } catch (error) {
    console.warn("[TeacherAgent] lazy question bank search failed:", error)
    return {
      ok: false,
      errorCode: "EXECUTION_ERROR",
      error: `Question bank search failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// ── 同步版本（兼容现有代码） ──────────────────────────────────────────────

/**
 * 同步版本的题库搜索（已废弃，使用 searchLocalQuestionBankLazy）
 *
 * @deprecated 使用 searchLocalQuestionBankLazy 替代
 */
export function searchLocalQuestionBank(input: QuestionBankSearchInput): ToolResult<QuestionBankSearchOutput> {
  // 注意：这个同步版本会触发异步加载，但返回时可能数据还未加载完成
  // 建议使用 searchLocalQuestionBankLazy 替代
  console.warn(
    "[TeacherAgent] searchLocalQuestionBank is deprecated, use searchLocalQuestionBankLazy instead"
  )

  // 为了保持向后兼容，我们返回一个空结果，并在后台触发加载
  // 调用者应该迁移到 searchLocalQuestionBankLazy
  setTimeout(() => {
    void searchLocalQuestionBankLazy(input)
  }, 0)

  return {
    ok: true,
    data: { questions: [] }
  }
}

// ── 评分函数 ──────────────────────────────────────────────────────────────

function scoreQuestion(
  query: string,
  question: QuestionSeedItem,
  requestedKnowledgeIds: Set<string>,
  purpose: QuestionBankSearchInput["purpose"]
): number {
  let score = purposeBaseScore(purpose, question.type)

  for (const knowledgeNodeId of question.knowledgeNodeIds) {
    if (requestedKnowledgeIds.has(knowledgeNodeId)) {
      score += 8
    }
  }

  if (!query) {
    return score
  }

  const normalizedQuery = normalizeText(query)
  const searchable = normalizeText(
    [
      question.title ?? "",
      question.content,
      question.answer ?? "",
      ...(question.solutionSteps ?? []),
      ...(question.hints ?? []).map((hint) => hint.text),
      ...question.knowledgeNodeIds
    ].join(" ")
  )

  if (searchable.includes(normalizedQuery)) {
    score += 8
  }

  for (const token of tokenize(normalizedQuery)) {
    if (normalizeText(question.title ?? "").includes(token)) {
      score += 4
    } else if (normalizeText(question.content).includes(token)) {
      score += 3
    } else if (searchable.includes(token)) {
      score += 1
    }
  }

  return score
}

function purposeBaseScore(purpose: QuestionBankSearchInput["purpose"], type: string): number {
  if (purpose === "assessment" && (type === "concept_check" || type === "diagnostic")) {
    return 3
  }

  if (purpose === "review" && type === "solution") {
    return 3
  }

  if (purpose === "practice") {
    return 2
  }

  if (purpose === "similar_example") {
    return 2
  }

  return 1
}

function tokenize(value: string): string[] {
  const asciiTokens = value.match(/[a-z0-9_+-]{2,}/g) ?? []
  const chineseTokens = value.match(/[一-鿿]{2,}/g) ?? []
  const phraseTokens = [
    // Limits and continuity
    "极限", "连续", "左右极限", "无穷小", "不定式",
    "等价无穷小", "夹逼定理", "分段函数", "可去间断",
    "介值定理", "有理函数", "指数对数", "三角极限",
    // Derivatives
    "导数", "微分", "链式法则", "隐函数", "高阶导数",
    "切线", "乘法法则", "除法法则", "对数求导",
    // Applications of derivatives
    "单调性", "极值", "凹凸性", "拐点", "最值",
    "优化", "相关变化率", "线性近似", "泰勒展开",
    // Integrals
    "不定积分", "定积分", "换元积分", "分部积分", "反常积分",
    "原函数", "黎曼和", "微积分基本定理", "部分分式",
    // Integral applications
    "面积", "体积", "弧长", "做功", "旋转体",
    "圆盘法", "柱壳法", "平均值",
    // Mean value theorems
    "罗尔定理", "拉格朗日中值定理", "柯西中值定理", "洛必达", "泰勒定理",
    // Multivariable calculus
    "多元函数", "偏导数", "全微分", "梯度", "多元极值",
    "方向导数", "鞍点", "二重极限",
    // Linear algebra
    "矩阵", "行列式", "逆矩阵", "线性方程组", "向量",
    // Probability
    "概率", "条件概率", "期望", "方差", "随机变量",
    // Probability distributions
    "二项分布", "泊松分布", "几何分布", "正态分布", "均匀分布", "指数分布",
    "贝叶斯", "大数定律", "中心极限定理", "泊松近似",
    // Linear algebra expanded
    "秩", "向量空间", "线性无关", "线性相关", "基", "维数",
    "特征值", "特征向量", "对角化", "正交", "投影",
    // CS408: 数据结构
    "数据结构", "线性表", "栈", "队列", "树", "图", "排序", "KMP", "哈希", "B树", "AVL",
    // CS408: 计算机组成原理
    "组成原理", "补码", "浮点数", "Cache", "流水线", "指令", "DMA", "总线",
    // CS408: 操作系统
    "操作系统", "进程", "线程", "调度", "信号量", "PV", "死锁", "分页", "虚拟内存", "LRU", "磁盘调度",
    // CS408: 计算机网络
    "计算机网络", "OSI", "TCP/IP", "IP地址", "子网", "ARP", "ICMP", "TCP", "UDP", "拥塞控制", "DNS", "HTTP",
    // Physics
    "力学", "电磁学", "热学", "波动", "光学", "近代物理", "牛顿", "动量", "能量", "库仑", "电场", "磁场",
    "电磁感应", "麦克斯韦", "热力学", "熵", "卡诺", "干涉", "衍射", "偏振", "光电效应", "波粒二象性",
    // English
    "定语从句", "名词性从句", "非谓语动词", "虚拟语气", "长难句", "阅读理解", "翻译", "完形填空",
    "考研英语", "语法", "从句", "时态", "语态",
  ].filter((token) => value.includes(token))

  return [...new Set([...asciiTokens, ...chineseTokens, ...phraseTokens])]
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function toSourceRef(source: QuestionSeedItem["source"]): SourceRef {
  return {
    id: source.title,
    title: source.title,
    license: source.license,
    url: source.url
  }
}
