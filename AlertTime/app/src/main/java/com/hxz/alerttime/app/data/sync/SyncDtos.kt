package com.hxz.alerttime.app.data.sync

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * AlertTime ↔ TeacherAgent 同步协议 v1 DTO。
 *
 * 协议权威说明见 sync/protocol/protocol.md（两个仓库各保存一份，内容逐字一致）。
 * 与备份协议（alerttime-backup）完全分离：本模块不读取、不发送备份 envelope，
 * 也不调用 BackupRepository 的恢复逻辑。
 */
object SyncProtocol {
    const val FORMAT = "alerttime-teacher-sync"
    const val SCHEMA_VERSION = 1

    /** 请求体上限（与 TeacherAgent 一致）。 */
    const val MAX_SYNC_BYTES = 8L * 1024L * 1024L

    // 集合数量上限（与协议 schema 一致）。
    const val MAX_COLLECTION_SIZE_SUBJECTS = 5_000
    const val MAX_COLLECTION_SIZE_WEEKLY_GOALS = 50_000
    const val MAX_COLLECTION_SIZE_TASKS = 100_000
    const val MAX_COLLECTION_SIZE_SESSIONS = 200_000

    const val MAX_STRING_LENGTH = 20_000
    const val MAX_TITLE_LENGTH = 200
    const val MAX_NAME_LENGTH = 100
    const val MAX_ID_LENGTH = 64
    const val MIN_ID_LENGTH = 8
    const val MAX_APP_VERSION_LENGTH = 64
    const val MAX_ANALYSIS_QUESTIONS = 50
    const val MAX_ANALYSIS_WARNINGS = 50
    const val MAX_PROPOSALS = 100
    const val MAX_PROPOSED_WEEKLY_GOALS = 20
    const val MAX_PROPOSED_TASKS = 100
    const val MAX_SOURCE_ASSESSMENT_IDS = 200
    const val MAX_PROPOSED_SUCCESS_CRITERIA_LENGTH = 2_000

    const val MESSAGE_TYPE_PAIR = "pair"
    const val MESSAGE_TYPE_PAIR_ACK = "pairAck"
    const val MESSAGE_TYPE_UNPAIR_ACK = "unpairAck"
    const val MESSAGE_TYPE_SNAPSHOT = "snapshot"
    const val MESSAGE_TYPE_SNAPSHOT_ACK = "snapshotAck"
    const val MESSAGE_TYPE_PROPOSAL = "proposal"
    const val MESSAGE_TYPE_PROPOSAL_DECISION = "proposalDecision"
    const val MESSAGE_TYPE_DECISION_ACK = "decisionAck"

    // AI 使用时间来源枚举（v1 可选扩展）。
    const val AI_USAGE_SOURCE_ALERTTIME = "alerttime_ai_help"
    const val AI_USAGE_SOURCE_USAGE_STATS = "usage_stats"
    const val AI_USAGE_SOURCE_UNKNOWN = "unknown"
}

/** AI 使用时间来源白名单（校验用）。 */
val AI_USAGE_SOURCES: Set<String> = setOf(
    SyncProtocol.AI_USAGE_SOURCE_ALERTTIME,
    SyncProtocol.AI_USAGE_SOURCE_USAGE_STATS,
    SyncProtocol.AI_USAGE_SOURCE_UNKNOWN
)

/** 学习分析协议允许的固定聚合证据别名；Prompt、Android 校验与映射共用。 */
val LEARNING_ANALYSIS_AGGREGATE_EVIDENCE_REFS: Set<String> = linkedSetOf(
    "scope:today",
    "scope:current_week",
    "scope:historical",
    "session_summary:today",
    "session_summary:all"
)

/** 用户主动填写且可作为学习分析证据的固定设置别名。 */
val LEARNING_ANALYSIS_USER_SETTING_EVIDENCE_REFS: Set<String> = linkedSetOf(
    "user_setting:purpose",
    "user_setting:examName",
    "user_setting:focusSubjects",
    "user_setting:targetDate"
)

