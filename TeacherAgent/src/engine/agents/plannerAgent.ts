import type { AssessmentResult } from "../../types/assessment"
import type { KnowledgePrerequisite, StudentKnowledgeMastery, SubjectCode } from "../../types/learning"
import type { LearningMemoryPromptContext } from "../../services/student/memoryService"
import type { PlannerResult, PlannerTask, PlannerTrigger } from "../../types/planner"
import { subjectLabel } from "../../utils/subject"
import { uniqueTrimmedStrings as unique } from "../../utils/text"

// Chapter-level DAG types
export interface ChapterNode {
  id: string
  title: string
  knowledgeNodeIds: string[]
  prerequisiteChapterIds: string[]
  difficulty: number
  masteryProbability: number
  isCompleted: boolean
  isReady: boolean // all prerequisites completed
}

export interface ChapterDAG {
  chapters: ChapterNode[]
  topologicalOrder: string[]
  criticalPath: string[]
  recommendedNext: string | null
}

export interface ChapterDAGResult {
  dag: ChapterDAG
  chapterTasks: PlannerTask[]
  chapterSignals: string[]
}

export interface PlannerAgentInput {
  userMessage: string
  subjectCode: SubjectCode
  trigger?: PlannerTrigger
  memoryContext?: LearningMemoryPromptContext
  assessmentResult?: AssessmentResult
  studentKnowledge?: StudentKnowledgeMastery[]
  knowledgePrerequisites?: KnowledgePrerequisite[]
  nowIso?: string
}

export function shouldTriggerPlanner(userMessage: string): boolean {
  return /(?:接下来学什么|下一步学什么|怎么安排|学习计划|复习计划|规划|路径|路线|今天学|这周学|备考安排|怎么复习|薄弱点)/i.test(
    userMessage
  )
}

export function planNextLearningStep(input: PlannerAgentInput): PlannerResult {
  const trigger = input.trigger ?? inferPlannerTrigger(input.userMessage)
  const subjectPlan = createSubjectPlan(input.subjectCode)
  const memoryFocus = collectMemoryFocus(input.memoryContext)
  const assessmentFocus = collectAssessmentFocus(input.assessmentResult)
  const masterySignals = collectMasterySignals(input.studentKnowledge)
  const prerequisiteSignals = collectPrerequisiteSignals(input.knowledgePrerequisites)
  const reviewDueItems = collectReviewDueItems(input.studentKnowledge, input.nowIso)
  const reviewDueSignals = reviewDueItems.map((item) => `${item.title}（已 ${item.daysSinceReview} 天未复习）`)

  // Build chapter-level DAG when prerequisites are available
  let chapterDAGResult: ChapterDAGResult | undefined
  if (input.knowledgePrerequisites?.length && input.studentKnowledge?.length) {
    const dag = buildChapterDAG(input.knowledgePrerequisites, input.studentKnowledge, input.subjectCode)
    chapterDAGResult = generateChapterDAGTasks(dag)
  }

  const chapterSignals = chapterDAGResult?.chapterSignals ?? []
  const focusSignals =
    trigger === "review_due"
      ? [...assessmentFocus, ...reviewDueSignals, ...chapterSignals, ...masterySignals, ...prerequisiteSignals]
      : [...assessmentFocus, ...chapterSignals, ...masterySignals, ...reviewDueSignals, ...prerequisiteSignals]
  const reviewFocus = unique([...focusSignals, ...memoryFocus, ...subjectPlan.reviewFocus]).slice(0, 5)
  const adaptiveTasks =
    trigger === "review_due"
      ? [
          ...createReviewDueTasks(reviewDueItems, trigger),
          ...(chapterDAGResult?.chapterTasks ?? []),
          ...createPrerequisiteTasks(input.knowledgePrerequisites, input.studentKnowledge),
          ...createMasteryTasks(input.studentKnowledge)
        ]
      : [
          ...(chapterDAGResult?.chapterTasks ?? []),
          ...createPrerequisiteTasks(input.knowledgePrerequisites, input.studentKnowledge),
          ...createMasteryTasks(input.studentKnowledge),
          ...createReviewDueTasks(reviewDueItems, trigger)
        ]
  const nextTasks = prioritizeTasks([
    ...adaptiveTasks,
    ...subjectPlan.tasks,
    ...createAdaptiveTasks(reviewFocus)
  ])

  return {
    trigger,
    subjectCode: input.subjectCode,
    summary: createSummary(input.subjectCode, reviewFocus, trigger),
    nextTasks,
    reviewFocus,
    masterySignals,
    prerequisiteSignals,
    reviewDueSignals,
    chapterSignals,
    planningHorizon: inferPlanningHorizon(input.userMessage),
    confidence:
      prerequisiteSignals.length || reviewDueSignals.length
        ? 0.82
        : masterySignals.length
          ? 0.78
          : reviewFocus.length
            ? 0.72
            : 0.56
  }
}

