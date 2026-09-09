package com.hxz.alerttime.app.core.notifications

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderSettingsTest {
    private val zoneId = ZoneId.of("UTC")

    @Test
    fun encodeDecode_preservesUserPreferences() {
        val settings = ReminderSettings(
            planRemindersEnabled = false,
            weeklyGoalRemindersEnabled = true,
            awayReminderEnabled = false,
            manualPauseReminderEnabled = true,
            aiPauseReminderEnabled = false,
            awayMinutes = 15,
            manualPauseMinutes = 25,
            aiPauseMinutes = 40,
            dailyReminderHour = 19,
            quietStartMinuteOfDay = 23 * 60,
            quietEndMinuteOfDay = 7 * 60 + 30
        )

        assertEquals(settings, ReminderSettings.decode(settings.encode()))
    }

    @Test
    fun decode_normalizesOutOfRangeValues() {
        val decoded = ReminderSettings.decode(
            "awayMinutes=0;pauseMinutes=999;aiMinutes=-4;dailyHour=24;" +
                "quietStart=-1;quietEnd=9999"
        )

        assertEquals(1, decoded.awayMinutes)
        assertEquals(180, decoded.manualPauseMinutes)
        assertEquals(1, decoded.aiPauseMinutes)
        assertEquals(23, decoded.dailyReminderHour)
        assertEquals(0, decoded.quietStartMinuteOfDay)
        assertEquals(1439, decoded.quietEndMinuteOfDay)
    }

    @Test
    fun isQuietTime_supportsOvernightRange() {
        val settings = ReminderSettings(
            quietStartMinuteOfDay = 22 * 60 + 30,
            quietEndMinuteOfDay = 8 * 60
        )

        assertTrue(settings.isQuietTime(at(23, 0), zoneId))
        assertTrue(settings.isQuietTime(at(7, 59), zoneId))
        assertFalse(settings.isQuietTime(at(8, 0), zoneId))
        assertFalse(settings.isQuietTime(at(12, 0), zoneId))
    }

    @Test
    fun equalQuietTimeBoundaries_meanQuietModeIsDisabled() {
        val settings = ReminderSettings(
            quietStartMinuteOfDay = 8 * 60,
            quietEndMinuteOfDay = 8 * 60
        )

        assertFalse(settings.isQuietTime(at(8, 0), zoneId))
        assertFalse(settings.isQuietTime(at(23, 0), zoneId))
        assertEquals(0L, settings.millisUntilQuietTimeEnds(at(23, 0), zoneId))
    }

    @Test
    fun quietReminder_isDelayedUntilOvernightQuietPeriodEnds() {
        val settings = ReminderSettings(
            quietStartMinuteOfDay = 22 * 60 + 30,
            quietEndMinuteOfDay = 8 * 60
        )

        assertEquals(
            9L * 60L * 60L * 1000L,
            settings.millisUntilQuietTimeEnds(at(23, 0), zoneId)
        )
    }

    private fun at(hour: Int, minute: Int): Long {
        return ZonedDateTime.of(2026, 7, 27, hour, minute, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()
    }
}
