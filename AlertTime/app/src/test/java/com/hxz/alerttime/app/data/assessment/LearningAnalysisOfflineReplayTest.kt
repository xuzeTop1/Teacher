package com.hxz.alerttime.app.data.assessment

import com.hxz.alerttime.app.data.llm.LlmProviderSettingsStore
import com.hxz.alerttime.app.data.sync.DeterministicLearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.LearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.SyncCodec
import com.hxz.alerttime.app.data.sync.SyncLearningAnalysisDto
import com.hxz.alerttime.app.data.sync.SyncSnapshotPayload
import com.hxz.alerttime.app.data.sync.SyncSubjectDto
import com.hxz.alerttime.app.data.sync.SyncTaskDto
import com.hxz.alerttime.app.data.sync.SyncStudySessionDto
import com.hxz.alerttime.app.data.sync.SyncWeeklyGoalDto
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Offline replay across the mobile learning-analysis service/repository boundaries.
 *
 * This deliberately does not use Room, Android Keystore, HTTP, or a device:
 * the provider and latest-analysis store are the same boundaries used by the
 * production repository, while the snapshots are deterministic replay input.
 */
class LearningAnalysisOfflineReplayTest {
    @Test
    fun `canonical fixture replays through repository with deterministic task evidence`() = runBlocking {
        val fixtureText = requireNotNull(javaClass.getResourceAsStream(CANONICAL_FIXTURE_RESOURCE)) {
            "missing canonical sync fixture"
        }.bufferedReader(Charsets.UTF_8).use { it.readText() }
        val envelope = SyncCodec.decodeSnapshotEnvelope(fixtureText)
        val snapshotId = requireNotNull(envelope.snapshotId)
        val payload = envelope.payload
        val zoneId = ZoneId.of("Asia/Shanghai")
        val todayDueAt = payload.tasks
            .filter { it.type == 1 && it.dueAt != null }
            .map { requireNotNull(it.dueAt) }
            .min()
        val today = Instant.ofEpochMilli(todayDueAt).atZone(zoneId).toLocalDate()
        val nowMs = today.atTime(LocalTime.NOON).atZone(zoneId).toInstant().toEpochMilli()
        val store = ReplayStore()
        val deterministicFallback = DeterministicLearningAnalysisGenerator(zoneId) { nowMs }
        val repository = LearningAnalysisRepository(
            buildSnapshot = { payload },
            analysisGenerator = LearningAnalysisService(
                providerStore = UnconfiguredProviderStore,
                now = { nowMs },
                zoneId = zoneId,
                fallbackGenerator = deterministicFallback
            ),
            fallbackGenerator = deterministicFallback,
            localStore = store
        )

        val replayed = repository.prepareForSync(snapshotId).payload
        val analysis = requireNotNull(replayed.learningAnalysis)

        assertEquals(snapshotId, analysis.sourceSnapshotId)
        assertEquals(3, replayed.subjects.size)
        assertEquals(5, replayed.weeklyGoals.size)
        assertEquals(4, replayed.tasks.size)
        assertEquals(5, replayed.studySessions.size)
        assertTrue(replayed.subjects.single { it.remoteId == MATH_SUBJECT_ID }.name.contains("π ≥ 1/2"))
        assertTrue(replayed.subjects.single { it.remoteId == MATH_SUBJECT_ID }.name.contains("🎓"))
        assertTrue(replayed.subjects.single { it.remoteId == MATH_SUBJECT_ID }.name.contains("\n第二行"))
        assertNotNull(replayed.subjects.single { it.remoteId == DELETED_SUBJECT_ID }.deletedAt)
        assertNotNull(replayed.weeklyGoals.single { it.remoteId == DELETED_GOAL_ID }.deletedAt)
        assertNotNull(replayed.tasks.single { it.remoteId == DELETED_TASK_ID }.deletedAt)

        val aiSession = replayed.studySessions.single { it.remoteId == AI_SESSION_ID }
        assertEquals(420L, aiSession.aiHelpSeconds)
        assertEquals(2, aiSession.aiHelpCount)
        assertEquals(0L, aiSession.externalAiAppSeconds)
        assertEquals("alerttime_ai_help", aiSession.aiUsageSource)

        assertEquals("deterministic_fallback", analysis.generator)
        assertEquals("draft", analysis.assessmentDraft.status)
        assertTrue(analysis.warnings.contains("learning_time_is_not_mastery_evidence"))
        assertTrue(analysis.warnings.contains("assessment_draft_not_counted_toward_mastery"))
        val todayTaskIds = setOf(TODAY_TASK_A, TODAY_TASK_B)
        val todayPlanFact = requireNotNull(analysis.profile.facts.single { it.code == "today_plan_count" })
        assertEquals(2L, jsonLong(todayPlanFact.value))
        assertEquals(todayTaskIds, todayPlanFact.evidenceRefs.toSet())
        todayTaskIds.forEach { taskId ->
            assertNotNull(analysis.assessmentDraft.questions.singleOrNull { it.taskRemoteId == taskId })
        }
        assertEquals(analysis, store.latest)
    }

