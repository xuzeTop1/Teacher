package com.hxz.alerttime.app.ui.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TimerManagerDayBoundaryTest {
    private val dayStart = 2_000L

    @Test
    fun pausedBeforeToday_isClosedAtDayBoundary() {
        assertTrue(
            shouldClosePausedSessionAtDayBoundary(
                status = TimerStatus.Paused,
                pauseStartedAt = dayStart - 1,
                dayStartMillis = dayStart
            )
        )
    }

    @Test
    fun pausedToday_remainsAvailableToResume() {
        assertFalse(
            shouldClosePausedSessionAtDayBoundary(
                status = TimerStatus.Paused,
                pauseStartedAt = dayStart,
                dayStartMillis = dayStart
            )
        )
    }

    @Test
    fun runningSession_canContinueAcrossDayBoundary() {
        assertFalse(
            shouldClosePausedSessionAtDayBoundary(
                status = TimerStatus.Running,
                pauseStartedAt = dayStart - 1,
                dayStartMillis = dayStart
            )
        )
    }

    @Test
    fun missingPauseTimestamp_doesNotCloseSession() {
        assertFalse(
            shouldClosePausedSessionAtDayBoundary(
                status = TimerStatus.Paused,
                pauseStartedAt = 0,
                dayStartMillis = dayStart
            )
        )
    }

    @Test
    fun resumeRequiresPausedStateAndValidPauseTimestamp() {
        assertTrue(canResumeTimer(TimerStatus.Paused, pauseStartedAt = 1, activeSessionId = 9))
        assertFalse(canResumeTimer(TimerStatus.Running, pauseStartedAt = 1, activeSessionId = 9))
        assertFalse(canResumeTimer(TimerStatus.Paused, pauseStartedAt = 0, activeSessionId = 9))
        assertFalse(canResumeTimer(TimerStatus.Paused, pauseStartedAt = 1, activeSessionId = null))
    }

    @Test
    fun pausedAcrossDayBoundary_includesTheEntireOpenPauseSegment() {
        assertEquals(
            8 * 60 * 60 + 30 * 60,
            pauseSecondsAt(
                accumulatedPauseSeconds = 0,
                status = TimerStatus.Paused,
                pauseStartedAt = 23 * 60 * 60 * 1000L + 30 * 60 * 1000L,
                now = 32 * 60 * 60 * 1000L
            )
        )
    }

    @Test
    fun targetCompletion_onlyTriggersWhenThisSessionCrossesTarget() {
        assertFalse(
            shouldCompleteTaskAtTarget(
                completedBeforeSeconds = 0,
                activeSessionSeconds = 299,
                targetSeconds = 300
            )
        )
        assertTrue(
            shouldCompleteTaskAtTarget(
                completedBeforeSeconds = 120,
                activeSessionSeconds = 180,
                targetSeconds = 300
            )
        )
        assertFalse(
            shouldCompleteTaskAtTarget(
                completedBeforeSeconds = 300,
                activeSessionSeconds = 1,
                targetSeconds = 300
            )
        )
    }

    @Test
    fun staleRunningSession_requiresExplicitRecoveryChoice() {
        assertFalse(
            requiresRunningSessionRecovery(
                persistedStatus = TimerStatus.Running,
                runningGapMillis = 5 * 60 * 1000,
                thresholdMillis = 5 * 60 * 1000
            )
        )
        assertTrue(
            requiresRunningSessionRecovery(
                persistedStatus = TimerStatus.Running,
                runningGapMillis = 5 * 60 * 1000 + 1,
                thresholdMillis = 5 * 60 * 1000
            )
        )
        assertFalse(
            requiresRunningSessionRecovery(
                persistedStatus = TimerStatus.Paused,
                runningGapMillis = 60 * 60 * 1000,
                thresholdMillis = 5 * 60 * 1000
            )
        )
    }
}
