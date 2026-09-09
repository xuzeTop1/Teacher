package com.hxz.alerttime.app.data.sync

import androidx.room.withTransaction
import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.data.local.entity.SubjectEntity
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import com.hxz.alerttime.app.data.local.entity.WeeklyGoalEntity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * 外部 AI App 使用时长读取接口：与 Room/同步解耦，便于测试注入。
 * 未授权 UsageStats 时实现应返回 null（unknown），不得伪造为 0。
 *
 * 进行中会话（endTime 为空）一律不统计（null）——规则在默认实现中，
 * 具体实现只负责一次性统计本次快照中的「已结束会话」。
 */
interface ExternalAiUsageReader {
    /**
     * 一次性返回多个会话的外部 AI App 前台秒数。
     *
     * Map 必须以会话本地 id 为键；值为 null 表示无法统计/未授权，0 表示已授权但
     * 该会话区间没有目标 App 使用记录。实现不得为每个会话单独调用系统 UsageStats。
     */
    fun externalAiAppSecondsForCompleted(sessions: List<StudySessionEntity>): Map<Long, Long?>
}

/**
 * 在单个 Room 只读事务中生成一致的业务快照（完整快照，非增量）。
 *
 * 规则：
 * - 每个实体必须有稳定 UUID：优先使用现有 `remote_id`；为空时在事务内生成并持久化。
 * - 不使用本地自增 id 作为跨设备 ID；DTO 外键全部使用 remote_id。
 * - 只导出同步白名单（subjects / weeklyGoals / tasks / studySessions，含软删除）；
 *   不导出 diaries、appSettings、studySessionEvents、备份文件等。
 */
