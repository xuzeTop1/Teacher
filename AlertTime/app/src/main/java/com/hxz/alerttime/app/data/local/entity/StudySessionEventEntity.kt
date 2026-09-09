package com.hxz.alerttime.app.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "study_session_events",
    foreignKeys = [
        ForeignKey(
            entity = StudySessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["session_id"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("session_id")]
)
data class StudySessionEventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "session_id") val sessionId: Long,
    @ColumnInfo(name = "event_type") val eventType: Int,
    @ColumnInfo(name = "event_time") val eventTime: Long,
    @ColumnInfo(name = "event_detail") val eventDetail: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long
)
