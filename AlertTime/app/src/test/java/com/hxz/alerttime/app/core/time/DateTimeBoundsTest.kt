package com.hxz.alerttime.app.core.time

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class DateTimeBoundsTest {

    @Test
    fun `todayBounds returns correct start and end for current day`() {
        val zoneId = ZoneId.of("Asia/Shanghai")
        val bounds = todayBounds(zoneId)

        val today = LocalDate.now(zoneId)
        val expectedStart = today.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val expectedEnd = today.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()

        assertEquals(expectedStart, bounds.startInclusive)
        assertEquals(expectedEnd, bounds.endExclusive)
    }

    @Test
    fun `todayBounds end minus start equals exactly 24 hours`() {
        val zoneId = ZoneId.of("UTC")
        val bounds = todayBounds(zoneId)

        val diffMillis = bounds.endExclusive - bounds.startInclusive
        val diffHours = diffMillis / (1000 * 60 * 60)
        assertEquals(24L, diffHours)
    }

    @Test
    fun `dayBounds returns correct boundaries for a specific date`() {
        val zoneId = ZoneId.of("UTC")
        val date = LocalDate.of(2025, 6, 15)
        val bounds = dayBounds(date, zoneId)

        val expectedStart = date.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val expectedEnd = date.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()

        assertEquals(expectedStart, bounds.startInclusive)
        assertEquals(expectedEnd, bounds.endExclusive)
    }

    @Test
    fun `dayBounds for consecutive days are contiguous`() {
        val zoneId = ZoneId.of("UTC")
        val day1 = dayBounds(LocalDate.of(2025, 3, 10), zoneId)
        val day2 = dayBounds(LocalDate.of(2025, 3, 11), zoneId)

        assertEquals(day1.endExclusive, day2.startInclusive)
    }

    @Test
    fun `recentDates returns oldest to newest including today`() {
        val zoneId = ZoneId.of("Asia/Shanghai")
        val today = LocalDate.now(zoneId)

        val dates = recentDates(days = 7, zoneId = zoneId)

        assertEquals(7, dates.size)
        assertEquals(today.minusDays(6), dates.first())
        assertEquals(today, dates.last())
    }

    @Test
    fun `recentDaysBounds spans complete local dates`() {
        val zoneId = ZoneId.of("Asia/Shanghai")
        val dates = recentDates(days = 7, zoneId = zoneId)
        val bounds = recentDaysBounds(days = 7, zoneId = zoneId)

        assertEquals(dates.first().atStartOfDay(zoneId).toInstant().toEpochMilli(), bounds.startInclusive)
        assertEquals(dates.last().plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli(), bounds.endExclusive)
    }

    @Test
    fun `formatStudyDuration with 0 seconds`() {
        assertEquals("00:00", formatStudyDuration(0))
    }

    @Test
    fun `formatStudyDuration with 59 seconds`() {
        assertEquals("00:59", formatStudyDuration(59))
    }

    @Test
    fun `formatStudyDuration with 60 seconds shows 1 minute`() {
        assertEquals("01:00", formatStudyDuration(60))
    }

    @Test
    fun `formatStudyDuration with 5 minutes 30 seconds`() {
        assertEquals("05:30", formatStudyDuration(330))
    }

    @Test
    fun `formatStudyDuration with exactly 1 hour`() {
        assertEquals("1小时 00分钟", formatStudyDuration(3600))
    }

    @Test
    fun `formatStudyDuration with 1 hour 30 minutes`() {
        assertEquals("1小时 30分钟", formatStudyDuration(5400))
    }

    @Test
    fun `formatStudyDuration with 2 hours 5 minutes`() {
        assertEquals("2小时 05分钟", formatStudyDuration(7500))
    }

    @Test
    fun `formatStudyDuration with large value`() {
        // 10 hours 0 minutes 0 seconds
        assertEquals("10小时 00分钟", formatStudyDuration(36000))
    }
}
