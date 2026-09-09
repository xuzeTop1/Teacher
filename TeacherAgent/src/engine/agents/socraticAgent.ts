import type { HintLevel } from "../../types/agent"
import type { SubjectCode } from "../../types/learning"
import type { TutorMode, TutorPromptMessage } from "../prompts/tutorPromptBuilder"

export type SocraticStrategyName =
  | "probing_question"
  | "decomposition"
  | "counterexample"
  | "reflection_question"
  | "analogy_bridge"
  | "direct_review"

export type ExplanationDepth = "none" | "concept" | "method" | "key_step" | "full_review"

export interface SocraticInput {
  userMessage: string
  recentMessages?: TutorPromptMessage[]
  subjectCode: SubjectCode
  requestedMode?: TutorMode
  requestedMaxHintLevel?: HintLevel
}

export type SocraticIntent =
  | "concept_question"
  | "outline_summary"
  | "practice_solve"
  | "direct_answer_request"
  | "review"
  | "learning_plan"
  | "exam_sprint"
  | "emotional_support"
  | "counterexample"
  | "answer_with_reasoning"
  | "default_guide"
  | "xingce_practice"
  | "xingce_method"
  | "shenlun_material"
  | "shenlun_outline"
  | "shenlun_rewrite"
  | "shenlun_essay_structure"
  | "code_debug"
  | "code_explain"
  | "code_run_request"

export interface SocraticDecision {
  mode: TutorMode
  maxHintLevel: HintLevel
  strategy: SocraticStrategyName
  shouldAskQuestion: boolean
  explanationDepth: ExplanationDepth
  intent: SocraticIntent
  rationale: string
  riskSignals: string[]
}