export function formatPlannerResult(result: PlannerResult): string {
  const horizon = {
    next_turn: "下一步",
    today: "今天",
    this_week: "这周"
  }[result.planningHorizon]
  const tasks = result.nextTasks
    .slice(0, 4)
    .map((task, index) => `${index + 1}. ${task.title}（约 ${task.estimatedMinutes} 分钟）\n   ${task.rationale}`)
    .join("\n")
  const review = result.reviewFocus.length ? `\n\n优先盯住：${result.reviewFocus.join("、")}。` : ""
  const chapterInfo = result.chapterSignals.length
    ? `\n\n📊 ${result.chapterSignals.join("；")}`
    : ""

  return [
    `${horizon}我建议按这个顺序来，不先铺太大摊子：`,
    "",
    tasks,
    review,
    chapterInfo,
    "",
    "你先选第 1 项开始。完成后把你的过程或卡点发给我，我再根据表现调整后面的安排。"
  ].join("\n")
}

function inferPlannerTrigger(userMessage: string): PlannerTrigger {
  if (/(?:复习计划|怎么复习|遗忘|回顾)/i.test(userMessage)) return "review_due"
  if (/(?:怎么安排|学习计划|规划|路径|路线|今天学|这周学|备考安排)/i.test(userMessage)) return "user_requested_schedule"
  return "user_requested_next_step"
}

function inferPlanningHorizon(userMessage: string): PlannerResult["planningHorizon"] {
  if (/(?:这周|本周|七天|一周)/i.test(userMessage)) return "this_week"
  if (/(?:今天|今晚|上午|下午|晚上)/i.test(userMessage)) return "today"
  return "next_turn"
}

