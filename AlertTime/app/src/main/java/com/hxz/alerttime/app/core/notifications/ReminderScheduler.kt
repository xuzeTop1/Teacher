package com.hxz.alerttime.app.core.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

class ReminderScheduler(context: Context) {
    private val appContext = context.applicationContext
    private val workManager = WorkManager.getInstance(appContext)

    fun createNotificationChannels() {
        val manager = appContext.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(
                    CHANNEL_PLANS,
                    "计划提醒",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "每日计划和休息日周目标提醒"
                },
                NotificationChannel(
                    CHANNEL_FOCUS,
                    "专注状态提醒",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "长时间离开或暂停学习时提醒"
                }
            )
        )
    }

    fun rescheduleDailyReminder(settings: ReminderSettings) {
        if (!settings.planRemindersEnabled && !settings.weeklyGoalRemindersEnabled) {
            workManager.cancelUniqueWork(WORK_DAILY_REVIEW)
            workManager.cancelUniqueWork(WORK_DAILY_REVIEW_QUIET_RETRY)
            return
        }
        workManager.cancelUniqueWork(WORK_DAILY_REVIEW_QUIET_RETRY)
        val now = ZonedDateTime.now()
        var next = now.toLocalDate().atTime(settings.dailyReminderHour, 0).atZone(now.zone)
        if (!next.isAfter(now)) next = next.plusDays(1)
        val initialDelayMillis = java.time.Duration.between(now, next).toMillis().coerceAtLeast(0)
        val request = PeriodicWorkRequestBuilder<DailyReviewReminderWorker>(24, TimeUnit.HOURS)
            .setInitialDelay(initialDelayMillis, TimeUnit.MILLISECONDS)
            .build()
        workManager.enqueueUniquePeriodicWork(
            WORK_DAILY_REVIEW,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }

    fun schedulePausedSessionReminder(
        sessionId: Long,
        pauseStartedAt: Long,
        kind: PauseReminderKind,
        settings: ReminderSettings
    ) {
        val enabled = when (kind) {
            PauseReminderKind.Away -> settings.awayReminderEnabled
            PauseReminderKind.Manual -> settings.manualPauseReminderEnabled
            PauseReminderKind.AiHelp -> settings.aiPauseReminderEnabled
        }
        if (!enabled) {
            cancelPausedSessionReminder(sessionId)
            return
        }
        val minutes = when (kind) {
            PauseReminderKind.Away -> settings.awayMinutes
            PauseReminderKind.Manual -> settings.manualPauseMinutes
            PauseReminderKind.AiHelp -> settings.aiPauseMinutes
        }
        val dueAt = pauseStartedAt + TimeUnit.MINUTES.toMillis(minutes.toLong())
        val delayMillis = (dueAt - System.currentTimeMillis()).coerceAtLeast(0)
        enqueuePausedSessionReminder(sessionId, pauseStartedAt, kind, delayMillis)
    }

    fun schedulePausedSessionReminderAfterQuietTime(
        sessionId: Long,
        pauseStartedAt: Long,
        kind: PauseReminderKind,
        settings: ReminderSettings
    ) {
        val delayMillis = settings.millisUntilQuietTimeEnds()
            .coerceAtLeast(TimeUnit.MINUTES.toMillis(1))
        enqueuePausedSessionReminder(sessionId, pauseStartedAt, kind, delayMillis)
    }

    fun scheduleDailyReminderAfterQuietTime(settings: ReminderSettings) {
        val delayMillis = settings.millisUntilQuietTimeEnds()
            .coerceAtLeast(TimeUnit.MINUTES.toMillis(1))
        val request = OneTimeWorkRequestBuilder<DailyReviewReminderWorker>()
            .setInitialDelay(delayMillis, TimeUnit.MILLISECONDS)
            .build()
        workManager.enqueueUniqueWork(
            WORK_DAILY_REVIEW_QUIET_RETRY,
            ExistingWorkPolicy.REPLACE,
            request
        )
    }

    private fun enqueuePausedSessionReminder(
        sessionId: Long,
        pauseStartedAt: Long,
        kind: PauseReminderKind,
        delayMillis: Long
    ) {
        val request = OneTimeWorkRequestBuilder<PausedSessionReminderWorker>()
            .setInitialDelay(delayMillis, TimeUnit.MILLISECONDS)
            .setInputData(
                Data.Builder()
                    .putLong(KEY_SESSION_ID, sessionId)
                    .putLong(KEY_PAUSE_STARTED_AT, pauseStartedAt)
                    .putString(KEY_PAUSE_KIND, kind.name)
                    .build()
            )
            .build()
        workManager.enqueueUniqueWork(
            pausedWorkName(sessionId),
            ExistingWorkPolicy.REPLACE,
            request
        )
    }

    fun cancelPausedSessionReminder(sessionId: Long?) {
        if (sessionId != null) {
            workManager.cancelUniqueWork(pausedWorkName(sessionId))
        }
    }

    companion object {
        const val CHANNEL_PLANS = "plan_reminders"
        const val CHANNEL_FOCUS = "focus_reminders"
        const val KEY_SESSION_ID = "session_id"
        const val KEY_PAUSE_STARTED_AT = "pause_started_at"
        const val KEY_PAUSE_KIND = "pause_kind"
        private const val WORK_DAILY_REVIEW = "daily_plan_and_weekly_goal_review"
        private const val WORK_DAILY_REVIEW_QUIET_RETRY = "daily_plan_and_weekly_goal_review_quiet_retry"

        private fun pausedWorkName(sessionId: Long) = "paused_session_reminder_$sessionId"
    }
}

enum class PauseReminderKind {
    Away,
    Manual,
    AiHelp
}
