/**
 * 计划建议稿（proposal）生成引擎（纯规则，无 LLM 调用）。
 *
 * 边界：
 * - 只有用户显式确认的学科映射参与掌握度分析；无映射科目只进入执行分析。
 * - 掌握度只来自答题/诊断证据（approved 题库）；学习时长只影响投入度描述。
 * - 本引擎只生成 proposal（建议稿），不直接修改手机数据；手机端用户明确采纳后才写库。
 * - 本引擎不产生学生可见的 LLM 内容，输出为结构化数据，不涉及 GuardrailAgent 审核路径；
 *   若未来接入 LLM 生成建议文案，必须走 GuardrailAgent。
 *
 * 建议结构：
 * - proposedWeeklyGoals：本周结果目标（默认下一自然周），不强制拆成每日任务。
 * - proposedTasks：执行计划（可带 subjectRemoteId / targetDurationSeconds / dueAt）。
 * - rationale：中文生成依据（计划完成率、投入度、诊断正确率、薄弱节点）。
 */

import { mondayOfWeek, type WeeklyReport } from "./weeklyReport"
import type { ProposedTask, ProposedWeeklyGoal, SubjectMapping, SyncProposal } from "../../types/sync"
import type { ProposalOutcome } from "./proposalOutcome"

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export interface DiagnosticEvidence {
  assessmentId: string
  /** 该批诊断中全部真实持久化的 assessment id（proposal 的 sourceAssessmentIds 使用） */
  assessmentIds: string[]
  /** 新证据的主归属键；旧 localStorage 记录可能缺失，兼容逻辑必须 fail-closed。 */
  alertSubjectRemoteId?: string | null
  teacherSubjectId: string
  /** 诊断生成时的考试体系范围；旧记录缺失时保持兼容但不猜测叶子。 */
  examTrackId?: string | null
  examSubjectId?: string | null
  examModuleId?: string | null
  /** 只统计成功持久化的题数（未落库的答题不得计入） */
  questionCount: number
  /** 成功持久化题中的答对数 */
  correctCount: number
  /** 诊断完成时间（epoch ms） */
  atMs: number
  /** DB-authoritative creation timestamp when rebuilt from assessment_results. */
  createdAt?: string
}

export interface WeakNode {
  nodeId: string
  title: string
  mastery: number
}

export interface ProposalPlannerInput {
  report: WeeklyReport
  mappings: SubjectMapping[]
  /** 每个 AlertTime 映射下的薄弱节点（attempts ≥ 1 且掌握度 < 0.6），由调用方预过滤。 */
  weakNodesByMapping: Record<string, WeakNode[]>
  /** 最近诊断证据（只使用 approved 题库答题产生的评估） */
  diagnosticEvidence: DiagnosticEvidence[]
  /** 最近仍可由 sourceProposalId 证明的 accepted proposal 执行结果。 */
  latestAcceptedOutcome?: ProposalOutcome | null
  /** 全部 accepted proposal，作为同一计划周期内的保守去重证据。 */
  acceptedProposals?: SyncProposal[]
  /** 按 proposalId 关联的执行结果；不可追踪结果保留为 null/undefined。 */
  acceptedProposalOutcomes?: Record<string, ProposalOutcome | null | undefined>
  /** 当前仍 pending 的 proposal；只用于避免生成同标题同科目的重复建议。 */
  pendingProposals?: SyncProposal[]
  nowMs?: number
}

export interface ProposalDraft {
  rationale: string
  proposedWeeklyGoals: ProposedWeeklyGoal[]
  proposedTasks: ProposedTask[]
  sourceAssessmentIds: string[]
}

export interface ProposalGate {
  allowed: boolean
  reason: string
}

const MAX_WEEKLY_GOALS = 3
const MAX_TASKS = 6
const WEAK_MASTERY_THRESHOLD = 0.6
const CORRECT_RATE_THRESHOLD = 0.7
const DAY_MS = 24 * 60 * 60 * 1000

export function canGenerateProposal(input: ProposalPlannerInput): ProposalGate {
  if (uniqueMappings(input.mappings).length === 0) {
    return {
      allowed: false,
      reason:
        "尚未映射学科。请先在「学科映射」中明确选择 AlertTime 科目对应的 TeacherAgent 学科，之后才能基于答题证据生成学习计划建议。"
    }
  }
  if (input.diagnosticEvidence.length === 0) {
    return {
      allowed: false,
      reason:
        "没有可用的持久化诊断证据。请先完成一次 approved 题库诊断，且至少一题的评估结果成功写入 assessment_results 后再生成建议。"
    }
  }
  if (usableEvidenceForMappings(input.mappings, input.diagnosticEvidence).length === 0) {
    return {
      allowed: false,
      reason:
        "现有诊断证据无法绑定到当前学科映射（旧证据存在多映射歧义或考试范围已变化）。请重新完成对应 AlertTime 科目的 approved 诊断后再生成建议。"
    }
  }
  return { allowed: true, reason: "" }
}

