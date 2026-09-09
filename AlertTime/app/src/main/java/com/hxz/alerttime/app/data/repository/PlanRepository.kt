package com.hxz.alerttime.app.data.repository

import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import com.hxz.alerttime.app.data.local.entity.SubjectEntity
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import com.hxz.alerttime.app.data.local.entity.WeeklyGoalEntity
import androidx.room.withTransaction
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

enum class PlanScheduleMode {
    SingleDay,
    ContinuousDays,
    DailyCycle,
    WeeklyCycle
}

class PlanRepository(
    private val database: AlertTimeDatabase
) {
    suspend fun ensureUserId(): Long {
        return AlertTimeDatabase.ensureLocalUserId(database)
    }

    fun observeTasks(userId: Long): Flow<List<TaskEntity>> {
        return database.taskDao().observeTasks(userId)
    }

    fun observeSubjects(userId: Long): Flow<List<SubjectEntity>> {
        return database.subjectDao().observeSubjects(userId)
    }

    fun observeCompletedTaskDurations(userId: Long): Flow<Map<Long, Long>> {
        return database.studySessionDao().observeSessions(userId).map { sessions ->
            sessions
                .asSequence()
                .filter { it.status == StatusCodes.SESSION_COMPLETED && it.taskId != null }
                .groupBy { requireNotNull(it.taskId) }
                .mapValues { (_, taskSessions) -> taskSessions.sumOf { it.durationSeconds } }
        }
    }

    fun observeWeeklyGoals(userId: Long): Flow<List<WeeklyGoalEntity>> {
        return database.weeklyGoalDao().observeGoals(userId)
    }

    fun observeRestDays(): Flow<Set<Int>> {
        return database.appSettingDao().observeSetting(KEY_WEEKLY_REST_DAYS).map { setting ->
            parseRestDays(setting?.value)
        }
    }

    suspend fun saveRestDays(days: Set<Int>) {
        val normalized = days.filter { it in 1..7 }
            .toSet()
            .ifEmpty { DEFAULT_REST_DAYS }
        database.appSettingDao().upsert(
            AppSettingEntity(
                key = KEY_WEEKLY_REST_DAYS,
                value = normalized.joinToString(","),
                updatedAt = System.currentTimeMillis()
            )
        )
    }

    suspend fun addWeeklyGoal(
        userId: Long,
        weekStart: Long,
        title: String,
        successCriteria: String?
    ) {
        val cleanTitle = title.trim()
        require(cleanTitle.isNotBlank()) { "周目标不能为空" }
        val now = System.currentTimeMillis()
        database.weeklyGoalDao().insert(
            WeeklyGoalEntity(
                userId = userId,
                weekStart = startOfWeek(weekStart),
                title = cleanTitle,
                successCriteria = successCriteria?.trim()?.ifBlank { null },
                status = StatusCodes.WEEKLY_GOAL_TODO,
                createdAt = now,
                updatedAt = now
            )
        )
    }

    suspend fun setWeeklyGoalCompleted(goalId: Long, completed: Boolean) {
        database.withTransaction {
            val goal = database.weeklyGoalDao().getGoal(goalId)
                ?: error("周目标不存在或已删除")
            val expectedStatus = if (completed) {
                StatusCodes.WEEKLY_GOAL_TODO
            } else {
                StatusCodes.WEEKLY_GOAL_DONE
            }
            check(goal.status == expectedStatus) {
                if (completed) "只有进行中的周目标可以完成" else "只有已完成的周目标可以撤销完成"
            }
            val now = System.currentTimeMillis()
            val updatedRows = database.weeklyGoalDao().updateStatus(
                goalId = goalId,
                status = if (completed) StatusCodes.WEEKLY_GOAL_DONE else StatusCodes.WEEKLY_GOAL_TODO,
                completedAt = if (completed) now else null,
                deferredToWeekStart = null,
                exceptionReason = null,
                updatedAt = now
            )
            check(updatedRows == 1) { "周目标不存在或已删除" }
        }
    }

    suspend fun deferWeeklyGoal(goalId: Long, targetWeekStart: Long, reason: String) {
        val cleanReason = reason.trim()
        require(cleanReason.isNotBlank()) { "请填写延期原因" }
        val normalizedTargetWeek = startOfWeek(targetWeekStart)
        database.withTransaction {
            val goal = database.weeklyGoalDao().getGoal(goalId)
                ?: error("周目标不存在或已删除")
            check(goal.status == StatusCodes.WEEKLY_GOAL_TODO) { "只有进行中的周目标可以延期" }
            check(normalizedTargetWeek > goal.weekStart) { "延期周必须晚于原目标周" }
            val now = System.currentTimeMillis()
            val updatedRows = database.weeklyGoalDao().updateStatus(
                goalId = goalId,
                status = StatusCodes.WEEKLY_GOAL_DEFERRED,
                completedAt = null,
                deferredToWeekStart = normalizedTargetWeek,
                exceptionReason = cleanReason,
                updatedAt = now
            )
            check(updatedRows == 1) { "延期周目标失败" }
            database.weeklyGoalDao().insert(
                goal.copy(
                    id = 0,
                    remoteId = null,
                    weekStart = normalizedTargetWeek,
                    status = StatusCodes.WEEKLY_GOAL_TODO,
                    completedAt = null,
                    deferredToWeekStart = null,
                    exceptionReason = null,
                    createdAt = now,
                    updatedAt = now,
                    deletedAt = null,
                    syncStatus = 0
                )
            )
        }
    }

    suspend fun cancelWeeklyGoal(goalId: Long, reason: String) {
        val cleanReason = reason.trim()
        require(cleanReason.isNotBlank()) { "请填写取消原因" }
        database.withTransaction {
            val goal = database.weeklyGoalDao().getGoal(goalId)
                ?: error("周目标不存在或已删除")
            check(goal.status == StatusCodes.WEEKLY_GOAL_TODO) {
                "只有进行中的周目标可以取消"
            }
            val now = System.currentTimeMillis()
            val updatedRows = database.weeklyGoalDao().updateStatus(
                goalId = goalId,
                status = StatusCodes.WEEKLY_GOAL_CANCELED,
                completedAt = null,
                deferredToWeekStart = null,
                exceptionReason = cleanReason,
                updatedAt = now
            )
            check(updatedRows == 1) { "周目标不存在或已删除" }
        }
    }

    suspend fun addPlan(
        userId: Long,
        title: String,
        content: String?,
        subjectId: Long?,
        targetDurationSeconds: Long?,
        startDateMillis: Long,
        scheduleMode: PlanScheduleMode,
        repeatCount: Int
    ) {
        val now = System.currentTimeMillis()
        val dates = buildPlanDates(startDateMillis, scheduleMode, repeatCount)
        val tasks = dates.mapIndexed { index, dueAt ->
                TaskEntity(
                    userId = userId,
                    subjectId = subjectId,
                    title = title.trim(),
                    content = content?.trim()?.ifBlank { null },
                    type = StatusCodes.TYPE_PLAN,
                    targetDurationSeconds = targetDurationSeconds?.takeIf { it > 0 },
                    dueAt = dueAt,
                    sortOrder = index,
                    createdAt = now,
                    updatedAt = now
                )
        }
        database.withTransaction {
            database.taskDao().insertAll(tasks)
        }
    }

    suspend fun updatePlan(
        taskId: Long,
        title: String,
        content: String?,
        subjectId: Long?,
        targetDurationSeconds: Long?,
        dueAt: Long?
    ) {
        val now = System.currentTimeMillis()
        val updatedRows = database.taskDao().updateTaskDetails(
            taskId = taskId,
            title = title.trim(),
            content = content?.trim()?.ifBlank { null },
            subjectId = subjectId,
            targetDurationSeconds = targetDurationSeconds?.takeIf { it > 0 },
            dueAt = dueAt,
            updatedAt = now
        )
        check(updatedRows == 1) { "计划不存在或已删除" }
    }

    suspend fun addSubject(userId: Long, name: String): Long {
        val cleanName = name.trim()
        require(cleanName.isNotBlank()) { "科目名称不能为空" }
        return database.withTransaction {
            database.subjectDao().getSubjectByName(userId, cleanName)?.id ?: run {
                val now = System.currentTimeMillis()
                val nextOrder = database.subjectDao().countSubjects(userId)
                database.subjectDao().upsert(
                    SubjectEntity(
                        userId = userId,
                        name = cleanName,
                        color = "#2F6F62",
                        sortOrder = nextOrder,
                        createdAt = now,
                        updatedAt = now
                    )
                )
            }
        }
    }

    suspend fun deleteSubject(subjectId: Long) {
        val subject = database.subjectDao().getSubject(subjectId) ?: return
        if (subject.name == StatusCodes.DEFAULT_SUBJECT_NAME) return
        val now = System.currentTimeMillis()
        database.subjectDao().softDeleteSubject(
            subjectId = subjectId,
            deletedAt = now,
            updatedAt = now
        )
    }

    suspend fun toggleDone(taskId: Long) {
        database.withTransaction {
            val task = database.taskDao().getTask(taskId)
                ?: error("计划不存在或已删除")
            val now = System.currentTimeMillis()
            val nextDone = task.status == StatusCodes.TASK_TODO
            val updatedRows = database.taskDao().updateTaskStatus(
                taskId = taskId,
                status = if (nextDone) StatusCodes.TASK_DONE else StatusCodes.TASK_TODO,
                completedAt = if (nextDone) now else null,
                updatedAt = now
            )
            check(updatedRows == 1) { "计划状态更新失败" }
        }
    }

    /** Moves a pending task to the start of tomorrow in the device's local time zone. */
    suspend fun deferTaskToTomorrow(taskId: Long, now: Long = System.currentTimeMillis()) {
        database.withTransaction {
            val task = database.taskDao().getTask(taskId)
                ?: error("计划不存在或已删除")
            check(task.status == StatusCodes.TASK_TODO) { "只有未完成的计划可以顺延" }

            val tomorrowStart = startOfNextDay(now)
            check(task.dueAt == null || task.dueAt < tomorrowStart) {
                "该计划已安排在明天或更晚日期"
            }
            val updatedRows = database.taskDao().movePendingTaskToDate(
                taskId = taskId,
                dueAt = tomorrowStart,
                updatedAt = now
            )
            check(updatedRows == 1) { "顺延计划失败" }
        }
    }

    suspend fun softDeletePlan(taskId: Long) {
        val now = System.currentTimeMillis()
        val deletedRows = database.taskDao().softDeleteTask(
            taskId = taskId,
            deletedAt = now,
            updatedAt = now
        )
        check(deletedRows == 1) { "计划不存在或已删除" }
    }

    companion object {
        const val TYPE_PLAN = StatusCodes.TYPE_PLAN
        const val STATUS_TODO = StatusCodes.TASK_TODO
        const val STATUS_DONE = StatusCodes.TASK_DONE
        const val WEEKLY_GOAL_TODO = StatusCodes.WEEKLY_GOAL_TODO
        const val WEEKLY_GOAL_DONE = StatusCodes.WEEKLY_GOAL_DONE
        const val WEEKLY_GOAL_DEFERRED = StatusCodes.WEEKLY_GOAL_DEFERRED
        const val WEEKLY_GOAL_CANCELED = StatusCodes.WEEKLY_GOAL_CANCELED

        const val KEY_WEEKLY_REST_DAYS = "weekly_rest_days"
        val DEFAULT_REST_DAYS: Set<Int> = setOf(DayOfWeek.SUNDAY.value)

        fun startOfDay(millis: Long): Long {
            val zoneId = ZoneId.systemDefault()
            return Instant.ofEpochMilli(millis)
                .atZone(zoneId)
                .toLocalDate()
                .atStartOfDay(zoneId)
                .toInstant()
                .toEpochMilli()
        }

        fun startOfNextDay(millis: Long, zoneId: ZoneId = ZoneId.systemDefault()): Long {
            return Instant.ofEpochMilli(millis)
                .atZone(zoneId)
                .toLocalDate()
                .plusDays(1)
                .atStartOfDay(zoneId)
                .toInstant()
                .toEpochMilli()
        }

        fun startOfWeek(millis: Long, zoneId: ZoneId = ZoneId.systemDefault()): Long {
            return Instant.ofEpochMilli(millis)
                .atZone(zoneId)
                .toLocalDate()
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .atStartOfDay(zoneId)
                .toInstant()
                .toEpochMilli()
        }

        fun nextWeekStart(millis: Long, zoneId: ZoneId = ZoneId.systemDefault()): Long {
            return Instant.ofEpochMilli(startOfWeek(millis, zoneId))
                .atZone(zoneId)
                .plusWeeks(1)
                .toInstant()
                .toEpochMilli()
        }

        fun isRestDay(
            restDays: Set<Int>,
            millis: Long = System.currentTimeMillis(),
            zoneId: ZoneId = ZoneId.systemDefault()
        ): Boolean {
            val dayOfWeek = Instant.ofEpochMilli(millis).atZone(zoneId).dayOfWeek.value
            return dayOfWeek in restDays
        }

        fun parseRestDays(value: String?): Set<Int> {
            val parsed = value
                ?.split(',')
                ?.mapNotNull { it.trim().toIntOrNull()?.takeIf { day -> day in 1..7 } }
                ?.toSet()
                .orEmpty()
            return parsed.ifEmpty { DEFAULT_REST_DAYS }
        }

        private fun buildPlanDates(
            startDateMillis: Long,
            scheduleMode: PlanScheduleMode,
            repeatCount: Int
        ): List<Long> {
            val count = repeatCount.coerceIn(1, 366)
            val stepDays = when (scheduleMode) {
                PlanScheduleMode.SingleDay -> 0
                PlanScheduleMode.ContinuousDays,
                PlanScheduleMode.DailyCycle -> 1
                PlanScheduleMode.WeeklyCycle -> 7
            }
            val actualCount = if (scheduleMode == PlanScheduleMode.SingleDay) 1 else count
            val zoneId = ZoneId.systemDefault()
            var date = Instant.ofEpochMilli(startOfDay(startDateMillis))
                .atZone(zoneId)
                .toLocalDate()
            return List(actualCount) { index ->
                if (index > 0) {
                    date = date.plusDays(stepDays.toLong())
                }
                date.atStartOfDay(zoneId).toInstant().toEpochMilli()
            }
        }
    }
}
