package com.hxz.alerttime.app.data.backup

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.data.local.ALERT_TIME_DATABASE_VERSION
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import com.hxz.alerttime.app.data.local.entity.DiaryEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity
import com.hxz.alerttime.app.data.local.entity.SubjectEntity
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import com.hxz.alerttime.app.data.local.entity.UserEntity
import com.hxz.alerttime.app.data.local.entity.WeeklyGoalEntity
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

@RunWith(AndroidJUnit4::class)
class BackupRepositoryInstrumentedTest {

    private lateinit var database: AlertTimeDatabase
    private lateinit var repository: BackupRepository
    private lateinit var context: Context
    private lateinit var backupGate: BackupTimerGate
    private lateinit var recentBackupDir: File

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, AlertTimeDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        backupGate = BackupTimerGate()
        // P0: tests MUST use an isolated temp directory, never the production
        // recent-backup location under noBackupFilesDir.
        recentBackupDir = File(context.cacheDir, "backup-test-${System.currentTimeMillis()}")
        repository = BackupRepository(
            database = database,
            context = context,
            backupGate = backupGate,
            recentBackupRoot = recentBackupDir
        )
    }

    @After
    fun tearDown() {
        recentBackupDir.deleteRecursively()
        database.close()
    }

    /**
     * Guards the P0 regression: the repository writes ONLY into the injected test
     * directory, never the production noBackupFilesDir location. We assert on the
     * injected dir (must contain the file) and on the production path (must not be
     * created by tests); we never assert on the production dir's contents, which
     * legitimately hold real user backups.
     */
    @Test
    fun recentBackup_writtenToInjectedDirectory_notProduction() = runBlocking {
        seedUser(1, "学习者")
        val productionFile = File(context.noBackupFilesDir, BackupRepository.RECENT_BACKUP_DIR)
            .resolve(BackupRepository.RECENT_BACKUP_FILE)
        val existedBefore = productionFile.exists()
        val sizeBefore = productionFile.takeIf { existedBefore }?.length()
        val modifiedBefore = productionFile.takeIf { existedBefore }?.lastModified()

        assertTrue(repository.createRecentBackup() is BackupOperationResult.Success)

        assertTrue(File(recentBackupDir, BackupRepository.RECENT_BACKUP_FILE).exists())
        assertEquals(existedBefore, productionFile.exists())
        if (existedBefore) {
            assertEquals(sizeBefore, productionFile.length())
            assertEquals(modifiedBefore, productionFile.lastModified())
        }
    }

    private suspend fun seedUser(userId: Long, nickname: String) {
        database.userDao().insertAll(
            listOf(
                UserEntity(
                    id = userId,
                    nickname = nickname,
                    createdAt = 1_000,
                    updatedAt = 1_000
                )
            )
        )
    }

    private fun backupData(userId: Long = 10) = BackupDataDto(
        users = listOf(
            UserDto(id = userId, nickname = "备份用户", createdAt = 100, updatedAt = 100),
            // Soft-deleted user preserved in the backup.
            UserDto(
                id = userId + 1,
                nickname = "已删除用户",
                createdAt = 100,
                updatedAt = 200,
                deletedAt = 300
            )
        ),
        subjects = listOf(
            SubjectDto(
                id = userId * 100,
                userId = userId,
                name = "英语",
                color = "#4F7CAC",
                createdAt = 100,
                updatedAt = 100
            )
        ),
        tasks = listOf(
            TaskDto(
                id = userId * 1_000,
                userId = userId,
                subjectId = userId * 100,
                title = "完成练习",
                type = StatusCodes.TYPE_PLAN,
                status = StatusCodes.TASK_TODO,
                targetDurationSeconds = 1_800,
                createdAt = 100,
                updatedAt = 100
            )
        ),
        weeklyGoals = listOf(
            WeeklyGoalDto(
                id = userId * 10_000,
                userId = userId,
                weekStart = 1_700_000_000_000L,
                title = "周目标",
                status = StatusCodes.WEEKLY_GOAL_TODO,
                createdAt = 100,
                updatedAt = 100
            )
        ),
        studySessions = listOf(
            StudySessionDto(
                id = userId * 100_000,
                userId = userId,
                subjectId = userId * 100,
                taskId = userId * 1_000,
                startTime = 1_000,
                endTime = 2_000,
                durationSeconds = 900,
                pauseSeconds = 50,
                focusScore = 80,
                status = StatusCodes.SESSION_COMPLETED,
                createdAt = 1_000,
                updatedAt = 2_000
            )
        ),
        studySessionEvents = listOf(
            StudySessionEventDto(
                id = 1,
                sessionId = userId * 100_000,
                eventType = StatusCodes.EVENT_START,
                eventTime = 1_000,
                createdAt = 1_000
            ),
            StudySessionEventDto(
                id = 2,
                sessionId = userId * 100_000,
                eventType = StatusCodes.EVENT_END,
                eventTime = 2_000,
                createdAt = 2_000
            )
        ),
        diaries = listOf(
            DiaryDto(
                id = userId * 1_000_000,
                userId = userId,
                title = null,
                content = "今日复盘",
                diaryDate = 1_600_000_000_000L,
                createdAt = 100,
                updatedAt = 100
            )
        ),
        appSettings = listOf(
            AppSettingDto(key = "today_target_seconds", value = "3600", updatedAt = 100)
        )
    )

    private fun preview(data: BackupDataDto) = RestorePreview(
        exportedAt = 1_785_600_000_000L,
        schemaVersion = BackupProtocol.SCHEMA_VERSION,
        databaseVersion = ALERT_TIME_DATABASE_VERSION,
        appVersion = "0.1.0",
        data = data,
        source = RestoreSource.FILE
    )

    @Test
    fun exportSnapshot_includesAllCollectionsAndSoftDeletedRows() = runBlocking {
        seedUser(1, "学习者")
        database.subjectDao().insertAll(
            listOf(
                SubjectEntity(
                    id = 10,
                    userId = 1,
                    name = "英语",
                    createdAt = 100,
                    updatedAt = 100
                )
            )
        )
        // Soft-deleted task must still be exported.
        database.taskDao().insertAll(
            listOf(
                TaskEntity(
                    id = 20,
                    userId = 1,
                    subjectId = 10,
                    title = "已删除计划",
                    createdAt = 100,
                    updatedAt = 200,
                    deletedAt = 300
                )
            )
        )
        database.appSettingDao().insertAll(
            listOf(AppSettingEntity(key = "today_target_seconds", value = "1800", updatedAt = 100))
        )

        val snapshot = repository.exportSnapshot()

        assertEquals(1, snapshot.users?.size)
        assertEquals(1, snapshot.subjects?.size)
        assertEquals(1, snapshot.tasks?.size)
        assertEquals(300L, snapshot.tasks?.single()?.deletedAt)
        assertEquals(1, snapshot.appSettings?.size)
        assertEquals("1800", snapshot.appSettings?.single()?.value)
    }

    @Test
    fun restoreReplacesAllData_preservesForeignKeysAndSoftDeletes() = runBlocking {
        // Original data that must be fully replaced.
        seedUser(1, "原始用户")
        database.subjectDao().insertAll(
            listOf(SubjectEntity(id = 2, userId = 1, name = "旧科目", createdAt = 100, updatedAt = 100))
        )

        val result = repository.restoreValidated(preview(backupData()))

        assertTrue(result is BackupOperationResult.Success)

        val users = database.userDao().exportAll()
        assertEquals(2, users.size)
        assertEquals("备份用户", users.first { it.id == 10L }.nickname)
        assertEquals(300L, users.first { it.id == 11L }.deletedAt)
        // Original user gone.
        assertFalse(users.any { it.id == 1L })

        val subjects = database.subjectDao().exportAll()
        assertEquals(1, subjects.size)
        assertEquals(1_000L, subjects.single().id)

        val tasks = database.taskDao().exportAll()
        assertEquals(1, tasks.size)
        assertEquals(10_000L, tasks.single().id)

        val sessions = database.studySessionDao().exportAllSessions()
        assertEquals(1, sessions.size)
        assertEquals(1_000_000L, sessions.single().id)

        val events = database.studySessionDao().exportAllEvents()
        assertEquals(2, events.size)
        assertTrue(events.all { it.sessionId == 1_000_000L })

        val diaries = database.diaryDao().exportAll()
        assertEquals(1, diaries.size)
        assertEquals(10_000_000L, diaries.single().id)

        val goals = database.weeklyGoalDao().exportAll()
        assertEquals(1, goals.size)
        assertEquals(100_000L, goals.single().id)
    }

    @Test
    fun mergeAddsMissingBackupData_butKeepsCurrentConflicts() = runBlocking {
        // B: data created after backup A. Its matching local keys must win.
        seedUser(10, "当前用户")
        database.appSettingDao().insertAll(
            listOf(AppSettingEntity(key = "today_target_seconds", value = "7200", updatedAt = 999))
        )

        val result = repository.mergeValidated(preview(backupData()))

        assertTrue(result is BackupOperationResult.Success)
        val users = database.userDao().exportAll()
        assertEquals(2, users.size)
        assertEquals("当前用户", users.first { it.id == 10L }.nickname)
        assertEquals("已删除用户", users.first { it.id == 11L }.nickname)

        // A-only rows are added with their validated foreign-key graph intact.
        assertEquals(1_000L, database.subjectDao().exportAll().single().id)
        assertEquals(10_000L, database.taskDao().exportAll().single().id)
        assertEquals(1_000_000L, database.studySessionDao().exportAllSessions().single().id)
        assertEquals(2, database.studySessionDao().exportAllEvents().size)
        assertEquals(10_000_000L, database.diaryDao().exportAll().single().id)

        // A conflicting key belongs to current B and is never overwritten.
        assertEquals("7200", database.appSettingDao().getSetting("today_target_seconds")?.value)
    }

    @Test
    fun appSettings_restoredExactly() = runBlocking {
        val result = repository.restoreValidated(preview(backupData()))

        assertTrue(result is BackupOperationResult.Success)

        val setting = database.appSettingDao().getSetting("today_target_seconds")
        assertNotNull(setting)
        assertEquals("3600", setting?.value)
    }

    @Test
    fun restoreFailure_rollsBackAndKeepsOldData() = runBlocking {
        seedUser(1, "原始用户")
        database.subjectDao().insertAll(
            listOf(SubjectEntity(id = 2, userId = 1, name = "旧科目", createdAt = 100, updatedAt = 100))
        )

        // Force an insert failure mid-transaction: the events table is gone, so the
        // restore transaction must fail and roll everything back, old data intact.
        database.openHelper.writableDatabase.execSQL("DROP TABLE study_session_events")

        val result = repository.restoreValidated(preview(backupData()))

        assertTrue(result is BackupOperationResult.Failure)

        val users = database.userDao().exportAll()
        assertEquals(1, users.size)
        assertEquals("原始用户", users.single().nickname)
        assertEquals(1, database.subjectDao().exportAll().size)
    }

    @Test
    fun recentBackup_createInspectAndRestore_roundTrip() = runBlocking {
        seedUser(1, "学习者")

        val created = repository.createRecentBackup()
        assertTrue(created is BackupOperationResult.Success)

        assertTrue(repository.hasRecentBackupFile())

        val meta = repository.loadRecentBackupMeta()
        assertNotNull(meta)
        assertEquals(BackupProtocol.SCHEMA_VERSION, meta?.schemaVersion)
        assertEquals(1, meta?.dataSummary?.users)
        assertTrue((meta?.fileSizeBytes ?: 0) > 0)

        val preview = repository.inspectRecentBackup()
        assertNotNull(preview)
        assertEquals(RestoreSource.RECENT_BACKUP, preview?.source)

        // Restore from the recent backup preview works.
        val restored = repository.restoreValidated(preview!!)
        assertTrue(restored is BackupOperationResult.Success)
        assertEquals("学习者", database.userDao().exportAll().single().nickname)
    }

    @Test
    fun recentBackup_missingFile_reportsNullMeta() = runBlocking {
        assertFalse(repository.hasRecentBackupFile())
        assertNull(repository.loadRecentBackupMeta())
        assertNull(repository.inspectRecentBackup())
    }

    @Test
    fun activeTimer_blocksAllOperations_throughSharedGate() = runBlocking {
        seedUser(1, "学习者")
        // The timer claims the shared gate; backup/restore must be refused.
        assertTrue(backupGate.tryStartTimer())

        val createResult = repository.createRecentBackup()
        assertTrue(createResult is BackupOperationResult.Failure)
        assertEquals(BackupRepository.BLOCKED_MESSAGE, (createResult as BackupOperationResult.Failure).message)

        val restoreResult = repository.restoreValidated(preview(backupData()))
        assertTrue(restoreResult is BackupOperationResult.Failure)
        assertEquals(BackupRepository.BLOCKED_MESSAGE, (restoreResult as BackupOperationResult.Failure).message)

        // Data untouched.
        assertEquals(1, database.userDao().exportAll().size)
        assertFalse(repository.hasRecentBackupFile())

        // After the timer ends, operations work again.
        backupGate.markTimerIdle()
        val createAgain = repository.createRecentBackup()
        assertTrue(createAgain is BackupOperationResult.Success)
    }
}
