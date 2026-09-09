package com.hxz.alerttime.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import com.hxz.alerttime.app.data.local.entity.DiaryEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DiaryDao {
    @Query(
        "SELECT * FROM diaries WHERE user_id = :userId AND deleted_at IS NULL " +
            "ORDER BY diary_date DESC, created_at DESC"
    )
    fun observeDiaries(userId: Long): Flow<List<DiaryEntity>>

    /** Full snapshot including soft-deleted rows, for backup export. */
    @Query("SELECT * FROM diaries ORDER BY id")
    suspend fun exportAll(): List<DiaryEntity>

    @Query("DELETE FROM diaries")
    suspend fun deleteAll()

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertAll(diaries: List<DiaryEntity>)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAllIgnoring(diaries: List<DiaryEntity>)

    @Upsert
    suspend fun upsert(diary: DiaryEntity): Long

    @Query("UPDATE diaries SET deleted_at = :deletedAt, updated_at = :updatedAt WHERE id = :diaryId")
    suspend fun softDeleteDiary(diaryId: Long, deletedAt: Long, updatedAt: Long)

    @Query("UPDATE diaries SET title = :title, content = :content, mood = :mood, updated_at = :updatedAt WHERE id = :diaryId")
    suspend fun updateDiary(diaryId: Long, title: String?, content: String, mood: Int?, updatedAt: Long)
}
