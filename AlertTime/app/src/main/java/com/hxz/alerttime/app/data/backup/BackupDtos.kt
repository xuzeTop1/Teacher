package com.hxz.alerttime.app.data.backup

import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import com.hxz.alerttime.app.data.local.entity.DiaryEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity
import com.hxz.alerttime.app.data.local.entity.SubjectEntity
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import com.hxz.alerttime.app.data.local.entity.UserEntity
import com.hxz.alerttime.app.data.local.entity.WeeklyGoalEntity
import kotlinx.serialization.Serializable

/**
 * Backup JSON protocol, version 1.
 *
 * This is an explicit, versioned data-transfer format. It intentionally does NOT
 * serialize Room entities by reflection: every field below is written out by name,
 * and importing rejects files whose required keys are missing. See docs/BACKUP_AND_SYNC.md.
 *
 * Not encrypted: the exported file is plain text and may contain diary content,
 * study plans, focus records and distraction app labels. It must be kept privately.
 */
object BackupProtocol {
    const val FORMAT = "alerttime-backup"
    const val SCHEMA_VERSION = 1

    /** Maximum accepted backup file size in bytes, enforced while streaming reads. */
    const val MAX_BACKUP_BYTES = 32L * 1024L * 1024L

    // --- Bounds enforced by BackupValidator (see BackupValidator.kt) ---
    const val MAX_COLLECTION_SIZE_USERS = 1_000
    const val MAX_COLLECTION_SIZE_SUBJECTS = 5_000
    const val MAX_COLLECTION_SIZE_TASKS = 100_000
    const val MAX_COLLECTION_SIZE_WEEKLY_GOALS = 50_000
    const val MAX_COLLECTION_SIZE_SESSIONS = 200_000
    const val MAX_COLLECTION_SIZE_EVENTS = 2_000_000
    const val MAX_COLLECTION_SIZE_DIARIES = 100_000
    const val MAX_COLLECTION_SIZE_APP_SETTINGS = 1_000

    const val MAX_STRING_LENGTH = 20_000
    const val MAX_KEY_LENGTH = 128
    const val MAX_EVENT_DETAIL_LENGTH = 1_000
    const val MAX_APP_SETTING_VALUE_LENGTH = 20_000
}

@Serializable
data class BackupEnvelopeDto(
    val format: String,
    val schemaVersion: Int,
    val databaseVersion: Int,
    val appVersion: String? = null,
    val exportedAt: Long,
    val data: BackupDataDto
)

@Serializable
data class BackupDataDto(
    val users: List<UserDto>? = null,
    val subjects: List<SubjectDto>? = null,
    val tasks: List<TaskDto>? = null,
    val weeklyGoals: List<WeeklyGoalDto>? = null,
    val studySessions: List<StudySessionDto>? = null,
    val studySessionEvents: List<StudySessionEventDto>? = null,
    val diaries: List<DiaryDto>? = null,
    val appSettings: List<AppSettingDto>? = null
)

@Serializable
data class UserDto(
    val id: Long,
    val remoteId: String? = null,
    val nickname: String,
    val avatarUrl: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
    val syncStatus: Int = 0
)

@Serializable
data class SubjectDto(
    val id: Long,
    val remoteId: String? = null,
    val userId: Long,
    val name: String,
    val color: String? = null,
    val icon: String? = null,
    val sortOrder: Int = 0,
    val isArchived: Boolean = false,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
    val syncStatus: Int = 0
)

@Serializable
data class TaskDto(
    val id: Long,
    val remoteId: String? = null,
    val userId: Long,
    val subjectId: Long? = null,
    val title: String,
    val content: String? = null,
    val type: Int = 0,
    val priority: Int = 0,
    val status: Int = 0,
    val targetDurationSeconds: Long? = null,
    val dueAt: Long? = null,
    val completedAt: Long? = null,
    val sortOrder: Int = 0,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
    val syncStatus: Int = 0
)

@Serializable
data class WeeklyGoalDto(
    val id: Long,
    val remoteId: String? = null,
    val userId: Long,
    val weekStart: Long,
    val title: String,
    val successCriteria: String? = null,
    val status: Int = 0,
    val completedAt: Long? = null,
    val deferredToWeekStart: Long? = null,
    val exceptionReason: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
    val syncStatus: Int = 0
)

@Serializable
data class StudySessionDto(
    val id: Long,
    val remoteId: String? = null,
    val userId: Long,
    val subjectId: Long? = null,
    val taskId: Long? = null,
    val title: String? = null,
    val startTime: Long,
    val endTime: Long? = null,
    val durationSeconds: Long = 0,
    val pauseSeconds: Long = 0,
    /** AI 求助时长（v5 新增；旧 v4 备份缺失时默认 0）。 */
    val aiHelpSeconds: Long = 0,
    val focusScore: Int? = null,
    val note: String? = null,
    val status: Int = 0,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
    val syncStatus: Int = 0
)

@Serializable
data class StudySessionEventDto(
    val id: Long,
    val sessionId: Long,
    val eventType: Int,
    val eventTime: Long,
    val eventDetail: String? = null,
    val createdAt: Long
)

