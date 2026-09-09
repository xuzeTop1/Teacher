package com.hxz.alerttime.app.data.assessment

import com.hxz.alerttime.app.data.sync.DeterministicLearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.LearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.SyncLearningAnalysisDto
import com.hxz.alerttime.app.data.sync.SyncSnapshotPayload
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LearningAnalysisRepositoryTest {
    @Test
    fun `manual generation needs no pairing or desktop and saves latest`() = runBlocking {
        val store = MemoryStore()
        var snapshotsBuilt = 0
        val repository = LearningAnalysisRepository(
            buildSnapshot = {
                snapshotsBuilt += 1
                emptySnapshot()
            },
            analysisGenerator = DeterministicLearningAnalysisGenerator(),
            fallbackGenerator = DeterministicLearningAnalysisGenerator(),
            localStore = store
        )

        val generated = repository.generateNow()

        assertEquals(1, snapshotsBuilt)
        assertEquals(generated, store.latest)
        assertEquals(generated, repository.loadLatest())
        assertTrue(generated.sourceSnapshotId.isNotBlank())
        assertNotNull(generated.assessmentDraft.questions.firstOrNull())
    }

    @Test
    fun `desktop sync prepares a fresh analysis and persists before returning`() = runBlocking {
        val store = MemoryStore()
        val repository = LearningAnalysisRepository(
            buildSnapshot = { emptySnapshot() },
            analysisGenerator = DeterministicLearningAnalysisGenerator(),
            fallbackGenerator = DeterministicLearningAnalysisGenerator(),
            localStore = store
        )

        val prepared = repository.prepareForSync("snapshot-for-later-sync")

        assertEquals("snapshot-for-later-sync", prepared.snapshotId)
        assertEquals("snapshot-for-later-sync", prepared.payload.learningAnalysis?.sourceSnapshotId)
        assertEquals(prepared.payload.learningAnalysis, store.latest)
    }

    @Test
    fun `sync reuses the cached analysis when the input fingerprint is unchanged`() = runBlocking {
        val store = MemoryStore()
        var generatorCalls = 0
        val countingGenerator = object : LearningAnalysisGenerator {
            private val delegate = DeterministicLearningAnalysisGenerator()
            override suspend fun generate(
                snapshotId: String,
                snapshot: SyncSnapshotPayload
            ): SyncLearningAnalysisDto {
                generatorCalls += 1
                return delegate.generate(snapshotId, snapshot)
            }
        }
        val repository = LearningAnalysisRepository(
            buildSnapshot = { emptySnapshot() },
            analysisGenerator = countingGenerator,
            fallbackGenerator = DeterministicLearningAnalysisGenerator(),
            localStore = store
        )

        val first = repository.prepareForSync("snapshot-first")
        val second = repository.prepareForSync("snapshot-second")

        assertEquals(1, generatorCalls)
        // 复用：发送的仍是第一次的 snapshotId 与分析体，第二次冻结的 ID 被丢弃。
        assertEquals("snapshot-first", second.snapshotId)
        assertEquals(first.payload.learningAnalysis, second.payload.learningAnalysis)
        assertEquals(listOf("snapshot-first"), store.savedSnapshotIds)
    }

    @Test
    fun `sync regenerates when snapshot content changes`() = runBlocking {
        val store = MemoryStore()
        var tasks: List<com.hxz.alerttime.app.data.sync.SyncTaskDto> = emptyList()
        val repository = LearningAnalysisRepository(
            buildSnapshot = { emptySnapshot().copy(tasks = tasks) },
            analysisGenerator = DeterministicLearningAnalysisGenerator(),
            fallbackGenerator = DeterministicLearningAnalysisGenerator(),
            localStore = store
        )

        repository.prepareForSync("snapshot-a")
        tasks = listOf(
            com.hxz.alerttime.app.data.sync.SyncTaskDto(
                remoteId = "task-content-changed-0001",
                title = "新增计划",
                type = 1,
                priority = 0,
                status = 0,
                sortOrder = 0,
                createdAt = 1,
                updatedAt = 1
            )
        )
        val second = repository.prepareForSync("snapshot-b")

        assertEquals("snapshot-b", second.snapshotId)
        assertEquals(listOf("snapshot-a", "snapshot-b"), store.savedSnapshotIds)
    }

    @Test
    fun `manual generation always regenerates even with a fresh cache`() = runBlocking {
        val store = MemoryStore()
        var generatorCalls = 0
        val countingGenerator = object : LearningAnalysisGenerator {
            private val delegate = DeterministicLearningAnalysisGenerator()
            override suspend fun generate(
                snapshotId: String,
                snapshot: SyncSnapshotPayload
            ): SyncLearningAnalysisDto {
                generatorCalls += 1
                return delegate.generate(snapshotId, snapshot)
            }
        }
        val repository = LearningAnalysisRepository(
            buildSnapshot = { emptySnapshot() },
            analysisGenerator = countingGenerator,
            fallbackGenerator = DeterministicLearningAnalysisGenerator(),
            localStore = store
        )

        repository.prepareForSync("snapshot-synced")
        repository.generateNow()

        assertEquals(2, generatorCalls)
    }

    @Test
    fun `manual generation and later sync serialize across repository instances`() = runBlocking {
        val firstBuildStarted = CompletableDeferred<Unit>()
        val releaseFirstBuild = CompletableDeferred<Unit>()
        val secondBuildStarted = CompletableDeferred<Unit>()
        val store = MemoryStore()
        val manualRepository = LearningAnalysisRepository(
            buildSnapshot = {
                firstBuildStarted.complete(Unit)
                releaseFirstBuild.await()
                emptySnapshot()
            },
            analysisGenerator = DeterministicLearningAnalysisGenerator(),
            fallbackGenerator = DeterministicLearningAnalysisGenerator(),
            localStore = store
        )
        val syncRepository = LearningAnalysisRepository(
            buildSnapshot = {
                secondBuildStarted.complete(Unit)
                emptySnapshot()
            },
            analysisGenerator = DeterministicLearningAnalysisGenerator(),
            fallbackGenerator = DeterministicLearningAnalysisGenerator(),
            localStore = store
        )

        val manual = async(start = CoroutineStart.UNDISPATCHED) { manualRepository.generateNow() }
        firstBuildStarted.await()
        val sync = async(start = CoroutineStart.UNDISPATCHED) {
            syncRepository.prepareForSync("snapshot-after-manual")
        }

        assertFalse(secondBuildStarted.isCompleted)
        releaseFirstBuild.complete(Unit)
        val manualAnalysis = manual.await()
        val preparedSync = sync.await()

        // 手动生成与同步输入完全一致（空快照 + 同一上下文与日窗口）：同步复用
        // 手动结果，不再落库、不再调用生成器。互斥锁保证两者不并发覆盖缓存。
        assertEquals(manualAnalysis.sourceSnapshotId, preparedSync.snapshotId)
        assertEquals(listOf(manualAnalysis.sourceSnapshotId), store.savedSnapshotIds)
        assertEquals(manualAnalysis, store.latest)
    }

    private class MemoryStore : LocalLearningAnalysisStore {
        var latest: SyncLearningAnalysisDto? = null
        var latestFingerprint: String = ""
        val savedSnapshotIds = mutableListOf<String>()
        override suspend fun loadLatest(): SyncLearningAnalysisDto? = latest
        override suspend fun loadLatestCache(): CachedLearningAnalysis? =
            latest?.let { CachedLearningAnalysis(it, latestFingerprint, System.currentTimeMillis()) }
        override suspend fun saveLatest(
            analysis: SyncLearningAnalysisDto,
            sourceSnapshot: SyncSnapshotPayload,
            contentFingerprint: String
        ) {
            savedSnapshotIds += analysis.sourceSnapshotId
            latest = analysis
            latestFingerprint = contentFingerprint
        }
    }

    private fun emptySnapshot() = SyncSnapshotPayload(
        subjects = emptyList(),
        weeklyGoals = emptyList(),
        tasks = emptyList(),
        studySessions = emptyList()
    )
}
