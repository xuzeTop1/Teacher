package com.hxz.alerttime.app.data.backup

import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class BackupJsonCodecTest {

    private fun baseEnvelope() = BackupEnvelopeDto(
        format = BackupProtocol.FORMAT,
        schemaVersion = BackupProtocol.SCHEMA_VERSION,
        databaseVersion = 4,
        appVersion = "0.1.0",
        exportedAt = 1_785_600_000_000L,
        data = BackupDataDto(
            users = listOf(
                UserDto(id = 1, nickname = "学习者", createdAt = 1_000, updatedAt = 1_000)
            ),
            subjects = emptyList(),
            tasks = emptyList(),
            weeklyGoals = emptyList(),
            studySessions = emptyList(),
            studySessionEvents = emptyList(),
            diaries = emptyList(),
            appSettings = emptyList()
        )
    )

    @Test
    fun roundTrip_preservesAllFields() {
        val envelope = BackupEnvelopeDto(
            format = BackupProtocol.FORMAT,
            schemaVersion = 1,
            databaseVersion = 4,
            appVersion = "0.1.0",
            exportedAt = 1_785_600_000_000L,
            data = BackupDataDto(
                users = listOf(
                    UserDto(
                        id = 7,
                        remoteId = "remote-1",
                        nickname = "学习者",
                        avatarUrl = null,
                        createdAt = 1_000,
                        updatedAt = 2_000,
                        deletedAt = null,
                        syncStatus = 1
                    )
                ),
                subjects = listOf(
                    SubjectDto(
                        id = 3,
                        userId = 7,
                        name = "英语",
                        color = "#4F7CAC",
                        icon = null,
                        sortOrder = 1,
                        isArchived = true,
                        createdAt = 1_000,
                        updatedAt = 2_000,
                        deletedAt = null,
                        syncStatus = 0
                    )
                ),
                tasks = listOf(
                    TaskDto(
                        id = 5,
                        userId = 7,
                        subjectId = 3,
                        title = "完成练习",
                        content = "第 3 章",
                        type = 1,
                        priority = 2,
                        status = 0,
                        targetDurationSeconds = 1_800,
                        dueAt = 1_800_000_000_000L,
                        completedAt = null,
                        sortOrder = 0,
                        createdAt = 1_000,
                        updatedAt = 2_000,
                        deletedAt = null,
                        syncStatus = 0
                    )
                ),
                weeklyGoals = listOf(
                    WeeklyGoalDto(
                        id = 1,
                        userId = 7,
                        weekStart = 1_700_000_000_000L,
                        title = "周目标",
                        status = 0,
                        createdAt = 1_000,
                        updatedAt = 1_000
                    )
                ),
                studySessions = listOf(
                    StudySessionDto(
                        id = 9,
                        userId = 7,
                        subjectId = 3,
                        taskId = 5,
                        title = "专注",
                        startTime = 1_000,
                        endTime = 2_000,
                        durationSeconds = 900,
                        pauseSeconds = 50,
                        focusScore = 88,
                        note = "顺利",
                        status = 0,
                        createdAt = 1_000,
                        updatedAt = 2_000
                    )
                ),
                studySessionEvents = listOf(
                    StudySessionEventDto(
                        id = 1,
                        sessionId = 9,
                        eventType = 1,
                        eventTime = 1_000,
                        eventDetail = null,
                        createdAt = 1_000
                    )
                ),
                diaries = listOf(
                    DiaryDto(
                        id = 2,
                        userId = 7,
                        title = "复盘",
                        content = "今天不错",
                        mood = 3,
                        diaryDate = 1_600_000_000_000L,
                        createdAt = 1_000,
                        updatedAt = 1_000
                    )
                ),
                appSettings = listOf(
                    AppSettingDto(key = "today_target_seconds", value = "3600", updatedAt = 1_000)
                )
            )
        )

        val decoded = BackupJsonCodec.decode(BackupJsonCodec.encode(envelope))

        assertEquals(envelope, decoded)
    }

    @Test
    fun roundTrip_nullableFields_andChineseNewlinesAndSpecialCharacters() {
        val envelope = baseEnvelope().copy(
            data = BackupDataDto(
                users = listOf(
                    UserDto(
                        id = 1,
                        nickname = "中文昵称\n换行 \"引号\" \\反斜杠 \t制表符 🎯 emoji",
                        avatarUrl = null,
                        deletedAt = null,
                        createdAt = 1_000,
                        updatedAt = 1_000
                    )
                ),
                subjects = emptyList(),
                tasks = emptyList(),
                weeklyGoals = emptyList(),
                studySessions = emptyList(),
                studySessionEvents = emptyList(),
                diaries = emptyList(),
                appSettings = emptyList()
            )
        )

        val decoded = BackupJsonCodec.decode(BackupJsonCodec.encode(envelope))

        assertEquals("中文昵称\n换行 \"引号\" \\反斜杠 \t制表符 🎯 emoji", decoded.data.users.orEmpty().single().nickname)
        assertNull(decoded.data.users.orEmpty().single().avatarUrl)
    }

    @Test
    fun decode_ignoresUnknownFields_fromFutureVersions() {
        val json = BackupJsonCodec.encode(baseEnvelope())
            .replaceFirst("{\"format\"", "{\"futureTopLevelField\":123,\"format\"")
            .replaceFirst("\"data\":{\"users\"", "\"data\":{\"futureDataField\":42,\"users\"")
            .replaceFirst("{\"id\":1,\"nickname\"", "{\"id\":1,\"futureField\":\"x\",\"nickname\"")

        val decoded = BackupJsonCodec.decode(json)

        assertEquals(BackupProtocol.FORMAT, decoded.format)
        assertEquals("学习者", decoded.data.users.orEmpty().single().nickname)
    }

    @Test
    fun decode_rejectsWrongFieldTypes() {
        val json = BackupJsonCodec.encode(baseEnvelope())
            .replaceFirst("\"nickname\":\"学习者\"", "\"nickname\":123")

        try {
            BackupJsonCodec.decode(json)
            fail("expected SerializationException for wrong type")
        } catch (_: SerializationException) {
            // expected
        }
    }

    @Test
    fun decode_rejectsMissingRequiredFields() {
        // Remove the required "format" field entirely.
        val json = BackupJsonCodec.encode(baseEnvelope())
            .replaceFirst("\"format\":\"alerttime-backup\",", "")

        try {
            BackupJsonCodec.decode(json)
            fail("expected SerializationException for missing required field")
        } catch (_: SerializationException) {
            // expected
        }
    }

    @Test
    fun decode_rejectsMalformedJson() {
        try {
            BackupJsonCodec.decode("{not valid json")
            fail("expected SerializationException for malformed JSON")
        } catch (_: SerializationException) {
            // expected
        }
    }

    @Test
    fun decode_acceptsUnknownVersionStructurally_butValidatorRejectsIt() {
        // A future schemaVersion still decodes (unknown fields tolerated), but the
        // validator must reject it before any database write.
        val json = BackupJsonCodec.encode(baseEnvelope())
            .replaceFirst("\"schemaVersion\":1", "\"schemaVersion\":99")
        val decoded = BackupJsonCodec.decode(json)
        assertEquals(99, decoded.schemaVersion)

        val result = BackupValidator.validate(decoded, currentDatabaseVersion = 4)
        assertTrue(result.errors.any { it.contains("不支持的备份协议版本") })
    }
}
