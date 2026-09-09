package com.hxz.alerttime.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import androidx.room.Upsert
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface TaskDao {
    @Query(
        "SELECT * FROM tasks WHERE user_id = :userId AND deleted_at IS NULL " +
            "AND type = 1 ORDER BY status ASC, priority DESC, due_at ASC, sort_order ASC"
    )
    fun observeTasks(userId: Long): Flow<List<TaskEntity>>

    @Query(
        "SELECT * FROM tasks WHERE user_id = :userId AND deleted_at IS NULL AND type = 1"
    )
    suspend fun getActivePlans(userId: Long): List<TaskEntity>

    @Query(
        "SELECT COUNT(*) FROM tasks WHERE user_id = :userId AND deleted_at IS NULL " +
            "AND type = 1 AND status = 0 " +
            "AND (due_at IS NULL OR (due_at >= :todayStart AND due_at < :tomorrowStart))"
    )
    suspend fun countPendingTasks(userId: Long, todayStart: Long, tomorrowStart: Long): Int

    @Query(
        "SELECT COUNT(*) FROM tasks WHERE user_id = :userId AND deleted_at IS NULL " +
            "AND type = 1 AND status = 0 " +
            "AND (due_at IS NULL OR (due_at >= :todayStart AND due_at < :tomorrowStart))"
    )
    fun observePendingTaskCount(userId: Long, todayStart: Long, tomorrowStart: Long): Flow<Int>

    @Query(
        "SELECT * FROM tasks WHERE user_id = :userId AND deleted_at IS NULL " +
            "AND type = 1 AND status = 0 " +
            "AND (due_at IS NULL OR (due_at >= :todayStart AND due_at < :tomorrowStart)) " +
            "ORDER BY due_at IS NULL ASC, due_at ASC, priority DESC, sort_order ASC LIMIT 1"
    )
    fun observeNextPendingTask(userId: Long, todayStart: Long, tomorrowStart: Long): Flow<TaskEntity?>

    @Query(
        "SELECT * FROM tasks WHERE user_id = :userId AND deleted_at IS NULL " +
            "AND type = 1 AND status = 0 " +
            "AND (due_at IS NULL OR (due_at >= :todayStart AND due_at < :tomorrowStart)) " +
            "ORDER BY due_at IS NULL ASC, due_at ASC, priority DESC, sort_order ASC"
    )
    fun observePendingTasks(userId: Long, todayStart: Long, tomorrowStart: Long): Flow<List<TaskEntity>>

    @Query("SELECT * FROM tasks WHERE id = :taskId AND deleted_at IS NULL LIMIT 1")
    suspend fun getTask(taskId: Long): TaskEntity?

    /** Full snapshot including soft-deleted rows, for backup export. */
    @Query("SELECT * FROM tasks ORDER BY id")
    suspend fun exportAll(): List<TaskEntity>

    @Query("DELETE FROM tasks")
    suspend fun deleteAll()

    @Query(
        "SELECT COALESCE(SUM(duration_seconds), 0) FROM study_sessions " +
            "WHERE task_id = :taskId AND status = 0 AND deleted_at IS NULL"
    )
    suspend fun completedDurationSecondsForTask(taskId: Long): Long

    @Upsert
    suspend fun upsert(task: TaskEntity): Long

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertAll(tasks: List<TaskEntity>): List<Long>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAllIgnoring(tasks: List<TaskEntity>)

    @Update
    suspend fun update(task: TaskEntity)

    @Query("UPDATE tasks SET deleted_at = :deletedAt, updated_at = :updatedAt WHERE id = :taskId AND deleted_at IS NULL")
    suspend fun softDeleteTask(taskId: Long, deletedAt: Long, updatedAt: Long): Int

    @Query("UPDATE tasks SET title = :title, content = :content, subject_id = :subjectId, target_duration_seconds = :targetDurationSeconds, due_at = :dueAt, updated_at = :updatedAt WHERE id = :taskId AND deleted_at IS NULL")
    suspend fun updateTaskDetails(taskId: Long, title: String, content: String?, subjectId: Long?, targetDurationSeconds: Long?, dueAt: Long?, updatedAt: Long): Int

    @Query(
        "UPDATE tasks SET due_at = :dueAt, updated_at = :updatedAt " +
            "WHERE id = :taskId AND deleted_at IS NULL AND status = 0"
    )
    suspend fun movePendingTaskToDate(taskId: Long, dueAt: Long, updatedAt: Long): Int

    @Query(
        "UPDATE tasks SET status = :status, completed_at = :completedAt, updated_at = :updatedAt " +
            "WHERE id = :taskId AND deleted_at IS NULL"
    )
    suspend fun updateTaskStatus(taskId: Long, status: Int, completedAt: Long?, updatedAt: Long): Int

    /** 跨设备稳定 ID：只在 remote_id 为空时写入（同步快照事务内调用）。 */
    @Query("UPDATE tasks SET remote_id = :remoteId, updated_at = :updatedAt WHERE id = :taskId AND remote_id IS NULL")
    suspend fun assignRemoteId(taskId: Long, remoteId: String, updatedAt: Long): Int
}