function createSubjectPlan(subjectCode: SubjectCode): {
  tasks: PlannerTask[]
  reviewFocus: string[]
} {
  const common: Record<SubjectCode, { tasks: PlannerTask[]; reviewFocus: string[] }> = {
    math: {
      reviewFocus: ["定义条件", "典型误区", "一步变形"],
      tasks: [
        createTask("learn", "复习一个核心定义，并说出适用条件", "严谨学科先稳住定义边界，后面做题才不容易套错。", 12, "high"),
        createTask("practice", "做 2 道同知识点小题，只写关键第一步", "先训练识别题型，不急着完整刷题。", 18, "high"),
        createTask("reflect", "总结一个容易错的条件或反例", "把误区写出来，比多做一道题更能防止重复犯错。", 8, "medium")
      ]
    },
    english: {
      reviewFocus: ["可理解表达", "高频错误", "微练习"],
      tasks: [
        createTask("learn", "选一个表达场景，先说 3 句自己的版本", "英语先开口，错误之后再轻量纠正。", 10, "high"),
        createTask("review", "改写其中 1 句，让它更自然", "一次只改一个关键点，减少挫败感。", 8, "medium"),
        createTask("practice", "用新表达再造 2 句", "马上复用，记忆会更稳。", 10, "medium")
      ]
    },
    law: {
      reviewFocus: ["构成要件", "例外", "适用边界"],
      tasks: [
        createTask("learn", "整理一个概念的构成要件", "法学先拆要件，再谈适用。", 15, "high"),
        createTask("practice", "用一个小案例逐项套用", "案例推理能暴露遗漏的条件。", 18, "high"),
        createTask("reflect", "写出一个例外或争议点", "避免把不确定问题说死。", 10, "medium")
      ]
    },
    accounting: {
      reviewFocus: ["准则口径", "分录逻辑", "数值依据"],
      tasks: [
        createTask("learn", "先核对一个准则或科目口径", "会计题先统一口径，后面计算才可靠。", 12, "high"),
        createTask("practice", "写一组最小分录并标理由", "分录理由比结果本身更能暴露理解。", 18, "high"),
        createTask("review", "检查借贷方向和金额来源", "用检查清单减少低级错误。", 8, "medium")
      ]
    },
    programming: {
      reviewFocus: ["最小复现", "错误定位", "测试用例"],
      tasks: [
        createTask("diagnose", "先写出最小复现或输入输出样例", "编程学习先缩小问题边界。", 12, "high"),
        createTask("practice", "只改一个可验证的小点", "小步修改更容易定位原因。", 15, "high"),
        createTask("reflect", "补一个失败用例", "测试能把经验变成稳定能力。", 10, "medium")
      ]
    },
    cs408: {
      reviewFocus: ["核心概念", "典型算法", "易混淆点"],
      tasks: [
        createTask("learn", "梳理一个核心概念或原理的定义与适用条件", "408 先把概念边界搞清楚，做题才不会混淆。", 12, "high"),
        createTask("practice", "做 2 道同知识点的选择或应用题", "408 题量大，先练识别题型和关键步骤。", 18, "high"),
        createTask("reflect", "对比一个容易混淆的概念对（如进程vs线程、TCP vs UDP）", "对比记忆比单独背诵更牢固。", 8, "medium")
      ]
    },
    physics: {
      reviewFocus: ["物理图景", "适用条件", "量纲与方向"],
      tasks: [
        createTask("learn", "画一个物理过程的示意图并标出关键量", "物理先建立图景，再列方程。", 12, "high"),
        createTask("practice", "列方程前先说明每个符号的物理含义和适用条件", "物理公式不是代数模板，条件和方向比数值更重要。", 18, "high"),
        createTask("reflect", "检查量纲或极限情况是否合理", "量纲检验是最便宜的自查手段。", 8, "medium")
      ]
    },
    politics: {
      reviewFocus: ["基本概念", "原理辨析", "历史脉络"],
      tasks: [
        createTask("learn", "梳理一个核心概念的标准定义和关键词", "政治先把概念定义记准，辨析题才有判断依据。", 12, "high"),
        createTask("practice", "做 2 道概念辨析或选择题", "政治选择题重在区分近义概念。", 18, "high"),
        createTask("reflect", "对比两个容易混淆的原理或历史事件", "对比辨析是政治提分的关键。", 8, "medium")
      ]
    },
    management: {
      reviewFocus: ["题型识别", "关键步骤", "易错点"],
      tasks: [
        createTask("learn", "先判定题型，再调用对应公式或套路", "管综重速度与准确，先归类最省时间。", 12, "high"),
        createTask("practice", "做 2 道同题型小题，只写关键一步", "先训练识别，不急着完整刷。", 18, "high"),
        createTask("reflect", "总结一个易错条件或反例", "把误区写出来比多做一道题更防错。", 8, "medium")
      ]
    },
    education: {
      reviewFocus: ["概念辨析", "教育史时间线", "理论对应"],
      tasks: [
        createTask("learn", "梳理一个核心概念的标准定义和关键词", "教育先概念记准，辨析题才有依据。", 12, "high"),
        createTask("practice", "做 2 道概念辨析或选择题", "选择题重在区分近义概念。", 18, "high"),
        createTask("reflect", "对比两个易混理论或人物", "对比辨析是教育学提分关键。", 8, "medium")
      ]
    },
    psychology: {
      reviewFocus: ["理论框架", "经典实验", "变量与效度"],
      tasks: [
        createTask("learn", "梳理一个理论的框架与关键概念", "心理学先框架清楚，再谈应用。", 12, "high"),
        createTask("practice", "结合实验或例子说明该理论", "用实验证据支撑比背诵更牢。", 18, "high"),
        createTask("reflect", "指出一个常见误用或混淆", "把误区点出来防止张冠李戴。", 8, "medium")
      ]
    },
    lawmaster: {
      reviewFocus: ["构成要件", "例外", "适用边界"],
      tasks: [
        createTask("learn", "整理一个概念的构成要件", "法学先拆要件，再谈适用。", 15, "high"),
        createTask("practice", "用一个小案例逐项套用", "案例推理能暴露遗漏条件。", 18, "high"),
        createTask("reflect", "写出一个例外或争议点", "避免把不确定问题说死。", 10, "medium")
      ]
    },
    xingce: {
      reviewFocus: ["题型识别", "解题流程", "排除法"],
      tasks: [
        createTask("learn", "梳理一个题型的识别特征和解题步骤", "行测先判题型，再选方法。", 12, "high"),
        createTask("practice", "做 2 道同题型小题，只写关键排除步骤", "先练排除法和代入法。", 18, "high"),
        createTask("reflect", "总结一个高频陷阱或易错选项", "把陷阱写出来比多刷题更防错。", 8, "medium")
      ]
    },
    shenlun: {
      reviewFocus: ["材料拆解", "提纲结构", "段落改写"],
      tasks: [
        createTask("learn", "拆解一段申论材料，标注问题/原因/对策", "申论先拆材料，再谈写作。", 12, "high"),
        createTask("practice", "搭一个大作文提纲（总论点+2个分论点）", "提纲比全文更能暴露结构问题。", 18, "high"),
        createTask("review", "改写一段已有段落，贴近机关文风", "改写练习比背模板更有效。", 8, "medium")
      ]
    }
  }

  return common[subjectCode]
}

