package com.hxz.alerttime.app.data.repository

import com.hxz.alerttime.app.core.time.currentWeekBounds
import com.hxz.alerttime.app.core.time.calculateStudyTimeComposition
import com.hxz.alerttime.app.core.time.dayBounds
import com.hxz.alerttime.app.core.time.recentDates
import com.hxz.alerttime.app.core.time.recentDaysBounds
import com.hxz.alerttime.app.core.time.todayBounds
import com.hxz.alerttime.app.core.time.effectiveFocusSecondsWithin
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.LocalDate
import java.time.ZoneId

data class DailyStudyStat(
    val date: LocalDate,
    val durationSeconds: Long,
    val totalSeconds: Long = durationSeconds
)

data class SubjectStudyStat(
    val subjectName: String,
    val durationSeconds: Long
)

data class PlanStudyStat(
    val planId: Long?,
    val planTitle: String,
    val durationSeconds: Long
)

data class StudyStatsSnapshot(
    val todayTotalSeconds: Long,
    val todayFocusSeconds: Long,
    val todayAiHelpSeconds: Long,
    val todayPauseSeconds: Long,
    val weekSeconds: Long,
    val totalSeconds: Long,
    val recentTrend: List<DailyStudyStat>,
    val subjectDistribution: List<SubjectStudyStat>,
    val todaySubjectDistribution: List<SubjectStudyStat>,
    val todayPlanDistribution: List<PlanStudyStat>
)

class StatsRepository(
    private val database: AlertTimeDatabase
) {
    suspend fun ensureUserId(): Long {
        return AlertTimeDatabase.ensureLocalUserId(database)
    }

    fun observePlanChanges(userId: Long): Flow<Unit> {
        return database.taskDao().observeTasks(userId).map { Unit }
    }

    suspend fun loadStats(userId: Long): StudyStatsSnapshot {
        val zoneId = ZoneId.systemDefault()
        val today = todayBounds(zoneId)
        val week = currentWeekBounds(zoneId)
        val trendDates = recentDates(days = 7, zoneId = zoneId)
        val recentBounds = recentDaysBounds(days = 7, zoneId = zoneId)
        val weekSessions = database.studySessionDao().getCompletedSessionsBetween(
            userId = userId,
            startInclusive = week.startInclusive,
            endExclusive = week.endExclusive
        )
        val recentSessions = database.studySessionDao().getCompletedSessionsBetween(
            userId = userId,
            startInclusive = recentBounds.startInclusive,
            endExclusive = recentBounds.endExclusive
        )
        val recentEvents = recentSessions
            .map { it.id }
            .takeIf { it.isNotEmpty() }
            ?.let { database.studySessionDao().getEventsForSessions(it) }
            .orEmpty()
        val weekEvents = weekSessions
            .map { it.id }
            .takeIf { it.isNotEmpty() }
            ?.let { database.studySessionDao().getEventsForSessions(it) }
            .orEmpty()
        val weekEventsBySession = weekEvents.groupBy { it.sessionId }
        val subjectNames = database.subjectDao()
            .getSubjectsIncludingDeleted(userId)
            .associate { subject ->
                subject.id to if (subject.deletedAt == null) subject.name else DELETED_SUBJECT_NAME
            }

        val recentTrend = trendDates.map { date ->
            val bounds = dayBounds(date, zoneId)
            val composition = calculateStudyTimeComposition(
                sessions = recentSessions,
                events = recentEvents,
                startInclusive = bounds.startInclusive,
                endExclusive = bounds.endExclusive
            )
            DailyStudyStat(
                date = date,
                durationSeconds = composition.focusSeconds,
                totalSeconds = composition.totalSeconds
            )
        }

        val subjectDistribution = weekSessions
            .groupBy { session ->
                when (val subjectId = session.subjectId) {
                    null -> "未分类"
                    else -> subjectNames[subjectId] ?: DELETED_SUBJECT_NAME
                }
            }
            .map { (subjectName, sessions) ->
                SubjectStudyStat(
                    subjectName = subjectName,
                    durationSeconds = sessions.sumOf { session ->
                        session.effectiveFocusSecondsWithin(
                            events = weekEventsBySession[session.id].orEmpty(),
                            startInclusive = week.startInclusive,
                            endExclusive = week.endExclusive
                        )
                    }
                )
            }
            .filter { it.durationSeconds > 0 }
            .sortedByDescending { it.durationSeconds }

        val todaySessions = database.studySessionDao().getCompletedSessionsBetween(
            userId = userId,
            startInclusive = today.startInclusive,
            endExclusive = today.endExclusive
        )
        val todayEvents = todaySessions
            .map { it.id }
            .takeIf { it.isNotEmpty() }
            ?.let { database.studySessionDao().getEventsForSessions(it) }
            .orEmpty()
        val todayComposition = calculateStudyTimeComposition(
            sessions = todaySessions,
            events = todayEvents,
            startInclusive = today.startInclusive,
            endExclusive = today.endExclusive
        )
        val todaySubjectDistribution = buildSubjectDistribution(
            sessions = todaySessions,
            subjectNames = subjectNames,
            startInclusive = today.startInclusive,
            endExclusive = today.endExclusive,
            events = todayEvents
        )
        val activePlanTitles = database.taskDao()
            .getActivePlans(userId)
            .associate { task -> task.id to task.title }
        val todayPlanDistribution = buildPlanDistribution(
            sessions = todaySessions,
            startInclusive = today.startInclusive,
            endExclusive = today.endExclusive,
            events = todayEvents,
            activePlanTitles = activePlanTitles
        )

        // Use efficient SQL aggregate instead of loading all sessions into memory
        val totalDurationSeconds = database.studySessionDao().getTotalDurationSeconds(userId)

        return StudyStatsSnapshot(
            todayTotalSeconds = todayComposition.totalSeconds,
            todayFocusSeconds = todayComposition.focusSeconds,
            todayAiHelpSeconds = todayComposition.aiHelpSeconds,
            todayPauseSeconds = todayComposition.pauseSeconds,
            weekSeconds = weekSessions.sumOf { session ->
                session.effectiveFocusSecondsWithin(
                    events = weekEventsBySession[session.id].orEmpty(),
                    startInclusive = week.startInclusive,
                    endExclusive = week.endExclusive
                )
            },
            totalSeconds = totalDurationSeconds,
            recentTrend = recentTrend,
            subjectDistribution = subjectDistribution,
            todaySubjectDistribution = todaySubjectDistribution,
            todayPlanDistribution = todayPlanDistribution
        )
    }

    private companion object {
        const val DELETED_SUBJECT_NAME = "已删除科目"
    }
}

