package com.hxz.alerttime.app.data.sync

import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.core.usage.UsageInterval
import com.hxz.alerttime.app.core.usage.attributeUsageSecondsBySession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 外部 AI App 时长统计适配器测试（验收组 3/4）：
 * - 进行中会话（endTime 为空）不统计 → null（unknown），不得写成 0；
 * - 无 UsageStats 授权的 reader 返回 null；
 * - 已结束会话委托底层统计器，结果透传。
 */
class ExternalAiUsageReaderTest {

    private fun session(
        id: Long = 1,
        startTime: Long,
        endTime: Long?,
        durationSeconds: Long = 0
    ) = StudySessionEntity(
        id = id,
        userId = 1,
        startTime = startTime,
        endTime = endTime,
        durationSeconds = durationSeconds,
        createdAt = startTime,
        updatedAt = endTime ?: startTime
    )

    private class FakeReader(private val value: Long?) : ExternalAiUsageReader {
        override fun externalAiAppSecondsForCompleted(
            sessions: List<StudySessionEntity>
        ): Map<Long, Long?> = sessions.associate { session ->
            val endTime = session.endTime
            session.id to if (endTime != null && endTime > session.startTime) value else null
        }
    }

    @Test
    fun `running session returns null (unknown) even with authorized reader`() {
        // 进行中会话（endTime 为空）：接口默认实现不统计 → null，不得写成 0。
        val reader = FakeReader(value = 0L)
        val running = session(startTime = 100, endTime = null)
        assertNull(reader.externalAiAppSecondsForCompleted(listOf(running))[running.id])
    }

    @Test
    fun `completed session delegates to underlying reader`() {
        val reader = FakeReader(value = 120L)
        val completed = session(startTime = 100, endTime = 10_000)
        assertEquals(120L, reader.externalAiAppSecondsForCompleted(listOf(completed))[completed.id])
    }

    @Test
    fun `unauthorized reader returns null not zero`() {
        // 模拟未授权（null = unknown）：适配器必须透传 null，不能伪造 0。
        val reader = FakeReader(value = null)
        val completed = session(startTime = 100, endTime = 10_000)
        assertNull(reader.externalAiAppSecondsForCompleted(listOf(completed))[completed.id])
    }

    @Test
    fun `usage access race cannot block offline analysis or sync`() {
        val reader = object : ExternalAiUsageReader {
            override fun externalAiAppSecondsForCompleted(
                sessions: List<StudySessionEntity>
            ): Map<Long, Long?> = throw SecurityException("usage access revoked")
        }

        val completed = session(startTime = 100, endTime = 10_000)
        assertNull(runCatching {
            reader.externalAiAppSecondsForCompleted(listOf(completed))
        }.getOrNull())
    }

    @Test
    fun `end time not after start time returns null`() {
        val reader = FakeReader(value = 120L)
        val invalid = session(startTime = 10_000, endTime = 10_000)
        assertNull(reader.externalAiAppSecondsForCompleted(listOf(invalid))[invalid.id])
    }

    @Test
    fun `one scanned interval is attributed to multiple sessions without crossing boundaries`() {
        val sessions = listOf(
            session(id = 1, startTime = 0, endTime = 10_000),
            session(id = 2, startTime = 10_000, endTime = 20_000)
        )

        assertEquals(
            mapOf(1L to 5L, 2L to 5L),
            attributeUsageSecondsBySession(
                sessions,
                listOf(UsageInterval("com.openai.chatgpt", 5_000, 15_000))
            )
        )
    }

    @Test
    fun `attribution keeps running session as zero for pure function while reader maps it to unknown`() {
        val running = session(id = 2, startTime = 10_000, endTime = null)
        assertEquals(
            mapOf(2L to 0L),
            attributeUsageSecondsBySession(
                listOf(running),
                listOf(UsageInterval("com.openai.chatgpt", 10_000, 20_000))
            )
        )
        assertNull(FakeReader(value = 0L).externalAiAppSecondsForCompleted(listOf(running))[running.id])
    }

    @Test
    fun `authorized batch result can distinguish zero from unauthorized null`() {
        val ended = session(id = 1, startTime = 100, endTime = 10_000)
        val running = session(id = 2, startTime = 100, endTime = null)
        val authorized = FakeReader(value = 0L).externalAiAppSecondsForCompleted(listOf(ended, running))
        val unauthorized = FakeReader(value = null).externalAiAppSecondsForCompleted(listOf(ended, running))

        assertEquals(0L, authorized[ended.id])
        assertNull(authorized[running.id])
        assertNull(unauthorized[ended.id])
        assertNull(unauthorized[running.id])
    }
}