function collectMemoryFocus(memoryContext: LearningMemoryPromptContext | undefined): string[] {
  return unique([
    ...(memoryContext?.shortTermMemory?.lastMisconceptions ?? []),
    ...(memoryContext?.shortTermMemory?.recentFocus ?? []),
    ...(memoryContext?.profile?.recurringMisconceptions ?? []),
    ...((memoryContext?.longTermMemories ?? [])
      .filter((memory) => memory.kind === "misconception" || memory.kind === "mastery_signal")
      .map((memory) => memory.summary))
  ]).slice(0, 5)
}

function collectAssessmentFocus(assessmentResult: AssessmentResult | undefined): string[] {
  if (!assessmentResult) {
    return []
  }

  return unique([
    ...assessmentResult.detectedMisconceptions,
    ...assessmentResult.knowledgeUpdates.map((update) => update.reason),
    ...(assessmentResult.diagnosticReport?.recommendedPriorities ?? [])
  ]).slice(0, 5)
}

function collectMasterySignals(studentKnowledge: StudentKnowledgeMastery[] | undefined): string[] {
  return (studentKnowledge ?? [])
    .filter((item) => item.masteryProbability < 0.62 || item.attemptsCount < 2)
    .sort((left, right) => left.masteryProbability - right.masteryProbability)
    .map((item) => {
      const percent = Math.round(item.masteryProbability * 100)
      return `${item.title}（掌握度约 ${percent}%）`
    })
    .slice(0, 4)
}

function collectPrerequisiteSignals(knowledgePrerequisites: KnowledgePrerequisite[] | undefined): string[] {
  return unique(
    (knowledgePrerequisites ?? []).map((item) =>
      item.source === "knowledge_edges" ? `${item.title}（前置依赖）` : `${item.title}（前置概念）`
    )
  ).slice(0, 4)
}