export function selectSocraticStrategy(input: SocraticInput): SocraticDecision {
  const message = input.userMessage.trim()
  const riskSignals = detectRiskSignals(message)
  const requested = createRequestedOverride(input)

  if (requested) {
    return {
      ...requested,
      intent: requested.intent ?? "default_guide",
      riskSignals,
      rationale: `${requested.rationale}；用户或调用方显式指定了教学模式/提示等级。`
    }
  }

  if (isEmotionalDistress(message)) {
    return {
      mode: "guide",
      maxHintLevel: "L1",
      strategy: "reflection_question",
      shouldAskQuestion: true,
      explanationDepth: "none",
      intent: "emotional_support",
      rationale: "学生表达了挫败或压力，先降低认知负荷，用一个很小的问题恢复可行动感。",
      riskSignals: [...riskSignals, "emotional_support"]
    }
  }

  if (asksForReview(message)) {
    return {
      mode: "review",
      maxHintLevel: "L4",
      strategy: "direct_review",
      shouldAskQuestion: false,
      explanationDepth: "full_review",
      intent: "review",
      rationale: "学生在请求复盘、订正或完整解析，允许更完整地梳理步骤和错误点。",
      riskSignals
    }
  }

  if (asksForLearningPlan(message)) {
    return {
      mode: "review",
      maxHintLevel: "L3",
      strategy: "direct_review",
      shouldAskQuestion: false,
      explanationDepth: "method",
      intent: "learning_plan",
      rationale: "学生主动请求学习规划或下一步安排，触发 PlannerAgent，而不是进入普通解题链路。",
      riskSignals: [...riskSignals, "plan_learning_request"]
    }
  }

  if (asksForDirectAnswer(message)) {
    return {
      mode: "guide",
      maxHintLevel: "L2",
      strategy: "probing_question",
      shouldAskQuestion: true,
      explanationDepth: "method",
      intent: "direct_answer_request",
      rationale: "学生倾向于索要答案但没有明确展示尝试，先给方向性提示并追问下一步。",
      riskSignals: [...riskSignals, "direct_answer_request"]
    }
  }

  if (hasAnswerWithReasoning(message)) {
    return {
      mode: "review",
      maxHintLevel: "L4",
      strategy: "direct_review",
      shouldAskQuestion: false,
      explanationDepth: "full_review",
      intent: "answer_with_reasoning",
      rationale: "学生已给出结论和推导依据，应先确认正确、补充规范表达，不再追问基础点。",
      riskSignals
    }
  }

  // ── 考公 · 行测（受 subjectCode 守卫，优先于通用 hasStudentAttempt）──
  if (input.subjectCode === "xingce") {
    if (asksForXingcePractice(message)) {
      return {
        mode: "diagnose",
        maxHintLevel: "L2",
        strategy: "decomposition",
        shouldAskQuestion: true,
        explanationDepth: "method",
        intent: "xingce_practice",
        rationale: "行测用户要题型训练/出题，先讲题型与步骤，再出对应一题。",
        riskSignals
      }
    }
    if (asksForXingceMethod(message)) {
      return {
        mode: "explain",
        maxHintLevel: "L2",
        strategy: "decomposition",
        shouldAskQuestion: true,
        explanationDepth: "method",
        intent: "xingce_method",
        rationale: "行测方法讲解：拆解题型、给解题流程与高频陷阱，保留关键一步让用户完成。",
        riskSignals
      }
    }
  }

  // ── 考公 · 申论（受 subjectCode 守卫，优先于通用 hasStudentAttempt）──
  if (input.subjectCode === "shenlun") {
    if (asksForShenlunMaterial(message)) {
      return {
        mode: "explain",
        maxHintLevel: "L2",
        strategy: "decomposition",
        shouldAskQuestion: true,
        explanationDepth: "method",
        intent: "shenlun_material",
        rationale: "申论材料拆解/概括：先带用户拆材料、标要点，不直接给成品概括。",
        riskSignals
      }
    }
    if (asksForShenlunOutline(message)) {
      return {
        mode: "explain",
        maxHintLevel: "L2",
        strategy: "decomposition",
        shouldAskQuestion: true,
        explanationDepth: "method",
        intent: "shenlun_outline",
        rationale: "申论提纲辅导：给结构框架与分论点搭建方法，不代写全文。",
        riskSignals
      }
    }
    if (asksForShenlunRewrite(message)) {
      return {
        mode: "review",
        maxHintLevel: "L3",
        strategy: "direct_review",
        shouldAskQuestion: false,
        explanationDepth: "key_step",
        intent: "shenlun_rewrite",
        rationale: "申论段落改写/润色：在用户已有段落上改，说明改写依据，贴近机关文风去 AI 味。",
        riskSignals
      }
    }
    if (asksForShenlunEssay(message)) {
      return {
        mode: "explain",
        maxHintLevel: "L2",
        strategy: "decomposition",
        shouldAskQuestion: true,
        explanationDepth: "method",
        intent: "shenlun_essay_structure",
        rationale: "申论大作文结构辅导：审题立意、总分论点、结构，不默认输出整篇代写。",
        riskSignals
      }
    }
  }

  // ── 编程学科（受 subjectCode 守卫）──
  if (input.subjectCode === "programming") {
    if (asksForCodeDebug(message)) {
      return {
        mode: "diagnose",
        maxHintLevel: "L2",
        strategy: "decomposition",
        shouldAskQuestion: true,
        explanationDepth: "key_step",
        intent: "code_debug",
        rationale: "学生遇到报错或 bug，先定位错误行，再问学生该行做了什么，引导逐步排查。",
        riskSignals: [...riskSignals, "code_debug"]
      }
    }
    if (asksForCodeExplain(message)) {
      return {
        mode: "explain",
        maxHintLevel: "L2",
        strategy: "decomposition",
        shouldAskQuestion: true,
        explanationDepth: "concept",
        intent: "code_explain",
        rationale: "学生想理解代码逻辑，先解释关键语句的作用，再用小问题确认理解。",
        riskSignals
      }
    }
    if (asksForCodeRun(message)) {
      return {
        mode: "diagnose",
        maxHintLevel: "L3",
        strategy: "direct_review",
        shouldAskQuestion: false,
        explanationDepth: "key_step",
        intent: "code_run_request",
        rationale: "学生请求运行代码，先执行并展示结果，再引导分析输出或错误。",
        riskSignals: [...riskSignals, "code_run_request"]
      }
    }
  }

  if (hasStudentAttempt(message) || recentStudentAttempt(input.recentMessages)) {
    return {
      mode: "diagnose",
      maxHintLevel: "L3",
      strategy: "decomposition",
      shouldAskQuestion: true,
      explanationDepth: "key_step",
      intent: "practice_solve",
      rationale: "学生已经给出思路或步骤，适合诊断最小关键点，而不是重新讲整题。",
      riskSignals
    }
  }

  if (asksForOutlineOrSummary(message)) {
    return {
      mode: "explain",
      maxHintLevel: "L2",
      strategy: "direct_review",
      shouldAskQuestion: false,
      explanationDepth: "concept",
      intent: "outline_summary",
      rationale: "学生在查询资料摘要、考试大纲、章节框架或内容范围，先结构化概括，不强制追问。",
      riskSignals
    }
  }

  if (asksForConcept(message)) {
    return {
      mode: "explain",
      maxHintLevel: "L2",
      strategy: input.subjectCode === "english" ? "analogy_bridge" : "decomposition",
      shouldAskQuestion: false,
      explanationDepth: "concept",
      intent: "concept_question",
      rationale: "学生在问定义、定理、原因、区别、用途或要求通俗解释，应先给出可核验的核心解释；除非学生明确要求练习或检查理解，否则不额外追问。",
      riskSignals
    }
  }

  if (asksForCounterexample(message)) {
    return {
      mode: "guide",
      maxHintLevel: "L2",
      strategy: "counterexample",
      shouldAskQuestion: true,
      explanationDepth: "method",
      intent: "counterexample",
      rationale: "学生的问题适合通过反例或边界条件澄清误区。",
      riskSignals
    }
  }

  if (asksForExamSprint(message)) {
    return {
      mode: "exam_sprint",
      maxHintLevel: "L3",
      strategy: "decomposition",
      shouldAskQuestion: true,
      explanationDepth: "method",
      intent: "exam_sprint",
      rationale: "学生强调考试或提分目标，适合用步骤化策略和考点边界推进。",
      riskSignals
    }
  }

  return {
    mode: "guide",
    maxHintLevel: "L2",
    strategy: "probing_question",
    shouldAskQuestion: true,
    explanationDepth: "method",
    intent: "default_guide",
    rationale: "默认使用苏格拉底式引导，用一个小问题推动学生先尝试关键一步。",
    riskSignals
  }
}

