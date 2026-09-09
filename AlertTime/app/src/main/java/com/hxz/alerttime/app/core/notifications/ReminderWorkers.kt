package com.hxz.alerttime.app.core.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.hxz.alerttime.app.AlertTimeApplication
import com.hxz.alerttime.app.MainActivity
import com.hxz.alerttime.app.R
import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.core.time.todayBounds
import com.hxz.alerttime.app.data.repository.PlanRepository
import kotlinx.coroutines.flow.first

class PausedSessionReminderWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        if (!applicationContext.canPostNotifications()) return Result.success()
        val sessionId = inputData.getLong(ReminderScheduler.KEY_SESSION_ID, -1)
        val pauseStartedAt = inputData.getLong(ReminderScheduler.KEY_PAUSE_STARTED_AT, -1)
        val kind = inputData.getString(ReminderScheduler.KEY_PAUSE_KIND)
            ?.let { runCatching { PauseReminderKind.valueOf(it) }.getOrNull() }
            ?: return Result.success()
        if (sessionId <= 0 || pauseStartedAt <= 0) return Result.success()

        val database = (applicationContext as AlertTimeApplication).database
        val settings = ReminderSettings.decode(
            database.appSettingDao().getSetting(ReminderSettings.SETTING_KEY)?.value
        )
        val enabled = when (kind) {
            PauseReminderKind.Away -> settings.awayReminderEnabled
            PauseReminderKind.Manual -> settings.manualPauseReminderEnabled
            PauseReminderKind.AiHelp -> settings.aiPauseReminderEnabled
        }
        if (!enabled) return Result.success()
        if (settings.isQuietTime()) {
            ReminderScheduler(applicationContext).schedulePausedSessionReminderAfterQuietTime(
                sessionId = sessionId,
                pauseStartedAt = pauseStartedAt,
                kind = kind,
                settings = settings
            )
            return Result.success()
        }

        val userId = AlertTimeDatabaseAccess.localUserIdOrNull(database) ?: return Result.success()
        val session = database.studySessionDao().getRunningSession(userId) ?: return Result.success()
        if (session.id != sessionId) return Result.success()
        val lastTimingEvent = database.studySessionDao().getEventsForSession(sessionId)
            .lastOrNull {
                it.eventType == StatusCodes.EVENT_PAUSE ||
                    it.eventType == StatusCodes.EVENT_RESUME ||
                    it.eventType == StatusCodes.EVENT_END
            }
        if (lastTimingEvent?.eventType != StatusCodes.EVENT_PAUSE ||
            lastTimingEvent.eventTime != pauseStartedAt
        ) {
            return Result.success()
        }

        val title = when (kind) {
            PauseReminderKind.Away -> "学习仍处于暂停状态"
            PauseReminderKind.Manual -> "已经暂停一段时间"
            PauseReminderKind.AiHelp -> "AI 求助后要继续吗？"
        }
        val planTitle = session.title?.takeIf { it.isNotBlank() } ?: "本次学习"
        applicationContext.showReminder(
            channelId = ReminderScheduler.CHANNEL_FOCUS,
            notificationId = sessionId.hashCode(),
            title = title,
            message = "返回继续「$planTitle」，或者结束本次记录。"
        )
        return Result.success()
    }
}

class DailyReviewReminderWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        if (!applicationContext.canPostNotifications()) return Result.success()
        val database = (applicationContext as AlertTimeApplication).database
        val settings = ReminderSettings.decode(
            database.appSettingDao().getSetting(ReminderSettings.SETTING_KEY)?.value
        )
        if (settings.isQuietTime()) {
            ReminderScheduler(applicationContext).scheduleDailyReminderAfterQuietTime(settings)
            return Result.success()
        }
        val userId = AlertTimeDatabaseAccess.localUserIdOrNull(database) ?: return Result.success()
        val today = todayBounds()

        if (settings.planRemindersEnabled) {
            val pendingCount = database.taskDao().countPendingTasks(
                userId,
                today.startInclusive,
                today.endExclusive
            )
            if (pendingCount > 0) {
                applicationContext.showReminder(
                    channelId = ReminderScheduler.CHANNEL_PLANS,
                    notificationId = NOTIFICATION_DAILY_PLANS,
                    title = "今天还有计划未完成",
                    message = "还有 $pendingCount 项计划，完成后记得在 AlertTime 中勾选。"
                )
            }
        }

        if (settings.weeklyGoalRemindersEnabled) {
            val restDays = PlanRepository.parseRestDays(
                database.appSettingDao()
                    .getSetting(PlanRepository.KEY_WEEKLY_REST_DAYS)
                    ?.value
            )
            if (PlanRepository.isRestDay(restDays)) {
                val nextWeekStart = PlanRepository.nextWeekStart(System.currentTimeMillis())
                val nextWeekGoalCount = database.weeklyGoalDao()
                    .observeGoals(userId)
                    .first()
                    .count {
                        it.weekStart == nextWeekStart &&
                            it.status == StatusCodes.WEEKLY_GOAL_TODO
                    }
                applicationContext.showReminder(
                    channelId = ReminderScheduler.CHANNEL_PLANS,
                    notificationId = NOTIFICATION_WEEKLY_GOALS,
                    title = "今天是休息日",
                    message = if (nextWeekGoalCount > 0) {
                        "下周已规定 $nextWeekGoalCount 项成果，可以回顾本周并确认安排。"
                    } else {
                        "回顾本周，也可以补录本周目标或规划下周成果。"
                    }
                )
            }
        }
        return Result.success()
    }
}

private object AlertTimeDatabaseAccess {
    suspend fun localUserIdOrNull(
        database: com.hxz.alerttime.app.data.local.AlertTimeDatabase
    ): Long? {
        return database.userDao().getDefaultUser()?.id
    }
}

private fun Context.canPostNotifications(): Boolean {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
}

private fun Context.showReminder(
    channelId: String,
    notificationId: Int,
    title: String,
    message: String
) {
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val pendingIntent = PendingIntent.getActivity(
        this,
        notificationId,
        Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val publicNotification = Notification.Builder(this, channelId)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle("AlertTime 提醒")
        .setContentText("打开应用查看详情")
        .setContentIntent(pendingIntent)
        .setAutoCancel(true)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .build()
    val notification = Notification.Builder(this, channelId)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(title)
        .setContentText(message)
        .setStyle(Notification.BigTextStyle().bigText(message))
        .setContentIntent(pendingIntent)
        .setAutoCancel(true)
        .setCategory(Notification.CATEGORY_REMINDER)
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setPublicVersion(publicNotification)
        .build()
    manager.notify(notificationId, notification)
}

private const val NOTIFICATION_DAILY_PLANS = 20_001
private const val NOTIFICATION_WEEKLY_GOALS = 20_002