internal fun buildSubjectDistribution(
    sessions: List<StudySessionEntity>,
    subjectNames: Map<Long, String>,
    startInclusive: Long,
    endExclusive: Long,
    events: List<StudySessionEventEntity> = emptyList()
): List<SubjectStudyStat> {
    val eventsBySession = events.groupBy { it.sessionId }
    return sessions
        .groupBy { session ->
            when (val subjectId = session.subjectId) {
                null -> "未分类"
                else -> subjectNames[subjectId] ?: "已删除科目"
            }
        }
        .map { (subjectName, groupedSessions) ->
            SubjectStudyStat(
                subjectName = subjectName,
                durationSeconds = groupedSessions.sumOf { session ->
                    session.effectiveFocusSecondsWithin(
                        events = eventsBySession[session.id].orEmpty(),
                        startInclusive = startInclusive,
                        endExclusive = endExclusive
                    )
                }
            )
        }
        .filter { it.durationSeconds > 0 }
        .sortedByDescending { it.durationSeconds }
}

internal fun buildPlanDistribution(
    sessions: List<StudySessionEntity>,
    startInclusive: Long,
    endExclusive: Long,
    events: List<StudySessionEventEntity> = emptyList(),
    activePlanTitles: Map<Long, String> = emptyMap()
): List<PlanStudyStat> {
    val eventsBySession = events.groupBy { it.sessionId }
    return sessions
        .groupBy { session ->
            session.taskId?.let { "task:$it" }
                ?: "title:${session.title?.takeIf(String::isNotBlank) ?: "未关联计划"}"
        }
        .map { (_, groupedSessions) ->
            val representative = groupedSessions.first()
            PlanStudyStat(
                planId = representative.taskId,
                planTitle = representative.taskId
                    ?.let(activePlanTitles::get)
                    ?.takeIf(String::isNotBlank)
                    ?: representative.title?.takeIf(String::isNotBlank)
                    ?: "未关联计划",
                durationSeconds = groupedSessions.sumOf { session ->
                    session.effectiveFocusSecondsWithin(
                        events = eventsBySession[session.id].orEmpty(),
                        startInclusive = startInclusive,
                        endExclusive = endExclusive
                    )
                }
            )
        }
        .filter { it.durationSeconds > 0 }
        .sortedByDescending { it.durationSeconds }
}