function createRequestedOverride(input: SocraticInput): SocraticDecision | undefined {
  if (!input.requestedMode && !input.requestedMaxHintLevel) {
    return undefined
  }

  const mode = input.requestedMode ?? "guide"
  const maxHintLevel = input.requestedMaxHintLevel ?? defaultHintLevelForMode(mode)

  return {
    mode,
    maxHintLevel,
    strategy: strategyForMode(mode),
    shouldAskQuestion: mode !== "review",
    explanationDepth: explanationDepthForMode(mode, maxHintLevel),
    intent: intentForMode(mode),
    rationale: "采用外部传入的模式或提示等级",
    riskSignals: []
  }
}

function intentForMode(mode: TutorMode): SocraticIntent {
  if (mode === "review") return "review"
  if (mode === "exam_sprint") return "exam_sprint"
  if (mode === "diagnose") return "practice_solve"
  if (mode === "explain") return "concept_question"
  return "default_guide"
}

function defaultHintLevelForMode(mode: TutorMode): HintLevel {
  if (mode === "review") return "L4"
  if (mode === "exam_sprint" || mode === "diagnose") return "L3"
  return "L2"
}

function strategyForMode(mode: TutorMode): SocraticStrategyName {
  if (mode === "review") return "direct_review"
  if (mode === "explain") return "analogy_bridge"
  if (mode === "diagnose" || mode === "exam_sprint") return "decomposition"
  return "probing_question"
}

