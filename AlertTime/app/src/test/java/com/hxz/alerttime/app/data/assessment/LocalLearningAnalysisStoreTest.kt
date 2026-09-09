package com.hxz.alerttime.app.data.assessment

import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import com.hxz.alerttime.app.data.sync.DeterministicLearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.SyncLearningFactDto
import com.hxz.alerttime.app.data.sync.SyncLearningInferenceDto
import com.hxz.alerttime.app.data.sync.SyncSnapshotPayload
import com.hxz.alerttime.app.data.sync.SyncStudySessionDto
import com.hxz.alerttime.app.data.sync.SyncTaskDto
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalLearningAnalysisStoreTest {
    @Test
    fun `validated analysis survives process style reload`() = runBlocking {
        val dao = TestAppSettingDao()
        val analysis = DeterministicLearningAnalysisGenerator()
            .generate("snapshot-local", emptySnapshot())

        AppSettingLocalLearningAnalysisStore(dao, now = { 456L })
            .saveLatest(analysis, emptySnapshot(), contentFingerprint = "fp-stable-1")
        val reloaded = AppSettingLocalLearningAnalysisStore(dao).loadLatest()
        val cache = AppSettingLocalLearningAnalysisStore(dao).loadLatestCache()

        assertEquals(analysis, reloaded)
        assertEquals(
            456L,
            dao.getSetting(AppSettingLocalLearningAnalysisStore.KEY_LATEST)?.updatedAt
        )
        assertEquals("fp-stable-1", cache?.contentFingerprint)
        assertEquals(456L, cache?.savedAtMs)
    }

    @Test
    fun `malformed cache fails closed`() = runBlocking {
        val dao = TestAppSettingDao(
            listOf(AppSettingEntity(AppSettingLocalLearningAnalysisStore.KEY_LATEST, "not-json", 1))
        )
        assertNull(AppSettingLocalLearningAnalysisStore(dao).loadLatest())
    }

    @Test
    fun `cache keeps only the evidence id index needed for reload validation`() = runBlocking {
        val dao = TestAppSettingDao()
        val snapshot = SyncSnapshotPayload(
            subjects = emptyList(),
            weeklyGoals = emptyList(),
            tasks = listOf(
                SyncTaskDto(
                    remoteId = TASK_ID,
                    title = "SECRET_SOURCE_TASK_TITLE",
                    type = 0,
                    priority = 0,
                    status = 0,
                    sortOrder = 0,
                    createdAt = 1,
                    updatedAt = 1
                )
            ),
            studySessions = listOf(
                SyncStudySessionDto(
                    remoteId = SESSION_ID,
                    startTime = 1,
                    endTime = 2,
                    durationSeconds = 1,
                    pauseSeconds = 0,
                    status = 0,
                    createdAt = 1,
                    updatedAt = 1
                )
            )
        )
        val baseline = DeterministicLearningAnalysisGenerator()
            .generate("snapshot-evidence", snapshot)
        val analysis = baseline.copy(
            profile = baseline.profile.copy(
                facts = baseline.profile.facts + SyncLearningFactDto(
                    code = "task.evidence",
                    label = "任务证据",
                    value = JsonPrimitive(1),
                    evidenceRefs = listOf("task:$TASK_ID")
                ),
                inferences = baseline.profile.inferences + SyncLearningInferenceDto(
                    statement = "会话证据可重新核验",
                    confidence = 0.5,
                    evidenceRefs = listOf(SESSION_ID)
                )
            )
        )

        AppSettingLocalLearningAnalysisStore(dao).saveLatest(analysis, snapshot, contentFingerprint = "")

        assertEquals(analysis, AppSettingLocalLearningAnalysisStore(dao).loadLatest())
        val stored = requireNotNull(dao.getSetting(AppSettingLocalLearningAnalysisStore.KEY_LATEST)?.value)
        assertTrue(stored.contains(TASK_ID))
        assertTrue(stored.contains(SESSION_ID))
        assertTrue(!stored.contains("SECRET_SOURCE_TASK_TITLE"))
    }

    private fun emptySnapshot() = SyncSnapshotPayload(
        subjects = emptyList(),
        weeklyGoals = emptyList(),
        tasks = emptyList(),
        studySessions = emptyList()
    )

    companion object {
        private const val TASK_ID = "11111111-1111-4111-8111-111111111111"
        private const val SESSION_ID = "22222222-2222-4222-8222-222222222222"
    }
}
