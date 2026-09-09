package com.hxz.alerttime.app.data.repository

import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.core.notifications.ReminderSettings
import com.hxz.alerttime.app.core.time.StudyTimeComposition
import com.hxz.alerttime.app.core.time.calculateStudyTimeComposition
import com.hxz.alerttime.app.core.time.todayBounds
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity
import com.hxz.alerttime.app.data.local.entity.SubjectEntity
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import com.hxz.alerttime.app.data.local.entity.UserEntity
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import androidx.room.withTransaction
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

class HomeRepository(
    private val database: AlertTimeDatabase
) {
    suspend fun ensureLocalUser(): UserEntity {
        return AlertTimeDatabase.ensureLocalUser(database)
    }

    suspend fun ensureDefaultSubjects(userId: Long) {
        database.withTransaction {
            if (database.subjectDao().countSubjects(userId) == 0) {
                seedDefaultSubjects(userId, System.currentTimeMillis())
            }
        }
    }

    suspend fun startSession(userId: Long, startedAt: Long): Long {
        return startSession(
            userId = userId,
            startedAt = startedAt,
            taskId = null,
            subjectId = null,
            title = "专注学习"
        )
    }

    suspend fun startSession(
        userId: Long,
        startedAt: Long,
        taskId: Long?,
        subjectId: Long?,
        title: String
    ): Long {
        return database.withTransaction {
            check(database.studySessionDao().getRunningSession(userId) == null) {
                "已有进行中的学习，请返回首页继续或结束。"
            }
            val sessionId = database.studySessionDao().insertSession(
                StudySessionEntity(
                    userId = userId,
                    subjectId = subjectId,
                    taskId = taskId,
                    title = title,
                    startTime = startedAt,
                    status = SESSION_RUNNING,
                    createdAt = startedAt,
                    updatedAt = startedAt
                )
            )
            database.studySessionDao().insertEvent(
                StudySessionEventEntity(
                    sessionId = sessionId,
                    eventType = EVENT_START,
                    eventTime = startedAt,
                    createdAt = startedAt
                )
            )
            sessionId
        }
    }

    suspend fun completeSession(
        sessionId: Long,
        userId: Long,
        startedAt: Long,
        endedAt: Long,
        durationSeconds: Long,
        pauseSeconds: Long,
        aiHelpSeconds: Long = 0,
        taskId: Long? = null,
        subjectId: Long? = null,
        title: String = "专注学习",
        note: String? = null,
        markLinkedTaskDone: Boolean = false
    ) {
        database.withTransaction {
            val runningSession = database.studySessionDao().getRunningSessionById(
                sessionId = sessionId,
                runningStatus = StatusCodes.SESSION_RUNNING
            ) ?: error("学习记录已结束、已删除或不存在")
            check(runningSession.userId == userId) { "学习记录不属于当前用户" }
            check(runningSession.startTime == startedAt) { "学习记录开始时间不一致" }
            check(endedAt >= runningSession.startTime) { "结束时间不能早于开始时间" }
            check(durationSeconds >= 0 && pauseSeconds >= 0 && aiHelpSeconds >= 0) { "学习时长不能为负数" }
            if (markLinkedTaskDone) {
                check(taskId != null && runningSession.taskId == taskId) {
                    "只能完成学习记录实际关联的计划"
                }
            }
            val updatedRows = database.studySessionDao().completeSession(
                sessionId = sessionId,
                endedAt = endedAt,
                durationSeconds = durationSeconds,
                pauseSeconds = pauseSeconds,
                aiHelpSeconds = aiHelpSeconds,
                note = note,
                status = StatusCodes.SESSION_COMPLETED,
                updatedAt = endedAt,
                runningStatus = StatusCodes.SESSION_RUNNING
            )
            check(updatedRows == 1) { "学习记录已结束、已删除或不存在" }
            insertEvent(sessionId, StatusCodes.EVENT_END, endedAt)
            if (markLinkedTaskDone && taskId != null) {
                val taskRows = database.taskDao().updateTaskStatus(
                    taskId = taskId,
                    status = StatusCodes.TASK_DONE,
                    completedAt = endedAt,
                    updatedAt = endedAt
                )
                check(taskRows == 1) { "关联计划不存在或已删除" }
            }
        }
    }

    suspend fun insertEvent(
        sessionId: Long,
        eventType: Int,
        eventTime: Long,
        eventDetail: String? = null
    ) {
        database.studySessionDao().insertEvent(
            StudySessionEventEntity(
                sessionId = sessionId,
                eventType = eventType,
                eventTime = eventTime,
                eventDetail = eventDetail,
                createdAt = System.currentTimeMillis()
            )
        )
    }

    suspend fun runningSession(userId: Long): StudySessionEntity? {
        return database.studySessionDao().getRunningSession(userId)
    }

    suspend fun sessionEvents(sessionId: Long): List<StudySessionEventEntity> {
        return database.studySessionDao().getEventsForSession(sessionId)
    }

    suspend fun updateRunningSessionProgress(
        sessionId: Long,
        durationSeconds: Long,
        pauseSeconds: Long,
        aiHelpSeconds: Long,
        updatedAt: Long
    ) {
        val updatedRows = database.studySessionDao().updateRunningSessionProgress(
            sessionId = sessionId,
            durationSeconds = durationSeconds,
            pauseSeconds = pauseSeconds,
            aiHelpSeconds = aiHelpSeconds,
            updatedAt = updatedAt,
            runningStatus = StatusCodes.SESSION_RUNNING
        )
        check(updatedRows == 1) { "学习记录已结束、已删除或不存在" }
    }

    suspend fun todayDurationSeconds(userId: Long): Long {
        return todayStudyComposition(userId).focusSeconds
    }

    suspend fun todayStudyComposition(userId: Long): StudyTimeComposition {
        val bounds = todayBounds()
        val sessions = database.studySessionDao().getCompletedSessionsBetween(
            userId = userId,
            startInclusive = bounds.startInclusive,
            endExclusive = bounds.endExclusive
        )
        val events = sessions
            .map { it.id }
            .takeIf { it.isNotEmpty() }
            ?.let { database.studySessionDao().getEventsForSessions(it) }
            .orEmpty()
        return calculateStudyTimeComposition(
            sessions = sessions,
            events = events,
            startInclusive = bounds.startInclusive,
            endExclusive = bounds.endExclusive
        )
    }

    suspend fun pendingTaskCount(userId: Long): Int {
        val bounds = todayBounds()
        return database.taskDao().countPendingTasks(userId, bounds.startInclusive, bounds.endExclusive)
    }

    fun observePendingTaskCount(userId: Long): Flow<Int> {
        val bounds = todayBounds()
        return database.taskDao().observePendingTaskCount(userId, bounds.startInclusive, bounds.endExclusive)
    }

    fun observeNextPendingTask(userId: Long): Flow<TaskEntity?> {
        val bounds = todayBounds()
        return database.taskDao().observeNextPendingTask(userId, bounds.startInclusive, bounds.endExclusive)
    }

    fun observePendingTasks(userId: Long): Flow<List<TaskEntity>> {
        val bounds = todayBounds()
        return database.taskDao().observePendingTasks(userId, bounds.startInclusive, bounds.endExclusive)
    }

    fun observeSubjects(userId: Long): Flow<List<SubjectEntity>> {
        return database.subjectDao().observeSubjects(userId)
    }

    fun observeWeeklyGoals(userId: Long) = database.weeklyGoalDao().observeGoals(userId)

    fun observeRestDays(): Flow<Set<Int>> {
        return database.appSettingDao()
            .observeSetting(PlanRepository.KEY_WEEKLY_REST_DAYS)
            .map { PlanRepository.parseRestDays(it?.value) }
    }

    fun observeReminderSettings(): Flow<ReminderSettings> {
        return database.appSettingDao()
            .observeSetting(ReminderSettings.SETTING_KEY)
            .map { ReminderSettings.decode(it?.value) }
    }

    suspend fun reminderSettings(): ReminderSettings {
        return ReminderSettings.decode(
            database.appSettingDao().getSetting(ReminderSettings.SETTING_KEY)?.value
        )
    }

    suspend fun saveReminderSettings(settings: ReminderSettings) {
        database.appSettingDao().upsert(
            AppSettingEntity(
                key = ReminderSettings.SETTING_KEY,
                value = settings.normalized().encode(),
                updatedAt = System.currentTimeMillis()
            )
        )
    }

    suspend fun notificationPermissionPrompted(): Boolean {
        return database.appSettingDao()
            .getSetting(KEY_NOTIFICATION_PERMISSION_PROMPTED)
            ?.value == "1"
    }

    suspend fun markNotificationPermissionPrompted() {
        database.appSettingDao().upsert(
            AppSettingEntity(
                key = KEY_NOTIFICATION_PERMISSION_PROMPTED,
                value = "1",
                updatedAt = System.currentTimeMillis()
            )
        )
    }

    suspend fun completedTaskDurationSeconds(taskId: Long): Long {
        return database.taskDao().completedDurationSecondsForTask(taskId)
    }

    suspend fun task(taskId: Long): TaskEntity? {
        return database.taskDao().getTask(taskId)
    }

    suspend fun markTaskDone(task: TaskEntity, completedAt: Long = System.currentTimeMillis()) {
        database.taskDao().updateTaskStatus(
            taskId = task.id,
            status = StatusCodes.TASK_DONE,
            completedAt = completedAt,
            updatedAt = completedAt
        )
    }

    suspend fun markTaskDone(taskId: Long, completedAt: Long = System.currentTimeMillis()) {
        val task = database.taskDao().getTask(taskId) ?: return
        markTaskDone(task, completedAt)
    }

    suspend fun todayTargetSeconds(): Long? {
        val setting = database.appSettingDao().observeSetting(KEY_TODAY_TARGET_SECONDS).first()
        return setting?.value?.toLongOrNull()
    }

    suspend fun saveTodayTargetSeconds(seconds: Long) {
        database.appSettingDao().upsert(
            AppSettingEntity(
                key = KEY_TODAY_TARGET_SECONDS,
                value = seconds.coerceAtLeast(0).toString(),
                updatedAt = System.currentTimeMillis()
            )
        )
    }

    private suspend fun seedDefaultSubjects(userId: Long, now: Long) {
        val defaults = listOf(
            StatusCodes.DEFAULT_SUBJECT_NAME to "#74817C",
            "英语" to "#4F7CAC",
            "数学" to "#7A6FBE",
            "专业课" to "#2F6F62",
            "阅读" to "#B88746"
        )
        defaults.forEachIndexed { index, subject ->
            database.subjectDao().upsert(
                SubjectEntity(
                    userId = userId,
                    name = subject.first,
                    color = subject.second,
                    sortOrder = index,
                    createdAt = now,
                    updatedAt = now
                )
            )
        }
    }

    companion object {
        const val SESSION_COMPLETED = StatusCodes.SESSION_COMPLETED
        const val SESSION_RUNNING = StatusCodes.SESSION_RUNNING

        const val EVENT_START = StatusCodes.EVENT_START
        const val EVENT_PAUSE = StatusCodes.EVENT_PAUSE
        const val EVENT_RESUME = StatusCodes.EVENT_RESUME
        const val EVENT_END = StatusCodes.EVENT_END
        const val EVENT_DISTRACTION = StatusCodes.EVENT_DISTRACTION
        const val EVENT_DISTRACTION_APP = StatusCodes.EVENT_DISTRACTION_APP
        const val EVENT_AI_HELP = StatusCodes.EVENT_AI_HELP
        const val EVENT_AI_HELP_ENDED = StatusCodes.EVENT_AI_HELP_ENDED

        const val KEY_TODAY_TARGET_SECONDS = "today_target_seconds"
        const val KEY_NOTIFICATION_PERMISSION_PROMPTED = "notification_permission_prompted_v1"
    }
}
