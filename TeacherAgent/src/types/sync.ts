/**
 * AlertTime ↔ TeacherAgent LAN sync types.
 *
 * Mirrors sync/protocol/protocol.md (schemaVersion 1). The Vue layer only
 * talks to these explicit DTOs through Tauri commands; it never binds ports,
 * opens SQLite directly, stores pairing tokens or touches certificate keys.
 */

export interface SyncServerStatus {
  running: boolean
  address: string | null
  port: number | null
  startedAtMs: number | null
  certificatePin: string | null
}

export interface SyncPairingInfo {
  qrText: string
  token: string
  expiresAtMs: number
  deviceId: string
}

export interface SyncDeviceInfo {
  deviceId: string
  displayName: string
  pairedAt: string
  lastSyncAt: string | null
  revoked: boolean
  certificatePin: string
}

export interface FirewallDiagnosis {
  firewallEnabled: boolean | null
  selfTestOk: boolean
  selfTestMessage: string
  guidance: string
}

// ── Read model (mirror of the AlertTime upload whitelist) ──────────────

export interface SyncSubject {
  remoteId: string
  name: string
  isArchived: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** 手机端声明的考试体系归属（可选；仅展示与映射建议，不是权威映射） */
  examTrackId?: string | null
  examSubjectId?: string | null
  examModuleId?: string | null
}

export interface SyncWeeklyGoal {
  remoteId: string
  weekStart: number
  title: string
  successCriteria: string | null
  status: number
  completedAt: number | null
  deferredToWeekStart: number | null
  exceptionReason: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** 创建该周目标的 accepted proposal；旧手机端缺失时保持 null/undefined。 */
  sourceProposalId?: string | null
}

export interface SyncTask {
  remoteId: string
  subjectRemoteId: string | null
  title: string
  content: string | null
  type: number
  priority: number
  status: number
  targetDurationSeconds: number | null
  dueAt: number | null
  completedAt: number | null
  sortOrder: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** 创建该任务的 accepted proposal；旧手机端缺失时保持 null/undefined。 */
  sourceProposalId?: string | null
}

export interface SyncStudySession {
  remoteId: string
  subjectRemoteId: string | null
  taskRemoteId: string | null
  title: string | null
  startTime: number
  endTime: number | null
  durationSeconds: number
  pauseSeconds: number
  focusScore: number | null
  note: string | null
  status: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** AI 使用时间（v1 可选扩展；旧版手机端缺失时默认 0，展示为「未记录」） */
  aiHelpSeconds?: number
  aiHelpCount?: number
  /** 外部 AI App 前台秒数；未授权 UsageStats 时为 null（unknown），不得写成 0 */
  externalAiAppSeconds?: number | null
  /** AI 使用时间来源：alerttime_ai_help / usage_stats / unknown */
  aiUsageSource?: string | null
}

/** AI 使用时间来源标签（展示用）。 */
export function aiUsageSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "alerttime_ai_help":
      return "AlertTime AI 求助"
    case "usage_stats":
      return "外部 AI App（使用统计）"
    case "unknown":
      return "未记录"
    default:
      return "未记录"
  }
}

/** AI 时长是否「未记录」（旧客户端没上报或来源 unknown），不得显示为 0 分钟误导。 */
export function isAiUsageUnknown(
  session: Pick<SyncStudySession, "aiUsageSource" | "aiHelpSeconds" | "aiHelpCount" | "externalAiAppSeconds">
): boolean {
  // 有外部 AI App 记录（来源 usage_stats）即使没有内置 AI 求助记录也不算未记录。
  if (session.externalAiAppSeconds != null) return false
  if (session.aiUsageSource === "unknown") return true
  if (session.aiUsageSource == null && (session.aiHelpSeconds ?? 0) === 0 && (session.aiHelpCount ?? 0) === 0) {
    return true
  }
  return false
}

export type SyncLearningAnalysisGenerator = "android_llm" | "deterministic_fallback"
export type SyncPlanEvaluationVerdict = "reasonable" | "needs_adjustment" | "insufficient_data"
export type SyncAssessmentDraftQuestionType = "concept_check" | "diagnostic" | "reflection"

export interface SyncLearningAnalysisDto {
  analysisId: string
  sourceSnapshotId: string
  generatedAt: number
  promptVersion: string
  generator: SyncLearningAnalysisGenerator
  profile: {
    facts: Array<{
      code: string
      label: string
      value: unknown
      evidenceRefs: string[]
    }>
    inferences: Array<{
      statement: string
      confidence: number
      evidenceRefs: string[]
    }>
  }
  planEvaluation: {
    verdict: SyncPlanEvaluationVerdict
    score: number | null
    dimensions: Array<{
      code: string
      score: number | null
      summary: string
    }>
    risks: string[]
    suggestions: string[]
  }
  assessmentDraft: {
    status: "draft"
    scopeSummary: string
    questions: Array<{
      questionId: string
      subjectRemoteId?: string | null
      taskRemoteId?: string | null
      type: SyncAssessmentDraftQuestionType
      prompt: string
      rationale: string
      rubric: string[]
    }>
  }
  warnings: string[]
}

export interface SyncReadModel {
  subjects: SyncSubject[]
  weeklyGoals: SyncWeeklyGoal[]
  tasks: SyncTask[]
  studySessions: SyncStudySession[]
  latestLearningAnalysis?: SyncLearningAnalysisDto | null
}

export interface SubjectMapping {
  alertSubjectRemoteId: string
  teacherSubjectId: string
  /** 考试体系叶子映射（优先于 teacherSubjectId；旧平面码/自定义学科保留旧字段） */
  examTrackId?: string | null
  examSubjectId?: string | null
  examModuleId?: string | null
}

export interface LastSnapshotInfo {
  snapshotId: string
  receivedAt: string
  subjectCount: number
  goalCount: number
  taskCount: number
  sessionCount: number
}

export interface SyncDeviceState {
  readModel: SyncReadModel
  lastSnapshot: LastSnapshotInfo | null
}

// ── Proposals (TeacherAgent is the only writer) ────────────────────────

export interface ProposedWeeklyGoal {
  weekStart: number
  title: string
  successCriteria: string | null
}

export interface ProposedTask {
  title: string
  subjectRemoteId: string | null
  targetDurationSeconds: number | null
  dueAt: number | null
}

export type ProposalStatus = "pending" | "accepted" | "rejected" | "superseded"

export interface SyncProposal {
  proposalId: string
  deviceId: string
  version: number
  status: ProposalStatus
  rationale: string
  proposedWeeklyGoals: ProposedWeeklyGoal[]
  proposedTasks: ProposedTask[]
  sourceAssessmentIds: string[]
  createdAt: number
  expiresAt: number | null
}

export interface CreateProposalInput {
  deviceId: string
  rationale: string
  proposedWeeklyGoals: ProposedWeeklyGoal[]
  proposedTasks: ProposedTask[]
  sourceAssessmentIds: string[]
  expiresAtMs?: number
}