function explanationDepthForMode(mode: TutorMode, maxHintLevel: HintLevel): ExplanationDepth {
  if (mode === "review" || maxHintLevel === "L4") return "full_review"
  if (mode === "diagnose" || maxHintLevel === "L3") return "key_step"
  if (mode === "explain") return "concept"
  if (maxHintLevel === "L0" || maxHintLevel === "L1") return "none"
  return "method"
}

function detectRiskSignals(message: string): string[] {
  const signals: string[] = []

  if (asksForDirectAnswer(message)) {
    signals.push("direct_answer_request")
  }

  if (/(?:作弊|代考|替我|帮我写完|直接交|不要解释)/i.test(message)) {
    signals.push("academic_integrity_risk")
  }

  if (/(?:手机号|身份证|准考证|密码|api key|token|密钥)/i.test(message)) {
    signals.push("personal_data_risk")
  }

  return signals
}

function asksForReview(message: string): boolean {
  return /(?:复盘|订正|我做完了|已经做完|完整解析|完整讲解|帮我检查|看看我哪里错|批改)/i.test(message)
}

function asksForLearningPlan(message: string): boolean {
  return /(?:接下来学什么|下一步学什么|怎么安排|学习计划|复习计划|规划|路径|路线|今天学|这周学|备考安排|怎么复习|薄弱点)/i.test(
    message
  )
}

function asksForDirectAnswer(message: string): boolean {
  return /(?:直接给答案|答案是啥|答案是什么|最终答案|别废话|只要答案|不用过程|告诉我结果)/i.test(message)
}

function asksForConcept(message: string): boolean {
  return /(?:什么是|是什么|是啥|何为|为什么|解释|定义|原理|区别|本质|概念|怎么理解|用人话|通俗.{0,4}(?:说|讲|解释)|简单.{0,4}(?:说|讲|解释)|说白了|打个比方|有什么用|用来干什么|能用来干什么|用途|应用场景|有什么作用|how|why|what is|explain)/i.test(message)
}

function asksForCounterexample(message: string): boolean {
  return /(?:反例|一定|总是|必然|有没有例外|边界情况|不成立|counterexample)/i.test(message)
}

function asksForOutlineOrSummary(message: string): boolean {
  return /(?:考哪些|考什么|大纲|考试范围|讲了什么|讲了啥|包含哪些|主要学什么|主要讲|总结资料|总结一下|帮我总结|summarize|syllabus|outline|scope|涵盖了|覆盖了|目录|章节框架|内容范围|考试内容|知识点有哪些|知识框架)/i.test(
    message
  )
}

function asksForExamSprint(message: string): boolean {
  return /(?:冲刺|提分|速成|刷题|考点|高频题|真题|模拟题)/i.test(message)
}

function hasStudentAttempt(message: string): boolean {
  return /(?:我觉得|我认为|我算|我写|我的思路|是不是|对吗|哪里错|因为|所以|=>|=|≈|->|→)/i.test(message)
}

function recentStudentAttempt(messages: TutorPromptMessage[] | undefined): boolean {
  return Boolean(messages?.slice(-3).some((message) => message.role === "user" && hasStudentAttempt(message.content)))
}

function isEmotionalDistress(message: string): boolean {
  return /(?:不会|看不懂|学不会|太难|崩溃|烦死|我太笨|绝望|焦虑|emo)/i.test(message)
}

/**
 * 检测学生是否已给出结论 + 推导依据（答对闭环场景）。
 * 例如："tanx 等价于 x 所以极限值为 3/2"
 * 当学生同时包含推导关键词和结论关键词时，应确认而非追问。
 */