@Serializable
data class SyncEnvelopeDto<T>(
    val format: String,
    val schemaVersion: Int,
    @SerialName("messageType") val messageType: String,
    @SerialName("deviceId") val deviceId: String,
    @SerialName("snapshotId") val snapshotId: String? = null,
    @SerialName("generatedAt") val generatedAt: Long,
    @SerialName("appVersion") val appVersion: String? = null,
    @SerialName("protocolCapabilities") val protocolCapabilities: Map<String, Boolean>? = null,
    val cursor: kotlinx.serialization.json.JsonElement? = null,
    val payload: T
)

// ── 快照 payload（上报白名单） ────────────────────────────────────────

@Serializable
data class SyncSnapshotPayload(
    val subjects: List<SyncSubjectDto>,
    @SerialName("weeklyGoals") val weeklyGoals: List<SyncWeeklyGoalDto>,
    val tasks: List<SyncTaskDto>,
    @SerialName("studySessions") val studySessions: List<SyncStudySessionDto>,
    /** 每次同步都应生成；旧版本快照缺失时仍可被 TeacherAgent 兼容读取。 */
    @SerialName("learningAnalysis") val learningAnalysis: SyncLearningAnalysisDto? = null
)

@Serializable
data class SyncLearningAnalysisDto(
    val analysisId: String,
    val sourceSnapshotId: String,
    val generatedAt: Long,
    val promptVersion: String,
    val generator: String,
    val profile: SyncLearningProfileDto,
    val planEvaluation: SyncPlanEvaluationDto,
    val assessmentDraft: SyncAssessmentDraftDto,
    val warnings: List<String>,
    /**
     * 本次分析实际构建的 Provider 输入范围摘要；只包含计数和固定语义标识，绝不包含 ID 或正文。
     * 可选以兼容旧版手机与旧版 TeacherAgent 缓存。
     */
    val inputSummary: SyncLearningInputSummaryDto? = null
)

@Serializable
data class SyncLearningInputSummaryDto(
    val subjectCount: Int,
    val weeklyGoalCount: Int,
    val taskCount: Int,
    val completedSessionCount: Int,
    val source: String
) {
    companion object {
        const val SOURCE_SAME_ANALYSIS_INPUT_V1 = "same_analysis_input_v1"

        fun fromSnapshot(payload: SyncSnapshotPayload): SyncLearningInputSummaryDto =
            SyncLearningInputSummaryDto(
                subjectCount = payload.subjects.count { it.deletedAt == null },
                weeklyGoalCount = payload.weeklyGoals.count { it.deletedAt == null },
                taskCount = payload.tasks.count { it.deletedAt == null },
                completedSessionCount = payload.studySessions.count {
                    it.deletedAt == null && it.endTime != null
                },
                source = SOURCE_SAME_ANALYSIS_INPUT_V1
            )
    }
}

@Serializable
data class SyncLearningProfileDto(
    val facts: List<SyncLearningFactDto>,
    val inferences: List<SyncLearningInferenceDto>
)

@Serializable
data class SyncLearningFactDto(
    val code: String,
    val label: String,
    val value: kotlinx.serialization.json.JsonElement,
    val evidenceRefs: List<String>
)

@Serializable
data class SyncLearningInferenceDto(
    val statement: String,
    val confidence: Double,
    val evidenceRefs: List<String>
)

@Serializable
data class SyncPlanEvaluationDto(
    val verdict: String,
    val score: Double?,
    val dimensions: List<SyncPlanEvaluationDimensionDto>,
    val risks: List<String>,
    val suggestions: List<String>
)

@Serializable
data class SyncPlanEvaluationDimensionDto(
    val code: String,
    val score: Double?,
    val summary: String
)

@Serializable
data class SyncAssessmentDraftDto(
    val status: String,
    val scopeSummary: String,
    val questions: List<SyncAssessmentDraftQuestionDto>
)