interface ReviewDueItem {
  knowledgeNodeId: string
  title: string
  masteryProbability: number
  daysSinceReview: number
  thresholdDays: number
}

function collectReviewDueItems(
  studentKnowledge: StudentKnowledgeMastery[] | undefined,
  nowIso?: string
): ReviewDueItem[] {
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now()
  if (!Number.isFinite(nowMs)) {
    return []
  }

  return (studentKnowledge ?? [])
    .map((item) => {
      const lastReviewAt = item.lastPracticedAt ?? item.updatedAt
      const lastReviewMs = Date.parse(lastReviewAt)
      if (!Number.isFinite(lastReviewMs) || item.attemptsCount <= 0) {
        return undefined
      }

      const daysSinceReview = Math.floor((nowMs - lastReviewMs) / 86_400_000)
      const thresholdDays = reviewThresholdDays(item.masteryProbability)
      if (daysSinceReview < thresholdDays) {
        return undefined
      }

      return {
        knowledgeNodeId: item.knowledgeNodeId,
        title: item.title,
        masteryProbability: item.masteryProbability,
        daysSinceReview,
        thresholdDays
      }
    })
    .filter((item): item is ReviewDueItem => Boolean(item))
    .sort((left, right) => right.daysSinceReview - left.daysSinceReview)
    .slice(0, 4)
}

function reviewThresholdDays(masteryProbability: number): number {
  if (masteryProbability >= 0.85) return 14
  if (masteryProbability >= 0.7) return 7
  return 3
}

function createReviewDueTasks(reviewDueItems: ReviewDueItem[], trigger: PlannerTrigger): PlannerTask[] {
  const due = reviewDueItems[0]
  if (!due) {
    return []
  }

  const priority = trigger === "review_due" || due.daysSinceReview >= due.thresholdDays * 2 ? "high" : "medium"

  return [
    createTask(
      "review",
      `回顾已间隔 ${due.daysSinceReview} 天的 ${due.title}`,
      `这个点距离上次练习已经超过 ${due.thresholdDays} 天，先用 1 个小例子确认还稳不稳。`,
      10,
      priority
    )
  ]
}

function createPrerequisiteTasks(
  knowledgePrerequisites: KnowledgePrerequisite[] | undefined,
  studentKnowledge: StudentKnowledgeMastery[] | undefined
): PlannerTask[] {
  const prerequisite = (knowledgePrerequisites ?? [])[0]
  if (!prerequisite) {
    return []
  }

  const target = studentKnowledge?.find((item) => item.knowledgeNodeId === prerequisite.targetNodeId)
  const targetTitle = target?.title ?? "当前薄弱知识点"
  const sourceNote =
    prerequisite.source === "knowledge_edges" ? "知识图谱里它是前置节点" : "知识节点记录里它是前置概念"

  return [
    createTask(
      "review",
      `先补前置：${prerequisite.title}`,
      `${sourceNote}，先把它补稳，再回到 ${targetTitle} 会更顺。`,
      10,
      "high"
    )
  ]
}

function createMasteryTasks(studentKnowledge: StudentKnowledgeMastery[] | undefined): PlannerTask[] {
  const weakest = (studentKnowledge ?? [])
    .filter((item) => item.masteryProbability < 0.7)
    .sort((left, right) => left.masteryProbability - right.masteryProbability)[0]

  if (!weakest) {
    return []
  }

  const percent = Math.round(weakest.masteryProbability * 100)

  return [
    createTask(
      "review",
      `先补 ${weakest.title}`,
      `当前记录的掌握度约 ${percent}%，先回到这个点更稳。${weakest.evidenceSummary ? `最近证据：${weakest.evidenceSummary}` : ""}`,
      12,
      "high"
    ),
    createTask(
      "practice",
      `围绕 ${weakest.title} 做 1 道小题并只写第一步`,
      "用最小练习验证是否真的能识别题型，而不是只看懂了解释。",
      15,
      "high"
    )
  ]
}

