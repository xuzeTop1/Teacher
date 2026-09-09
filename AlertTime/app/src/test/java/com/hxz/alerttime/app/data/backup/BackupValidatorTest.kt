package com.hxz.alerttime.app.data.backup

import com.hxz.alerttime.app.core.StatusCodes
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackupValidatorTest {

    private val currentDatabaseVersion = 4

    private fun validEnvelope(data: BackupDataDto = validData()): BackupEnvelopeDto {
        return BackupEnvelopeDto(
            format = BackupProtocol.FORMAT,
            schemaVersion = BackupProtocol.SCHEMA_VERSION,
            databaseVersion = currentDatabaseVersion,
            appVersion = "0.1.0",
            exportedAt = 1_785_600_000_000L,
            data = data
        )
    }

    /** A structurally valid dataset covering every collection, including soft-deleted rows. */
    private fun validData() = BackupDataDto(
        users = listOf(
            UserDto(id = 1, nickname = "学习者", createdAt = 1_000, updatedAt = 1_000),
            // Soft-deleted user is still exported and must pass validation.
            UserDto(
                id = 2,
                nickname = "旧用户",
                createdAt = 1_000,
                updatedAt = 2_000,
                deletedAt = 3_000
            )
        ),
        subjects = listOf(
            SubjectDto(
                id = 1,
                userId = 1,
                name = "英语",
                color = "#4F7CAC",
                sortOrder = 0,
                createdAt = 1_000,
                updatedAt = 1_000
            ),
            // Soft-deleted subject.
            SubjectDto(
                id = 2,
                userId = 1,
                name = "数学",
                createdAt = 1_000,
                updatedAt = 2_000,
                deletedAt = 3_000
            )
        ),
        tasks = listOf(
            TaskDto(
                id = 1,
                userId = 1,
                subjectId = 1,
                title = "计划A",
                type = StatusCodes.TYPE_PLAN,
                priority = 1,
                status = StatusCodes.TASK_TODO,
                targetDurationSeconds = 1_800,
                sortOrder = 0,
                createdAt = 1_000,
                updatedAt = 1_000
            ),
            // Soft-deleted task without subject (SET NULL semantics).
            TaskDto(
                id = 2,
                userId = 1,
                subjectId = null,
                title = "旧计划",
                type = StatusCodes.TYPE_PLAN,
                status = StatusCodes.TASK_DONE,
                createdAt = 1_000,
                updatedAt = 2_000,
                deletedAt = 3_000
            )
        ),
        weeklyGoals = listOf(
            WeeklyGoalDto(
                id = 1,
                userId = 1,
                weekStart = 1_700_000_000_000L,
                title = "完成复习",
                status = StatusCodes.WEEKLY_GOAL_TODO,
                createdAt = 1_000,
                updatedAt = 1_000
            ),
            WeeklyGoalDto(
                id = 2,
                userId = 1,
                weekStart = 1_700_000_000_000L,
                title = "已取消",
                status = StatusCodes.WEEKLY_GOAL_CANCELED,
                createdAt = 1_000,
                updatedAt = 1_000
            )
        ),
        studySessions = listOf(
            StudySessionDto(
                id = 1,
                userId = 1,
                subjectId = 1,
                taskId = 1,
                title = "专注一",
                startTime = 1_000,
                endTime = 2_000,
                durationSeconds = 900,
                pauseSeconds = 50,
                focusScore = 88,
                status = StatusCodes.SESSION_COMPLETED,
                createdAt = 1_000,
                updatedAt = 2_000
            ),
            StudySessionDto(
                id = 2,
                userId = 1,
                startTime = 3_000,
                durationSeconds = 0,
                status = StatusCodes.SESSION_RUNNING,
                createdAt = 3_000,
                updatedAt = 3_000
            )
        ),
        studySessionEvents = listOf(
            StudySessionEventDto(
                id = 1,
                sessionId = 1,
                eventType = StatusCodes.EVENT_START,
                eventTime = 1_000,
                createdAt = 1_000
            ),
            StudySessionEventDto(
                id = 2,
                sessionId = 1,
                eventType = StatusCodes.EVENT_DISTRACTION_APP,
                eventTime = 1_500,
                eventDetail = "微信 (com.tencent.mm)",
                createdAt = 1_500
            ),
            StudySessionEventDto(
                id = 3,
                sessionId = 1,
                eventType = StatusCodes.EVENT_END,
                eventTime = 2_000,
                createdAt = 2_000
            )
        ),
        diaries = listOf(
            DiaryDto(
                id = 1,
                userId = 1,
                title = "复盘",
                content = "今天专注不错",
                mood = 4,
                diaryDate = 1_600_000_000_000L,
                createdAt = 1_000,
                updatedAt = 1_000
            )
        ),
        appSettings = listOf(
            AppSettingDto(key = "today_target_seconds", value = "3600", updatedAt = 1_000)
        )
    )

    private fun validate(data: BackupDataDto) =
        BackupValidator.validate(validEnvelope(data), currentDatabaseVersion)

    @Test
    fun validDataset_includingSoftDeletedRows_passes() {
        val result = validate(validData())
        assertTrue(result.errors.joinToString(), result.isValid)
    }

    @Test
    fun backupContainingSyncRuntimeKeys_isRejected() {
        // 外部/旧备份可能手工包含 sync_*：必须整批拒绝，不能静默接受。
        val data = validData().copy(
            appSettings = listOf(
                AppSettingDto(key = "today_target_seconds", value = "3600", updatedAt = 1_000),
                AppSettingDto(key = "sync_credential_v1", value = "ciphertext", updatedAt = 1_000),
                AppSettingDto(key = "sync_server_info_v1", value = """{"host":"192.168.1.5"}""", updatedAt = 1_000)
            )
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(
            result.errors.joinToString(),
            result.errors.joinToString().contains("不允许的设备敏感配置")
        )
    }

    @Test
    fun backupContainingLearningAnalysisProviderSettings_isRejected() {
        val data = validData().copy(
            appSettings = listOf(
                AppSettingDto(key = "today_target_seconds", value = "3600", updatedAt = 1_000),
                AppSettingDto(
                    key = "learning_analysis_llm_api_key_ciphertext_v1",
                    value = "keystore-bound-ciphertext",
                    updatedAt = 1_000
                )
            )
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(
            result.errors.joinToString(),
            result.errors.any { it.contains("不允许的设备敏感配置") }
        )
    }

    @Test
    fun backupContainingDerivedLearningAnalysisCache_isRejected() {
        val data = validData().copy(
            appSettings = listOf(
                AppSettingDto(
                    key = "learning_analysis_runtime_latest_v1",
                    value = "{}",
                    updatedAt = 1_000
                )
            )
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("不允许的设备敏感配置") })
    }

    @Test
    fun duplicatePrimaryKey_rejected() {
        val data = validData().copy(
            users = validData().users.orEmpty() + UserDto(id = 1, nickname = "重复", createdAt = 1, updatedAt = 1)
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("重复的主键") })
    }

    @Test
    fun missingForeignKey_rejected() {
        val data = validData().copy(
            tasks = listOf(
                TaskDto(
                    id = 1,
                    userId = 99, // no such user
                    subjectId = 99, // no such subject
                    title = "孤立计划",
                    createdAt = 1,
                    updatedAt = 1
                )
            )
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("不存在的用户") })
        assertTrue(result.errors.any { it.contains("不存在的科目") })
    }

    @Test
    fun eventWithMissingSession_rejected() {
        val data = validData().copy(
            studySessionEvents = listOf(
                StudySessionEventDto(id = 1, sessionId = 999, eventType = 1, eventTime = 1, createdAt = 1)
            )
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("不存在的学习记录") })
    }

    @Test
    fun aiHelpEndedEvent_acceptedByBackupValidator() {
        // 回归：EVENT_AI_HELP_ENDED(=9) 必须在备份事件白名单中，否则含已结束
        // AI 求助记录的备份恢复会被拒绝。
        val data = validData().copy(
            studySessionEvents = listOf(
                StudySessionEventDto(
                    id = 1,
                    sessionId = 1,
                    eventType = StatusCodes.EVENT_AI_HELP,
                    eventTime = 1_000,
                    eventDetail = "Gemini",
                    createdAt = 1_000
                ),
                StudySessionEventDto(
                    id = 2,
                    sessionId = 1,
                    eventType = StatusCodes.EVENT_AI_HELP_ENDED,
                    eventTime = 2_000,
                    createdAt = 2_000
                )
            )
        )
        val result = validate(data)
        assertTrue("AI 结束事件应在备份白名单中: ${result.errors}", result.isValid)
    }

    @Test
    fun invalidEnums_rejected() {
        val badSessionStatus = validate(
            validData().copy(
                studySessions = listOf(
                    validData().studySessions.orEmpty()[0].copy(status = 99)
                )
            )
        )
        assertTrue(badSessionStatus.errors.any { it.contains("status=99") })

        val badEventType = validate(
            validData().copy(
                studySessionEvents = listOf(
                    StudySessionEventDto(id = 1, sessionId = 1, eventType = 99, eventTime = 1, createdAt = 1)
                )
            )
        )
        assertTrue(badEventType.errors.any { it.contains("eventType=99") })

        val badTaskType = validate(
            validData().copy(
                tasks = listOf(validData().tasks.orEmpty()[0].copy(type = 7))
            )
        )
        assertTrue(badTaskType.errors.any { it.contains("type=7") })

        val badGoalStatus = validate(
            validData().copy(
                weeklyGoals = listOf(validData().weeklyGoals.orEmpty()[0].copy(status = 7))
            )
        )
        assertTrue(badGoalStatus.errors.any { it.contains("status=7") })
    }

    @Test
    fun negativeDuration_rejected() {
        val data = validData().copy(
            studySessions = listOf(
                validData().studySessions.orEmpty()[0].copy(durationSeconds = -1)
            )
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("durationSeconds") })
    }

    @Test
    fun negativePauseSeconds_rejected() {
        val data = validData().copy(
            studySessions = listOf(
                validData().studySessions.orEmpty()[0].copy(pauseSeconds = -5)
            )
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("pauseSeconds") })
    }

    @Test
    fun endTimeBeforeStartTime_rejected() {
        val data = validData().copy(
            studySessions = listOf(
                validData().studySessions.orEmpty()[0].copy(startTime = 2_000, endTime = 1_000)
            )
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("结束时间早于开始时间") })
    }

    @Test
    fun focusScoreOutOfRange_rejected() {
        val data = validData().copy(
            studySessions = listOf(
                validData().studySessions.orEmpty()[0].copy(focusScore = 101)
            )
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("focusScore") })
    }

    @Test
    fun oversizedString_rejected() {
        val longTitle = "a".repeat(BackupProtocol.MAX_STRING_LENGTH + 1)
        val data = validData().copy(
            tasks = listOf(validData().tasks.orEmpty()[0].copy(title = longTitle))
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("长度超过上限") })
    }

    @Test
    fun oversizedCollection_rejected() {
        val tooManyUsers = (1L..(BackupProtocol.MAX_COLLECTION_SIZE_USERS + 1L)).map { id ->
            UserDto(id = id, nickname = "用户$id", createdAt = 1, updatedAt = 1)
        }
        val data = validData().copy(users = tooManyUsers)
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("数量超过上限") })
    }

    @Test
    fun missingCollectionKey_rejected() {
        val data = validData().copy(appSettings = null)
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("缺少必需的数据集合 appSettings") })
    }

    @Test
    fun duplicateAppSettingKey_rejected() {
        val data = validData().copy(
            appSettings = listOf(
                AppSettingDto(key = "today_target_seconds", value = "3600", updatedAt = 1),
                AppSettingDto(key = "today_target_seconds", value = "7200", updatedAt = 2)
            )
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("重复的 key") })
    }

    @Test
    fun multipleRunningSessions_rejected() {
        val running = validData().studySessions.orEmpty()[1]
        val data = validData().copy(
            studySessions = validData().studySessions.orEmpty() + listOf(
                running.copy(id = 3, startTime = 9_000)
            )
        )
        val result = validate(data)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("进行中的学习") })
    }

    @Test
    fun singleRunningSession_allowed() {
        val result = validate(validData())
        assertTrue(result.errors.joinToString(), result.isValid)
    }

    @Test
    fun unsupportedSchemaVersion_rejected() {
        val envelope = validEnvelope().copy(schemaVersion = 2)
        val result = BackupValidator.validate(envelope, currentDatabaseVersion)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("不支持的备份协议版本") })
    }

    @Test
    fun newerDatabaseVersion_rejected() {
        val envelope = validEnvelope().copy(databaseVersion = currentDatabaseVersion + 1)
        val result = BackupValidator.validate(envelope, currentDatabaseVersion)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("暂不支持版本转换") })
    }

    @Test
    fun olderDatabaseVersion_rejected() {
        val envelope = validEnvelope().copy(databaseVersion = currentDatabaseVersion - 1)
        val result = BackupValidator.validate(envelope, currentDatabaseVersion)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("暂不支持版本转换") })
    }

    @Test
    fun wrongFormat_rejected() {
        val envelope = validEnvelope().copy(format = "some-other-format")
        val result = BackupValidator.validate(envelope, currentDatabaseVersion)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.contains("不是有效的") })
    }
}
