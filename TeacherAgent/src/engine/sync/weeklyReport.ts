/**
 * AlertTime weekly report engine (pure functions).
 *
 * 统计口径（第一版，均以手机端上报的完整业务快照为准）：
 * - 周目标：按 weekStart 归属自然周；统计 完成/延期/取消/待完成 与完成率。
 * - 计划完成率：type=1 的计划，按 dueAt 落入本周统计；未设 dueAt 的计划不进入本周口径。
 * - 学习天数：本周内 startTime 归属的已完成会话（status=0 且未删除）按本地自然日去重。
 * - 有效学习时长：本周内已完成会话 durationSeconds 之和（进行中/取消/异常结束不计入）。
 * - 科目分布：按会话 subjectRemoteId 聚合本周有效时长；无科目归入“未分类”。
 * - 进行中会话：status=1 且未删除，只展示不计入统计。
 * - 投入度：由有效时长与学习天数推导（投入度是学习投入信号，不是掌握度）。
 */

import type {
  SyncReadModel,
  SyncStudySession,
  SyncTask,
  SyncWeeklyGoal
} from "../../types/sync"
import { isAiUsageUnknown as isAiUsageUnknownShared } from "../../types/sync"

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** 学习投入度等级：由有效学习时长与学习天数共同推导。 */
export type EngagementLevel = "low" | "medium" | "high"

export interface WeeklyGoalStats {
  total: number
  done: number
  deferred: number
  canceled: number
  pending: number
  /** 完成率 = done / total（0 个目标时为 null） */
  completionRate: number | null
}

export interface PlanStats {
  total: number
  done: number
  pending: number
  /** 计划完成率 = 本周已完成的计划 / 本周全部计划（无计划时为 null） */
  completionRate: number | null
  unfinished: SyncTask[]
}

export interface SubjectDuration {
  subjectRemoteId: string | null
  /** null 表示“未分类” */
  displayName: string
  durationSeconds: number
  ratio: number
}

export interface RunningSessionInfo {
  remoteId: string
  title: string | null
  subjectRemoteId: string | null
  startTime: number
  updatedAt: number
  durationSeconds: number
}

export interface WeeklyReport {
  weekStartMs: number
  weekEndMs: number
  goals: WeeklyGoalStats
  plans: PlanStats
  studyDays: number
  effectiveSeconds: number
  dailyAverageSeconds: number
  engagement: EngagementLevel
  subjectDistribution: SubjectDuration[]
  runningSessions: RunningSessionInfo[]
  dataUpdatedAt: string | null
  snapshotId: string | null
  missing: {
    noSnapshot: boolean
    noGoals: boolean
    noPlans: boolean
    noSessions: boolean
  }
  /** 手机科目列表（含软删除？不：只列未删除，供映射与展示） */
  activeSubjects: Array<{ remoteId: string; name: string; isArchived: boolean }>
  // ── AI 使用时间（与有效专注时间分开统计，不得混算） ──
  /** 本周 AlertTime AI 求助总时长（秒；来自 completed sessions 的 aiHelpSeconds） */
  aiHelpSeconds: number
  /** 本周 AI 求助次数 */
  aiHelpCount: number
  /**
   * 本周外部 AI App 前台总时长（秒）。
   * null = 全部会话均未记录（手机端未授权 UsageStats 或旧客户端）；不得显示为 0。
   * 部分会话有值、部分为 null 时，只累加有值的会话，并用 aiUsagePartiallyUnknown 标记。
   */
  externalAiAppSeconds: number | null
  /** 本周 AI 使用时间来源集合（去重） */
  aiUsageSources: string[]
  /** 是否有会话的 AI 时长缺失（旧客户端或未授权），缺失时 UI 显示「手机端未记录」 */
  aiUsagePartiallyUnknown: boolean
  /** 本周完成会话明细（专注时间 / AI 时间 / 外部 AI 时间），供逐会话查看 */
  sessionDetails: SessionAiDetail[]
}

export interface SessionAiDetail {
  remoteId: string
  title: string | null
  subjectRemoteId: string | null
  startTime: number
  durationSeconds: number
  pauseSeconds: number
  aiHelpSeconds: number
  aiHelpCount: number
  externalAiAppSeconds: number | null
  aiUsageSource: string | null
  /** AI 时长是否未记录（不得显示为 0 分钟误导） */
  aiUnknown: boolean
}