@Serializable
data class DiaryDto(
    val id: Long,
    val remoteId: String? = null,
    val userId: Long,
    val title: String? = null,
    val content: String,
    val mood: Int? = null,
    val diaryDate: Long,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
    val syncStatus: Int = 0
)

@Serializable
data class AppSettingDto(
    val key: String,
    val value: String,
    val updatedAt: Long
)

// --- Entity mapping (explicit field-by-field; backups preserve local primary keys) ---

fun UserEntity.toBackupDto(): UserDto = UserDto(
    id = id,
    remoteId = remoteId,
    nickname = nickname,
    avatarUrl = avatarUrl,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun UserDto.toEntity(): UserEntity = UserEntity(
    id = id,
    remoteId = remoteId,
    nickname = nickname,
    avatarUrl = avatarUrl,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun SubjectEntity.toBackupDto(): SubjectDto = SubjectDto(
    id = id,
    remoteId = remoteId,
    userId = userId,
    name = name,
    color = color,
    icon = icon,
    sortOrder = sortOrder,
    isArchived = isArchived,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun SubjectDto.toEntity(): SubjectEntity = SubjectEntity(
    id = id,
    remoteId = remoteId,
    userId = userId,
    name = name,
    color = color,
    icon = icon,
    sortOrder = sortOrder,
    isArchived = isArchived,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun TaskEntity.toBackupDto(): TaskDto = TaskDto(
    id = id,
    remoteId = remoteId,
    userId = userId,
    subjectId = subjectId,
    title = title,
    content = content,
    type = type,
    priority = priority,
    status = status,
    targetDurationSeconds = targetDurationSeconds,
    dueAt = dueAt,
    completedAt = completedAt,
    sortOrder = sortOrder,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun TaskDto.toEntity(): TaskEntity = TaskEntity(
    id = id,
    remoteId = remoteId,
    userId = userId,
    subjectId = subjectId,
    title = title,
    content = content,
    type = type,
    priority = priority,
    status = status,
    targetDurationSeconds = targetDurationSeconds,
    dueAt = dueAt,
    completedAt = completedAt,
    sortOrder = sortOrder,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun WeeklyGoalEntity.toBackupDto(): WeeklyGoalDto = WeeklyGoalDto(
    id = id,
    remoteId = remoteId,
    userId = userId,
    weekStart = weekStart,
    title = title,
    successCriteria = successCriteria,
    status = status,
    completedAt = completedAt,
    deferredToWeekStart = deferredToWeekStart,
    exceptionReason = exceptionReason,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun WeeklyGoalDto.toEntity(): WeeklyGoalEntity = WeeklyGoalEntity(
    id = id,
    remoteId = remoteId,
    userId = userId,
    weekStart = weekStart,
    title = title,
    successCriteria = successCriteria,
    status = status,
    completedAt = completedAt,
    deferredToWeekStart = deferredToWeekStart,
    exceptionReason = exceptionReason,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun StudySessionEntity.toBackupDto(): StudySessionDto = StudySessionDto(
    id = id,
    remoteId = remoteId,
    userId = userId,
    subjectId = subjectId,
    taskId = taskId,
    title = title,
    startTime = startTime,
    endTime = endTime,
    durationSeconds = durationSeconds,
    pauseSeconds = pauseSeconds,
    aiHelpSeconds = aiHelpSeconds,
    focusScore = focusScore,
    note = note,
    status = status,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun StudySessionDto.toEntity(): StudySessionEntity = StudySessionEntity(
    id = id,
    remoteId = remoteId,
    userId = userId,
    subjectId = subjectId,
    taskId = taskId,
    title = title,
    startTime = startTime,
    endTime = endTime,
    durationSeconds = durationSeconds,
    pauseSeconds = pauseSeconds,
    aiHelpSeconds = aiHelpSeconds,
    focusScore = focusScore,
    note = note,
    status = status,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun StudySessionEventEntity.toBackupDto(): StudySessionEventDto = StudySessionEventDto(
    id = id,
    sessionId = sessionId,
    eventType = eventType,
    eventTime = eventTime,
    eventDetail = eventDetail,
    createdAt = createdAt
)

fun StudySessionEventDto.toEntity(): StudySessionEventEntity = StudySessionEventEntity(
    id = id,
    sessionId = sessionId,
    eventType = eventType,
    eventTime = eventTime,
    eventDetail = eventDetail,
    createdAt = createdAt
)

fun DiaryEntity.toBackupDto(): DiaryDto = DiaryDto(
    id = id,
    remoteId = remoteId,
    userId = userId,
    title = title,
    content = content,
    mood = mood,
    diaryDate = diaryDate,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun DiaryDto.toEntity(): DiaryEntity = DiaryEntity(
    id = id,
    remoteId = remoteId,
    userId = userId,
    title = title,
    content = content,
    mood = mood,
    diaryDate = diaryDate,
    createdAt = createdAt,
    updatedAt = updatedAt,
    deletedAt = deletedAt,
    syncStatus = syncStatus
)

fun AppSettingEntity.toBackupDto(): AppSettingDto = AppSettingDto(
    key = key,
    value = value,
    updatedAt = updatedAt
)

fun AppSettingDto.toEntity(): AppSettingEntity = AppSettingEntity(
    key = key,
    value = value,
    updatedAt = updatedAt
)