function createAdaptiveTasks(reviewFocus: string[]): PlannerTask[] {
  if (!reviewFocus.length) {
    return []
  }

  return [
    createTask(
      "review",
      `先复盘最近暴露的薄弱点：${reviewFocus[0]}`,
      "系统最近记录到这个信号，先处理它比盲目往后学更划算。",
      12,
      "high"
    )
  ]
}

function prioritizeTasks(tasks: PlannerTask[]): PlannerTask[] {
  const priorityScore = { high: 3, medium: 2, low: 1 }
  const seen = new Set<string>()

  return tasks
    .filter((task) => {
      if (seen.has(task.title)) return false
      seen.add(task.title)
      return true
    })
    .sort((left, right) => priorityScore[right.priority] - priorityScore[left.priority])
    .slice(0, 5)
}

function createSummary(subjectCode: SubjectCode, reviewFocus: string[], trigger: PlannerTrigger): string {
  const subjectName = subjectLabel(subjectCode)
  const reason =
    trigger === "review_due"
      ? "先安排复习，防止薄弱点滚大"
      : trigger === "user_requested_schedule"
        ? "先给一个短周期安排"
        : "先确定最小下一步"
  const focus = reviewFocus[0] ? `，重点看 ${reviewFocus[0]}` : ""

  return `${subjectName}学习规划：${reason}${focus}。`
}

function createTask(
  type: PlannerTask["type"],
  title: string,
  rationale: string,
  estimatedMinutes: number,
  priority: PlannerTask["priority"]
): PlannerTask {
  return {
    id: `planner-${type}-${createSlug(title)}`,
    type,
    title,
    rationale,
    estimatedMinutes,
    priority
  }
}

function createSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

// ===== Chapter-level DAG Planner =====

/**
 * Build a chapter-level DAG from knowledge prerequisites and student mastery.
 * Groups knowledge nodes by their level (concept, method, theorem, application)
 * and builds chapter dependencies from prerequisite edges.
 */
export function buildChapterDAG(
  knowledgePrerequisites: KnowledgePrerequisite[],
  studentKnowledge: StudentKnowledgeMastery[],
  subjectCode: SubjectCode
): ChapterDAG {
  const masteryMap = new Map(studentKnowledge.map((k) => [k.knowledgeNodeId, k]))
  const chapters = buildChapterNodes(knowledgePrerequisites, masteryMap, subjectCode)
  const chapterMap = new Map(chapters.map((ch) => [ch.id, ch]))

  // Topological sort
  const topologicalOrder = topologicalSort(chapters)

  // Mark ready chapters (all prerequisites completed)
  for (const chapter of chapters) {
    chapter.isReady = chapter.prerequisiteChapterIds.every((id) => chapterMap.get(id)?.isCompleted === true)
  }

  // Find critical path (longest path through the DAG)
  const criticalPath = findCriticalPath(chapters, topologicalOrder)

  // Recommend next chapter: ready chapter with lowest mastery
  const recommendedNext = findRecommendedNext(chapters)

  return { chapters, topologicalOrder, criticalPath, recommendedNext }
}

/**
 * Generate chapter-level tasks and signals from a DAG.
 */
