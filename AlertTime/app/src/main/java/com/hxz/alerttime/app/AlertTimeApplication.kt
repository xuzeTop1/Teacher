package com.hxz.alerttime.app

import android.app.Application
import com.hxz.alerttime.app.core.notifications.ReminderScheduler
import com.hxz.alerttime.app.core.notifications.ReminderSettings
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class AlertTimeApplication : Application() {
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val database: AlertTimeDatabase by lazy {
        AlertTimeDatabase.create(this)
    }

    override fun onCreate() {
        super.onCreate()
        val scheduler = ReminderScheduler(this)
        scheduler.createNotificationChannels()
        applicationScope.launch {
            val settings = ReminderSettings.decode(
                database.appSettingDao().getSetting(ReminderSettings.SETTING_KEY)?.value
            )
            scheduler.rescheduleDailyReminder(settings)
        }
    }
}
