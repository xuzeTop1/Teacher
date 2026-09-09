package com.hxz.alerttime.app.data.repository

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WeeklyGoalRepositoryInstrumentedTest {
    private lateinit var database: AlertTimeDatabase
    private lateinit var repository: PlanRepository

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, AlertTimeDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repository = PlanRepository(database)
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun deferWeeklyGoal_preservesHistory_andCreatesNextWeekGoal() = runBlocking {
        val userId = repository.ensureUserId()
        val currentWeek = PlanRepository.startOfWeek(System.currentTimeMillis())
        val nextWeek = PlanRepository.nextWeekStart(currentWeek)
        repository.addWeeklyGoal(
            userId = userId,
            weekStart = currentWeek,
            title = "完成高数第五章",
            successCriteria = "独立完成课后习题"
        )
        val original = repository.observeWeeklyGoals(userId).first().single()

        repository.deferWeeklyGoal(
            goalId = original.id,
            targetWeekStart = nextWeek,
            reason = "临时考试"
        )

        val goals = repository.observeWeeklyGoals(userId).first()
        val deferred = goals.single { it.id == original.id }
        val carried = goals.single { it.id != original.id }
        assertEquals(StatusCodes.WEEKLY_GOAL_DEFERRED, deferred.status)
        assertEquals(nextWeek, deferred.deferredToWeekStart)
        assertEquals("临时考试", deferred.exceptionReason)
        assertEquals(StatusCodes.WEEKLY_GOAL_TODO, carried.status)
        assertEquals(nextWeek, carried.weekStart)
        assertEquals(original.title, carried.title)
        assertEquals(original.successCriteria, carried.successCriteria)
        assertNull(carried.exceptionReason)
    }

    @Test
    fun deferTaskToTomorrow_movesPendingTaskWithoutChangingItsProgress() = runBlocking {
        val userId = repository.ensureUserId()
        val now = System.currentTimeMillis()
        val taskId = database.taskDao().upsert(
            TaskEntity(
                userId = userId,
                title = "未完成课程",
                type = StatusCodes.TYPE_PLAN,
                dueAt = PlanRepository.startOfDay(now),
                createdAt = now,
                updatedAt = now
            )
        )

        repository.deferTaskToTomorrow(taskId, now)

        val task = requireNotNull(database.taskDao().getTask(taskId))
        assertEquals(PlanRepository.startOfNextDay(now), task.dueAt)
        assertEquals(StatusCodes.TASK_TODO, task.status)
        assertNull(task.completedAt)
        assertTrue(task.updatedAt >= now)
    }

    @Test
    fun completeWeeklyGoal_canBeUndone() = runBlocking {
        val userId = repository.ensureUserId()
        repository.addWeeklyGoal(
            userId = userId,
            weekStart = PlanRepository.startOfWeek(System.currentTimeMillis()),
            title = "完成课程设计初稿",
            successCriteria = null
        )
        val goalId = repository.observeWeeklyGoals(userId).first().single().id

        repository.setWeeklyGoalCompleted(goalId, true)
        assertEquals(
            StatusCodes.WEEKLY_GOAL_DONE,
            repository.observeWeeklyGoals(userId).first().single().status
        )

        repository.setWeeklyGoalCompleted(goalId, false)
        val undone = repository.observeWeeklyGoals(userId).first().single()
        assertEquals(StatusCodes.WEEKLY_GOAL_TODO, undone.status)
        assertNull(undone.completedAt)
    }
}
