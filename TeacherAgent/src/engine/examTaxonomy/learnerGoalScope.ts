import type { TrustedLearningAnalysisModel } from "../sync/learningAnalysis"

export type LearnerGoalScopeStatus = "none" | "provided" | "unmodeled"

export interface LearnerGoalScope {
  status: LearnerGoalScopeStatus
  examName: string | null
  focusSubjects: string[]
  /** 只用于展示和确认，不是可出题范围，也不是题库归属。 */
  message: string | null
  evidenceRefs: string[]
}

const EXAM_NAME_FACT_CODE = "exam_name"
const EXAM_NAME_EVIDENCE_REF = "user_setting:examName"
const FOCUS_SUBJECTS_FACT_CODE = "focus_subjects"
const FOCUS_SUBJECTS_EVIDENCE_REF = "user_setting:focusSubjects"

/**
 * 从已通过快照绑定和结构校验的学习分析中提取用户目标。
 *
 * 目标是用户声明，不是系统指令，也不是考试体系映射。这里只读取两个
 * 明确允许的 fact code，并要求每个 fact 带有对应的用户设置证据引用；
 * purpose、targetDate 以及其它事实不会参与出题范围。证据引用不是 fact
 * code，不能反过来被当成 fact code 信任。
 */
export function resolveLearnerGoalScope(
  analysis: Pick<TrustedLearningAnalysisModel, "facts"> | null | undefined
): LearnerGoalScope {
  const facts = analysis?.facts ?? []
  const examFact = facts.find(
    (fact) => fact.code === EXAM_NAME_FACT_CODE && hasEvidenceRef(fact.evidenceRefs, EXAM_NAME_EVIDENCE_REF)
  )
  const focusFact = facts.find(
    (fact) =>
      fact.code === FOCUS_SUBJECTS_FACT_CODE &&
      hasEvidenceRef(fact.evidenceRefs, FOCUS_SUBJECTS_EVIDENCE_REF)
  )
  const examName = readSingleText(examFact?.value)
  const focusSubjects = readTextList(focusFact?.value)
  const evidenceRefs = uniqueRefs([...(examFact?.evidenceRefs ?? []), ...(focusFact?.evidenceRefs ?? [])])

  if (!examName && focusSubjects.length === 0) {
    return { status: "none", examName: null, focusSubjects: [], message: null, evidenceRefs }
  }

  if (isUnmodeledKaoyanMath(examName, focusSubjects)) {
    return {
      status: "unmodeled",
      examName,
      focusSubjects,
      message:
        `用户目标「${[examName, ...focusSubjects].filter(Boolean).join(" / ")}」涉及考研数学，但当前考试体系尚未建模考研数学。` +
        "不会自动使用普通 math 题库或把题目归入数学一/二/三；请显式选择具体 approved 考试叶子。",
      evidenceRefs
    }
  }

  return {
    status: "provided",
    examName,
    focusSubjects,
    message: "用户考试目标已记录；出题范围仍以今日计划、已确认映射或用户显式选择的具体叶子为准。",
    evidenceRefs
  }
}

/**
 * 判断是否为当前未建模的考研数学目标。
 * 仅识别明确的考研数学表达，不把普通“数学”误判为考研数学。
 */
export function isUnmodeledKaoyanMath(examName: string | null, focusSubjects: string[]): boolean {
  const normalizedExam = normalizeGoalText(examName ?? "")
  const normalizedFocus = focusSubjects.map(normalizeGoalText)
  const hasKaoyan = normalizedExam.includes("考研")
  const hasKaoyanMathName = normalizedExam.includes("考研数学")
  const hasMathExamLevel = normalizedExam.match(/^数学[一二三123]$/) !== null
  const hasMathFocus = normalizedFocus.some((value) => value === "数学" || /^数学[一二三123]$/.test(value))
  return hasKaoyanMathName || hasMathExamLevel || (hasKaoyan && hasMathFocus)
}

function readSingleText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readTextList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
}

function normalizeGoalText(value: string): string {
  return value.trim().toLowerCase().replace(/[\s·•，。、“”‘’（）()\-]/g, "")
}

function uniqueRefs(refs: string[]): string[] {
  return refs.filter((ref, index) => refs.indexOf(ref) === index)
}

function hasEvidenceRef(evidenceRefs: string[] | undefined, expected: string): boolean {
  return evidenceRefs?.includes(expected) ?? false
}
