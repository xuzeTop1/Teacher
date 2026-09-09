package com.hxz.alerttime.app.ui.plan

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanWeekSelectionTest {
    @Test
    fun weeklyGoalCanTargetCurrentOrNextWeekOnly() {
        val currentWeek = 1_000L
        val nextWeek = 2_000L

        assertTrue(isSelectableWeeklyGoalWeek(currentWeek, currentWeek, nextWeek))
        assertTrue(isSelectableWeeklyGoalWeek(nextWeek, currentWeek, nextWeek))
        assertFalse(isSelectableWeeklyGoalWeek(0L, currentWeek, nextWeek))
        assertFalse(isSelectableWeeklyGoalWeek(3_000L, currentWeek, nextWeek))
    }
}