export interface WeeklyReportInput {
  model: SyncReadModel
  weekStartMs?: number
  dataUpdatedAt?: string | null
  snapshotId?: string | null
  nowMs?: number
}

/** 本地时区周一 00:00 的 epoch 毫秒。 */
export function mondayOfWeek(ms: number): number {
  const date = new Date(ms)
  const day = (date.getDay() + 6) % 7 // Monday = 0
  date.setHours(0, 0, 0, 0)
  return date.getTime() - day * 24 * 60 * 60 * 1000
}

/** 同一本地自然日判断。 */
export function sameLocalDay(leftMs: number, rightMs: number): boolean {
  const left = new Date(leftMs)
  const right = new Date(rightMs)
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function isInWeek(valueMs: number, weekStartMs: number): boolean {
  return valueMs >= weekStartMs && valueMs < weekStartMs + WEEK_MS
}

export function engagementLevel(effectiveSeconds: number, studyDays: number): EngagementLevel {
  const minutes = effectiveSeconds / 60
  if (minutes >= 240 && studyDays >= 4) return "high"
  if (minutes >= 90 && studyDays >= 2) return "medium"
  return "low"
}

export function computeWeeklyReport(input: WeeklyReportInput): WeeklyReport {
  const { model } = input
  const nowMs = input.nowMs ?? Date.now()
  const weekStartMs = input.weekStartMs ?? mondayOfWeek(nowMs)
  const weekEndMs = weekStartMs + WEEK_MS

  // 周目标（按 weekStart 归属）。
  const goalsOfWeek = model.weeklyGoals.filter(
    (goal) => goal.deletedAt === null && goal.weekStart === weekStartMs
  )
  const goalStats: WeeklyGoalStats = {
    total: goalsOfWeek.length,
    done: goalsOfWeek.filter((goal) => goal.status === 1).length,
    deferred: goalsOfWeek.filter((goal) => goal.status === 2).length,
    canceled: goalsOfWeek.filter((goal) => goal.status === 3).length,
    pending: goalsOfWeek.filter((goal) => goal.status === 0).length,
    completionRate:
      goalsOfWeek.length > 0
        ? goalsOfWeek.filter((goal) => goal.status === 1).length / goalsOfWeek.length
        : null
  }

  // 计划（type=1）按 dueAt 归属本周；无 dueAt 不进入本周口径。
  const plansOfWeek = model.tasks.filter(
    (task) =>
      task.deletedAt === null &&
      task.type === 1 &&
      task.dueAt !== null &&
      isInWeek(task.dueAt, weekStartMs)
  )
  const planStats: PlanStats = {
    total: plansOfWeek.length,
    done: plansOfWeek.filter((task) => task.status === 1).length,
    pending: plansOfWeek.filter((task) => task.status === 0).length,
    completionRate:
      plansOfWeek.length > 0
        ? plansOfWeek.filter((task) => task.status === 1).length / plansOfWeek.length
        : null,
    unfinished: plansOfWeek.filter((task) => task.status === 0)
  }

  // 已完成会话（status=0 且未删除）按 startTime 归属本周。
  const completedSessions = model.studySessions.filter(
    (session) => session.deletedAt === null && session.status === 0 && isInWeek(session.startTime, weekStartMs)
  )
  const effectiveSeconds = completedSessions.reduce((sum, session) => sum + session.durationSeconds, 0)

  const studyDays = new Set(
    completedSessions.map((session) => new Date(session.startTime).toDateString())
  ).size

  // 科目分布。
  const bySubject = new Map<string | null, number>()
  for (const session of completedSessions) {
    bySubject.set(session.subjectRemoteId, (bySubject.get(session.subjectRemoteId) ?? 0) + session.durationSeconds)
  }
  const subjectNameOf = new Map<string, string>()
  for (const subject of model.subjects) {
    subjectNameOf.set(subject.remoteId, subject.name)
  }
  const subjectDistribution: SubjectDuration[] = [...bySubject.entries()]
    .map(([remoteId, seconds]) => ({
      subjectRemoteId: remoteId,
      displayName: remoteId === null ? "未分类" : (subjectNameOf.get(remoteId) ?? "未知科目"),
      durationSeconds: seconds,
      ratio: effectiveSeconds > 0 ? seconds / effectiveSeconds : 0
    }))
    .sort((left, right) => right.durationSeconds - left.durationSeconds)

  // 进行中会话（只展示）。
  const runningSessions: RunningSessionInfo[] = model.studySessions
    .filter((session) => session.deletedAt === null && session.status === 1)
    .map((session) => ({
      remoteId: session.remoteId,
      title: session.title,
      subjectRemoteId: session.subjectRemoteId,
      startTime: session.startTime,
      updatedAt: session.updatedAt,
      durationSeconds: session.durationSeconds
    }))
    .sort((left, right) => right.startTime - left.startTime)

  const activeSubjects = model.subjects
    .filter((subject) => subject.deletedAt === null && !subject.isArchived)
    .map((subject) => ({ remoteId: subject.remoteId, name: subject.name, isArchived: subject.isArchived }))

  // ── AI 使用时间统计（与专注时间分开；缺失如实标记，不推断为 0） ──
  const sessionDetails: SessionAiDetail[] = completedSessions.map((session) => ({
    remoteId: session.remoteId,
    title: session.title,
    subjectRemoteId: session.subjectRemoteId,
    startTime: session.startTime,
    durationSeconds: session.durationSeconds,
    pauseSeconds: session.pauseSeconds,
    aiHelpSeconds: session.aiHelpSeconds ?? 0,
    aiHelpCount: session.aiHelpCount ?? 0,
    externalAiAppSeconds: session.externalAiAppSeconds ?? null,
    aiUsageSource: session.aiUsageSource ?? null,
    aiUnknown: isAiUsageUnknownForSession(session)
  }))
  const aiHelpSeconds = sessionDetails.reduce((sum, s) => sum + s.aiHelpSeconds, 0)
  const aiHelpCount = sessionDetails.reduce((sum, s) => sum + s.aiHelpCount, 0)
  const externalValues = sessionDetails
    .map((s) => s.externalAiAppSeconds)
    .filter((v): v is number => v !== null)
  const externalAiAppSeconds = externalValues.length > 0 ? externalValues.reduce((a, b) => a + b, 0) : null
  const aiUsageSources = [...new Set(sessionDetails.map((s) => s.aiUsageSource).filter(Boolean))] as string[]
  const aiUsagePartiallyUnknown = sessionDetails.some((s) => s.aiUnknown)

  return {
    weekStartMs,
    weekEndMs,
    goals: goalStats,
    plans: planStats,
    studyDays,
    effectiveSeconds,
    dailyAverageSeconds: studyDays > 0 ? Math.round(effectiveSeconds / studyDays) : 0,
    engagement: engagementLevel(effectiveSeconds, studyDays),
    subjectDistribution,
    runningSessions,
    dataUpdatedAt: input.dataUpdatedAt ?? null,
    snapshotId: input.snapshotId ?? null,
    missing: {
      noSnapshot: (input.dataUpdatedAt ?? null) === null,
      noGoals: goalsOfWeek.length === 0,
      noPlans: plansOfWeek.length === 0,
      noSessions: completedSessions.length === 0
    },
    activeSubjects,
    aiHelpSeconds,
    aiHelpCount,
    externalAiAppSeconds,
    aiUsageSources,
    aiUsagePartiallyUnknown,
    sessionDetails
  }
}

function isAiUsageUnknownForSession(session: SyncStudySession): boolean {
  // 复用共享判断：有外部 AI App 记录（externalAiAppSeconds != null）即使无内置 AI 求助也不算未记录。
  return isAiUsageUnknownShared(session)
}

/** 格式化为可读时长（"3 小时 20 分"）。 */
export function formatEffectiveSeconds(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes <= 0) return "0 分钟"
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours <= 0) return `${minutes} 分钟`
  return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
}

/** 只读辅助：供测试与 UI 复用的过滤谓词。 */
export function isCompletedSession(session: SyncStudySession): boolean {
  return session.deletedAt === null && session.status === 0
}

export function isPlanOfWeek(task: SyncTask, weekStartMs: number): boolean {
  return (
    task.deletedAt === null &&
    task.type === 1 &&
    task.dueAt !== null &&
    isInWeek(task.dueAt, weekStartMs)
  )
}

export function isGoalOfWeek(goal: SyncWeeklyGoal, weekStartMs: number): boolean {
  return goal.deletedAt === null && goal.weekStart === weekStartMs
}