@Serializable
data class SyncAssessmentDraftQuestionDto(
    val questionId: String,
    val subjectRemoteId: String? = null,
    val taskRemoteId: String? = null,
    val type: String,
    val prompt: String,
    val rationale: String,
    val rubric: List<String>
)

@Serializable
data class SyncSubjectDto(
    @SerialName("remoteId") val remoteId: String,
    val name: String,
    val color: String? = null,
    val icon: String? = null,
    @SerialName("sortOrder") val sortOrder: Int = 0,
    @SerialName("isArchived") val isArchived: Boolean = false,
    @SerialName("createdAt") val createdAt: Long,
    @SerialName("updatedAt") val updatedAt: Long,
    @SerialName("deletedAt") val deletedAt: Long? = null,
    // 考试体系声明（v1 可选扩展）：默认 null，旧版行为不变。
    // 只用于 TeacherAgent 展示与映射建议，不是权威映射；长度 ≤ 200、非空字符串。
    @SerialName("examTrackId") val examTrackId: String? = null,
    @SerialName("examSubjectId") val examSubjectId: String? = null,
    @SerialName("examModuleId") val examModuleId: String? = null
)

@Serializable
data class SyncWeeklyGoalDto(
    @SerialName("remoteId") val remoteId: String,
    @SerialName("weekStart") val weekStart: Long,
    val title: String,
    @SerialName("successCriteria") val successCriteria: String? = null,
    val status: Int,
    @SerialName("completedAt") val completedAt: Long? = null,
    @SerialName("deferredToWeekStart") val deferredToWeekStart: Long? = null,
    @SerialName("exceptionReason") val exceptionReason: String? = null,
    @SerialName("createdAt") val createdAt: Long,
    @SerialName("updatedAt") val updatedAt: Long,
    @SerialName("deletedAt") val deletedAt: Long? = null,
    /** Optional local provenance; absent/null is compatible with older clients. */
    @SerialName("sourceProposalId") val sourceProposalId: String? = null
)

@Serializable
data class SyncTaskDto(
    @SerialName("remoteId") val remoteId: String,
    @SerialName("subjectRemoteId") val subjectRemoteId: String? = null,
    val title: String,
    val content: String? = null,
    val type: Int,
    val priority: Int,
    val status: Int,
    @SerialName("targetDurationSeconds") val targetDurationSeconds: Long? = null,
    @SerialName("dueAt") val dueAt: Long? = null,
    @SerialName("completedAt") val completedAt: Long? = null,
    @SerialName("sortOrder") val sortOrder: Int,
    @SerialName("createdAt") val createdAt: Long,
    @SerialName("updatedAt") val updatedAt: Long,
    @SerialName("deletedAt") val deletedAt: Long? = null,
    /** Optional local provenance; absent/null is compatible with older clients. */
    @SerialName("sourceProposalId") val sourceProposalId: String? = null
)

@Serializable
data class SyncStudySessionDto(
    @SerialName("remoteId") val remoteId: String,
    @SerialName("subjectRemoteId") val subjectRemoteId: String? = null,
    @SerialName("taskRemoteId") val taskRemoteId: String? = null,
    val title: String? = null,
    @SerialName("startTime") val startTime: Long,
    @SerialName("endTime") val endTime: Long? = null,
    @SerialName("durationSeconds") val durationSeconds: Long,
    @SerialName("pauseSeconds") val pauseSeconds: Long,
    @SerialName("focusScore") val focusScore: Int? = null,
    val note: String? = null,
    val status: Int,
    @SerialName("createdAt") val createdAt: Long,
    @SerialName("updatedAt") val updatedAt: Long,
    @SerialName("deletedAt") val deletedAt: Long? = null,
    // ── AI 使用时间（v1 可选扩展；旧版客户端不发送时使用默认值，TeacherAgent 必须兼容） ──
    /** 用户在 AlertTime 的 AI 求助时段内停留的秒数（AI_HELP_STARTED → AI_HELP_ENDED）。 */
    @SerialName("aiHelpSeconds") val aiHelpSeconds: Long = 0,
    /** AI 求助会话次数（EVENT_AI_HELP 开始事件数）。 */
    @SerialName("aiHelpCount") val aiHelpCount: Int = 0,
    /** 外部 AI App（如 Gemini/ChatGPT）前台使用秒数；仅 UsageStats 授权后统计，未授权为 null（unknown）。 */
    @SerialName("externalAiAppSeconds") val externalAiAppSeconds: Long? = null,
    /** AI 使用时间来源：alerttime_ai_help / usage_stats / unknown。 */
    @SerialName("aiUsageSource") val aiUsageSource: String? = null
)

