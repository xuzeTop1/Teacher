package com.hxz.alerttime.app.data.repository

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WeeklyPlanningRulesTest {
    private val zoneId = ZoneId.of("UTC")

    @Test
    fun startOfWeek_usesMondayWithoutAssigningDailyTasks() {
        val wednesday = ZonedDateTime.of(2026, 7, 29, 12, 0, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()
        val expectedMonday = ZonedDateTime.of(2026, 7, 27, 0, 0, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()

        assertEquals(expectedMonday, PlanRepository.startOfWeek(wednesday, zoneId))
    }

    @Test
    fun nextWeekStart_advancesByOneCalendarWeek() {
        val currentWeek = ZonedDateTime.of(2026, 7, 27, 0, 0, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()
        val expected = ZonedDateTime.of(2026, 8, 3, 0, 0, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()

        assertEquals(expected, PlanRepository.nextWeekStart(currentWeek, zoneId))
    }

    @Test
    fun startOfNextDay_usesTheNextLocalCalendarDay() {
        val lateEvening = ZonedDateTime.of(2026, 8, 2, 22, 0, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()
        val expected = ZonedDateTime.of(2026, 8, 3, 0, 0, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()

        assertEquals(expected, PlanRepository.startOfNextDay(lateEvening, zoneId))
    }

    @Test
    fun restDayParsing_filtersInvalidValues_andDefaultsToSunday() {
        assertEquals(setOf(6, 7), PlanRepository.parseRestDays("6,7,8,abc"))
        assertEquals(setOf(7), PlanRepository.parseRestDays(null))
        assertEquals(setOf(7), PlanRepository.parseRestDays(""))
    }

    @Test
    fun isRestDay_usesConfiguredWeekdays() {
        val sunday = ZonedDateTime.of(2026, 8, 2, 12, 0, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()
        assertTrue(PlanRepository.isRestDay(setOf(7), sunday, zoneId))
        assertFalse(PlanRepository.isRestDay(setOf(6), sunday, zoneId))
    }
}
