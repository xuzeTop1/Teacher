package com.hxz.alerttime.app.data.sync

import com.hxz.alerttime.app.data.assessment.CachedLearningAnalysis
import com.hxz.alerttime.app.data.assessment.LearningAnalysisRepository
import com.hxz.alerttime.app.data.assessment.LocalLearningAnalysisStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncCoordinatorLearningAnalysisTest {

    @Test
    fun `desktop network failure happens only after latest analysis is persisted`() = runBlocking {
        val events = mutableListOf<String>()
        var latest: SyncLearningAnalysisDto? = null
        val repository = LearningAnalysisRepository(
            buildSnapshot = { emptySnapshot() },
            analysisGenerator = generator { snapshotId, _ -> analysis(snapshotId, "android_llm") },
            fallbackGenerator = generator { snapshotId, _ ->
                analysis(snapshotId, "deterministic_fallback")
            },
            localStore = object : LocalLearningAnalysisStore {
                override suspend fun loadLatest(): SyncLearningAnalysisDto? = latest

                override suspend fun loadLatestCache(): CachedLearningAnalysis? =
                    latest?.let { CachedLearningAnalysis(it, "", System.currentTimeMillis()) }

                override suspend fun saveLatest(
                    analysis: SyncLearningAnalysisDto,
                    sourceSnapshot: SyncSnapshotPayload,
                    contentFingerprint: String
                ) {
                    latest = analysis
                    events += "saved:${analysis.sourceSnapshotId}"
                }
            }
        )

        val result = runCatching {
            prepareSnapshotBeforeFirstNetworkRequest(SNAPSHOT_ID, repository) { prepared ->
                events += "network:${prepared.payload.learningAnalysis?.sourceSnapshotId}"
                assertEquals(prepared.payload.learningAnalysis, latest)
                assertEquals(SNAPSHOT_ID, prepared.snapshotId)
                error("desktop unavailable")
            }
        }

        assertTrue(result.isFailure)
        assertEquals("desktop unavailable", result.exceptionOrNull()?.message)
        assertEquals(listOf("saved:$SNAPSHOT_ID", "network:$SNAPSHOT_ID"), events)
        assertEquals(SNAPSHOT_ID, latest?.sourceSnapshotId)
    }

    @Test
    fun `builds snapshot before generating exactly one analysis with frozen snapshot id`() = runBlocking {
        val events = mutableListOf<String>()
        val primary = generator { snapshotId, payload ->
            events += "analyze:$snapshotId:${payload.learningAnalysis == null}"
            analysis(snapshotId, "android_llm")
        }

        val result = prepareAnalyzedSnapshot(
            snapshotId = SNAPSHOT_ID,
            buildSnapshot = {
                events += "build"
                emptySnapshot()
            },
            analysisGenerator = primary,
            fallbackGenerator = generator { _, _ -> error("fallback must not run") }
        )

        assertEquals(listOf("build", "analyze:$SNAPSHOT_ID:true"), events)
        assertEquals(SNAPSHOT_ID, result.learningAnalysis?.sourceSnapshotId)
        assertEquals("android_llm", result.learningAnalysis?.generator)
    }

    @Test
    fun `generator failure produces deterministic fallback without dropping analysis`() = runBlocking {
        var fallbackCalls = 0
        val result = prepareAnalyzedSnapshot(
            snapshotId = SNAPSHOT_ID,
            buildSnapshot = { emptySnapshot() },
            analysisGenerator = generator { _, _ -> error("provider unavailable") },
            fallbackGenerator = generator { snapshotId, _ ->
                fallbackCalls += 1
                analysis(snapshotId, "deterministic_fallback")
            }
        )

        assertEquals(1, fallbackCalls)
        assertNotNull(result.learningAnalysis)
        assertEquals("deterministic_fallback", result.learningAnalysis?.generator)
        assertEquals(SNAPSHOT_ID, result.learningAnalysis?.sourceSnapshotId)
    }

    @Test
    fun `mismatched analysis snapshot id is replaced by fallback`() = runBlocking {
        val result = prepareAnalyzedSnapshot(
            snapshotId = SNAPSHOT_ID,
            buildSnapshot = { emptySnapshot() },
            analysisGenerator = generator { _, _ -> analysis("different-snapshot-id", "android_llm") },
            fallbackGenerator = generator { snapshotId, _ -> analysis(snapshotId, "deterministic_fallback") }
        )

        assertEquals("deterministic_fallback", result.learningAnalysis?.generator)
        assertEquals(SNAPSHOT_ID, result.learningAnalysis?.sourceSnapshotId)
    }

    @Test
    fun `invalid generator enum is replaced by validated fallback`() = runBlocking {
        var fallbackCalls = 0
        val result = prepareAnalyzedSnapshot(
            snapshotId = SNAPSHOT_ID,
            buildSnapshot = { emptySnapshot() },
            analysisGenerator = generator { snapshotId, _ ->
                analysis(snapshotId, "unsupported_generator")
            },
            fallbackGenerator = generator { snapshotId, _ ->
                fallbackCalls += 1
                analysis(snapshotId, "deterministic_fallback")
            }
        )

        assertEquals(1, fallbackCalls)
        assertEquals("deterministic_fallback", result.learningAnalysis?.generator)
    }

    @Test
    fun `oversized generator result is replaced by validated fallback`() = runBlocking {
        val oversizedFacts = List(101) { index ->
            SyncLearningFactDto(
                code = "fact-$index",
                label = "事实 $index",
                value = kotlinx.serialization.json.JsonPrimitive(index),
                evidenceRefs = emptyList()
            )
        }
        val result = prepareAnalyzedSnapshot(
            snapshotId = SNAPSHOT_ID,
            buildSnapshot = { emptySnapshot() },
            analysisGenerator = generator { snapshotId, _ ->
                analysis(snapshotId, "android_llm").copy(
                    profile = SyncLearningProfileDto(facts = oversizedFacts, inferences = emptyList())
                )
            },
            fallbackGenerator = generator { snapshotId, _ -> analysis(snapshotId, "deterministic_fallback") }
        )

        assertEquals("deterministic_fallback", result.learningAnalysis?.generator)
    }

    @Test
    fun `invalid fallback is rejected before upload`() = runBlocking {
        val result = runCatching {
            prepareAnalyzedSnapshot(
                snapshotId = SNAPSHOT_ID,
                buildSnapshot = { emptySnapshot() },
                analysisGenerator = generator { _, _ -> error("primary failed") },
                fallbackGenerator = generator { snapshotId, _ -> analysis(snapshotId, "invalid_fallback") }
            )
        }

        assertTrue(result.exceptionOrNull() is SyncValidationException)
    }

    private fun generator(
        block: suspend (String, SyncSnapshotPayload) -> SyncLearningAnalysisDto
    ): LearningAnalysisGenerator = object : LearningAnalysisGenerator {
        override suspend fun generate(
            snapshotId: String,
            snapshot: SyncSnapshotPayload
        ): SyncLearningAnalysisDto = block(snapshotId, snapshot)
    }

    private fun emptySnapshot() = SyncSnapshotPayload(
        subjects = emptyList(),
        weeklyGoals = emptyList(),
        tasks = emptyList(),
        studySessions = emptyList()
    )

    private fun analysis(snapshotId: String, generator: String) = SyncLearningAnalysisDto(
        analysisId = "11111111-1111-4111-8111-111111111111",
        sourceSnapshotId = snapshotId,
        generatedAt = 1,
        promptVersion = "test-v1",
        generator = generator,
        profile = SyncLearningProfileDto(facts = emptyList(), inferences = emptyList()),
        planEvaluation = SyncPlanEvaluationDto(
            verdict = "insufficient_data",
            score = null,
            dimensions = emptyList(),
            risks = emptyList(),
            suggestions = emptyList()
        ),
        assessmentDraft = SyncAssessmentDraftDto(
            status = "draft",
            scopeSummary = "test",
            questions = emptyList()
        ),
        warnings = emptyList()
    )

    companion object {
        private const val SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222"
    }
}
