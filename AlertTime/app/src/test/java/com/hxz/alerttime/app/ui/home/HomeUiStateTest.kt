package com.hxz.alerttime.app.ui.home

import org.junit.Assert.assertEquals
import org.junit.Test

class HomeUiStateTest {
    @Test
    fun todaySummary_usesOnlyActiveSecondsFromCurrentDay() {
        val state = HomeUiState(
            todaySeconds = 100,
            todayElapsedSeconds = 150,
            todayAiHelpSeconds = 20,
            todayPauseSeconds = 30,
            activeSeconds = 500,
            todayActiveSeconds = 20,
            todayActiveElapsedSeconds = 30,
            todayActiveAiHelpSeconds = 5
        )

        assertEquals("03:00", state.todayDurationText)
        assertEquals(120, state.todayFocusTotalSeconds)
        assertEquals(25, state.todayAiHelpTotalSeconds)
        assertEquals(35, state.todayPauseTotalSeconds)
    }

    @Test
    fun pendingSummary_excludesTheTaskCurrentlyBeingTimed() {
        val active = StudyPlanUi(
            id = 1,
            title = "正在学习",
            content = null,
            dueAt = 100,
            subjectId = null,
            targetDurationSeconds = 1_800
        )
        val next = StudyPlanUi(
            id = 2,
            title = "下一项",
            content = null,
            dueAt = 200,
            subjectId = null,
            targetDurationSeconds = 2_700
        )
        val state = HomeUiState(
            activeTaskId = active.id,
            pendingPlans = listOf(active, next),
            nextPlan = NextPlanUi(
                id = active.id,
                title = active.title,
                content = null,
                dueAt = active.dueAt,
                subjectId = null,
                targetDurationSeconds = active.targetDurationSeconds
            )
        )

        assertEquals(1, state.visiblePendingTaskCount)
        assertEquals(next.id, state.visibleNextPlan?.id)
    }

    @Test
    fun activePlan_focusClockIncludesStudyCompletedBeforeRestart() {
        val state = HomeUiState(
            activeTaskId = 1L,
            activePlanCompletedBeforeSeconds = 3_600,
            activeSeconds = 15,
            timerStatus = TimerStatus.Running
        )

        assertEquals("计划累计专注", state.activeFocusClockLabel)
        assertEquals("1小时 00分钟", state.activeFocusClockText)
    }
}