/** 某映射学科的诊断证据。 */
function uniqueMappings(mappings: SubjectMapping[]): SubjectMapping[] {
  const seen = new Set<string>()
  return mappings.filter((mapping) => {
    if (!mapping.alertSubjectRemoteId || seen.has(mapping.alertSubjectRemoteId)) return false
    seen.add(mapping.alertSubjectRemoteId)
    return true
  })
}

/**
 * 证据优先按 AlertTime mapping 主键归属。
 * 旧 localStorage 证据缺失 remoteId 时，仅在当前 teacherSubjectId 唯一映射时兼容；
 * 同一 teacherSubjectId 对应多个手机科目时拒绝猜测叶子。
 */
function evidenceFor(
  mapping: SubjectMapping,
  mappings: SubjectMapping[],
  evidence: DiagnosticEvidence[]
): DiagnosticEvidence[] {
  const sameTeacherMappings = mappings.filter((item) => item.teacherSubjectId === mapping.teacherSubjectId)
  return evidence.filter((item) => {
    if (!item.assessmentId || item.assessmentIds.length === 0 || item.questionCount <= 0) return false
    if (item.alertSubjectRemoteId) {
      if (item.alertSubjectRemoteId !== mapping.alertSubjectRemoteId) return false
      // 如果证据带考试范围，范围也必须仍与当前 mapping 一致，防止 mapping 改指后复用旧诊断。
      if (item.examTrackId != null && item.examTrackId !== (mapping.examTrackId ?? null)) return false
      if (item.examSubjectId != null && item.examSubjectId !== (mapping.examSubjectId ?? null)) return false
      if (item.examModuleId != null && item.examModuleId !== (mapping.examModuleId ?? null)) return false
      return true
    }
    if (sameTeacherMappings.length !== 1) return false
    return item.teacherSubjectId === mapping.teacherSubjectId
  })
}

function usableEvidenceForMappings(
  mappings: SubjectMapping[],
  evidence: DiagnosticEvidence[]
): DiagnosticEvidence[] {
  const unique = uniqueMappings(mappings)
  const usable = new Map<string, DiagnosticEvidence>()
  for (const mapping of unique) {
    for (const item of evidenceFor(mapping, unique, evidence)) {
      usable.set(`${mapping.alertSubjectRemoteId}:${item.assessmentId}`, item)
    }
  }
  return [...usable.values()]
}

function correctnessSummary(evidence: DiagnosticEvidence[]): string {
  if (evidence.length === 0) return "尚未完成诊断"
  const correct = evidence.reduce((sum, item) => sum + item.correctCount, 0)
  const total = evidence.reduce((sum, item) => sum + item.questionCount, 0)
  const rate = total > 0 ? correct / total : 0
  return rate >= CORRECT_RATE_THRESHOLD
    ? `诊断正确率 ${Math.round(rate * 100)}%（${correct}/${total}）`
    : `诊断正确率 ${Math.round(rate * 100)}%（${correct}/${total}），建议先巩固薄弱点`
}

function engagementText(report: WeeklyReport): string {
  if (report.effectiveSeconds <= 0) return "本周尚无有效学习时长"
  const minutes = Math.round(report.effectiveSeconds / 60)
  const days = report.studyDays
  return `本周有效学习 ${minutes} 分钟（${days} 天）`
}

function outcomeText(outcome: ProposalOutcome | null | undefined): string | null {
  if (!outcome?.traceable) return null
  const task = outcome.tasksSummary
  const goal = outcome.weeklyGoalsSummary
  const rate = outcome.totalSummary.completionRate
  const rateText = rate === null ? "暂无完成率" : `总完成率 ${Math.round(rate * 100)}%`
  return `最近一次可追踪的采纳建议执行情况：任务已完成 ${task.completed}/${task.expected}（待完成 ${task.pending}、已关闭 ${task.closed}、已删除 ${task.deleted}、未追踪 ${task.missing}），周目标已完成 ${goal.completed}/${goal.expected}（待完成 ${goal.pending}、已关闭 ${goal.closed}、已删除 ${goal.deleted}、未追踪 ${goal.missing}），${rateText}`
}

function acceptedWaitingText(proposal: SyncProposal): string {
  return `建议 ${proposal.proposalId} 已采纳，等待下一次手机同步确认`
}

