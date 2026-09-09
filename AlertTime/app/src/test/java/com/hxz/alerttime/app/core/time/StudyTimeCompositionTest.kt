package com.hxz.alerttime.app.core.time

import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class StudyTimeCompositionTest {
    @Test
    fun composition_separatesFocusAiHelpAndOtherPause() {
        val session = session(id = 7, start = 0, end = 600_000, focusSeconds = 420)
        val events = listOf(
            event(7, StatusCodes.EVENT_AI_HELP, 100_000),
            event(7, StatusCodes.EVENT_RESUME, 160_000)
        )

        val result = calculateStudyTimeComposition(
            sessions = listOf(session),
            events = events,
            startInclusive = 0,
            endExclusive = 600_000
        )

        assertEquals(600, result.totalSeconds)
        assertEquals(420, result.focusSeconds)
        assertEquals(60, result.aiHelpSeconds)
        assertEquals(120, result.pauseSeconds)
    }

    @Test
    fun composition_clipsAiHelpToRequestedDayWindow() {
        val session = session(id = 9, start = 0, end = 1_200_000, focusSeconds = 600)
        val events = listOf(
            event(9, StatusCodes.EVENT_AI_HELP, 500_000),
            event(9, StatusCodes.EVENT_RESUME, 700_000)
        )

        val result = calculateStudyTimeComposition(
            sessions = listOf(session),
            events = events,
            startInclusive = 600_000,
            endExclusive = 1_200_000
        )

        assertEquals(600, result.totalSeconds)
        assertEquals(300, result.focusSeconds)
        assertEquals(100, result.aiHelpSeconds)
        assertEquals(200, result.pauseSeconds)
    }

    @Test
    fun composition_usesExplicitAiHelpEndedEvent() {
        val session = session(id = 13, start = 0, end = 600_000, focusSeconds = 420)
        val events = listOf(
            event(13, StatusCodes.EVENT_AI_HELP, 100_000),
            event(13, StatusCodes.EVENT_PAUSE, 100_000),
            event(13, StatusCodes.EVENT_AI_HELP_ENDED, 160_000),
            event(13, StatusCodes.EVENT_RESUME, 160_000),
            event(13, StatusCodes.EVENT_END, 600_000)
        )

        val result = calculateStudyTimeComposition(
            sessions = listOf(session),
            events = events,
            startInclusive = 0,
            endExclusive = 600_000
        )

        // AI 时段 100s→160s = 60s；ENDED 是显式结束，不依赖 RESUME 推断。
        assertEquals(60, result.aiHelpSeconds)
    }

    @Test
    fun composition_legacyDataWithoutEndedClosesOnSessionEnd() {
        // 旧版本数据：AI 开始后只有 PAUSE，无 ENDED/RESUME——END 关闭时段（旧数据兼容推断）。
        // 已完成会话总有 END，因此不会无限增长。
        val session = session(id = 14, start = 0, end = 600_000, focusSeconds = 60)
        val events = listOf(
            event(14, StatusCodes.EVENT_AI_HELP, 100_000),
            event(14, StatusCodes.EVENT_PAUSE, 300_000),
            event(14, StatusCodes.EVENT_END, 600_000)
        )

        val result = calculateStudyTimeComposition(
            sessions = listOf(session),
            events = events,
            startInclusive = 0,
            endExclusive = 600_000
        )

        // 100s→600s（END）= 500s：AI 段从未显式结束，END 兜底关闭。
        assertEquals(500, result.aiHelpSeconds)
    }

    @Test
    fun composition_repeatedAiHelpStartIsIdempotent() {
        val session = session(id = 15, start = 0, end = 600_000, focusSeconds = 420)
        val events = listOf(
            event(15, StatusCodes.EVENT_AI_HELP, 100_000),
            event(15, StatusCodes.EVENT_PAUSE, 100_000),
            event(15, StatusCodes.EVENT_AI_HELP, 150_000), // 重复开始：幂等，不重置
            event(15, StatusCodes.EVENT_AI_HELP_ENDED, 250_000),
            event(15, StatusCodes.EVENT_RESUME, 250_000),
            event(15, StatusCodes.EVENT_END, 600_000)
        )

        val result = calculateStudyTimeComposition(
            sessions = listOf(session),
            events = events,
            startInclusive = 0,
            endExclusive = 600_000
        )

        assertEquals(150, result.aiHelpSeconds) // 100s→250s = 150s
    }

    @Test
    fun composition_usesPauseEventsInsteadOfProportionalCrossWindowSplit() {
        val session = session(id = 11, start = 0, end = 1_200_000, focusSeconds = 600)
        val events = listOf(
            event(11, StatusCodes.EVENT_PAUSE, 100_000),
            event(11, StatusCodes.EVENT_RESUME, 700_000),
            event(11, StatusCodes.EVENT_END, 1_200_000)
        )

        val firstWindow = calculateStudyTimeComposition(
            sessions = listOf(session),
            events = events,
            startInclusive = 0,
            endExclusive = 600_000
        )
        val secondWindow = calculateStudyTimeComposition(
            sessions = listOf(session),
            events = events,
            startInclusive = 600_000,
            endExclusive = 1_200_000
        )

        assertEquals(100, firstWindow.focusSeconds)
        assertEquals(500, firstWindow.pauseSeconds)
        assertEquals(500, secondWindow.focusSeconds)
        assertEquals(100, secondWindow.pauseSeconds)
    }

    private fun session(id: Long, start: Long, end: Long, focusSeconds: Long) = StudySessionEntity(
        id = id,
        userId = 1,
        startTime = start,
        endTime = end,
        durationSeconds = focusSeconds,
        createdAt = start,
        updatedAt = end
    )

    private fun event(sessionId: Long, type: Int, time: Long) = StudySessionEventEntity(
        sessionId = sessionId,
        eventType = type,
        eventTime = time,
        createdAt = time
    )
}
