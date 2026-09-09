package com.hxz.alerttime.app.data.sync

import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LearningAnalysisGeneratorTest {
    private val zoneId = ZoneId.of("Asia/Shanghai")
    private val nowMs = Instant.parse("2026-08-10T04:00:00Z").toEpochMilli()
    private val today = Instant.ofEpochMilli(nowMs).atZone(zoneId).toLocalDate()

    @Test
    fun effectiveTodayPlanIncludesTodoAndDoneButExcludesClosedAndDeleted() {
        val dueAt = today.atTime(12, 0).atZone(zoneId).toInstant().toEpochMilli()
        fun task(id: String, status: Int, deletedAt: Long? = null) = SyncTaskDto(
            remoteId = id,
            title = id,
            type = 1,
            priority = 0,
            status = status,
            sortOrder = 0,
            dueAt = dueAt,
            createdAt = 1,
            updatedAt = 1,
            deletedAt = deletedAt
        )

        assertTrue(isEffectiveTodayPlan(task("todo", status = 0)))
        assertTrue(isEffectiveTodayPlan(task("done", status = 1)))
        assertFalse(isEffectiveTodayPlan(task("closed", status = 2)))
        assertFalse(isEffectiveTodayPlan(task("deleted", status = 1, deletedAt = 2)))
    }

    @Test fun currentWeekGoalsContributeFactsClarityCompletionAndMissingCriteriaGuidance() = runBlocking {
        val weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).atStartOfDay(zoneId).toInstant().toEpochMilli()
        val todayNoon = today.atTime(12, 0).atZone(zoneId).toInstant().toEpochMilli()
        val snapshot = emptySnapshot().copy(
            weeklyGoals = listOf(
                goal("goal-current-done", weekStart, "完成线代复习", "完成 10 道题并订正", status = 1),
                goal("goal-current-open", weekStart, "复习概率论", null, status = 0),
                goal("goal-deleted-000", weekStart, "已删除目标", "不应统计", status = 1, deletedAt = 1),
                goal("goal-other-week", weekStart - 7 * DAY_MILLIS, "上周目标", "不应统计", status = 1)
            ),
            tasks = listOf(
                SyncTaskDto(
                    remoteId = "task-today-done",
                    title = "完成今日极限练习",
                    type = 1,
                    priority = 0,
                    status = 1,
                    sortOrder = 0,
                    dueAt = todayNoon,
                    completedAt = todayNoon,
                    createdAt = 1,
                    updatedAt = 1
                )
            )
        )

        val result = DeterministicLearningAnalysisGenerator(zoneId) { nowMs }
            .generate("snapshot-weekly", snapshot)

        assertEquals(nowMs, result.generatedAt)
        assertEquals(2, result.fact("current_week_goal_count").value.jsonPrimitive.int)
        assertEquals(1, result.fact("current_week_completed_goal_count").value.jsonPrimitive.int)
        assertEquals(50.0, result.fact("current_week_success_criteria_completeness").value.jsonPrimitive.double, 0.001)
        assertEquals(50.0, result.dimension("goal_clarity").score!!, 0.001)
        assertEquals(75.0, result.dimension("completion").score!!, 0.001)
        assertTrue(result.planEvaluation.risks.any { it.contains("成功标准") })
        assertTrue(result.planEvaluation.suggestions.any { it.contains("成功标准") || it.contains("完成条件") })
        assertTrue(result.warnings.contains("weekly_goal_success_criteria_missing"))
        assertEquals("concept_check", result.assessmentDraft.questions.single().type)
        assertEquals("task-today-done", result.assessmentDraft.questions.single().taskRemoteId)
    }

    @Test fun noTodayPlanStillProducesReflectionAndTimeDoesNotInferMastery() = runBlocking {
        val weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).atStartOfDay(zoneId).toInstant().toEpochMilli()
        val sessionStart = today.atTime(9, 0).atZone(zoneId).toInstant().toEpochMilli()
        val result = DeterministicLearningAnalysisGenerator(zoneId, now = { nowMs }).generate(
            "snapshot-reflection",
            emptySnapshot().copy(
                weeklyGoals = listOf(goal("goal-current-clear", weekStart, "完成数据结构复习", "完成章节测验且达到 80 分", status = 0)),
                studySessions = listOf(
                    SyncStudySessionDto(
                        remoteId = "session-today-01",
                        startTime = sessionStart,
                        endTime = sessionStart + 7_200_000,
                        durationSeconds = 7_200,
                        pauseSeconds = 0,
                        status = 0,
                        createdAt = 1,
                        updatedAt = 1
                    )
                )
            )
        )

        assertEquals(1, result.fact("current_week_goal_count").value.jsonPrimitive.int)
        assertNotNull(result.dimension("goal_clarity"))
        assertEquals(1, result.assessmentDraft.questions.size)
        assertEquals("reflection", result.assessmentDraft.questions.single().type)
        assertTrue(result.warnings.contains("learning_time_is_not_mastery_evidence"))
        assertFalse(result.profile.inferences.any { it.statement.contains("时长") || it.statement.contains("专注") })
    }

    @Test fun crossMidnightSessionsAreProratedWithoutSubtractingPauseTwice() = runBlocking {
        val todayStart = today.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val tomorrowStart = today.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()
        fun crossDaySession(remoteId: String, start: Long, end: Long, deletedAt: Long? = null) =
            SyncStudySessionDto(
                remoteId = remoteId,
                startTime = start,
                endTime = end,
                durationSeconds = 1_200,
                pauseSeconds = 600,
                status = 0,
                createdAt = 1,
                updatedAt = 1,
                deletedAt = deletedAt
            )
        val result = DeterministicLearningAnalysisGenerator(zoneId, now = { nowMs }).generate(
            "snapshot-cross-day",
            emptySnapshot().copy(
                studySessions = listOf(
                    crossDaySession("session-from-yesterday", todayStart - 600_000, todayStart + 1_200_000),
                    crossDaySession("session-into-tomorrow", tomorrowStart - 600_000, tomorrowStart + 1_200_000),
                    crossDaySession("session-deleted-000", todayStart - 600_000, todayStart + 1_200_000, deletedAt = 2)
                )
            )
        )

        // 前一会话今天占 2/3（800 秒），后一会话今天占 1/3（400 秒）。
        assertEquals(1_200, result.fact("today_effective_focus_seconds").value.jsonPrimitive.int)
        assertEquals(
            setOf("session-from-yesterday", "session-into-tomorrow"),
            result.fact("today_effective_focus_seconds").evidenceRefs.toSet()
        )
        assertTrue(result.warnings.contains("cross_day_session_uses_proportional_split"))
    }

    @Test fun practiceStyleTaskTitleGeneratesReviewPrompt() = runBlocking {
        val todayNoon = today.atTime(12, 0).atZone(zoneId).toInstant().toEpochMilli()
        val snapshot = emptySnapshot().copy(
            tasks = listOf(
                SyncTaskDto(
                    remoteId = "task-practice-01",
                    title = "高数基本700题",
                    type = 1, priority = 0, status = 0, sortOrder = 0,
                    dueAt = todayNoon, createdAt = 1, updatedAt = 1
                )
            )
        )
        val result = DeterministicLearningAnalysisGenerator(zoneId, now = { nowMs })
            .generate("snapshot-practice", snapshot)
        val q = result.assessmentDraft.questions.single()
        assertEquals("concept_check", q.type)
        assertTrue("practice prompt should contain review wording", q.prompt.contains("回顾"))
        assertFalse("practice prompt should not ask about concept", q.prompt.contains("概念"))
        assertEquals("task-practice-01", q.taskRemoteId)
    }

    @Test fun nonPracticeTaskTitleGeneratesConceptPrompt() = runBlocking {
        val todayNoon = today.atTime(12, 0).atZone(zoneId).toInstant().toEpochMilli()
        val snapshot = emptySnapshot().copy(
            tasks = listOf(
                SyncTaskDto(
                    remoteId = "task-concept-01",
                    title = "passage7-8精读",
                    type = 1, priority = 0, status = 0, sortOrder = 0,
                    dueAt = todayNoon, createdAt = 1, updatedAt = 1
                )
            )
        )
        val result = DeterministicLearningAnalysisGenerator(zoneId, now = { nowMs })
            .generate("snapshot-concept", snapshot)
        val q = result.assessmentDraft.questions.single()
        assertEquals("concept_check", q.type)
        assertTrue("concept prompt should contain 概念 wording", q.prompt.contains("概念"))
        assertFalse("concept prompt should not contain review wording", q.prompt.contains("回顾"))
    }

    private fun emptySnapshot() = SyncSnapshotPayload(
        subjects = emptyList(),
        weeklyGoals = emptyList(),
        tasks = emptyList(),
        studySessions = emptyList()
    )

    private fun goal(
        remoteId: String,
        weekStart: Long,
        title: String,
        successCriteria: String?,
        status: Int,
        deletedAt: Long? = null
    ) = SyncWeeklyGoalDto(
        remoteId = remoteId,
        weekStart = weekStart,
        title = title,
        successCriteria = successCriteria,
        status = status,
        completedAt = if (status == 1) weekStart else null,
        createdAt = 1,
        updatedAt = 1,
        deletedAt = deletedAt
    )

    private fun SyncLearningAnalysisDto.fact(code: String) = profile.facts.single { it.code == code }

    private fun SyncLearningAnalysisDto.dimension(code: String) = planEvaluation.dimensions.single { it.code == code }

    companion object {
        private const val DAY_MILLIS = 86_400_000L
    }
}
