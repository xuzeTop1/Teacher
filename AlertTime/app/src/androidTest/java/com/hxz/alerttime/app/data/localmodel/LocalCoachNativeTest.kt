package com.hxz.alerttime.app.data.localmodel

import androidx.test.core.app.ApplicationProvider
import android.content.Context
import android.os.SystemClock
import android.os.PowerManager
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import java.io.File
import org.junit.Assert.*
import org.junit.Test

/** Run on an explicitly authorized ARM64 test device. No Room or production credentials. */
class LocalCoachNativeTest {
    @Suppress("DEPRECATION") // A bounded, test-only screen wake lock; no persistent setting changes.
    @Test fun bundledV2ModelRunsAllThreeTrainedTasksOffline() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        check(context.packageName == "com.hxz.alerttime.app.localcoach")
        val power = context.getSystemService(PowerManager::class.java)
        val wakeLock = power.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK, "AlertTime:ModelSmokeTest")
        wakeLock.acquire(360_000L)
        try {
            val engine = LocalCoachEngine(context)
            val receipt = File(context.noBackupFilesDir, "local-coach/native-smoke-receipt.json")
            receipt.parentFile!!.mkdirs()
            val results = mutableListOf<JsonObject>()
            fun save(completed: Boolean) {
                receipt.writeText(buildJsonObject {
                    put("scope", "isolated-android-native-synthetic-smoke")
                    put("completed", completed)
                    put("cases", JsonArray(results))
                }.toString())
            }
            save(false)
            val prompts = mapOf(
                CoachTask.Factors to "学英语40分钟，中间回了两次消息，倒装句仍然不理解。",
                CoachTask.Create to "做10道高数定积分题\n当日已排时长：2小时\n目标考试：考研数学二",
                CoachTask.Delete to "背英语单词50个\n上下文：连续学习很多天太累了，今天想休息一下。"
            )
            for ((task, text) in prompts) {
                val started = SystemClock.elapsedRealtime()
                val result = engine.analyze(task, text, LocalCoachEngine.nextRequestId())
                assertEquals(task, result.task)
                assertTrue(result.summary.isNotBlank())
                results += buildJsonObject {
                    put("task", task.wire)
                    put("elapsedMs", SystemClock.elapsedRealtime() - started)
                    put("validated", true)
                }
                save(false)
            }
            save(true)
        } finally {
            if (wakeLock.isHeld) wakeLock.release()
        }
    }
}
