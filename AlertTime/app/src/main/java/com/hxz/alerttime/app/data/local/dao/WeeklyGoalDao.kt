package com.hxz.alerttime.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.hxz.alerttime.app.data.local.entity.WeeklyGoalEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface WeeklyGoalDao {
    @Query(
        "SELECT * FROM weekly_goals WHERE user_id = :userId AND deleted_at IS NULL " +
            "ORDER BY week_start ASC, status ASC, created_at ASC"
    )
    fun observeGoals(userId: Long): Flow<List<WeeklyGoalEntity>>

    @Query("SELECT * FROM weekly_goals WHERE id = :goalId AND deleted_at IS NULL LIMIT 1")
    suspend fun getGoal(goalId: Long): WeeklyGoalEntity?

    /** Full snapshot including soft-deleted rows, for backup export. */
    @Query("SELECT * FROM weekly_goals ORDER BY id")
    suspend fun exportAll(): List<WeeklyGoalEntity>

    @Query("DELETE FROM weekly_goals")
    suspend fun deleteAll()

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertAll(goals: List<WeeklyGoalEntity>)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAllIgnoring(goals: List<WeeklyGoalEntity>)

    @Insert
    suspend fun insert(goal: WeeklyGoalEntity): Long

    @Query(
        "UPDATE weekly_goals SET status = :status, completed_at = :completedAt, " +
            "deferred_to_week_start = :deferredToWeekStart, exception_reason = :exceptionReason, " +
            "updated_at = :updatedAt WHERE id = :goalId AND deleted_at IS NULL"
    )
    suspend fun updateStatus(
        goalId: Long,
        status: Int,
        completedAt: Long?,
        deferredToWeekStart: Long?,
        exceptionReason: String?,
        updatedAt: Long
    ): Int

    /** 跨设备稳定 ID：只在 remote_id 为空时写入（同步快照事务内调用）。 */
    @Query("UPDATE weekly_goals SET remote_id = :remoteId, updated_at = :updatedAt WHERE id = :goalId AND remote_id IS NULL")
    suspend fun assignRemoteId(goalId: Long, remoteId: String, updatedAt: Long): Int
}
