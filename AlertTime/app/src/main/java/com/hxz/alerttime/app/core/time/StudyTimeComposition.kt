package com.hxz.alerttime.app.core.time

import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity
import kotlin.math.max
import kotlin.math.min

data class StudyTimeComposition(
    val totalSeconds: Long = 0,
    val focusSeconds: Long = 0,
    val aiHelpSeconds: Long = 0,
    val pauseSeconds: Long = 0
)

fun calculateStudyTimeComposition(
    sessions: List<StudySessionEntity>,
    events: List<StudySessionEventEntity>,
    startInclusive: Long,
    endExclusive: Long
): StudyTimeComposition {
    if (endExclusive <= startInclusive || sessions.isEmpty()) return StudyTimeComposition()
    val eventsBySession = events.groupBy { it.sessionId }
    val totalSeconds = sessions.sumOf { session ->
        session.overlapSeconds(startInclusive, endExclusive)
    }
    val focusSeconds = sessions.sumOf { session ->
        session.effectiveFocusSecondsWithin(
            events = eventsBySession[session.id].orEmpty(),
            startInclusive = startInclusive,
            endExclusive = endExclusive
        )
    }.coerceAtMost(totalSeconds)
    val aiHelpSeconds = sessions.sumOf { session ->
        session.aiHelpSecondsWithin(
            events = eventsBySession[session.id].orEmpty(),
            startInclusive = startInclusive,
            endExclusive = endExclusive
        )
    }.coerceAtMost((totalSeconds - focusSeconds).coerceAtLeast(0))
    return StudyTimeComposition(
        totalSeconds = totalSeconds,
        focusSeconds = focusSeconds,
        aiHelpSeconds = aiHelpSeconds,
        pauseSeconds = (totalSeconds - focusSeconds - aiHelpSeconds).coerceAtLeast(0)
    )
}

fun StudySessionEntity.effectiveFocusSecondsWithin(
    startInclusive: Long,
    endExclusive: Long
): Long {
    val endedAt = endTime ?: return 0
    val overlapMillis = min(endedAt, endExclusive) - max(startTime, startInclusive)
    val elapsedMillis = endedAt - startTime
    if (overlapMillis <= 0 || elapsedMillis <= 0 || durationSeconds <= 0) return 0
    return (durationSeconds * overlapMillis / elapsedMillis).coerceAtLeast(0)
}

fun StudySessionEntity.effectiveFocusSecondsWithin(
    events: List<StudySessionEventEntity>,
    startInclusive: Long,
    endExclusive: Long
): Long {
    val endedAt = endTime ?: return 0
    if (events.isEmpty()) return effectiveFocusSecondsWithin(startInclusive, endExclusive)
    val activeIntervals = buildActiveIntervals(
        sessionStart = startTime,
        sessionEnd = endedAt,
        events = events
    )
    val totalActiveMillis = activeIntervals.sumOf { (start, end) -> (end - start).coerceAtLeast(0) }
    if (totalActiveMillis <= 0 || durationSeconds <= 0) {
        return effectiveFocusSecondsWithin(startInclusive, endExclusive)
    }
    val activeOverlapMillis = activeIntervals.sumOf { (start, end) ->
        overlapMillis(start, end, startInclusive, endExclusive)
    }
    return (durationSeconds * activeOverlapMillis / totalActiveMillis)
        .coerceIn(0, durationSeconds)
}

private fun StudySessionEntity.overlapSeconds(startInclusive: Long, endExclusive: Long): Long {
    val endedAt = endTime ?: return 0
    return ((min(endedAt, endExclusive) - max(startTime, startInclusive)).coerceAtLeast(0) / 1000)
}

private fun StudySessionEntity.aiHelpSecondsWithin(
    events: List<StudySessionEventEntity>,
    startInclusive: Long,
    endExclusive: Long
): Long {
    val sessionEnd = endTime ?: return 0
    var aiHelpStartedAt: Long? = null
    var lastEventTime = sessionEnd
    var totalMillis = 0L
    events.sortedBy { it.eventTime }.forEach { event ->
        lastEventTime = event.eventTime
        when (event.eventType) {
            StatusCodes.EVENT_AI_HELP -> if (aiHelpStartedAt == null) {
                aiHelpStartedAt = event.eventTime
            }
            // 显式结束优先；旧数据（无 ENDED）兼容 RESUME/END 结束语义。
            StatusCodes.EVENT_AI_HELP_ENDED,
            StatusCodes.EVENT_RESUME,
            StatusCodes.EVENT_END -> {
                val startedAt = aiHelpStartedAt ?: return@forEach
                totalMillis += overlapMillis(
                    startedAt,
                    event.eventTime,
                    startInclusive,
                    endExclusive
                )
                aiHelpStartedAt = null
            }
        }
    }
    // 未正常结束的 AI 时段（进程崩溃等）：安全截断到最后一个事件时间，不无限增长。
    aiHelpStartedAt?.let { startedAt ->
        val safeEnd = maxOf(lastEventTime, sessionEnd)
        if (safeEnd > startedAt) {
            totalMillis += overlapMillis(startedAt, safeEnd, startInclusive, endExclusive)
        }
    }
    return (totalMillis / 1000).coerceAtLeast(0)
}

private fun buildActiveIntervals(
    sessionStart: Long,
    sessionEnd: Long,
    events: List<StudySessionEventEntity>
): List<Pair<Long, Long>> {
    if (sessionEnd <= sessionStart) return emptyList()
    val intervals = mutableListOf<Pair<Long, Long>>()
    var activeStartedAt: Long? = sessionStart
    events.asSequence()
        .filter { it.eventTime in sessionStart..sessionEnd }
        .sortedBy { it.eventTime }
        .forEach { event ->
            when (event.eventType) {
                StatusCodes.EVENT_START -> if (activeStartedAt == null) {
                    activeStartedAt = event.eventTime
                }
                StatusCodes.EVENT_PAUSE,
                StatusCodes.EVENT_AI_HELP -> {
                    activeStartedAt?.let { start ->
                        if (event.eventTime > start) intervals += start to event.eventTime
                    }
                    activeStartedAt = null
                }
                StatusCodes.EVENT_RESUME -> if (activeStartedAt == null) {
                    activeStartedAt = event.eventTime
                }
                StatusCodes.EVENT_END -> {
                    activeStartedAt?.let { start ->
                        if (event.eventTime > start) intervals += start to event.eventTime
                    }
                    activeStartedAt = null
                }
            }
        }
    activeStartedAt?.let { start ->
        if (sessionEnd > start) intervals += start to sessionEnd
    }
    return intervals
}

private fun overlapMillis(
    intervalStart: Long,
    intervalEnd: Long,
    startInclusive: Long,
    endExclusive: Long
): Long {
    return (min(intervalEnd, endExclusive) - max(intervalStart, startInclusive)).coerceAtLeast(0)
}
