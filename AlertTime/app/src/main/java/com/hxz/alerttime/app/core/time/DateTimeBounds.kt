package com.hxz.alerttime.app.core.time

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId

data class DayBounds(
    val startInclusive: Long,
    val endExclusive: Long
)

fun todayBounds(
    zoneId: ZoneId = ZoneId.systemDefault()
): DayBounds {
    return dayBounds(LocalDate.now(zoneId), zoneId)
}

fun dayBounds(
    date: LocalDate,
    zoneId: ZoneId = ZoneId.systemDefault()
): DayBounds {
    val start = date.atStartOfDay(zoneId).toInstant().toEpochMilli()
    val end = date.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()
    return DayBounds(startInclusive = start, endExclusive = end)
}

fun currentWeekDates(
    zoneId: ZoneId = ZoneId.systemDefault()
): List<LocalDate> {
    val today = LocalDate.now(zoneId)
    val daysSinceMonday = (today.dayOfWeek.value - DayOfWeek.MONDAY.value + 7) % 7
    val monday = today.minusDays(daysSinceMonday.toLong())
    return (0..6).map { monday.plusDays(it.toLong()) }
}

fun recentDates(
    days: Int = 7,
    zoneId: ZoneId = ZoneId.systemDefault()
): List<LocalDate> {
    require(days > 0) { "days must be positive" }
    val today = LocalDate.now(zoneId)
    return (days - 1 downTo 0).map { today.minusDays(it.toLong()) }
}

fun recentDaysBounds(
    days: Int = 7,
    zoneId: ZoneId = ZoneId.systemDefault()
): DayBounds {
    val dates = recentDates(days, zoneId)
    val start = dates.first().atStartOfDay(zoneId).toInstant().toEpochMilli()
    val end = dates.last().plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()
    return DayBounds(startInclusive = start, endExclusive = end)
}

fun currentWeekBounds(
    zoneId: ZoneId = ZoneId.systemDefault()
): DayBounds {
    val dates = currentWeekDates(zoneId)
    val start = dates.first().atStartOfDay(zoneId).toInstant().toEpochMilli()
    val end = dates.last().plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()
    return DayBounds(startInclusive = start, endExclusive = end)
}

fun formatStudyDuration(totalSeconds: Long): String {
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) {
        "${hours}小时 ${minutes.toString().padStart(2, '0')}分钟"
    } else {
        "${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}"
    }
}

fun formatCompactStudyDuration(totalSeconds: Long): String {
    val safeSeconds = totalSeconds.coerceAtLeast(0)
    val hours = safeSeconds / 3600
    val minutes = (safeSeconds % 3600) / 60
    return when {
        hours > 0 && minutes > 0 -> "${hours}小时${minutes}分"
        hours > 0 -> "${hours}小时"
        minutes > 0 -> "${minutes}分"
        else -> "0分"
    }
}
