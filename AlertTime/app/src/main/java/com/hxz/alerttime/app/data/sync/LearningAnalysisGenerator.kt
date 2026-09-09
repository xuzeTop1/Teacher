package com.hxz.alerttime.app.data.sync

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters
import java.util.UUID

/**
 * 每次同步前生成学习分析。生成器只读同步快照，不写 Room 业务表。
 * LLM 生成失败必须回退到 DeterministicLearningAnalysisGenerator；分析中的
 * assessmentDraft 永远只是草稿，不进入 approved 题库、assessment_results 或 mastery。
 */
interface LearningAnalysisGenerator {
    suspend fun generate(snapshotId: String, snapshot: SyncSnapshotPayload): SyncLearningAnalysisDto
}

/**
 * A task is eligible for today's plan analysis only when it is not deleted and
 * has a supported active/completed status. Date and task-type filtering remain
 * explicit at each caller so this shared predicate has one narrow contract.
 */
internal fun isEffectiveTodayPlan(task: SyncTaskDto): Boolean =
    task.deletedAt == null && task.status in 0..1

class DeterministicLearningAnalysisGenerator(
    private val zoneId: ZoneId = ZoneId.systemDefault(),
    private val now: () -> Long = { System.currentTimeMillis() }
) : LearningAnalysisGenerator {
    override suspend fun generate(snapshotId: String, snapshot: SyncSnapshotPayload): SyncLearningAnalysisDto {
        // 一次生成只读取一次时钟，避免午夜跨界时 facts、题目范围和 generatedAt 彼此漂移。
        val generatedAt = now()
        val today = Instant.ofEpochMilli(generatedAt).atZone(zoneId).toLocalDate()
        val todayWindow = learningAnalysisDayWindow(generatedAt, zoneId)
        val currentWeekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        val todayTasks = snapshot.tasks.filter { task ->
            isEffectiveTodayPlan(task) &&
                task.type == 1 &&
                task.dueAt?.let(::dateOf) == today
        }
        val completedTasks = todayTasks.count { it.status == 1 || it.completedAt != null }
        val todaySessions = snapshot.studySessions.filter { session ->
            session.deletedAt == null && session.status == 0 && session.overlaps(todayWindow)
        }
        val currentWeekGoals = snapshot.weeklyGoals.filter { goal ->
            goal.deletedAt == null && dateOf(goal.weekStart) == currentWeekStart
        }
        val completedWeekGoals = currentWeekGoals.filter { it.status == 1 || it.completedAt != null }
        val goalsWithSuccessCriteria = currentWeekGoals.filter { !it.successCriteria.isNullOrBlank() }
        val goalsMissingSuccessCriteria = currentWeekGoals - goalsWithSuccessCriteria.toSet()
        // durationSeconds 本身就是有效专注时间，pauseSeconds 是独立统计，不能重复扣除。
        val effectiveSeconds = todaySessions.sumOf { session ->
            session.proratedSecondsWithin(session.durationSeconds, todayWindow)
        }
        val averageFocus = todaySessions.mapNotNull { it.focusScore }.takeIf { it.isNotEmpty() }?.average()
        val completionRate = if (todayTasks.isEmpty()) null else completedTasks.toDouble() / todayTasks.size
        val weeklyGoalCompletionRate = if (currentWeekGoals.isEmpty()) null else completedWeekGoals.size.toDouble() / currentWeekGoals.size
        val goalClarityScore = if (currentWeekGoals.isEmpty()) null else goalsWithSuccessCriteria.size.toDouble() / currentWeekGoals.size * 100.0
        val completionScore = listOfNotNull(completionRate?.times(100.0), weeklyGoalCompletionRate?.times(100.0))
            .takeIf { it.isNotEmpty() }
            ?.average()
        val evaluationScore = listOfNotNull(goalClarityScore, completionScore)
            .takeIf { it.isNotEmpty() }
            ?.average()
        val subjectIds = todayTasks.mapNotNull { it.subjectRemoteId }.distinct()

        val facts = buildList {
            add(fact("today_plan_count", "今日计划数", JsonPrimitive(todayTasks.size), todayTasks.map { it.remoteId }))
            add(fact("today_completed_plan_count", "今日完成计划数", JsonPrimitive(completedTasks), todayTasks.filter { it.status == 1 }.map { it.remoteId }))
            add(fact("today_effective_focus_seconds", "今日有效专注秒数", JsonPrimitive(effectiveSeconds), todaySessions.map { it.remoteId }))
            add(fact("today_subject_count", "今日计划涉及科目数", JsonPrimitive(subjectIds.size), subjectIds))
            averageFocus?.let { add(fact("today_average_focus_score", "今日平均专注评分", JsonPrimitive(it), todaySessions.map { session -> session.remoteId })) }
            add(fact("current_week_goal_count", "本周目标数", JsonPrimitive(currentWeekGoals.size), currentWeekGoals.map { it.remoteId }.take(MAX_EVIDENCE_REFS)))
            add(fact("current_week_completed_goal_count", "本周已完成目标数", JsonPrimitive(completedWeekGoals.size), completedWeekGoals.map { it.remoteId }.take(MAX_EVIDENCE_REFS)))
            add(
                fact(
                    "current_week_success_criteria_completeness",
                    "本周目标成功标准完整度",
                    goalClarityScore?.let(::JsonPrimitive) ?: JsonNull,
                    currentWeekGoals.map { it.remoteId }.take(MAX_EVIDENCE_REFS)
                )
            )
        }
        val inferences = buildList {
            if (todayTasks.isEmpty()) {
                add(inference("当前没有可可靠识别的今日计划，无法判断计划与执行是否匹配。", 0.98, emptyList()))
            } else if (completionRate != null && completionRate >= 0.8) {
                add(inference("今日计划完成度较高，当前计划颗粒度与执行能力基本匹配。", 0.78, todayTasks.map { it.remoteId }))
            } else {
                add(inference("今日仍有计划未完成，可能需要降低单次任务颗粒度或重新安排优先级；这不是能力掌握度结论。", 0.66, todayTasks.map { it.remoteId }))
            }
            when {
                currentWeekGoals.isEmpty() -> add(
                    inference("当前没有可可靠识别的本周目标，目标清晰度证据不足。", 0.98, emptyList())
                )
                goalsMissingSuccessCriteria.isNotEmpty() -> add(
                    inference(
                        "部分本周目标缺少可验证的成功标准，后续难以客观判断是否完成。",
                        0.92,
                        goalsMissingSuccessCriteria.map { it.remoteId }.take(MAX_EVIDENCE_REFS)
                    )
                )
                else -> add(
                    inference(
                        "本周目标均包含成功标准，目标是否达成具备基本可核对条件。",
                        0.84,
                        currentWeekGoals.map { it.remoteId }.take(MAX_EVIDENCE_REFS)
                    )
                )
            }
        }
        val verdict = when {
            todayTasks.isEmpty() && todaySessions.isEmpty() && currentWeekGoals.isEmpty() -> "insufficient_data"
            currentWeekGoals.isEmpty() || goalsMissingSuccessCriteria.isNotEmpty() -> "needs_adjustment"
            goalClarityScore != null && goalClarityScore >= 80.0 && completionScore != null && completionScore >= 80.0 -> "reasonable"
            else -> "needs_adjustment"
        }
        val questions = todayTasks.take(5).map { task ->
            // 刷题/习题类计划问「概念」会很别扭：按标题自适应为回顾式提问。
            val practiceStyle = PRACTICE_TITLE_PATTERN.containsMatchIn(task.title)
            SyncAssessmentDraftQuestionDto(
                questionId = UUID.nameUUIDFromBytes("$snapshotId:${task.remoteId}".toByteArray()).toString(),
                subjectRemoteId = task.subjectRemoteId,
                taskRemoteId = task.remoteId,
                type = "concept_check",
                prompt = if (practiceStyle) {
                    "请回顾“${task.title}”：选一道印象最深的题，说明你的解题依据或错因，以及你是如何核对的。"
                } else {
                    "请用自己的话说明“${task.title}”今天最重要的一个概念、步骤或判断依据。"
                },
                rationale = "问题来自今日计划，用于后续确认理解，不根据学习时长推断掌握度。",
                rubric = if (practiceStyle) {
                    listOf("能指出解题依据或错因", "能说明核对方法", "没有把时长当作掌握证据")
                } else {
                    listOf("能指出核心概念或步骤", "能说明一个判断依据", "没有把时长当作掌握证据")
                }
            )
        }.ifEmpty {
            listOf(
                SyncAssessmentDraftQuestionDto(
                    questionId = "draft-reflection-${snapshotId.take(12)}",
                    type = "reflection",
                    prompt = "回顾今天的学习，你能指出一个已经理解的点和一个仍需核对的点吗？",
                    rationale = "没有今日计划时只生成反思草稿，不伪造学科题目。",
                    rubric = listOf("区分事实与推断", "指出下一步核对内容")
                )
            )
        }
        val warnings = buildList {
            add("learning_time_is_not_mastery_evidence")
            if (todayTasks.isEmpty()) add("no_reliable_today_plan")
            if (goalsMissingSuccessCriteria.isNotEmpty()) add("weekly_goal_success_criteria_missing")
            if (todaySessions.any { it.crosses(todayWindow) }) add("cross_day_session_uses_proportional_split")
            add("assessment_draft_not_counted_toward_mastery")
        }
        val risks = buildList {
            if (todayTasks.isEmpty()) add("今日计划不足，不能可靠评估今日计划与执行是否匹配")
            if (currentWeekGoals.isEmpty()) add("本周目标不足，无法评估目标清晰度与周完成情况")
            if (goalsMissingSuccessCriteria.isNotEmpty()) {
                add("本周有 ${goalsMissingSuccessCriteria.size} 个目标缺少可验证的成功标准")
            }
        }
        val suggestions = buildList {
            if (todayTasks.isEmpty()) add("先在手机端建立具体到科目或任务的今日计划")
            if (currentWeekGoals.isEmpty()) add("建立本周目标，并为目标填写可检查的成功标准")
            if (goalsMissingSuccessCriteria.isNotEmpty()) add("为缺少标准的本周目标补充可量化或可核对的完成条件")
            if (todayTasks.isNotEmpty()) add("优先完成未完成计划，再根据实际答题结果调整难度")
        }
        return SyncLearningAnalysisDto(
            analysisId = UUID.randomUUID().toString(),
            sourceSnapshotId = snapshotId,
            generatedAt = generatedAt,
            promptVersion = PROMPT_VERSION,
            generator = "deterministic_fallback",
            profile = SyncLearningProfileDto(facts = facts, inferences = inferences),
            planEvaluation = SyncPlanEvaluationDto(
                verdict = verdict,
                score = evaluationScore,
                dimensions = listOf(
                    SyncPlanEvaluationDimensionDto("plan_coverage", if (todayTasks.isEmpty()) null else 100.0, "只按可识别的今日计划判断覆盖度。"),
                    SyncPlanEvaluationDimensionDto(
                        "goal_clarity",
                        goalClarityScore,
                        if (goalClarityScore == null) {
                            "本周没有足够目标数据。"
                        } else {
                            "本周 ${goalsWithSuccessCriteria.size}/${currentWeekGoals.size} 个目标包含可验证的成功标准。"
                        }
                    ),
                    SyncPlanEvaluationDimensionDto(
                        "completion",
                        completionScore,
                        buildList {
                            completionRate?.let { add("今日计划完成率 ${"%.0f".format(it * 100.0)}%") }
                            weeklyGoalCompletionRate?.let { add("本周目标完成率 ${"%.0f".format(it * 100.0)}%") }
                        }.joinToString("；").ifBlank { "今日计划和本周目标均没有足够完成数据。" }
                    ),
                    SyncPlanEvaluationDimensionDto("focus_evidence", if (averageFocus == null) null else averageFocus, "专注时长和评分只作为执行证据，不更新掌握度。")
                ),
                risks = risks,
                suggestions = suggestions
            ),
            assessmentDraft = SyncAssessmentDraftDto(
                status = "draft",
                scopeSummary = if (subjectIds.isEmpty()) "今日计划范围未映射；仅生成通用反思草稿。" else "覆盖今日计划涉及的 ${subjectIds.size} 个已声明科目，待用户作答后再进入正式诊断链路。",
                questions = questions
            ),
            warnings = warnings,
            inputSummary = SyncLearningInputSummaryDto.fromSnapshot(snapshot)
        )
    }

    private fun dateOf(epochMs: Long): LocalDate = Instant.ofEpochMilli(epochMs).atZone(zoneId).toLocalDate()

    private fun fact(code: String, label: String, value: JsonElement, evidenceRefs: List<String>) =
        SyncLearningFactDto(code, label, value, evidenceRefs.take(MAX_EVIDENCE_REFS))

    private fun inference(statement: String, confidence: Double, evidenceRefs: List<String>) =
        SyncLearningInferenceDto(statement, confidence, evidenceRefs.take(MAX_EVIDENCE_REFS))

    companion object {
        const val PROMPT_VERSION = "alerttime-plan-assessment-v2"
        private const val MAX_EVIDENCE_REFS = 20
        private val PRACTICE_TITLE_PATTERN = Regex("题|练习|习题|试卷")
    }
}