function proposalCycleWeekStart(proposal: SyncProposal): number {
  // proposal.createdAt is the only stable fallback for tasks without dueAt;
  // generated proposals target the next natural week.
  return mondayOfWeek(proposal.createdAt) + WEEK_MS
}

function dueSemantic(dueAt: number | null, fallbackWeekStart: number): string {
  if (dueAt === null) return `week:${fallbackWeekStart}:none`
  const weekStart = mondayOfWeek(dueAt)
  const dayOffset = Math.floor((dueAt - weekStart) / DAY_MS)
  return `week:${weekStart}:day:${dayOffset}`
}

function sameTaskPlanCycle(left: ProposedTask, right: ProposedTask, leftWeekStart: number, rightWeekStart: number): boolean {
  return (
    left.title === right.title &&
    left.subjectRemoteId === right.subjectRemoteId &&
    dueSemantic(left.dueAt, leftWeekStart) === dueSemantic(right.dueAt, rightWeekStart)
  )
}

function sameGoalPlanCycle(left: ProposedWeeklyGoal, right: ProposedWeeklyGoal): boolean {
  return left.weekStart === right.weekStart && left.title === right.title
}

function hasTaskDuplicate(
  task: ProposedTask,
  pendingProposals: SyncProposal[],
  acceptedProposals: SyncProposal[],
  cycleWeekStart: number
): boolean {
  const pendingProposalMatch = pendingProposals.some(
    (proposal) =>
      proposal.status === "pending" &&
      proposal.proposedTasks.some(
        (pending) => sameTaskPlanCycle(task, pending, cycleWeekStart, proposalCycleWeekStart(proposal))
      )
  )
  if (pendingProposalMatch) return true
  return acceptedProposals.some((proposal) =>
    proposal.status === "accepted" &&
    proposal.proposedTasks.some((accepted) =>
      sameTaskPlanCycle(task, accepted, cycleWeekStart, proposalCycleWeekStart(proposal))
    )
  )
}

function hasGoalDuplicate(
  goal: ProposedWeeklyGoal,
  pendingProposals: SyncProposal[],
  acceptedProposals: SyncProposal[]
): boolean {
  const pendingProposalMatch = pendingProposals.some(
    (proposal) =>
      proposal.status === "pending" &&
      proposal.proposedWeeklyGoals.some(
        (pending) => sameGoalPlanCycle(goal, pending)
      )
  )
  if (pendingProposalMatch) return true
  return acceptedProposals.some((proposal) =>
    proposal.status === "accepted" &&
    proposal.proposedWeeklyGoals.some((accepted) => sameGoalPlanCycle(goal, accepted))
  )
}

/**
 * 生成计划建议稿。要求：至少一个已确认的学科映射。
 * 有诊断证据的科目进入掌握度分析；无证据科目仍可生成执行层面的建议并建议先诊断。
 */
