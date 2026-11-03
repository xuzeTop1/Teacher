package com.hxz.alerttime.app.data.sync

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hxz.alerttime.app.data.backup.BackupRepository
import com.hxz.alerttime.app.data.backup.BackupTimerGate
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.data.local.entity.SubjectEntity
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import com.hxz.alerttime.app.data.local.entity.UserEntity
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 快照构建（remote_id 持久化、note 不上传）与备份排除 sync_* instrumentation 测试。
 */
@RunWith(AndroidJUnit4::class)
class SyncSnapshotAndBackupInstrumentedTest {

    private lateinit var database: AlertTimeDatabase
    private lateinit var context: Context
    private lateinit var recentBackupDir: File

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, AlertTimeDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        recentBackupDir = File(context.cacheDir, "sync-backup-test-${System.currentTimeMillis()}")
    }

    @After
    fun tearDown() {
        recentBackupDir.deleteRecursively()
        database.close()
    }

    private fun seedUserAndData(): Long = runBlocking {
        val userId = AlertTimeDatabase.ensureLocalUserId(database)
        database.subjectDao().upsert(
            SubjectEntity(userId = userId, name = "英语", createdAt = 1, updatedAt = 1)
        )
        database.taskDao().upsert(
            TaskEntity(userId = userId, title = "计划一", type = 1, status = 0, createdAt = 1, updatedAt = 1)
        )
        userId
    }

    @Test
    fun snapshotAssignsAndPersistsRemoteIds_andOmitsNotes() = runBlocking {
        val userId = seedUserAndData()
        database.studySessionDao().insertSession(
            StudySessionEntity(
                userId = userId,
                title = "会话",
                startTime = 1,
                durationSeconds = 100,
                pauseSeconds = 0,
                status = 0,
                note = "包含隐私的笔记",
                createdAt = 1,
                updatedAt = 1
            )
        )

        val builder = SyncSnapshotBuilder(database)
        val snapshot = builder.buildSnapshot()

        // 所有实体都有稳定 remoteId，且已持久化到数据库。
        assertEquals(1, snapshot.subjects.size)
        assertEquals(1, snapshot.tasks.size)
        assertEquals(1, snapshot.studySessions.size)
        assertNotNull(snapshot.subjects[0].remoteId)
        assertNotNull(snapshot.tasks[0].remoteId)
        assertNotNull(snapshot.studySessions[0].remoteId)
        assertEquals(snapshot.subjects[0].remoteId, database.subjectDao().exportAll()[0].remoteId)

        // 隐私最小化：note 默认不上传。
        assertNull(snapshot.studySessions[0].note)

        // 再次构建快照：remote_id 复用，不生成新 UUID。
        val second = builder.buildSnapshot()
        assertEquals(snapshot.subjects[0].remoteId, second.subjects[0].remoteId)
    }

    @Test
    fun acceptedProposalSourceIsInSnapshot_andPairingClearOnlyRemovesAttribution() = runBlocking {
        val userId = AlertTimeDatabase.ensureLocalUserId(database)
        database.subjectDao().upsert(
            SubjectEntity(
                userId = userId,
                name = "数学",
                remoteId = "subject-source-1",
                createdAt = 1,
                updatedAt = 1
            )
        )
        val proposalId = "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f"
        val proposal = SyncProposalDto(
            proposalId = proposalId,
            deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            version = 1,
            status = "pending",
            rationale = "根据本周计划生成",
            proposedWeeklyGoals = listOf(
                SyncProposedWeeklyGoalDto(weekStart = 1, title = "数学周目标")
            ),
            proposedTasks = listOf(
                SyncProposedTaskDto(title = "数学任务", subjectRemoteId = "subject-source-1")
            ),
            sourceAssessmentIds = emptyList(),
            createdAt = 1
        )
        val proposalStore = SyncProposalStore(database, database.appSettingDao())
        assertTrue(proposalStore.acceptProposal(proposal))

        val builder = SyncSnapshotBuilder(database)
        val attributed = builder.buildSnapshot()
        assertEquals(proposalId, attributed.weeklyGoals.single().sourceProposalId)
        assertEquals(proposalId, attributed.tasks.single().sourceProposalId)

        database.appSettingDao().upsert(
            AppSettingEntity(
                key = ProposalSourceMappingCodec.KEY,
                value = "{\"version\":1,\"entries\":[{\"proposalId\":\"bad id\",\"weeklyGoalLocalIds\":[1],\"taskLocalIds\":[]}]}",
                updatedAt = 2
            )
        )
        val afterCorruption = builder.buildSnapshot()
        assertNull(afterCorruption.weeklyGoals.single().sourceProposalId)
        assertNull(afterCorruption.tasks.single().sourceProposalId)

        proposalStore.clearPairingRuntimeState()
        val afterClear = builder.buildSnapshot()
        assertEquals(1, afterClear.weeklyGoals.size)
        assertEquals(1, afterClear.tasks.size)
        assertNull(afterClear.weeklyGoals.single().sourceProposalId)
        assertNull(afterClear.tasks.single().sourceProposalId)
    }

    @Test
    fun snapshotCarriesAiUsageFields_andNeverOverridesCoreTiming() = runBlocking {
        val userId = seedUserAndData()
        val sessionId = database.studySessionDao().insertSession(
            StudySessionEntity(
                userId = userId,
                title = "AI 会话",
                startTime = 1,
                // 已完成会话必须带 endTime：SyncSnapshotBuilder 只对
                // endTime != null && endTime > startTime 的会话读取外部 AI 用时
                // （SyncSnapshotBuilder.kt:120-131），而本用例的 fakeReader 也以
                // endTime != null 作为返回 240 的条件。原 fixture 漏设 endTime（默认 null），
                // 于是走到"进行中会话"分支拿到 null，断言得到 expected:<240> but was:<null>。
                // status 本就是 SESSION_COMPLETED(0)，补齐 endTime 才自洽。
                endTime = 501,
                durationSeconds = 500,
                pauseSeconds = 100,
                aiHelpSeconds = 60,
                status = 0,
                createdAt = 1,
                updatedAt = 1
            )
        )
        // AI 求助开始事件 ×2（count 按事件聚合）。
        database.studySessionDao().insertEvent(
            com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity(
                sessionId = sessionId,
                eventType = com.hxz.alerttime.app.core.StatusCodes.EVENT_AI_HELP,
                eventTime = 10,
                eventDetail = "Gemini",
                createdAt = 10
            )
        )
        database.studySessionDao().insertEvent(
            com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity(
                sessionId = sessionId,
                eventType = com.hxz.alerttime.app.core.StatusCodes.EVENT_AI_HELP,
                eventTime = 20,
                eventDetail = "ChatGPT",
                createdAt = 20
            )
        )

        // 外部 AI reader：注入 fake（已授权，返回固定时长）。
        val fakeReader = object : ExternalAiUsageReader {
            var batchCalls = 0

            override fun externalAiAppSecondsForCompleted(
                sessions: List<StudySessionEntity>
            ): Map<Long, Long?> {
                batchCalls += 1
                return sessions.associate { it.id to if (it.endTime != null) 240L else null }
            }
        }
        val builder = SyncSnapshotBuilder(database, externalAiUsageReader = fakeReader)
        val snapshot = builder.buildSnapshot()

        val dto = snapshot.studySessions.first { it.title == "AI 会话" }
        assertEquals(60L, dto.aiHelpSeconds)
        assertEquals(2, dto.aiHelpCount)
        assertEquals(240L, dto.externalAiAppSeconds)
        assertEquals("alerttime_ai_help", dto.aiUsageSource)
        assertEquals("外部 AI UsageStats 必须按快照批量读取一次", 1, fakeReader.batchCalls)
        // AI 字段不得覆盖核心计时字段。
        assertEquals(500L, dto.durationSeconds)
        assertEquals(100L, dto.pauseSeconds)
        // 进行中会话（endTime 为 null）外部 AI 时长保持 unknown。
        val runningId = database.studySessionDao().insertSession(
            StudySessionEntity(
                userId = userId,
                title = "进行中",
                startTime = 1000,
                durationSeconds = 0,
                status = 1,
                createdAt = 1000,
                updatedAt = 1000
            )
        )
        // 快照是时间点载荷：上面那次 buildSnapshot() 之后才插入进行中会话，
        // 必须重新构建才能看到它。（原写法在旧快照上 first{}，必然抛 NoSuchElementException。）
        val runningDto = builder.buildSnapshot().studySessions.first { it.title == "进行中" }
        assertNull(runningDto.externalAiAppSeconds)
        assertEquals("unknown", runningDto.aiUsageSource)
    }

    @Test
    fun backupExport_excludesSyncRuntimeKeys_butKeepsRegularSettings() = runBlocking {
        seedUserAndData()
        database.appSettingDao().upsert(
            AppSettingEntity(key = "sync_server_info_v1", value = """{"host":"192.168.1.5"}""", updatedAt = 1)
        )
        database.appSettingDao().upsert(
            AppSettingEntity(key = "sync_credential_v1", value = "ciphertext-base64", updatedAt = 1)
        )
        database.appSettingDao().upsert(
            AppSettingEntity(key = "sync_proposals_v1", value = "[]", updatedAt = 1)
        )
        database.appSettingDao().upsert(
            AppSettingEntity(key = "theme_mode", value = "light", updatedAt = 1)
        )
        database.appSettingDao().upsert(
            AppSettingEntity(
                key = ProposalSourceMappingCodec.KEY,
                value = ProposalSourceMappingCodec.encode(
                    listOf(ProposalSourceMappingDto("9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f", listOf(1), emptyList()))
                ),
                updatedAt = 1
            )
        )

        val gate = BackupTimerGate()
        val repository = BackupRepository(
            database = database,
            context = context,
            backupGate = gate,
            recentBackupRoot = recentBackupDir
        )
        val data = repository.exportSnapshot()
        val exportedKeys = data.appSettings.orEmpty().map { it.key }
        assertFalse("sync_server_info_v1 不得导出", exportedKeys.contains("sync_server_info_v1"))
        assertFalse("sync_credential_v1 不得导出", exportedKeys.contains("sync_credential_v1"))
        assertFalse("sync_proposals_v1 不得导出", exportedKeys.contains("sync_proposals_v1"))
        assertFalse("proposal 来源映射不得导出", exportedKeys.contains(ProposalSourceMappingCodec.KEY))
        assertTrue("普通 AppSetting 仍正常备份", exportedKeys.contains("theme_mode"))
    }

    @Test
    fun restoreAndMerge_defensivelyNeverWriteSyncKeys() = runBlocking {
        seedUserAndData()
        val gate = BackupTimerGate()
        val repository = BackupRepository(
            database = database,
            context = context,
            backupGate = gate,
            recentBackupRoot = recentBackupDir
        )
        // 构造一个绕过"构造期 validator"的预览（直接 new RestorePreview），内含 sync_* key，
        // 用来验证 restoreValidated / mergeValidated 自身的二次校验（revalidatePreview）
        // 会整批拒绝这类载荷，而不是照单写入。
        val data = repository.exportSnapshot().copy(
            appSettings = (repository.exportSnapshot().appSettings.orEmpty()) + listOf(
                com.hxz.alerttime.app.data.backup.AppSettingDto(
                    key = "sync_credential_v1",
                    value = "ciphertext",
                    updatedAt = 1
                ),
                com.hxz.alerttime.app.data.backup.AppSettingDto(
                    key = "sync_server_info_v1",
                    value = """{"host":"192.168.1.5"}""",
                    updatedAt = 1
                )
            )
        )
        val preview = com.hxz.alerttime.app.data.backup.RestorePreview(
            exportedAt = System.currentTimeMillis(),
            schemaVersion = 1,
            databaseVersion = com.hxz.alerttime.app.data.local.ALERT_TIME_DATABASE_VERSION,
            appVersion = null,
            data = data,
            source = com.hxz.alerttime.app.data.backup.RestoreSource.FILE
        )

        // 全量恢复。双重防线：即使调用方直接构造出含 sync_* 的预览、绕过构造期校验，
        // restoreValidated 仍会在 revalidatePreview 处整批拒绝（校验器把 sync_* 视为
        // "设备敏感配置"）。拒绝比"接受后过滤"更强——一个字节都不会落库。
        val restoreResult = repository.restoreValidated(preview)
        assertTrue(
            "含 sync_* 的预览必须被整批拒绝，实际：$restoreResult",
            restoreResult is com.hxz.alerttime.app.data.backup.BackupOperationResult.Failure &&
                restoreResult.message.contains("不允许的设备敏感配置")
        )
        assertNull(database.appSettingDao().getSetting("sync_credential_v1"))
        assertNull(database.appSettingDao().getSetting("sync_server_info_v1"))

        database.appSettingDao().upsert(
            AppSettingEntity(
                key = ProposalSourceMappingCodec.KEY,
                value = ProposalSourceMappingCodec.encode(
                    listOf(ProposalSourceMappingDto("9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f", listOf(1), emptyList()))
                ),
                updatedAt = 2
            )
        )
        // 合并恢复同样整批拒绝，不写入 sync_*。
        val mergeResult = repository.mergeValidated(preview)
        assertTrue(
            "含 sync_* 的预览必须被整批拒绝，实际：$mergeResult",
            mergeResult is com.hxz.alerttime.app.data.backup.BackupOperationResult.Failure &&
                mergeResult.message.contains("不允许的设备敏感配置")
        )
        assertNull(database.appSettingDao().getSetting("sync_credential_v1"))
        assertNull(database.appSettingDao().getSetting("sync_server_info_v1"))
        // 本地既有的 sync_proposal_sources_v1 在整批拒绝后必须原样保留——拒绝即"什么都没发生"，
        // 这正是事务原子性。原断言是 assertNull（期望它被清除），但那建立在"恢复会被接受"的前提上；
        // 现在这类含 sync_* 的载荷在校验处就被整批拒绝，走不到写入/清除，故改为断言本地未被改动。
        assertNotNull(database.appSettingDao().getSetting(ProposalSourceMappingCodec.KEY))
    }

    @Test
    fun restoreOldBackup_doesNotRestorePairing() = runBlocking {
        seedUserAndData()
        // 当前有配对状态与普通设置。
        database.appSettingDao().upsert(
            AppSettingEntity(key = "sync_server_info_v1", value = """{"host":"192.168.1.5"}""", updatedAt = 1)
        )
        database.appSettingDao().upsert(
            AppSettingEntity(key = "theme_mode", value = "light", updatedAt = 1)
        )
        database.appSettingDao().upsert(
            AppSettingEntity(
                key = ProposalSourceMappingCodec.KEY,
                value = ProposalSourceMappingCodec.encode(
                    listOf(ProposalSourceMappingDto("9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f", listOf(1), emptyList()))
                ),
                updatedAt = 1
            )
        )
        val gate = BackupTimerGate()
        val repository = BackupRepository(
            database = database,
            context = context,
            backupGate = gate,
            recentBackupRoot = recentBackupDir
        )

        // 导出（不含 sync_*），用导出数据构造预览后全量恢复。
        val data = repository.exportSnapshot()
        val preview = com.hxz.alerttime.app.data.backup.RestorePreview(
            exportedAt = System.currentTimeMillis(),
            schemaVersion = 1,
            databaseVersion = com.hxz.alerttime.app.data.local.ALERT_TIME_DATABASE_VERSION,
            appVersion = null,
            data = data,
            source = com.hxz.alerttime.app.data.backup.RestoreSource.RECENT_BACKUP
        )
        val result = repository.restoreValidated(preview)
        assertTrue(result is com.hxz.alerttime.app.data.backup.BackupOperationResult.Success)

        // 恢复旧备份不会自动恢复配对；普通设置恢复。
        assertNull(database.appSettingDao().getSetting("sync_server_info_v1"))
        assertNull(database.appSettingDao().getSetting(ProposalSourceMappingCodec.KEY))
        assertEquals("light", database.appSettingDao().getSetting("theme_mode")?.value)
    }
}