export function generateChapterDAGTasks(dag: ChapterDAG): ChapterDAGResult {
  const chapterTasks: PlannerTask[] = []
  const chapterSignals: string[] = []

  // Task for recommended next chapter
  if (dag.recommendedNext) {
    const chapter = dag.chapters.find((ch) => ch.id === dag.recommendedNext)
    if (chapter) {
      const percent = Math.round(chapter.masteryProbability * 100)
      chapterTasks.push(
        createTask(
          "learn",
          `\u8fdb\u5165\u4e0b\u4e00\u7ae0\uff1a${chapter.title}`,
          `\u524d\u7f6e\u6761\u4ef6\u5df2\u6ee1\u8db3\uff0c\u5f53\u524d\u638c\u63e1\u5ea6\u7ea6 ${percent}%\uff0c\u9002\u5408\u5f00\u59cb\u5b66\u4e60\u3002`,
          20,
          "high"
        )
      )
      chapterSignals.push(`\u63a8\u8350\u4e0b\u4e00\u7ae0\uff1a${chapter.title}\uff08\u638c\u63e1\u5ea6 ${percent}%\uff09`)
    }
  }

  // Tasks for chapters on the critical path with low mastery
  for (const chapterId of dag.criticalPath.slice(0, 3)) {
    const chapter = dag.chapters.find((ch) => ch.id === chapterId)
    if (chapter && !chapter.isCompleted && chapter.masteryProbability < 0.6) {
      const percent = Math.round(chapter.masteryProbability * 100)
      chapterTasks.push(
        createTask(
          "review",
          `\u91cd\u70b9\u653b\u514b\uff1a${chapter.title}`,
          `\u8fd9\u662f\u5b66\u4e60\u8def\u5f84\u5173\u952e\u8282\u70b9\uff0c\u5f53\u524d\u638c\u63e1\u5ea6 ${percent}%\uff0c\u9700\u8981\u4f18\u5148\u8865\u5f3a\u3002`,
          15,
          "high"
        )
      )
      chapterSignals.push(`\u5173\u952e\u8def\u5f84\u8584\u5f31\uff1a${chapter.title}\uff08${percent}%\uff09`)
    }
  }

  // Tasks for ready but not started chapters
  const readyChapters = dag.chapters.filter((ch) => ch.isReady && !ch.isCompleted && ch.id !== dag.recommendedNext)
  for (const chapter of readyChapters.slice(0, 2)) {
    const percent = Math.round(chapter.masteryProbability * 100)
    if (percent < 50) {
      chapterTasks.push(
        createTask(
          "learn",
          `\u9884\u4e60\uff1a${chapter.title}`,
          `\u524d\u7f6e\u5df2\u5c31\u7eea\uff0c\u53ef\u4ee5\u63d0\u524d\u4e86\u89e3\u6838\u5fc3\u6982\u5ff5\u3002`,
          12,
          "medium"
        )
      )
    }
  }

  // Summary signals
  const completedCount = dag.chapters.filter((ch) => ch.isCompleted).length
  const totalCount = dag.chapters.length
  if (totalCount > 0) {
    const progressPercent = Math.round((completedCount / totalCount) * 100)
    chapterSignals.unshift(`\u7ae0\u8282\u8fdb\u5ea6\uff1a${completedCount}/${totalCount}\uff08${progressPercent}%\uff09`)
  }

  if (dag.criticalPath.length > 1) {
    const criticalTitles = dag.criticalPath
      .slice(0, 3)
      .map((id) => dag.chapters.find((ch) => ch.id === id)?.title ?? id)
    chapterSignals.push(`\u5173\u952e\u8def\u5f84\uff1a${criticalTitles.join(" \u2192 ")}`)
  }

  return { dag, chapterTasks, chapterSignals }
}

/**
 * Build chapter nodes by grouping knowledge prerequisites into logical chapters.
 * Each unique prerequisite target becomes a chapter; its prerequisites form chapter edges.
 */