    @Test
    fun `same entity state changes replay through repository and replace latest analysis`() = runBlocking {
        val zoneId = ZoneId.of("Asia/Shanghai")
        val today = Instant.ofEpochMilli(1785500000000L).atZone(zoneId).toLocalDate()
        val nowMs = today.atTime(23, 0).atZone(zoneId).toInstant().toEpochMilli()
        val monday = today.with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY))
        val weekStartMs = monday.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val snapshotA = changedEntitySnapshot(
            weekStartMs = weekStartMs,
            today = today,
            taskStatus = 0,
            taskCompletedAt = null,
            goalStatus = 0,
            goalCompletedAt = null,
            durationSeconds = 600
        )
        val snapshotB = changedEntitySnapshot(
            weekStartMs = weekStartMs,
            today = today,
            taskStatus = 1,
            taskCompletedAt = nowMs - 1_000,
            goalStatus = 1,
            goalCompletedAt = nowMs - 1_000,
            durationSeconds = 1_800
        )
        var nextSnapshot = snapshotA
        val store = ReplayStore()
        val deterministic = DeterministicLearningAnalysisGenerator(zoneId) { nowMs }
        val repository = LearningAnalysisRepository(
            buildSnapshot = { nextSnapshot },
            analysisGenerator = deterministic,
            fallbackGenerator = deterministic,
            localStore = store
        )

        val replayedA = repository.prepareForSync(SNAPSHOT_A).payload
        nextSnapshot = snapshotB
        val replayedB = repository.prepareForSync(SNAPSHOT_B).payload
        val analysisA = requireNotNull(replayedA.learningAnalysis)
        val analysisB = requireNotNull(replayedB.learningAnalysis)

        assertNotEquals(analysisA.analysisId, analysisB.analysisId)
        assertEquals(SNAPSHOT_A, analysisA.sourceSnapshotId)
        assertEquals(SNAPSHOT_B, analysisB.sourceSnapshotId)
        assertEquals(0L, factLong(analysisA, "today_completed_plan_count"))
        assertEquals(1L, factLong(analysisB, "today_completed_plan_count"))
        assertEquals(0L, factLong(analysisA, "current_week_completed_goal_count"))
        assertEquals(1L, factLong(analysisB, "current_week_completed_goal_count"))
        assertEquals(600L, factLong(analysisA, "today_effective_focus_seconds"))
        assertEquals(1_800L, factLong(analysisB, "today_effective_focus_seconds"))
        assertNotEquals(analysisA.planEvaluation.verdict, analysisB.planEvaluation.verdict)
        assertNotEquals(analysisA.planEvaluation.score, analysisB.planEvaluation.score)

        val stableIds = setOf(SHARED_SUBJECT_ID, SHARED_TASK_ID, SHARED_GOAL_ID, SHARED_SESSION_ID)
        listOf(analysisA, analysisB).forEach { analysis ->
            assertTrue(
                analysis.profile.facts.flatMap { it.evidenceRefs }
                    .all { it in stableIds }
            )
        }
        assertEquals(analysisB, store.latest)
        assertEquals(SNAPSHOT_B, repository.loadLatest()?.sourceSnapshotId)
    }

    @Test
    fun `service and repository fallbacks replay two snapshots and keep newest analysis`() = runBlocking {
        val firstAnalysisStarted = CompletableDeferred<Unit>()
        val releaseFirstAnalysis = CompletableDeferred<Unit>()
        val zoneId = ZoneId.of("Asia/Shanghai")
        val nowMs = Instant.parse("2026-08-10T04:00:00Z").toEpochMilli()
        val snapshots = mapOf(
            SNAPSHOT_A to replaySnapshot(TASK_A, "完成线性代数极限复习", nowMs, zoneId),
            SNAPSHOT_B to replaySnapshot(TASK_B, "完成计算机网络分层复习", nowMs, zoneId)
        )
        var nextSnapshotId = SNAPSHOT_A
        val store = ReplayStore()
        val deterministicFallback = DeterministicLearningAnalysisGenerator(zoneId) { nowMs }
        val service = LearningAnalysisService(
            providerStore = UnconfiguredProviderStore,
            now = { nowMs },
            zoneId = zoneId,
            fallbackGenerator = deterministicFallback
        )
        val replayGenerator = object : LearningAnalysisGenerator {
            override suspend fun generate(
                snapshotId: String,
                snapshot: SyncSnapshotPayload
            ): SyncLearningAnalysisDto {
                if (snapshotId == SNAPSHOT_A) {
                    firstAnalysisStarted.complete(Unit)
                    releaseFirstAnalysis.await()
                    return service.generate(snapshotId, snapshot)
                }
                error("provider transport failed")
            }
        }
        val repository = LearningAnalysisRepository(
            buildSnapshot = {
                store.builtSnapshotIds += nextSnapshotId
                requireNotNull(snapshots[nextSnapshotId])
            },
            analysisGenerator = replayGenerator,
            fallbackGenerator = deterministicFallback,
            localStore = store
        )

        // A missing Provider goes through the real service fallback and is
        // saved before any later desktop/network work could happen.
        val first = async(start = CoroutineStart.UNDISPATCHED) {
            repository.prepareForSync(SNAPSHOT_A)
        }
        firstAnalysisStarted.await()
        val firstTaskSnapshot = store.builtSnapshotIds.single()

        // Start a newer replay while the older one is still generating. The
        // repository's process-wide mutex must prevent B from building/saving
        // until A has completed; otherwise an old result could become latest.
        nextSnapshotId = SNAPSHOT_B
        val second = async(start = CoroutineStart.UNDISPATCHED) {
            repository.prepareForSync(SNAPSHOT_B)
        }
        yield()
        assertFalse(second.isCompleted)
        assertEquals(firstTaskSnapshot, SNAPSHOT_A)
        assertEquals(listOf(SNAPSHOT_A), store.builtSnapshotIds)
        assertEquals(emptyList<String>(), store.savedSnapshotIds)

        releaseFirstAnalysis.complete(Unit)
        val firstPayload = first.await().payload
        val secondPayload = second.await().payload
        val firstAnalysis = requireNotNull(firstPayload.learningAnalysis)
        val secondAnalysis = requireNotNull(secondPayload.learningAnalysis)

        // 1) A exercises the service's no-Provider fallback. B makes the
        // primary generator throw and therefore exercises the Repository's
        // fallbackGenerator branch. Both results are persisted.
        assertEquals("deterministic_fallback", firstAnalysis.generator)
        assertEquals("deterministic_fallback", secondAnalysis.generator)
        assertEquals(firstAnalysis, store.savedAnalyses.first())
        assertTrue(firstAnalysis.warnings.contains("learning_time_is_not_mastery_evidence"))

        // 2) A and B are independent replay inputs and receive fresh IDs.
        assertEquals(SNAPSHOT_A, firstAnalysis.sourceSnapshotId)
        assertEquals(SNAPSHOT_B, secondAnalysis.sourceSnapshotId)
        assertNotEquals(firstAnalysis.analysisId, secondAnalysis.analysisId)
        assertTrue(firstAnalysis.profile.facts.any { it.evidenceRefs.contains(TASK_A) })
        assertTrue(secondAnalysis.profile.facts.any { it.evidenceRefs.contains(TASK_B) })
        assertNotNull(firstAnalysis.assessmentDraft.questions.singleOrNull { it.taskRemoteId == TASK_A })
        assertNotNull(secondAnalysis.assessmentDraft.questions.singleOrNull { it.taskRemoteId == TASK_B })

        // 3) The completed newer operation is the only latest result; the
        // older A result cannot overwrite it after the shared mutex releases.
        assertEquals(listOf(SNAPSHOT_A, SNAPSHOT_B), store.builtSnapshotIds)
        assertEquals(listOf(SNAPSHOT_A, SNAPSHOT_B), store.savedSnapshotIds)
        assertEquals(secondAnalysis, store.latest)
        assertEquals(SNAPSHOT_B, repository.loadLatest()?.sourceSnapshotId)
    }

    private fun replaySnapshot(
        taskId: String,
        title: String,
        nowMs: Long,
        zoneId: ZoneId
    ): SyncSnapshotPayload {
        val todayNoon = Instant.ofEpochMilli(nowMs).atZone(zoneId).toLocalDate()
            .atTime(12, 0).atZone(zoneId).toInstant().toEpochMilli()
        return SyncSnapshotPayload(
            subjects = listOf(
                SyncSubjectDto(
                    remoteId = SUBJECT_ID,
                    name = title,
                    createdAt = 1,
                    updatedAt = 1
                )
            ),
            weeklyGoals = emptyList(),
            tasks = listOf(
                SyncTaskDto(
                    remoteId = taskId,
                    subjectRemoteId = SUBJECT_ID,
                    title = title,
                    type = 1,
                    priority = 0,
                    status = 0,
                    sortOrder = 0,
                    dueAt = todayNoon,
                    createdAt = 1,
                    updatedAt = 1
                )
            ),
            studySessions = emptyList()
        )
    }

    private fun changedEntitySnapshot(
        weekStartMs: Long,
        today: java.time.LocalDate,
        taskStatus: Int,
        taskCompletedAt: Long?,
        goalStatus: Int,
        goalCompletedAt: Long?,
        durationSeconds: Long
    ): SyncSnapshotPayload {
        val startTime = today.atTime(12, 0).atZone(ZoneId.of("Asia/Shanghai")).toInstant().toEpochMilli()
        return SyncSnapshotPayload(
            subjects = listOf(
                SyncSubjectDto(
                    remoteId = SHARED_SUBJECT_ID,
                    name = "同一科目",
                    createdAt = 1,
                    updatedAt = 1
                )
            ),
            weeklyGoals = listOf(
                SyncWeeklyGoalDto(
                    remoteId = SHARED_GOAL_ID,
                    weekStart = weekStartMs,
                    title = "同一周目标",
                    successCriteria = "完成并复盘",
                    status = goalStatus,
                    completedAt = goalCompletedAt,
                    createdAt = 1,
                    updatedAt = 1
                )
            ),
            tasks = listOf(
                SyncTaskDto(
                    remoteId = SHARED_TASK_ID,
                    subjectRemoteId = SHARED_SUBJECT_ID,
                    title = "同一今日计划",
                    type = 1,
                    priority = 0,
                    status = taskStatus,
                    sortOrder = 0,
                    completedAt = taskCompletedAt,
                    dueAt = startTime,
                    createdAt = 1,
                    updatedAt = 1
                )
            ),
            studySessions = listOf(
                SyncStudySessionDto(
                    remoteId = SHARED_SESSION_ID,
                    subjectRemoteId = SHARED_SUBJECT_ID,
                    taskRemoteId = SHARED_TASK_ID,
                    title = "同一专注记录",
                    startTime = startTime,
                    endTime = startTime + durationSeconds * 1_000,
                    durationSeconds = durationSeconds,
                    pauseSeconds = 0,
                    status = 0,
                    createdAt = startTime,
                    updatedAt = startTime + durationSeconds * 1_000
                )
            )
        )
    }

    private fun factLong(analysis: SyncLearningAnalysisDto, code: String): Long {
        val fact = requireNotNull(analysis.profile.facts.single { it.code == code })
        return jsonLong(fact.value)
    }

    private fun jsonLong(value: kotlinx.serialization.json.JsonElement): Long {
        assertTrue(value is JsonPrimitive)
        return value.jsonPrimitive.long
    }

    private object UnconfiguredProviderStore : LlmProviderSettingsStore {
        override suspend fun load() = null
    }

    private class ReplayStore : LocalLearningAnalysisStore {
        val builtSnapshotIds = mutableListOf<String>()
        val savedSnapshotIds = mutableListOf<String>()
        val savedAnalyses = mutableListOf<SyncLearningAnalysisDto>()
        var latest: SyncLearningAnalysisDto? = null
        var latestFingerprint: String = ""

        override suspend fun loadLatest(): SyncLearningAnalysisDto? = latest

        override suspend fun loadLatestCache(): CachedLearningAnalysis? =
            latest?.let { CachedLearningAnalysis(it, latestFingerprint, System.currentTimeMillis()) }

        override suspend fun saveLatest(
            analysis: SyncLearningAnalysisDto,
            sourceSnapshot: SyncSnapshotPayload,
            contentFingerprint: String
        ) {
            require(sourceSnapshot.learningAnalysis == analysis)
            savedSnapshotIds += analysis.sourceSnapshotId
            savedAnalyses += analysis
            latest = analysis
            latestFingerprint = contentFingerprint
        }
    }

    companion object {
        private const val CANONICAL_FIXTURE_RESOURCE = "/sync/fixtures/snapshot-valid.json"
        private const val TODAY_TASK_A = "c9d0e1f2-a3b4-4c5d-9e6f-7a8b9c0d1e2f"
        private const val TODAY_TASK_B = "d0e1f2a3-b4c5-4d6e-9f7a-8b9c0d1e2f3a"
        private const val MATH_SUBJECT_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"
        private const val DELETED_SUBJECT_ID = "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f"
        private const val DELETED_GOAL_ID = "b8c9d0e1-f2a3-4b4c-9d5e-6f7a8b9c0d1e"
        private const val DELETED_TASK_ID = "f2a3b4c5-d6e7-4f8a-9b9c-0d1e2f3a4b5c"
        private const val AI_SESSION_ID = "a3b4c5d6-e7f8-4a9b-9c0d-1e2f3a4b5c6d"
        private const val SHARED_SUBJECT_ID = "66666666-6666-4666-8666-666666666666"
        private const val SHARED_TASK_ID = "77777777-7777-4777-8777-777777777777"
        private const val SHARED_GOAL_ID = "88888888-8888-4888-8888-888888888888"
        private const val SHARED_SESSION_ID = "99999999-9999-4999-8999-999999999999"
        private const val SUBJECT_ID = "11111111-1111-4111-8111-111111111111"
        private const val TASK_A = "22222222-2222-4222-8222-222222222222"
        private const val TASK_B = "33333333-3333-4333-8333-333333333333"
        private const val SNAPSHOT_A = "44444444-4444-4444-8444-444444444444"
        private const val SNAPSHOT_B = "55555555-5555-4555-8555-555555555555"
    }
}
