package com.hxz.alerttime.app.data.backup

/**
 * Result types surfaced to the backup UI. Detailed exceptions are logged and tested,
 * but are never shown as stack traces to the user.
 */
sealed class BackupOperationResult {
    data object Success : BackupOperationResult()

    data class Failure(val message: String) : BackupOperationResult()
}

/** Human-readable info about a recently created local backup. */
data class RecentBackupMeta(
    val exportedAt: Long,
    val fileSizeBytes: Long,
    val schemaVersion: Int,
    val databaseVersion: Int,
    val appVersion: String?,
    val dataSummary: BackupDataSummary
)

/** Per-collection counts shown in the restore preview. */
data class BackupDataSummary(
    val users: Int,
    val subjects: Int,
    val tasks: Int,
    val weeklyGoals: Int,
    val studySessions: Int,
    val studySessionEvents: Int,
    val diaries: Int,
    val appSettings: Int
) {
    val total: Int
        get() = users + subjects + tasks + weeklyGoals + studySessions +
            studySessionEvents + diaries + appSettings
}

fun BackupDataDto.toSummary(): BackupDataSummary = BackupDataSummary(
    users = users?.size ?: 0,
    subjects = subjects?.size ?: 0,
    tasks = tasks?.size ?: 0,
    weeklyGoals = weeklyGoals?.size ?: 0,
    studySessions = studySessions?.size ?: 0,
    studySessionEvents = studySessionEvents?.size ?: 0,
    diaries = diaries?.size ?: 0,
    appSettings = appSettings?.size ?: 0
)

/** A validated backup ready to be restored after the user confirms. */
data class RestorePreview(
    val exportedAt: Long,
    val schemaVersion: Int,
    val databaseVersion: Int,
    val appVersion: String?,
    val data: BackupDataDto,
    val source: RestoreSource
)

enum class RestoreSource {
    RECENT_BACKUP,
    FILE
}

/** Thrown when a backup/restore operation cannot run right now. */
class BackupBlockedException(message: String) : Exception(message)

/** Thrown when the backup file itself is unreadable or invalid. */
class BackupFileException(message: String, cause: Throwable? = null) : Exception(message, cause)
