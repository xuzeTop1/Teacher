package com.hxz.alerttime.app.data.repository

import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.DiaryEntity
import kotlinx.coroutines.flow.Flow
import java.time.LocalDate
import java.time.ZoneId

class DiaryRepository(
    private val database: AlertTimeDatabase
) {
    suspend fun ensureUserId(): Long {
        return AlertTimeDatabase.ensureLocalUserId(database)
    }

    fun observeDiaries(userId: Long): Flow<List<DiaryEntity>> {
        return database.diaryDao().observeDiaries(userId)
    }

    suspend fun addDiary(
        userId: Long,
        title: String?,
        content: String,
        mood: Int?
    ) {
        val now = System.currentTimeMillis()
        val diaryDate = LocalDate.now()
            .atStartOfDay(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()

        database.diaryDao().upsert(
            DiaryEntity(
                userId = userId,
                title = title?.trim()?.ifBlank { null },
                content = content.trim(),
                mood = mood,
                diaryDate = diaryDate,
                createdAt = now,
                updatedAt = now
            )
        )
    }

    suspend fun updateDiary(
        diaryId: Long,
        title: String?,
        content: String,
        mood: Int?
    ) {
        val now = System.currentTimeMillis()
        database.diaryDao().updateDiary(
            diaryId = diaryId,
            title = title?.trim()?.ifBlank { null },
            content = content.trim(),
            mood = mood,
            updatedAt = now
        )
    }

    suspend fun softDeleteDiary(diaryId: Long) {
        val now = System.currentTimeMillis()
        database.diaryDao().softDeleteDiary(
            diaryId = diaryId,
            deletedAt = now,
            updatedAt = now
        )
    }
}
