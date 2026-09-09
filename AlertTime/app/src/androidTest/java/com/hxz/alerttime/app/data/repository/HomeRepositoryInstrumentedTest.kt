package com.hxz.alerttime.app.data.repository

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HomeRepositoryInstrumentedTest {
    private lateinit var database: AlertTimeDatabase
    private lateinit var repository: HomeRepository

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, AlertTimeDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repository = HomeRepository(database)
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun startSession_rejectsSecondRunningSession_andCompletionPersistsNote() = runBlocking {
        val user = repository.ensureLocalUser()
        val startedAt = System.currentTimeMillis() - 60_000
        val sessionId = repository.startSession(
            userId = user.id,
            startedAt = startedAt,
            taskId = null,
            subjectId = null,
            title = "仪器测试"
        )

        val secondStartFailure = runCatching {
            repository.startSession(
                userId = user.id,
                startedAt = startedAt + 1_000,
                taskId = null,
                subjectId = null,
                title = "重复会话"
            )
        }.exceptionOrNull()
        assertTrue(secondStartFailure is IllegalStateException)

        val endedAt = startedAt + 45_000
        repository.completeSession(
            sessionId = sessionId,
            userId = user.id,
            startedAt = startedAt,
            endedAt = endedAt,
            durationSeconds = 40,
            pauseSeconds = 5,
            note = "已保存的测试备注"
        )

        val completed = database.studySessionDao()
            .getCompletedSessionsBetween(user.id, startedAt, endedAt + 1)
            .single()
        assertEquals(StatusCodes.SESSION_COMPLETED, completed.status)
        assertEquals(40L, completed.durationSeconds)
        assertEquals(5L, completed.pauseSeconds)
        assertEquals("已保存的测试备注", completed.note)
        assertNotNull(completed.endTime)

        val duplicateCompletion = runCatching {
            repository.completeSession(
                sessionId = sessionId,
                userId = user.id,
                startedAt = startedAt,
                endedAt = endedAt + 1_000,
                durationSeconds = 41,
                pauseSeconds = 5
            )
        }.exceptionOrNull()
        assertTrue(duplicateCompletion is IllegalStateException)
        assertEquals(
            1,
            repository.sessionEvents(sessionId).count { it.eventType == StatusCodes.EVENT_END }
        )
    }

    @Test
    fun ensureLocalUser_isAtomicAcrossConcurrentCallers() = runBlocking {
        val ids = coroutineScope {
            List(8) {
                async { AlertTimeDatabase.ensureLocalUserId(database) }
            }.awaitAll()
        }

        assertEquals(1, ids.distinct().size)
        assertEquals(1, database.userDao().countActiveUsers())
    }

    @Test
    fun getEventsForSessions_acceptsEmptyList() = runBlocking {
        assertTrue(database.studySessionDao().getEventsForSessions(emptyList()).isEmpty())
    }

    @Test
    fun completeSession_keepsLinkedTaskPendingByDefault() = runBlocking {
        val user = repository.ensureLocalUser()
        val startedAt = System.currentTimeMillis() - 60_000
        val taskId = database.taskDao().upsert(
            TaskEntity(
                userId = user.id,
                title = "提前结束不完成计划",
                type = StatusCodes.TYPE_PLAN,
                targetDurationSeconds = 3_600,
                createdAt = startedAt,
                updatedAt = startedAt
            )
        )
        val sessionId = repository.startSession(
            userId = user.id,
            startedAt = startedAt,
            taskId = taskId,
            subjectId = null,
            title = "提前结束不完成计划"
        )

        repository.completeSession(
            sessionId = sessionId,
            userId = user.id,
            startedAt = startedAt,
            endedAt = startedAt + 60_000,
            durationSeconds = 60,
            pauseSeconds = 0,
            taskId = taskId
        )

        val task = requireNotNull(database.taskDao().getTask(taskId))
        assertEquals(StatusCodes.TASK_TODO, task.status)
        assertEquals(null, task.completedAt)
    }

    @Test
    fun completeSession_marksLinkedTaskDone_whenExplicitlyRequested() = runBlocking {
        val user = repository.ensureLocalUser()
        val startedAt = System.currentTimeMillis() - 60_000
        val taskId = database.taskDao().upsert(
            TaskEntity(
                userId = user.id,
                title = "首页完成同步测试",
                type = StatusCodes.TYPE_PLAN,
                createdAt = startedAt,
                updatedAt = startedAt
            )
        )
        val sessionId = repository.startSession(
            userId = user.id,
            startedAt = startedAt,
            taskId = taskId,
            subjectId = null,
            title = "首页完成同步测试"
        )
        val endedAt = startedAt + 45_000

        repository.completeSession(
            sessionId = sessionId,
            userId = user.id,
            startedAt = startedAt,
            endedAt = endedAt,
            durationSeconds = 45,
            pauseSeconds = 0,
            taskId = taskId,
            title = "首页完成同步测试",
            markLinkedTaskDone = true
        )

        val task = requireNotNull(database.taskDao().getTask(taskId))
        assertEquals(StatusCodes.TASK_DONE, task.status)
        assertEquals(endedAt, task.completedAt)
    }
}