// ── 配对 ──────────────────────────────────────────────────────────────

@Serializable
data class SyncPairPayload(
    val token: String,
    @SerialName("deviceId") val deviceId: String,
    @SerialName("ownerIdentity") val ownerIdentity: String? = null
)

@Serializable
data class SyncPairAckPayload(
    val credential: String,
    @SerialName("deviceId") val deviceId: String,
    @SerialName("displayName") val displayName: String
)

@Serializable
data class SyncUnpairAckPayload(
    @SerialName("deviceId") val deviceId: String,
    val revoked: Boolean
)

// ── ack ───────────────────────────────────────────────────────────────

@Serializable
data class SyncSnapshotAckPayload(
    val accepted: Boolean,
    @SerialName("receivedAt") val receivedAt: Long,
    @SerialName("entityCounts") val entityCounts: SyncEntityCounts
)

@Serializable
data class SyncEntityCounts(
    val subjects: Int,
    @SerialName("weeklyGoals") val weeklyGoals: Int,
    val tasks: Int,
    @SerialName("studySessions") val studySessions: Int
)

@Serializable
data class SyncDecisionAckPayload(
    @SerialName("proposalId") val proposalId: String,
    val decision: String,
    val recorded: Boolean
)

// ── Proposal（TeacherAgent 下发，只读展示 + 采纳/拒绝） ─────────────

@Serializable
data class SyncProposalDto(
    @SerialName("proposalId") val proposalId: String,
    @SerialName("deviceId") val deviceId: String,
    val version: Int,
    val status: String,
    val rationale: String,
    @SerialName("proposedWeeklyGoals") val proposedWeeklyGoals: List<SyncProposedWeeklyGoalDto>,
    @SerialName("proposedTasks") val proposedTasks: List<SyncProposedTaskDto>,
    @SerialName("sourceAssessmentIds") val sourceAssessmentIds: List<String>,
    @SerialName("createdAt") val createdAt: Long,
    @SerialName("expiresAt") val expiresAt: Long? = null
)

@Serializable
data class SyncProposedWeeklyGoalDto(
    @SerialName("weekStart") val weekStart: Long,
    val title: String,
    @SerialName("successCriteria") val successCriteria: String? = null
)

@Serializable
data class SyncProposedTaskDto(
    val title: String,
    @SerialName("subjectRemoteId") val subjectRemoteId: String? = null,
    @SerialName("targetDurationSeconds") val targetDurationSeconds: Long? = null,
    @SerialName("dueAt") val dueAt: Long? = null
)

@Serializable
data class SyncProposalsListPayload(
    val proposals: List<SyncProposalDto>,
    @SerialName("nextCursor") val nextCursor: String? = null
)

@Serializable
data class SyncProposalDecisionPayload(
    @SerialName("proposalId") val proposalId: String,
    val decision: String,
    @SerialName("decidedAt") val decidedAt: Long
)

/** 配对二维码解析结果。 */
data class PairingQrInfo(
    val host: String,
    val port: Int,
    val pin: String,
    val token: String,
    val expiresAtMs: Long,
    val deviceId: String
)