class SyncSnapshotBuilder(
    private val database: AlertTimeDatabase,
    private val examTagStore: SubjectExamTagStore? = null,
    /**
     * 外部 AI App 时长统计器（可选）：未注入时 externalAiAppSeconds 保持 null（unknown），
     * 不伪造为 0。注入后仅在 UsageStats 授权时返回非 null。
     */
    private val externalAiUsageReader: ExternalAiUsageReader? = null
) {

    /**
     * 生成一致快照；同一事务内为缺失 remote_id 的实体补发并持久化 UUID。
     *
     * 外部 UsageStats 是系统查询，不属于 Room 数据快照：先在事务内冻结实体，事务结束
     * 后对这批实体做一次批量统计，再完成 DTO 映射，避免慢查询长时间占用 Room 事务。
     */
    suspend fun buildSnapshot(): SyncSnapshotPayload {
        val frozen = database.withTransaction {
            val now = System.currentTimeMillis()

            // 先补齐 remote_id，再构建外键查找表，最后映射 DTO。
            val subjects = database.subjectDao().exportAll().map { ensureSubjectRemoteId(it, now) }
            val weeklyGoals = database.weeklyGoalDao().exportAll().map { ensureGoalRemoteId(it, now) }
            val tasks = database.taskDao().exportAll().map { ensureTaskRemoteId(it, now) }
            val sessions = database.studySessionDao().exportAllSessions().map { ensureSessionRemoteId(it, now) }

            val subjectRemoteOf = subjects.associate { it.id to it.remoteId }
            val taskRemoteOf = tasks.associate { it.id to it.remoteId }

            // 来源映射是设备本地运行态；读取它与本次实体快照处于同一事务。
            // 损坏映射只会丢失 attribution，不得阻断普通同步，也不得伪造来源。
            val sourceIndexes = ProposalSourceMappingCodec.indexesOrEmpty(
                raw = database.appSettingDao().getSetting(ProposalSourceMappingCodec.KEY)?.value,
                existingWeeklyGoalIds = weeklyGoals.map { it.id }.toSet(),
                existingTaskIds = tasks.map { it.id }.toSet()
            )

            // 考试体系标签（可选）：默认无标签时协议行为与旧版完全一致（字段为 null）。
            val examTags = examTagStore?.all() ?: emptyMap()

            // AI 求助次数：按会话聚合 EVENT_AI_HELP 开始事件（不导出事件本身）。
            val aiHelpCountBySession = if (sessions.isEmpty()) {
                emptyMap()
            } else {
                database.studySessionDao()
                    .getEventsForSessions(sessions.map { it.id })
                    .filter { it.eventType == StatusCodes.EVENT_AI_HELP }
                    .groupingBy { it.sessionId }
                    .eachCount()
            }

            FrozenSnapshotEntities(
                subjects = subjects,
                weeklyGoals = weeklyGoals,
                tasks = tasks,
                sessions = sessions,
                subjectRemoteOf = subjectRemoteOf,
                taskRemoteOf = taskRemoteOf,
                sourceIndexes = sourceIndexes,
                examTags = examTags,
                aiHelpCountBySession = aiHelpCountBySession
            )
        }

        // UsageStats 访问必须在 Room 事务外完成。即使系统权限被撤销或 OEM API 抛错，
        // 也只把外部 AI 字段降级为 unknown，不阻断完整快照。
        val externalAiSecondsBySession = externalAiUsageReader?.let { reader ->
            try {
                // Room 事务已经结束；系统 UsageStats 可能扫描大量事件，不能在调用方
                // dispatcher（通常是 Main）同步执行，否则会造成 UI ANR。
                withContext(Dispatchers.IO) {
                    reader.externalAiAppSecondsForCompleted(
                        frozen.sessions.filter { session ->
                            val endTime = session.endTime
                            endTime != null && endTime > session.startTime
                        }
                    )
                }
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                emptyMap()
            }
        } ?: emptyMap()

        return SyncSnapshotPayload(
            subjects = frozen.subjects.map { toDto(it, frozen.examTags[it.remoteId]) },
            weeklyGoals = frozen.weeklyGoals.map {
                toDto(it, frozen.sourceIndexes.weeklyGoalByLocalId[it.id])
            },
            tasks = frozen.tasks.map {
                toDto(it, frozen.subjectRemoteOf, frozen.sourceIndexes.taskByLocalId[it.id])
            },
            studySessions = frozen.sessions.map { session ->
                toDto(
                    entity = session,
                    subjectRemoteOf = frozen.subjectRemoteOf,
                    taskRemoteOf = frozen.taskRemoteOf,
                    aiHelpCount = frozen.aiHelpCountBySession[session.id] ?: 0,
                    externalAiSeconds = externalAiSecondsBySession[session.id]
                )
            }
        )
    }

    private data class FrozenSnapshotEntities(
        val subjects: List<SubjectEntity>,
        val weeklyGoals: List<WeeklyGoalEntity>,
        val tasks: List<TaskEntity>,
        val sessions: List<StudySessionEntity>,
        val subjectRemoteOf: Map<Long, String?>,
        val taskRemoteOf: Map<Long, String?>,
        val sourceIndexes: ProposalSourceIndexes,
        val examTags: Map<String, SubjectExamTag>,
        val aiHelpCountBySession: Map<Long, Int>
    )

    private suspend fun ensureSubjectRemoteId(entity: SubjectEntity, now: Long): SubjectEntity {
        if (entity.remoteId != null) return entity
        val remoteId = newUuid()
        database.subjectDao().assignRemoteId(entity.id, remoteId, now)
        return entity.copy(remoteId = remoteId, updatedAt = now)
    }

    private suspend fun ensureGoalRemoteId(entity: WeeklyGoalEntity, now: Long): WeeklyGoalEntity {
        if (entity.remoteId != null) return entity
        val remoteId = newUuid()
        database.weeklyGoalDao().assignRemoteId(entity.id, remoteId, now)
        return entity.copy(remoteId = remoteId, updatedAt = now)
    }

    private suspend fun ensureTaskRemoteId(entity: TaskEntity, now: Long): TaskEntity {
        if (entity.remoteId != null) return entity
        val remoteId = newUuid()
        database.taskDao().assignRemoteId(entity.id, remoteId, now)
        return entity.copy(remoteId = remoteId, updatedAt = now)
    }

    private suspend fun ensureSessionRemoteId(entity: StudySessionEntity, now: Long): StudySessionEntity {
        if (entity.remoteId != null) return entity
        val remoteId = newUuid()
        database.studySessionDao().assignRemoteId(entity.id, remoteId, now)
        return entity.copy(remoteId = remoteId, updatedAt = now)
    }

    companion object {
        fun newUuid(): String = UUID.randomUUID().toString()
    }
}

