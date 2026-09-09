package com.hxz.alerttime.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import androidx.room.Upsert
import com.hxz.alerttime.app.data.local.entity.SubjectEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SubjectDao {
    @Query(
        "SELECT * FROM subjects WHERE user_id = :userId AND deleted_at IS NULL " +
            "ORDER BY sort_order ASC, created_at ASC"
    )
    fun observeSubjects(userId: Long): Flow<List<SubjectEntity>>

    @Query(
        "SELECT * FROM subjects WHERE user_id = :userId AND deleted_at IS NULL " +
            "ORDER BY sort_order ASC, created_at ASC"
    )
    suspend fun getSubjects(userId: Long): List<SubjectEntity>

    /** Subjects that may be referenced by a newly accepted Teacher proposal. */
    @Query(
        "SELECT * FROM subjects WHERE user_id = :userId AND deleted_at IS NULL " +
            "AND is_archived = 0 ORDER BY sort_order ASC, created_at ASC"
    )
    suspend fun getActiveSubjectsForProposal(userId: Long): List<SubjectEntity>

    @Query("SELECT * FROM subjects WHERE user_id = :userId ORDER BY sort_order ASC, created_at ASC")
    suspend fun getSubjectsIncludingDeleted(userId: Long): List<SubjectEntity>

    @Query("SELECT * FROM subjects WHERE id = :subjectId AND deleted_at IS NULL LIMIT 1")
    suspend fun getSubject(subjectId: Long): SubjectEntity?

    @Query(
        "SELECT * FROM subjects WHERE user_id = :userId AND name = :name " +
            "AND deleted_at IS NULL LIMIT 1"
    )
    suspend fun getSubjectByName(userId: Long, name: String): SubjectEntity?

    @Query("SELECT COUNT(*) FROM subjects WHERE user_id = :userId AND deleted_at IS NULL")
    suspend fun countSubjects(userId: Long): Int

    /** Full snapshot including soft-deleted rows, for backup export. */
    @Query("SELECT * FROM subjects ORDER BY id")
    suspend fun exportAll(): List<SubjectEntity>

    @Query("DELETE FROM subjects")
    suspend fun deleteAll()

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertAll(subjects: List<SubjectEntity>)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAllIgnoring(subjects: List<SubjectEntity>)

    @Upsert
    suspend fun upsert(subject: SubjectEntity): Long

    @Update
    suspend fun update(subject: SubjectEntity)

    @Query("UPDATE subjects SET deleted_at = :deletedAt, updated_at = :updatedAt WHERE id = :subjectId")
    suspend fun softDeleteSubject(subjectId: Long, deletedAt: Long, updatedAt: Long)

    /** 跨设备稳定 ID：只在 remote_id 为空时写入（同步快照事务内调用）。 */
    @Query("UPDATE subjects SET remote_id = :remoteId, updated_at = :updatedAt WHERE id = :subjectId AND remote_id IS NULL")
    suspend fun assignRemoteId(subjectId: Long, remoteId: String, updatedAt: Long): Int
}