function hasAnswerWithReasoning(message: string): boolean {
  // 推导关键词：等价、代入、化简、因为/所以、=> 等
  const hasReasoning = /(?:等价|等价于|~|代入|化简|展开|约分|通分|洛必达|夹逼|因为|所以|=>|->|→|因此|故|于是)/i.test(message)
  // 结论关键词：包含等式结构（=、≈、→、为、是）或分数形式，
  // 或包含明确的数学表达式（字母+运算符/等号/分式）
  const hasConclusion =
    // "等于/为/是 + 数值或分数"
    /(?:极限值|极限|答案|结果|值|等于|得出|算出|为)\s*(?:答案|结果)?\s*(?:[是为]?\s*)?[:：]?\s*(?:\d[\d\s/+\-*.]*\d|\d+|[一二三四五六七八九十])/i.test(message)
    // "所以/因此...等于/为/是 + 数值"
    || /(?:所以|因此|故|于是)\s*.{0,8}(?:等于|为|是)\s*[:：]?\s*(?:\d[\d\s/+\-*.]*\d|\d+)/i.test(message)
    // 包含等式结构（x = ...、= 3/2、≈ 0.5、~ 3x）：字母+等号/约等+内容
    || /[a-zA-Z]\s*(?:=|≈|~=|~)\s*\S+/.test(message)
    // 分数形式（3/2、1/3）
    || /\d+\s*\/\s*\d+/.test(message)
    // 代数表达式含运算符（tan 3x、sin(x)、x^2）
    || /(?:tan|sin|cos|log|ln|exp|sqrt)\s*\S+/.test(message)

  return hasReasoning && hasConclusion
}

// ── 考公检测函数 ──────────────────────────────────────────────────────

function asksForXingcePractice(message: string): boolean {
  return /(?:给我|来|出|要|再来|换).{0,8}(?:行测|言语|判断推理|资料分析|数量关系|常识).{0,6}(?:题|练习|训练)|(?:言语|判断推理|资料分析|数量关系|常识).{0,6}(?:题|练习|训练|模拟)/i.test(message)
}

function asksForXingceMethod(message: string): boolean {
  return /(?:行测|言语|判断推理|资料分析|数量关系|常识).{0,10}(?:怎么|如何|方法|技巧|步骤|思路|为什么)/i.test(message)
}

function asksForShenlunMaterial(message: string): boolean {
  return /(?:总结|概括|归纳|拆解?|分析|梳理).{0,10}(?:材料|这份|这段|这份材料|这段材料|申论材料)|(?:材料|这份|这段).{0,10}(?:总结|概括|归纳|拆解?|分析)/i.test(message)
}

function asksForShenlunOutline(message: string): boolean {
  return /(?:搭|列|写|拟).{0,6}(?:提纲|框架)|提纲辅导|帮我搭|作文提纲|大作文.*提纲/i.test(message)
}

function asksForShenlunRewrite(message: string): boolean {
  return /(?:改|润色|改写|优化|调整).{0,10}(?:这段|这段申论|这段话|这段材料|我的申论)|帮我改|帮我润色|去.{0,4}ai味|去ai味/i.test(message)
}

function asksForShenlunEssay(message: string): boolean {
  return /(?:大作文|申论作文|文章结构|立意|总分论点|分论点|开头结尾|引论本论结论)/i.test(message)
}

// ── 编程检测函数 ──────────────────────────────────────────────────────

function asksForCodeDebug(message: string): boolean {
  return /(?:Traceback|File ".*", line \d+|SyntaxError|TypeError|NameError|ValueError|IndentationError|ZeroDivisionError|IndexError|KeyError|AttributeError|ImportError|报错|出错|error|bug|异常|哪里错|为什么错|不对|不工作|运行不了|跑不通)/i.test(message)
}

function asksForCodeExplain(message: string): boolean {
  return /(?:这段代码|这个代码|上面的代码|解释.*代码|代码.*意思|代码.*做什么|这段.*做什么|怎么理解.*代码|代码.*解释|explain.*code|what does.*do)/i.test(message)
}

function asksForCodeRun(message: string): boolean {
  return /(?:运行|执行|跑一下|帮我跑|run|execute|试一下|看看结果|看看输出|跑.*代码|执行.*代码)/i.test(message)
}
