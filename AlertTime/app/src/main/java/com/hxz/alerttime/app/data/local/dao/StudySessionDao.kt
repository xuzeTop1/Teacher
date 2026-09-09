package com.hxz.alerttime.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface StudySessionDao {
    @Query(
        "SELECT * FROM study_sessions WHERE user_id = :userId AND deleted_at IS NULL " +
            "ORDER BY start_time DESC"
    )
    fun observeSessions(userId: Long): Flow<List<StudySessionEntity>>

    @Query(
        "SELECT COALESCE(SUM(duration_seconds), 0) FROM study_sessions " +
            "WHERE user_id = :userId AND status = 0 AND deleted_at IS NULL " +
            "AND start_time >= :startInclusive AND start_time < :endExclusive"
    )
    fun observeDurationSeconds(
        userId: Long,
        startInclusive: Long,
        endExclusive: Long
    ): Flow<Long>

    @Query(
        "SELECT * FROM study_sessions WHERE user_id = :userId AND status = 0 " +
            "AND deleted_at IS NULL AND start_time < :endExclusive " +
            "AND end_time IS NOT NULL AND end_time > :startInclusive ORDER BY start_time ASC"
    )
    suspend fun getCompletedSessionsBetween(
        userId: Long,
        startInclusive: Long,
        endExclusive: Long
    ): List<StudySessionEntity>

    @Query(
        "SELECT COALESCE(SUM(duration_seconds), 0) FROM study_sessions " +
            "WHERE user_id = :userId AND status = 0 AND deleted_at IS NULL " +
            "AND start_time >= :startInclusive AND start_time < :endExclusive"
    )
    suspend fun getDurationSeconds(
        userId: Long,
        startInclusive: Long,
        endExclusive: Long
    ): Long

    @Query(
        "SELECT COALESCE(SUM(duration_seconds), 0) FROM study_sessions " +
            "WHERE user_id = :userId AND status = 0 AND deleted_at IS NULL"
    )
    suspend fun getTotalDurationSeconds(userId: Long): Long

    @Query(
        "SELECT * FROM study_sessions WHERE user_id = :userId AND status = 1 " +
            "AND deleted_at IS NULL ORDER BY start_time DESC LIMIT 1"
    )
    suspend fun getRunningSession(userId: Long): StudySessionEntity?

    @Query(
        "SELECT * FROM study_sessions WHERE id = :sessionId AND status = :runningStatus " +
            "AND deleted_at IS NULL LIMIT 1"
    )
    suspend fun getRunningSessionById(
        sessionId: Long,
        runningStatus: Int
    ): StudySessionEntity?

    /** Full snapshots including soft-deleted rows, for backup export. */
    @Query("SELECT * FROM study_sessions ORDER BY id")
    suspend fun exportAllSessions(): List<StudySessionEntity>

    @Query("SELECT * FROM study_session_events ORDER BY id")
    suspend fun exportAllEvents(): List<StudySessionEventEntity>

    @Query("DELETE FROM study_sessions")
    suspend fun deleteAllSessions()

    @Query("DELETE FROM study_session_events")
    suspend fun deleteAllEvents()

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertAllSessions(sessions: List<StudySessionEntity>)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAllSessionsIgnoring(sessions: List<StudySessionEntity>)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertAllEvents(events: List<StudySessionEventEntity>)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAllEventsIgnoring(events: List<StudySessionEventEntity>)

    @Query(
        "SELECT * FROM study_session_events WHERE session_id = :sessionId " +
            "ORDER BY event_time ASC, id ASC"
    )
    suspend fun getEventsForSession(sessionId: Long): List<StudySessionEventEntity>

    @Query(
        "SELECT * FROM study_session_events WHERE session_id IN (:sessionIds) " +
            "ORDER BY event_time ASC, id ASC"
    )
    suspend fun getEventsForSessionsUnsafe(sessionIds: List<Long>): List<StudySessionEventEntity>

    suspend fun getEventsForSessions(sessionIds: List<Long>): List<StudySessionEventEntity> {
        return if (sessionIds.isEmpty()) emptyList() else getEventsForSessionsUnsafe(sessionIds)
    }

    @Query(
        "UPDATE study_sessions SET duration_seconds = :durationSeconds, " +
            "pause_seconds = :pauseSeconds, ai_help_seconds = :aiHelpSeconds, updated_at = :updatedAt " +
            "WHERE id = :sessionId AND status = :runningStatus AND deleted_at IS NULL"
    )
    suspend fun updateRunningSessionProgress(
        sessionId: Long,
        durationSeconds: Long,
        pauseSeconds: Long,
        aiHelpSeconds: Long,
        updatedAt: Long,
        runningStatus: Int
    ): Int

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertSession(session: StudySessionEntity): Long

    @Update
    suspend fun updateSession(session: StudySessionEntity)

    @Query(
        "UPDATE study_sessions SET end_time = :endedAt, duration_seconds = :durationSeconds, " +
            "pause_seconds = :pauseSeconds, ai_help_seconds = :aiHelpSeconds, note = :note, " +
            "status = :status, updated_at = :updatedAt " +
            "WHERE id = :sessionId AND status = :runningStatus AND deleted_at IS NULL"
    )
    suspend fun completeSession(
        sessionId: Long,
        endedAt: Long,
        durationSeconds: Long,
        pauseSeconds: Long,
        aiHelpSeconds: Long,
        note: String?,
        status: Int,
        updatedAt: Long,
        runningStatus: Int
    ): Int

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertEvent(event: StudySessionEventEntity): Long

    /** 跨设备稳定 ID：只在 remote_id 为空时写入（同步快照事务内调用）。 */
    @Query("UPDATE study_sessions SET remote_id = :remoteId, updated_at = :updatedAt WHERE id = :sessionId AND remote_id IS NULL")
    suspend fun assignRemoteId(sessionId: Long, remoteId: String, updatedAt: Long): Int
}