// ── DTO 映射（显式字段，外键用 remote_id） ───────────────────────────

private fun toDto(entity: SubjectEntity, examTag: SubjectExamTag? = null): SyncSubjectDto {
    return SyncSubjectDto(
        remoteId = requireNotNull(entity.remoteId),
        name = entity.name,
        color = entity.color,
        icon = entity.icon,
        sortOrder = entity.sortOrder,
        isArchived = entity.isArchived,
        createdAt = entity.createdAt,
        updatedAt = entity.updatedAt,
        deletedAt = entity.deletedAt,
        examTrackId = examTag?.examTrackId,
        examSubjectId = examTag?.examSubjectId,
        examModuleId = examTag?.examModuleId
    )
}

private fun toDto(entity: WeeklyGoalEntity, sourceProposalId: String? = null): SyncWeeklyGoalDto {
    return SyncWeeklyGoalDto(
        remoteId = requireNotNull(entity.remoteId),
        weekStart = entity.weekStart,
        title = entity.title,
        successCriteria = entity.successCriteria,
        status = entity.status,
        completedAt = entity.completedAt,
        deferredToWeekStart = entity.deferredToWeekStart,
        exceptionReason = entity.exceptionReason,
        createdAt = entity.createdAt,
        updatedAt = entity.updatedAt,
        deletedAt = entity.deletedAt,
        sourceProposalId = sourceProposalId
    )
}

private fun toDto(
    entity: TaskEntity,
    subjectRemoteOf: Map<Long, String?>,
    sourceProposalId: String? = null
): SyncTaskDto {
    return SyncTaskDto(
        remoteId = requireNotNull(entity.remoteId),
        subjectRemoteId = entity.subjectId?.let { subjectRemoteOf[it] },
        title = entity.title,
        content = entity.content,
        type = entity.type,
        priority = entity.priority,
        status = entity.status,
        targetDurationSeconds = entity.targetDurationSeconds,
        dueAt = entity.dueAt,
        completedAt = entity.completedAt,
        sortOrder = entity.sortOrder,
        createdAt = entity.createdAt,
        updatedAt = entity.updatedAt,
        deletedAt = entity.deletedAt,
        sourceProposalId = sourceProposalId
    )
}

private fun toDto(
    entity: StudySessionEntity,
    subjectRemoteOf: Map<Long, String?>,
    taskRemoteOf: Map<Long, String?>,
    aiHelpCount: Int = 0,
    externalAiSeconds: Long? = null
): SyncStudySessionDto {
    val source = when {
        entity.aiHelpSeconds > 0 || aiHelpCount > 0 -> "alerttime_ai_help"
        externalAiSeconds != null -> "usage_stats"
        else -> "unknown"
    }
    return SyncStudySessionDto(
        remoteId = requireNotNull(entity.remoteId),
        subjectRemoteId = entity.subjectId?.let { subjectRemoteOf[it] },
        taskRemoteId = entity.taskId?.let { taskRemoteOf[it] },
        title = entity.title,
        startTime = entity.startTime,
        endTime = entity.endTime,
        durationSeconds = entity.durationSeconds,
        pauseSeconds = entity.pauseSeconds,
        focusScore = entity.focusScore,
        // 隐私最小化：会话自由文本笔记默认不上传（协议字段保留为可选，v1 客户端永不发送）。
        note = null,
        status = entity.status,
        createdAt = entity.createdAt,
        updatedAt = entity.updatedAt,
        deletedAt = entity.deletedAt,
        aiHelpSeconds = entity.aiHelpSeconds,
        aiHelpCount = aiHelpCount,
        externalAiAppSeconds = externalAiSeconds,
        aiUsageSource = source
    )
}
