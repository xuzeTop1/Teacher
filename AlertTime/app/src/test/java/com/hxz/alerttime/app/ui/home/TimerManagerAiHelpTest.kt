package com.hxz.alerttime.app.ui.home

import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * AI 求助时长计算测试（验收组 3：AI 时间）。
 *
 * 显式 STARTED/ENDED 语义：
 * - EVENT_AI_HELP（开始）→ 进入 AI 时段；重复开始幂等；
 * - EVENT_AI_HELP_ENDED（结束）→ 结束时段并累计；
 * - 旧数据兼容：无 ENDED 时 EVENT_RESUME / EVENT_END 仍视为结束；
 * - 安全截断：未正常结束的 AI 时段截断到最后一个事件时间，不无限增长。
 */
class TimerManagerAiHelpTest {

    private fun event(type: Int, time: Long, detail: String? = null): StudySessionEventEntity {
        return StudySessionEventEntity(
            sessionId = 1,
            eventType = type,
            eventTime = time,
            eventDetail = detail,
            createdAt = time
        )
    }

    private fun calculate(events: List<StudySessionEventEntity>): Long {
        return calculateAiHelpSecondsFromEvents(events)
    }

    @Test
    fun `started and ended pairs compute correct total`() {
        val events = listOf(
            event(StatusCodes.EVENT_AI_HELP, 1000, "Gemini"),
            event(StatusCodes.EVENT_PAUSE, 1000),
            event(StatusCodes.EVENT_AI_HELP_ENDED, 3100),
            event(StatusCodes.EVENT_RESUME, 3100),
            event(StatusCodes.EVENT_AI_HELP, 5000, "ChatGPT"),
            event(StatusCodes.EVENT_PAUSE, 5000),
            event(StatusCodes.EVENT_AI_HELP_ENDED, 7100),
            event(StatusCodes.EVENT_RESUME, 7100)
        )
        assertEquals(2L + 2L, calculate(events)) // 2s + 2s
    }

    @Test
    fun `repeated start is idempotent (does not restart the segment)`() {
        val events = listOf(
            event(StatusCodes.EVENT_AI_HELP, 1000),
            event(StatusCodes.EVENT_PAUSE, 1000),
            // 重复点击开始（幂等：不重置开始时间）
            event(StatusCodes.EVENT_AI_HELP, 2000),
            event(StatusCodes.EVENT_AI_HELP_ENDED, 4000),
            event(StatusCodes.EVENT_RESUME, 4000)
        )
        assertEquals(3L, calculate(events)) // 4000-1000 = 3s
    }

    @Test
    fun `old data without ended still closes on resume or end`() {
        val events = listOf(
            event(StatusCodes.EVENT_AI_HELP, 1000),
            event(StatusCodes.EVENT_PAUSE, 1000),
            event(StatusCodes.EVENT_RESUME, 3600)
        )
        assertEquals(2L, calculate(events))
    }

    @Test
    fun `unclosed ai segment is safely truncated to last event time`() {
        // 进程崩溃场景：只有 STARTED 没有 ENDED → 截断到最后一个事件时间（不无限增长）。
        val events = listOf(
            event(StatusCodes.EVENT_AI_HELP, 1000),
            event(StatusCodes.EVENT_PAUSE, 1000)
        )
        assertEquals(0L, calculate(events))

        // 崩溃后最后事件晚于 STARTED（例如后续 PAUSE 事件时间不同）。
        val events2 = listOf(
            event(StatusCodes.EVENT_AI_HELP, 1000),
            event(StatusCodes.EVENT_PAUSE, 2500)
        )
        assertEquals(1L, calculate(events2)) // 截断到 2500 → 1s
    }

    @Test
    fun `empty events produce zero`() {
        assertEquals(0L, calculate(emptyList()))
    }

    @Test
    fun `multiple segments across the day sum correctly`() {
        val dayStart = 1_000_000L
        val events = listOf(
            event(StatusCodes.EVENT_AI_HELP, dayStart + 1000),
            event(StatusCodes.EVENT_PAUSE, dayStart + 1000),
            event(StatusCodes.EVENT_AI_HELP_ENDED, dayStart + 4000),
            event(StatusCodes.EVENT_RESUME, dayStart + 4000),
            event(StatusCodes.EVENT_AI_HELP, dayStart + 9000),
            event(StatusCodes.EVENT_PAUSE, dayStart + 9000),
            event(StatusCodes.EVENT_AI_HELP_ENDED, dayStart + 12000),
            event(StatusCodes.EVENT_RESUME, dayStart + 12000)
        )
        assertEquals(6L, calculate(events))
    }
}
