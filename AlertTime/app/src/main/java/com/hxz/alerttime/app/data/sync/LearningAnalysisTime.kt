package com.hxz.alerttime.app.data.sync

import java.time.Instant
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.min

/** 手机本地自然日边界；分析与 Prompt 必须共用同一个生成时刻和时区。 */
internal data class LearningAnalysisDayWindow(
    val startInclusive: Long,
    val endExclusive: Long
)

internal fun learningAnalysisDayWindow(nowMs: Long, zoneId: ZoneId): LearningAnalysisDayWindow {
    val today = Instant.ofEpochMilli(nowMs).atZone(zoneId).toLocalDate()
    return LearningAnalysisDayWindow(
        startInclusive = today.atStartOfDay(zoneId).toInstant().toEpochMilli(),
        endExclusive = today.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()
    )
}

internal fun SyncStudySessionDto.overlaps(window: LearningAnalysisDayWindow): Boolean {
    val endedAt = endTime ?: return false
    return endedAt > window.startInclusive && startTime < window.endExclusive && endedAt > startTime
}

/**
 * 同步 DTO 不携带暂停/继续事件，因此跨日时采用治理文档规定的旧数据回退：
 * 按 startTime/endTime 与本地自然日的重叠比例分摊已记录秒数。
 */
internal fun SyncStudySessionDto.proratedSecondsWithin(
    totalSeconds: Long,
    window: LearningAnalysisDayWindow
): Long {
    val endedAt = endTime ?: return 0
    val elapsedMillis = endedAt - startTime
    val overlapMillis = min(endedAt, window.endExclusive) - max(startTime, window.startInclusive)
    if (totalSeconds <= 0 || elapsedMillis <= 0 || overlapMillis <= 0) return 0
    return (totalSeconds.toDouble() * overlapMillis.toDouble() / elapsedMillis.toDouble())
        .toLong()
        .coerceIn(0, totalSeconds)
}

internal fun SyncStudySessionDto.crosses(window: LearningAnalysisDayWindow): Boolean =
    overlaps(window) && (startTime < window.startInclusive || requireNotNull(endTime) > window.endExclusive)
