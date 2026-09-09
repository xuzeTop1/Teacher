package com.hxz.alerttime.app.data.assessment

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LearnerContextStoreTest {
    @Test
    fun `empty installation has no embedded purpose exam subject or date`() = runBlocking {
        val context = AppSettingLearnerContextStore(TestAppSettingDao()).load()

        assertTrue(context.isEmpty())
        assertEquals("", context.purpose)
        assertEquals("", context.examName)
        assertEquals(emptyList<String>(), context.focusSubjects)
        assertEquals("", context.targetDate)
    }

    @Test
    fun `user supplied context is normalized and persisted`() = runBlocking {
        val store = AppSettingLearnerContextStore(TestAppSettingDao())

        store.save(
            purpose = "  考研  ",
            examName = " 2027 全国硕士研究生招生考试 ",
            focusSubjects = listOf(" 数学一 ", "英语一", "数学一", "408"),
            targetDate = " 2026-12-20 ",
            nowMs = 123
        )

        assertEquals(
            LearnerContext(
                purpose = "考研",
                examName = "2027 全国硕士研究生招生考试",
                focusSubjects = listOf("数学一", "英语一", "408"),
                targetDate = "2026-12-20"
            ),
            store.load()
        )
    }

    @Test
    fun `invalid target date is rejected`() = runBlocking {
        val store = AppSettingLearnerContextStore(TestAppSettingDao())
        val result = runCatching { store.save("考研", "", listOf("数学一"), "2026-13-40") }
        assertTrue(result.isFailure)
    }
}