function buildChapterNodes(
  prerequisites: KnowledgePrerequisite[],
  masteryMap: Map<string, StudentKnowledgeMastery>,
  subjectCode: SubjectCode
): ChapterNode[] {
  const chapterMap = new Map<string, ChapterNode>()

  // First pass: create chapters from prerequisite targets
  for (const prereq of prerequisites) {
    if (!chapterMap.has(prereq.targetNodeId)) {
      const mastery = masteryMap.get(prereq.targetNodeId)
      chapterMap.set(prereq.targetNodeId, {
        id: prereq.targetNodeId,
        title: mastery?.title ?? prereq.targetTitle,
        knowledgeNodeIds: [prereq.targetNodeId],
        prerequisiteChapterIds: [],
        difficulty: 1,
        masteryProbability: mastery?.masteryProbability ?? 0,
        isCompleted: (mastery?.masteryProbability ?? 0) >= 0.8,
        isReady: false
      })
    }

    // Add prerequisite edges
    if (prereq.prerequisiteNodeId) {
      const chapter = chapterMap.get(prereq.targetNodeId)!
      if (!chapter.prerequisiteChapterIds.includes(prereq.prerequisiteNodeId)) {
        chapter.prerequisiteChapterIds.push(prereq.prerequisiteNodeId)
      }

      // Ensure prerequisite node also exists as a chapter
      if (!chapterMap.has(prereq.prerequisiteNodeId)) {
        const prereqMastery = masteryMap.get(prereq.prerequisiteNodeId)
        chapterMap.set(prereq.prerequisiteNodeId, {
          id: prereq.prerequisiteNodeId,
          title: prereq.title,
          knowledgeNodeIds: [prereq.prerequisiteNodeId],
          prerequisiteChapterIds: [],
          difficulty: 1,
          masteryProbability: prereqMastery?.masteryProbability ?? 0,
          isCompleted: (prereqMastery?.masteryProbability ?? 0) >= 0.8,
          isReady: false
        })
      }
    }
  }

  return Array.from(chapterMap.values())
}

/**
 * Topological sort of chapter DAG using Kahn's algorithm.
 */
export function topologicalSort(chapters: ChapterNode[]): string[] {
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const chapter of chapters) {
    inDegree.set(chapter.id, 0)
    adjacency.set(chapter.id, [])
  }

  for (const chapter of chapters) {
    for (const prereqId of chapter.prerequisiteChapterIds) {
      if (adjacency.has(prereqId)) {
        adjacency.get(prereqId)!.push(chapter.id)
        inDegree.set(chapter.id, (inDegree.get(chapter.id) ?? 0) + 1)
      }
    }
  }

  const queue: string[] = []
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id)
    }
  }

  const result: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    result.push(current)
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) {
        queue.push(neighbor)
      }
    }
  }

  return result
}

/**
 * Find the critical path (longest path) through the DAG.
 */
export function findCriticalPath(chapters: ChapterNode[], topologicalOrder: string[]): string[] {
  const chapterMap = new Map(chapters.map((ch) => [ch.id, ch]))
  const dist = new Map<string, number>()
  const prev = new Map<string, string | null>()

  for (const id of topologicalOrder) {
    dist.set(id, 0)
    prev.set(id, null)
  }

  for (const id of topologicalOrder) {
    const chapter = chapterMap.get(id)
    if (!chapter) continue

    for (const neighborId of topologicalOrder) {
      const neighbor = chapterMap.get(neighborId)
      if (!neighbor) continue
      if (neighbor.prerequisiteChapterIds.includes(id)) {
        const newDist = (dist.get(id) ?? 0) + 1
        if (newDist > (dist.get(neighborId) ?? 0)) {
          dist.set(neighborId, newDist)
          prev.set(neighborId, id)
        }
      }
    }
  }

  // Find the node with maximum distance
  let maxDist = 0
  let maxNode = topologicalOrder[0] ?? ""
  for (const [id, d] of dist) {
    if (d > maxDist) {
      maxDist = d
      maxNode = id
    }
  }

  // Reconstruct path
  const path: string[] = []
  let current: string | null = maxNode
  while (current !== null) {
    path.unshift(current)
    current = prev.get(current) ?? null
  }

  return path
}

/**
 * Find the recommended next chapter: ready chapter with lowest mastery.
 */
export function findRecommendedNext(chapters: ChapterNode[]): string | null {
  const readyChapters = chapters.filter((ch) => ch.isReady && !ch.isCompleted)

  if (readyChapters.length === 0) {
    return null
  }

  return readyChapters.sort((a, b) => a.masteryProbability - b.masteryProbability)[0].id
}
