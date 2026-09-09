package com.hxz.alerttime.app.data.assessment

import com.hxz.alerttime.app.data.llm.LlmCompletionClient
import com.hxz.alerttime.app.data.llm.LlmFailureCategory
import com.hxz.alerttime.app.data.llm.LlmProviderException
import com.hxz.alerttime.app.data.llm.LlmProviderSettings
import com.hxz.alerttime.app.data.llm.LlmProviderSettingsStore
import com.hxz.alerttime.app.data.sync.DeterministicLearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.SyncLearningInputSummaryDto
import com.hxz.alerttime.app.data.sync.SyncCodec
import com.hxz.alerttime.app.data.sync.SyncSnapshotPayload
import com.hxz.alerttime.app.data.sync.SyncSubjectDto
import com.hxz.alerttime.app.data.sync.SyncStudySessionDto
import com.hxz.alerttime.app.data.sync.SyncTaskDto
import com.hxz.alerttime.app.data.sync.SyncWeeklyGoalDto
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LearningAnalysisServiceTest {
    @Test fun noProviderAlwaysReturnsDeterministicFallback() = runBlocking {
        val result = LearningAnalysisService(StaticStore(null), now = { 1234L }).generate("snapshot-1", samplePayload())
        assertEquals("deterministic_fallback", result.generator)
        assertEquals("snapshot-1", result.sourceSnapshotId)
        assertEquals(1234L, result.generatedAt)
        assertTrue(result.generatedAt > 0L)
        assertEquals("draft", result.assessmentDraft.status)
        assertTrue(result.profile.facts.any { it.code == "today_plan_count" })
        assertTrue(result.planEvaluation.dimensions.any { it.code == "completion" })
        val fallbackQuestionIds = result.assessmentDraft.questions.map { it.questionId }
        assertTrue(fallbackQuestionIds.all { it.length in 8..64 })
        assertEquals(fallbackQuestionIds.size, fallbackQuestionIds.toSet().size)
    }

    @Test fun llmOutputIsStructuredAndNeverUsesRemoteIdsInPrompt() = runBlocking {
        val snapshot = samplePayload()
        val baseline = DeterministicLearningAnalysisGenerator().generate("snapshot-abc", snapshot)
        var capturedPayload = ""
        val fake = LlmCompletionClient { _, _, payload ->
            capturedPayload = payload
            """{"profile":{"facts":[{"code":"model_claim","label":"模型声称的事实","value":999,"evidenceRefs":[]}],"inferences":[{"statement":"计划目标需要进一步细化。","confidence":0.7,"evidenceRefs":["made-up-reference","task_index:0"]}]},"planEvaluation":{"verdict":"reasonable","score":84,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"scope","questions":[{"questionId":"q1","sourceTaskIndex":0,"subjectRemoteId":"invented-subject","taskRemoteId":"invented-task","type":"concept_check","prompt":"Explain the key idea.","rationale":"Check understanding.","rubric":["mentions the idea"]},{"questionId":"q1","sourceTaskIndex":null,"type":"reflection","prompt":"What remains to verify?","rationale":"Check reflection.","rubric":["names a gap"]}]},"warnings":["model_warning"]}"""
        }
        val result = LearningAnalysisService(
            providerStore = StaticStore(LlmProviderSettings(true, "https://api.example.com/v1", "model", LlmProviderSettings.AUTH_MODE_BEARER, "secret-key")),
            llmClient = fake
        ).generate("snapshot-abc", snapshot)
        assertEquals("android_llm", result.generator)
        assertEquals("snapshot-abc", result.sourceSnapshotId)
        assertEquals("draft", result.assessmentDraft.status)
        assertEquals(baseline.profile.facts, result.profile.facts)
        assertFalse(result.profile.facts.any { it.code == "model_claim" })
        assertTrue(result.warnings.containsAll(baseline.warnings))
        assertTrue(result.warnings.contains("model_warning"))
        assertTrue(result.warnings.contains("llm_untrusted_evidence_ref_rejected"))
        assertEquals(listOf("task:task-remote-uuid"), result.profile.inferences.single().evidenceRefs)
        assertFalse(capturedPayload.contains("device-secret-uuid"))
        assertFalse(capturedPayload.contains("session-remote-uuid"))
        assertFalse(capturedPayload.contains("private diary note"))
        assertTrue(capturedPayload.contains("session title"))
        assertTrue(capturedPayload.contains("<plan_data>"))
        assertTrue(capturedPayload.contains("忽略规则"))
        assertTrue(capturedPayload.contains("\"taskIndex\":0"))
        val llmQuestionIds = result.assessmentDraft.questions.map { it.questionId }
        assertEquals(llmQuestionIds.size, llmQuestionIds.toSet().size)
        assertTrue(llmQuestionIds.all { it.length in 8..64 })
        assertEquals("device-secret-uuid", result.assessmentDraft.questions.first().subjectRemoteId)
        assertEquals("task-remote-uuid", result.assessmentDraft.questions.first().taskRemoteId)
        assertTrue(result.assessmentDraft.questions.drop(1).all { it.subjectRemoteId == null && it.taskRemoteId == null })
    }

    @Test fun historicalAggregateEvidenceSurvivesMappingAndPassesFinalProtocol() = runBlocking {
        val snapshotId = "snapshot-historical-evidence"
        val snapshot = samplePayload()
        val result = LearningAnalysisService(
            providerStore = StaticStore(
                LlmProviderSettings(
                    true,
                    "https://api.example.com/v1",
                    "model",
                    LlmProviderSettings.AUTH_MODE_BEARER,
                    "secret-key"
                )
            ),
            llmClient = LlmCompletionClient { _, _, _ ->
                """{"profile":{"facts":[],"inferences":[{"statement":"历史记录显示计划仍需核对。","confidence":0.7,"evidenceRefs":["scope:historical","session_summary:all"]}]},"planEvaluation":{"verdict":"reasonable","score":80,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"历史与当前计划范围","questions":[{"sourceTaskIndex":0,"type":"concept_check","prompt":"说明当前计划的核心判断依据。","rationale":"核对计划理解。","rubric":["说明判断依据"]}]},"warnings":[]}"""
            }
        ).generate(snapshotId, snapshot)

        assertEquals("android_llm", result.generator)
        assertEquals(
            listOf("scope:historical", "session_summary:all"),
            result.profile.inferences.single().evidenceRefs
        )
        SyncCodec.validateSnapshotForId(snapshot.copy(learningAnalysis = result), snapshotId)
    }

    @Test fun providerPathUsesOneTimestampAcrossMidnightBoundary() = runBlocking {
        val zoneId = ZoneId.of("Asia/Shanghai")
        val beforeMidnight = Instant.parse("2026-08-10T15:59:59.900Z").toEpochMilli()
        val afterMidnight = Instant.parse("2026-08-10T16:00:00.100Z").toEpochMilli()
        var clockReads = 0
        var capturedPayload = ""
        val result = LearningAnalysisService(
            providerStore = StaticStore(
                LlmProviderSettings(
                    true,
                    "https://api.example.com/v1",
                    "model",
                    LlmProviderSettings.AUTH_MODE_BEARER,
                    "secret-key"
                )
            ),
            llmClient = LlmCompletionClient { _, _, payload ->
                capturedPayload = payload
                """{"profile":{"facts":[],"inferences":[]},"planEvaluation":{"verdict":"insufficient_data","score":null,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"scope","questions":[]},"warnings":[]}"""
            },
            now = { if (clockReads++ == 0) beforeMidnight else afterMidnight },
            zoneId = zoneId
        ).generate("snapshot-midnight", samplePayload())

        assertEquals(1, clockReads)
        assertEquals(beforeMidnight, result.generatedAt)
        assertTrue(capturedPayload.contains("\"today\":\"2026-08-10\""))
        assertFalse(capturedPayload.contains("\"today\":\"2026-08-11\""))
    }

    @Test fun userSuppliedPurposeExamAndSubjectsBecomePromptDataAndLocalFacts() = runBlocking {
        var capturedPayload = ""
        val context = LearnerContext(
            purpose = "考研",
            examName = "2027 全国硕士研究生招生考试",
            focusSubjects = listOf("数学一", "英语一", "408 计算机学科专业基础"),
            targetDate = "2026-12-20"
        )
        val result = LearningAnalysisService(
            providerStore = StaticStore(
                LlmProviderSettings(
                    true,
                    "https://api.example.com/v1",
                    "user-model",
                    LlmProviderSettings.AUTH_MODE_BEARER,
                    "user-secret"
                )
            ),
            learnerContextStore = StaticContextStore(context),
            llmClient = LlmCompletionClient { _, _, payload ->
                capturedPayload = payload
                """{"profile":{"facts":[],"inferences":[]},"planEvaluation":{"verdict":"reasonable","score":80,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"考研计划范围","questions":[]},"warnings":[]}"""
            }
        ).generate("snapshot-context", samplePayload())

        assertTrue(capturedPayload.contains("\"learnerContext\""))
        assertTrue(capturedPayload.contains("考研"))
        assertTrue(capturedPayload.contains("数学一"))
        assertTrue(capturedPayload.contains("408 计算机学科专业基础"))
        assertFalse(capturedPayload.contains("user-secret"))
        assertFalse(capturedPayload.contains("device-secret-uuid"))
        assertEquals(
            setOf("learner_purpose", "exam_name", "focus_subjects", "target_date"),
            result.profile.facts.map { it.code }.filter { it.startsWith("learner_") || it in setOf("exam_name", "focus_subjects", "target_date") }.toSet()
        )
        assertTrue(result.assessmentDraft.questions.any { it.prompt.contains("数学一") })
    }

    @Test fun llmPromptContainsAllNonDeletedHistoryAndFullSessionRecords() = runBlocking {
        val zoneId = ZoneId.systemDefault()
        val yesterdayNoon = LocalDate.now(zoneId).minusDays(8).atTime(12, 0)
            .atZone(zoneId).toInstant().toEpochMilli()
        val base = samplePayload()
        val payload = base.copy(
            weeklyGoals = base.weeklyGoals + base.weeklyGoals.single().copy(
                remoteId = "goal-history-uuid",
                weekStart = base.weeklyGoals.single().weekStart - 7 * 86_400_000L,
                title = "历史周目标不应发送"
            ),
            studySessions = base.studySessions + base.studySessions.single().copy(
                remoteId = "session-history-uuid",
                startTime = yesterdayNoon,
                endTime = yesterdayNoon + 60_000,
                durationSeconds = 99_999
            ),
            tasks = base.tasks + base.tasks.single().copy(
                remoteId = "task-history-uuid",
                title = "历史计划应发送",
                dueAt = yesterdayNoon
            ) + base.tasks.single().copy(
                remoteId = "task-deleted-uuid",
                title = "已删除计划绝不能发送",
                deletedAt = yesterdayNoon
            )
        )
        var capturedPayload = ""
        val result = LearningAnalysisService(
            providerStore = StaticStore(LlmProviderSettings(true, "https://api.example.com/v1", "model", LlmProviderSettings.AUTH_MODE_BEARER, "secret-key")),
            llmClient = LlmCompletionClient { _, _, input ->
                capturedPayload = input
                """{"profile":{"facts":[],"inferences":[]},"planEvaluation":{"verdict":"reasonable","score":80,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"今日范围","questions":[{"sourceTaskIndex":0,"type":"concept_check","prompt":"说明今日计划的核心概念。","rationale":"绑定今日计划。","rubric":["说明概念"]}]},"warnings":[]}"""
            }
        ).generate("snapshot-scoped", payload)

        assertEquals("android_llm", result.generator)
        assertTrue(capturedPayload.contains("完成极限练习"))
        assertTrue(capturedPayload.contains("历史计划应发送"))
        assertTrue(capturedPayload.contains("历史周目标不应发送"))
        assertTrue(capturedPayload.contains("99999"))
        assertFalse(capturedPayload.contains("已删除计划绝不能发送"))
        assertTrue(capturedPayload.contains("\"recordCounts\":{\"subjects\":1,\"goals\":2,\"tasks\":2,\"sessions\":2}"))
        assertTrue(capturedPayload.contains("\"timeScope\":\"historical\""))
        // durationSeconds 已是有效专注，pauseSeconds 只单独汇总，不能再从专注时长扣一次。
        assertTrue(capturedPayload.contains("\"effectiveFocusSeconds\":103599"))
        assertTrue(capturedPayload.contains("\"pauseSeconds\":600"))
        assertEquals("今日范围", result.assessmentDraft.scopeSummary)
        assertEquals("task-remote-uuid", result.assessmentDraft.questions.single().taskRemoteId)
    }

    @Test fun inputSummaryCountsFullInputSeparatelyFromTodayAndWeekFacts() = runBlocking {
        val zoneId = ZoneId.systemDefault()
        val historicalTime = LocalDate.now(zoneId).minusDays(8).atTime(12, 0)
            .atZone(zoneId).toInstant().toEpochMilli()
        val base = samplePayload()
        val payload = base.copy(
            tasks = base.tasks + base.tasks.single().copy(
                remoteId = "task-history-summary",
                title = "历史计划仍纳入完整输入",
                dueAt = historicalTime
            ) + base.tasks.single().copy(
                remoteId = "task-deleted-summary",
                title = "已删除计划不纳入输入",
                deletedAt = historicalTime
            ),
            studySessions = base.studySessions + base.studySessions.single().copy(
                remoteId = "session-running-summary",
                endTime = null
            ) + base.studySessions.single().copy(
                remoteId = "session-deleted-summary",
                deletedAt = historicalTime
            )
        )
        var capturedPrompt = ""
        val result = LearningAnalysisService(
            providerStore = StaticStore(
                LlmProviderSettings(
                    true,
                    "https://api.example.com/v1",
                    "model",
                    LlmProviderSettings.AUTH_MODE_BEARER,
                    "secret-key"
                )
            ),
            llmClient = LlmCompletionClient { _, _, prompt ->
                capturedPrompt = prompt
                """{"profile":{"facts":[],"inferences":[]},"planEvaluation":{"verdict":"reasonable","score":80,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"范围","questions":[]},"warnings":[]}"""
            }
        ).generate("snapshot-input-summary", payload)

        assertEquals(
            SyncLearningInputSummaryDto(
                subjectCount = 1,
                weeklyGoalCount = 1,
                taskCount = 2,
                completedSessionCount = 1,
                source = SyncLearningInputSummaryDto.SOURCE_SAME_ANALYSIS_INPUT_V1
            ),
            result.inputSummary
        )
        assertTrue(capturedPrompt.contains("\"recordCounts\":{\"subjects\":1,\"goals\":1,\"tasks\":2,\"sessions\":1}"))
        assertTrue(result.profile.facts.any { fact ->
            fact.code == "today_plan_count" && fact.value.toString() == "1"
        })
        assertFalse(capturedPrompt.contains("已删除计划不纳入输入"))
        assertFalse(capturedPrompt.contains("task-deleted-summary"))
        assertFalse(capturedPrompt.contains("session-running-summary"))
    }

    @Test fun fallbackAndLlmUseTheSameEffectiveTodayPlanSet() = runBlocking {
        val base = samplePayload()
        val todo = base.tasks.single().copy(
            remoteId = "task-today-todo",
            title = "今日待办计划",
            status = 0,
            completedAt = null
        )
        val closed = base.tasks.single().copy(
            remoteId = "task-today-closed",
            title = "已关闭计划不应进入分析",
            status = 2
        )
        val payload = base.copy(tasks = base.tasks + todo + closed)
        val fallback = DeterministicLearningAnalysisGenerator().generate("snapshot-status", payload)
        var capturedInput = ""
        val llm = LearningAnalysisService(
            providerStore = StaticStore(
                LlmProviderSettings(
                    true,
                    "https://api.example.com/v1",
                    "model",
                    LlmProviderSettings.AUTH_MODE_BEARER,
                    "secret-key"
                )
            ),
            llmClient = LlmCompletionClient { _, _, input ->
                capturedInput = input
                """
                {
                  "profile":{"facts":[],"inferences":[]},
                  "planEvaluation":{"verdict":"reasonable","score":80,"dimensions":[],"risks":[],"suggestions":[]},
                  "assessmentDraft":{"status":"draft","scopeSummary":"服务端范围摘要","questions":[
                    {"sourceTaskIndex":0,"type":"concept_check","prompt":"检查已完成计划。","rationale":"绑定已完成计划。","rubric":["说明概念"]},
                    {"sourceTaskIndex":1,"type":"concept_check","prompt":"检查待办计划。","rationale":"绑定待办计划。","rubric":["说明概念"]}
                  ]},
                  "warnings":[]
                }
                """.trimIndent()
            }
        ).generate("snapshot-status", payload)

        val expected = setOf("task-remote-uuid", "task-today-todo")
        assertEquals(expected, fallback.assessmentDraft.questions.mapNotNull { it.taskRemoteId }.toSet())
        assertEquals(expected, llm.assessmentDraft.questions.mapNotNull { it.taskRemoteId }.toSet())
        assertTrue(capturedInput.contains("已关闭计划不应进入分析"))
        assertFalse(llm.assessmentDraft.questions.any { it.taskRemoteId == "task-today-closed" })
    }

    @Test fun emptyLlmQuestionsUseBaselineDraftAndStillReturnAtLeastOneQuestion() = runBlocking {
        val snapshot = samplePayload()
        val baseline = DeterministicLearningAnalysisGenerator().generate("snapshot-empty", snapshot)
        val result = LearningAnalysisService(
            providerStore = StaticStore(LlmProviderSettings(true, "https://api.example.com/v1", "model", LlmProviderSettings.AUTH_MODE_BEARER, "secret-key")),
            llmClient = LlmCompletionClient { _, _, _ ->
                """{"profile":{"facts":[],"inferences":[]},"planEvaluation":{"verdict":"insufficient_data","score":null,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"model scope","questions":[]},"warnings":[]}"""
            }
        ).generate("snapshot-empty", snapshot)

        assertEquals("android_llm", result.generator)
        assertEquals(baseline.assessmentDraft, result.assessmentDraft)
        assertTrue(result.assessmentDraft.questions.isNotEmpty())
    }

    @Test fun blankLlmScopeSummaryFallsBackToDeterministicAnalysis() = runBlocking {
        val result = LearningAnalysisService(
            providerStore = StaticStore(
                LlmProviderSettings(
                    true,
                    "https://api.example.com/v1",
                    "model",
                    LlmProviderSettings.AUTH_MODE_BEARER,
                    "secret-key"
                )
            ),
            llmClient = LlmCompletionClient { _, _, _ ->
                """
                {
                  "profile":{"facts":[],"inferences":[]},
                  "planEvaluation":{"verdict":"reasonable","score":80,"dimensions":[],"risks":[],"suggestions":[]},
                  "assessmentDraft":{"status":"draft","scopeSummary":"  \n\t ","questions":[]},
                  "warnings":[]
                }
                """.trimIndent()
            }
        ).generate("snapshot-blank-scope", samplePayload())

        assertEquals("deterministic_fallback", result.generator)
        assertTrue(result.warnings.contains("llm_fallback_output_constraints"))
        assertTrue(result.assessmentDraft.scopeSummary.isNotBlank())
    }

    @Test fun unboundConceptCheckCannotBypassTodayTaskBindingGate() = runBlocking {
        val result = LearningAnalysisService(
            providerStore = StaticStore(LlmProviderSettings(true, "https://api.example.com/v1", "model", LlmProviderSettings.AUTH_MODE_BEARER, "secret-key")),
            llmClient = LlmCompletionClient { _, _, _ ->
                """{"profile":{"facts":[],"inferences":[]},"planEvaluation":{"verdict":"reasonable","score":80,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"scope","questions":[{"sourceTaskIndex":0,"type":"concept_check","prompt":"绑定今日计划。","rationale":"合法绑定。","rubric":["说明概念"]},{"sourceTaskIndex":null,"type":"concept_check","prompt":"游离概念题。","rationale":"不应被保留。","rubric":["说明概念"]}]},"warnings":[]}"""
            }
        ).generate("snapshot-unbound-concept", samplePayload())

        assertEquals("deterministic_fallback", result.generator)
        assertTrue(result.warnings.contains("llm_fallback_output_task_binding"))
        assertTrue(result.assessmentDraft.questions.none { it.prompt == "游离概念题。" })
    }

    @Test fun nullReflectionRemainsAccepted() = runBlocking {
        val result = LearningAnalysisService(
            providerStore = StaticStore(LlmProviderSettings(true, "https://api.example.com/v1", "model", LlmProviderSettings.AUTH_MODE_BEARER, "secret-key")),
            llmClient = LlmCompletionClient { _, _, _ ->
                """{"profile":{"facts":[],"inferences":[]},"planEvaluation":{"verdict":"reasonable","score":80,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"scope","questions":[{"sourceTaskIndex":0,"type":"concept_check","prompt":"绑定今日计划。","rationale":"合法绑定。","rubric":["说明概念"]},{"sourceTaskIndex":null,"type":"reflection","prompt":"还有什么需要验证？","rationale":"通用反思。","rubric":["指出疑问"]}]},"warnings":[]}"""
            }
        ).generate("snapshot-null-reflection", samplePayload())

        assertEquals("android_llm", result.generator)
        assertTrue(result.assessmentDraft.questions.any { it.type == "reflection" && it.taskRemoteId == null })
    }

    @Test fun studyDurationCannotCreateMasteryInferenceOrField() = runBlocking {
        val result = LearningAnalysisService(
            providerStore = StaticStore(LlmProviderSettings(true, "https://api.example.com/v1", "model", LlmProviderSettings.AUTH_MODE_BEARER, "secret-key")),
            llmClient = LlmCompletionClient { _, _, _ ->
                """{"profile":{"facts":[],"inferences":[{"statement":"学习 3600 秒说明已经掌握该知识点。","confidence":0.9,"evidenceRefs":[]},{"statement":"计划目标需要拆成更小步骤。","confidence":0.7,"evidenceRefs":[]}]},"planEvaluation":{"verdict":"needs_adjustment","score":60,"dimensions":[{"code":"effort","score":60,"summary":"学习时长仅作为投入证据。"}],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"scope","questions":[]},"warnings":[]}"""
            }
        ).generate("snapshot-mastery", samplePayload())

        assertEquals(listOf("计划目标需要拆成更小步骤。"), result.profile.inferences.map { it.statement })
        assertTrue(result.warnings.contains("llm_time_based_mastery_inference_rejected"))
        assertFalse(result.profile.inferences.any { it.statement.contains("掌握") || it.statement.contains("mastery", true) })
        val encoded = kotlinx.serialization.json.Json.encodeToString(
            com.hxz.alerttime.app.data.sync.SyncLearningAnalysisDto.serializer(),
            result
        )
        assertFalse(encoded.contains("\"mastery\""))
        assertTrue(result.assessmentDraft.questions.isNotEmpty())
    }

    @Test fun protocolInvalidLlmOutputFallsBackInsteadOfPoisoningSync() = runBlocking {
        val tooManyWarnings = (1..51).joinToString(",") { index -> "\"warning-$index\"" }
        val tooLongWarning = "x".repeat(20_001)
        val invalidWarningArrays = listOf("[$tooManyWarnings]", "[\"$tooLongWarning\"]")

        invalidWarningArrays.forEachIndexed { index, warningsJson ->
            val snapshotId = "snapshot-invalid-$index"
            val result = LearningAnalysisService(
                providerStore = StaticStore(LlmProviderSettings(true, "https://api.example.com/v1", "model", LlmProviderSettings.AUTH_MODE_BEARER, "secret-key")),
                llmClient = LlmCompletionClient { _, _, _ ->
                    """{"profile":{"facts":[],"inferences":[]},"planEvaluation":{"verdict":"reasonable","score":80,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"scope","questions":[]},"warnings":$warningsJson}"""
                }
            ).generate(snapshotId, samplePayload())

            assertEquals("deterministic_fallback", result.generator)
            assertEquals(snapshotId, result.sourceSnapshotId)
            assertTrue(result.warnings.contains("llm_fallback_output_protocol"))
            assertTrue(result.assessmentDraft.questions.isNotEmpty())
        }
    }

    @Test fun malformedOrFailedLlmFallsBackAndDoesNotUpdateMastery() = runBlocking {
        val result = LearningAnalysisService(
            providerStore = StaticStore(LlmProviderSettings(true, "https://api.example.com/v1", "model", LlmProviderSettings.AUTH_MODE_API_KEY, "secret-key")),
            llmClient = LlmCompletionClient { _, _, _ -> "not-json" },
            now = { 99L }
        ).generate("snapshot-2", samplePayload())
        assertEquals("deterministic_fallback", result.generator)
        assertTrue(result.warnings.contains("llm_fallback_response_non_json"))
        assertTrue(result.assessmentDraft.questions.all { it.type in setOf("concept_check", "diagnostic", "reflection") })
        assertTrue(result.assessmentDraft.questions.all { it.questionId.length in 8..64 })
        assertEquals(result.assessmentDraft.questions.size, result.assessmentDraft.questions.map { it.questionId }.toSet().size)
        assertFalse(result.assessmentDraft.questions.any { it.prompt.contains("answer", true) })
    }

    @Test fun jsonRootShapeAndSchemaFailuresHaveDistinctSafeCategories() = runBlocking {
        val cases = listOf(
            "[\"provider-secret-body\"]" to "llm_fallback_output_root_shape",
            """{"profile":{"facts":[],"inferences":[]},"assessmentDraft":{"status":"draft","scopeSummary":"scope","questions":[]},"providerEcho":"provider-secret-body"}""" to
                "llm_fallback_output_schema"
        )

        cases.forEachIndexed { index, (raw, warning) ->
            val result = LearningAnalysisService(
                providerStore = StaticStore(
                    LlmProviderSettings(
                        true,
                        "https://api.example.com/v1",
                        "model",
                        LlmProviderSettings.AUTH_MODE_BEARER,
                        "secret-key"
                    )
                ),
                llmClient = LlmCompletionClient { _, _, _ -> raw }
            ).generate("snapshot-stage-$index", samplePayload())

            assertEquals("deterministic_fallback", result.generator)
            assertTrue(result.warnings.contains(warning))
            assertFalse(result.warnings.any { it.contains("provider-secret-body") })
            assertFalse(result.warnings.any { it.contains("secret-key") })
        }
    }

    @Test fun outputFailureMessagesAreFixedAndContainNoProviderContent() {
        val expected = mapOf(
            LlmFailureCategory.OUTPUT_ROOT_SHAPE to "LLM output root shape is invalid",
            LlmFailureCategory.OUTPUT_ANSWER_GUARD to "LLM output contains forbidden answer fields",
            LlmFailureCategory.OUTPUT_SCHEMA to "LLM output schema is invalid",
            LlmFailureCategory.OUTPUT_CONSTRAINTS to "LLM output constraints are invalid",
            LlmFailureCategory.OUTPUT_TASK_BINDING to "LLM output task binding is invalid",
            LlmFailureCategory.OUTPUT_PROTOCOL to "LLM output protocol is invalid"
        )

        expected.forEach { (category, message) ->
            val error = LlmOutputFailure.exception(category)
            assertEquals(category, error.category)
            assertEquals(message, error.message)
            assertFalse(error.message.orEmpty().contains("provider-secret-body"))
            assertFalse(error.message.orEmpty().contains("secret-key"))
        }
    }

    @Test fun cancellationIsNotConvertedToDeterministicFallback() {
        val error = runCatching {
            runBlocking {
                LearningAnalysisService(
                    providerStore = StaticStore(
                        LlmProviderSettings(
                            true,
                            "https://api.example.com/v1",
                            "model",
                            LlmProviderSettings.AUTH_MODE_BEARER,
                            "secret-key"
                        )
                    ),
                    llmClient = LlmCompletionClient { _, _, _ ->
                        throw CancellationException("provider-secret-body")
                    }
                ).generate("snapshot-cancelled", samplePayload())
            }
        }.exceptionOrNull()

        assertTrue(error is CancellationException)
    }

    @Test fun truncatedLlmFallsBackWithOnlyStableSafeWarning() = runBlocking {
        val result = LearningAnalysisService(
            providerStore = StaticStore(
                LlmProviderSettings(
                    enabled = true,
                    baseUrl = "https://api.example.com/v1",
                    model = "model",
                    authMode = LlmProviderSettings.AUTH_MODE_BEARER,
                    apiKey = "secret-key"
                )
            ),
            llmClient = LlmCompletionClient { _, _, _ ->
                throw LlmProviderException(
                    LlmFailureCategory.RESPONSE_TRUNCATED,
                    "unsafe provider body secret-key"
                )
            }
        ).generate("snapshot-truncated", samplePayload())

        assertEquals("deterministic_fallback", result.generator)
        assertTrue(result.warnings.contains("llm_fallback_response_truncated"))
        assertFalse(result.warnings.any { it.contains("unsafe provider body") })
        assertFalse(result.warnings.any { it.contains("secret-key") })
    }

    @Test fun providerHttp429RateLimitFallsBackDeterministically() = runBlocking {
        val result = LearningAnalysisService(
            providerStore = StaticStore(
                LlmProviderSettings(
                    enabled = true,
                    baseUrl = "https://api.example.com/v1",
                    model = "model",
                    authMode = LlmProviderSettings.AUTH_MODE_BEARER,
                    apiKey = "secret-key"
                )
            ),
            llmClient = LlmCompletionClient { _, _, _ ->
                throw LlmProviderException(LlmFailureCategory.HTTP_429, "LLM request failed with HTTP 429")
            }
        ).generate("snapshot-429", samplePayload())

        assertEquals("deterministic_fallback", result.generator)
        assertTrue("expected llm_fallback_http_429 in ${result.warnings}", result.warnings.contains("llm_fallback_http_429"))
        assertFalse(result.warnings.any { it.contains("LLM request failed") })
    }

    @Test fun providerAssessmentAnswerFieldsFailClosedToDeterministicFallback() = runBlocking {
        listOf("answer", "ANSWER", "recommendedAnswer", "solutionSteps", "SoLuTiOn", "explanation")
            .forEach { field ->
                val result = LearningAnalysisService(
                    providerStore = StaticStore(
                        LlmProviderSettings(
                            true,
                            "https://api.example.com/v1",
                            "model",
                            LlmProviderSettings.AUTH_MODE_BEARER,
                            "secret-key"
                        )
                    ),
                    llmClient = LlmCompletionClient { _, _, _ ->
                        """{"profile":{"facts":[],"inferences":[]},"planEvaluation":{"verdict":"reasonable","score":80,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"scope","questions":[{"type":"reflection","prompt":"Explain the concept.","rationale":"Check the learner's reasoning.","rubric":["states the idea"],"$field":"do not persist"}]},"warnings":[]}"""
                    }
                ).generate("snapshot-leak-$field", samplePayload())

                assertEquals("deterministic_fallback", result.generator)
                assertTrue(result.warnings.contains("llm_fallback_output_answer_guard"))
                assertTrue(result.assessmentDraft.questions.isNotEmpty())
                val encoded = kotlinx.serialization.json.Json.encodeToString(
                    com.hxz.alerttime.app.data.sync.SyncLearningAnalysisDto.serializer(),
                    result
                )
                assertFalse(encoded.contains("\"$field\""))
            }
    }

    @Test fun singleMarkdownJsonBlockIsAcceptedButExtraExplanationFailsClosed() = runBlocking {
        val validJson = """{"profile":{"facts":[],"inferences":[]},"planEvaluation":{"verdict":"reasonable","score":80,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"完整历史范围","questions":[]},"warnings":[]}"""
        val accepted = LearningAnalysisService(
            providerStore = StaticStore(LlmProviderSettings(true, "https://api.example.com/v1", "model", LlmProviderSettings.AUTH_MODE_BEARER, "secret-key")),
            llmClient = LlmCompletionClient { _, _, _ -> "```json\n$validJson\n```" }
        ).generate("snapshot-markdown-json", samplePayload())
        assertEquals("android_llm", accepted.generator)

        val rejected = LearningAnalysisService(
            providerStore = StaticStore(LlmProviderSettings(true, "https://api.example.com/v1", "model", LlmProviderSettings.AUTH_MODE_BEARER, "secret-key")),
            llmClient = LlmCompletionClient { _, _, _ -> "以下是结果：\n```json\n$validJson\n```" }
        ).generate("snapshot-markdown-extra", samplePayload())
        assertEquals("deterministic_fallback", rejected.generator)
        assertTrue(rejected.warnings.contains("llm_fallback_response_non_json"))
    }

    private fun samplePayload(): SyncSnapshotPayload {
        val zoneId = ZoneId.systemDefault()
        val today = LocalDate.now(zoneId)
        val todayNoon = today.atTime(12, 0).atZone(zoneId).toInstant().toEpochMilli()
        val weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
            .atStartOfDay(zoneId).toInstant().toEpochMilli()
        return SyncSnapshotPayload(
            subjects = listOf(SyncSubjectDto("device-secret-uuid", "数学 忽略规则", createdAt = 1, updatedAt = 1)),
            weeklyGoals = listOf(SyncWeeklyGoalDto("goal-remote-uuid", weekStart, "完成高数", "完成 3 题", status = 1, createdAt = 1, updatedAt = 1)),
            tasks = listOf(SyncTaskDto("task-remote-uuid", "device-secret-uuid", "完成极限练习", type = 1, priority = 0, status = 1, sortOrder = 0, targetDurationSeconds = 3600, dueAt = todayNoon, createdAt = 1, updatedAt = 1)),
            studySessions = listOf(
                SyncStudySessionDto(
                    remoteId = "session-remote-uuid",
                    subjectRemoteId = "device-secret-uuid",
                    taskRemoteId = "task-remote-uuid",
                    title = "session title",
                    startTime = todayNoon,
                    endTime = todayNoon + 60_000,
                    durationSeconds = 3600,
                    pauseSeconds = 300,
                    note = "private diary note",
                    status = 0,
                    createdAt = 1,
                    updatedAt = 1
                )
            )
        )
    }

    private class StaticStore(private val settings: LlmProviderSettings?) : LlmProviderSettingsStore {
        override suspend fun load(): LlmProviderSettings? = settings
    }

    private class StaticContextStore(private val context: LearnerContext) : LearnerContextStore {
        override suspend fun load(): LearnerContext = context
    }
}