export function planProposal(input: ProposalPlannerInput): ProposalDraft {
  const gate = canGenerateProposal(input)
  if (!gate.allowed) {
    throw new Error(gate.reason)
  }
  const nowMs = input.nowMs ?? Date.now()
  const targetWeekStart = mondayOfWeek(nowMs) + WEEK_MS

  const report = input.report
  const subjectNameOf = new Map(report.activeSubjects.map((subject) => [subject.remoteId, subject.name]))
  const mappings = uniqueMappings(input.mappings)

  const rationaleParts: string[] = []
  const weeklyGoals: ProposedWeeklyGoal[] = []
  const tasks: ProposedTask[] = []
  const sourceAssessmentIds: string[] = []

  const acceptedProposals = (input.acceptedProposals ?? [])
    .filter((proposal) => proposal.status === "accepted")
    .sort((left, right) => right.createdAt - left.createdAt)
  const latestAccepted = acceptedProposals[0]
  const latestAcceptedOutcome = latestAccepted
    ? input.acceptedProposalOutcomes?.[latestAccepted.proposalId] ??
      (input.latestAcceptedOutcome?.proposalId === latestAccepted.proposalId ? input.latestAcceptedOutcome : null)
    : input.latestAcceptedOutcome
  // A traceable outcome remains the preferred completion evidence. If a
  // newer accepted proposal has not appeared in a snapshot yet, show both
  // the last verified result and the explicit waiting state for the newer one.
  const previousOutcomeText = outcomeText(latestAcceptedOutcome) ?? outcomeText(input.latestAcceptedOutcome)
  if (previousOutcomeText) rationaleParts.push(previousOutcomeText)
  if (latestAccepted && !latestAcceptedOutcome?.traceable) {
    rationaleParts.push(acceptedWaitingText(latestAccepted))
  }
  const pendingProposals = input.pendingProposals ?? []

  // 执行情况总览。
  if (report.plans.completionRate !== null) {
    rationaleParts.push(
      `本周计划完成率 ${Math.round(report.plans.completionRate * 100)}%（${report.plans.done}/${report.plans.total}）`
    )
  } else {
    rationaleParts.push("本周暂无可统计的执行计划")
  }
  rationaleParts.push(engagementText(report))

  // 每个映射学科：诊断正确率 + 薄弱节点 → 建议任务与周目标。
  for (const mapping of mappings) {
    const alertSubjectRemoteId = mapping.alertSubjectRemoteId
    const displayName = subjectNameOf.get(alertSubjectRemoteId) ?? alertSubjectRemoteId
    const evidence = evidenceFor(mapping, mappings, input.diagnosticEvidence)
    const weakNodes = (input.weakNodesByMapping[alertSubjectRemoteId] ?? [])
      .filter((node) => node.mastery < WEAK_MASTERY_THRESHOLD)
      .sort((left, right) => left.mastery - right.mastery)

    for (const item of evidence) {
      // sourceAssessmentIds 只使用真实持久化的 assessment id。
      for (const id of item.assessmentIds) {
        if (!sourceAssessmentIds.includes(id)) {
          sourceAssessmentIds.push(id)
        }
      }
    }

    rationaleParts.push(`${displayName}：${correctnessSummary(evidence)}`)

    // 掌握度证据驱动的任务（薄弱节点复习）。
    for (const node of weakNodes.slice(0, 3)) {
      if (tasks.length >= MAX_TASKS) break
      const proposedTask: ProposedTask = {
        title: `复习「${node.title}」`,
        subjectRemoteId: alertSubjectRemoteId,
        targetDurationSeconds: 1800,
        dueAt: targetWeekStart + 2 * 86400000
      }
      if (!hasTaskDuplicate(proposedTask, pendingProposals, acceptedProposals, targetWeekStart)) tasks.push(proposedTask)
    }

    // 无诊断证据的科目：先安排诊断练习。
    if (evidence.length === 0 && tasks.length < MAX_TASKS) {
      const proposedTask: ProposedTask = {
        title: `完成「${displayName}」诊断练习（5 题）`,
        subjectRemoteId: alertSubjectRemoteId,
        targetDurationSeconds: 1500,
        dueAt: targetWeekStart + 1 * 86400000
      }
      if (!hasTaskDuplicate(proposedTask, pendingProposals, acceptedProposals, targetWeekStart)) tasks.push(proposedTask)
    }

    // 周目标：本周结果目标。
    if (weeklyGoals.length < MAX_WEEKLY_GOALS) {
      const focus = weakNodes[0] ? `，重点：${weakNodes[0].title}` : ""
      const title = weakNodes.length > 0
        ? `完成「${displayName}」巩固计划${focus}`
        : evidence.length > 0
          ? `完成「${displayName}」本周巩固计划`
          : `完成「${displayName}」首次诊断并开始本周计划`
      const proposedGoal: ProposedWeeklyGoal = {
        weekStart: targetWeekStart,
        title,
        successCriteria: evidence.length > 0 ? "诊断正确率 ≥ 80%" : "完成 5 题诊断并记录结果"
      }
      if (!hasGoalDuplicate(proposedGoal, pendingProposals, acceptedProposals)) weeklyGoals.push(proposedGoal)
    }
  }

  // 执行层面的兜底任务：投入度不足时建议保持节奏。
  if (report.effectiveSeconds < 90 * 60 && tasks.length < MAX_TASKS) {
    const proposedTask: ProposedTask = {
      title: "保持本周学习节奏（每天至少 30 分钟有效学习）",
      subjectRemoteId: null,
      targetDurationSeconds: 1800,
      dueAt: null
    }
    if (!hasTaskDuplicate(proposedTask, pendingProposals, acceptedProposals, targetWeekStart)) tasks.push(proposedTask)
  }

  if (weeklyGoals.length === 0) {
    const proposedGoal: ProposedWeeklyGoal = {
      weekStart: targetWeekStart,
      title: "完成本周学习计划并记录执行结果",
      successCriteria: "至少完成 3 个计划任务"
    }
    if (!hasGoalDuplicate(proposedGoal, pendingProposals, acceptedProposals)) weeklyGoals.push(proposedGoal)
  }

  const rationale =
    rationaleParts.join("；") +
    "。以上建议基于已确认的学科映射与真实答题证据生成；采纳后才会创建周目标与计划。"

  if (sourceAssessmentIds.length === 0) {
    throw new Error("没有可绑定当前学科映射的持久化诊断证据，拒绝生成计划建议。")
  }

  return { rationale, proposedWeeklyGoals: weeklyGoals, proposedTasks: tasks, sourceAssessmentIds }
}
