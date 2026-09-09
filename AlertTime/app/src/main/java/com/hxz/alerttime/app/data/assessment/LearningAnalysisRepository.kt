package com.hxz.alerttime.app.data.assessment

import com.hxz.alerttime.app.data.sync.LearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.SyncLearningAnalysisDto
import com.hxz.alerttime.app.data.sync.SyncSnapshotBuilder
import com.hxz.alerttime.app.data.sync.SyncSnapshotPayload
import com.hxz.alerttime.app.data.sync.prepareAnalyzedSnapshot
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.ZoneId

/**
 * 手机端学习分析用例：可独立生成并本地保存，也可为一次稍后的桌面同步准备新分析。
 * 不依赖配对状态，不访问 TeacherAgent，不引入云端数据库。
 *
 * 同步路径（[prepareForSync]）带内容指纹复用：当快照内容、学习上下文与日/周
 * 窗口全部未变且缓存未过期时，直接复用上一次的「快照 ID + 分析」原样重发，
 * 桌面端按 snapshotId 幂等处理——同步不再等待模型服务。手动生成
 * （[generateNow]）是用户显式动作，永远重新生成。
 */
class LearningAnalysisRepository(
    private val buildSnapshot: suspend () -> SyncSnapshotPayload,
    private val analysisGenerator: LearningAnalysisGenerator,
    private val fallbackGenerator: LearningAnalysisGenerator,
    private val localStore: LocalLearningAnalysisStore,
    private val learnerContextStore: LearnerContextStore = EmptyLearnerContextStore,
    private val now: () -> Long = { System.currentTimeMillis() },
    private val zoneId: ZoneId = ZoneId.systemDefault()
) {
    /** 准备结果：实际要发送的 snapshotId（复用时是旧的）与对应 payload。 */
    data class PreparedSyncSnapshot(val snapshotId: String, val payload: SyncSnapshotPayload)

    suspend fun generateNow(): SyncLearningAnalysisDto = operationMutex.withLock {
        val snapshotId = SyncSnapshotBuilder.newUuid()
        requireNotNull(buildAndSave(snapshotId, reuseCached = false).payload.learningAnalysis)
    }

    suspend fun prepareForSync(snapshotId: String): PreparedSyncSnapshot =
        operationMutex.withLock { buildAndSave(snapshotId, reuseCached = true) }

    suspend fun loadLatest(): SyncLearningAnalysisDto? = localStore.loadLatest()

    private suspend fun buildAndSave(snapshotId: String, reuseCached: Boolean): PreparedSyncSnapshot {
        val basePayload = buildSnapshot().copy(learningAnalysis = null)
        val fingerprint = LearningAnalysisInputFingerprint.of(
            snapshot = basePayload,
            context = learnerContextStore.load(),
            nowMs = now(),
            zoneId = zoneId
        )
        if (reuseCached && fingerprint.isNotEmpty()) {
            val cached = localStore.loadLatestCache()
            if (cached != null && cached.contentFingerprint == fingerprint &&
                now() - cached.savedAtMs <= ANALYSIS_REUSE_MAX_AGE_MS
            ) {
                // 输入完全一致：复用原 snapshotId 与原分析体（草稿题 ID 由
                // snapshotId 派生，不可换绑）。payload 内容与生成该分析时逐字段
                // 相同，inputSummary 计数与证据绑定仍然成立。
                return PreparedSyncSnapshot(
                    snapshotId = cached.analysis.sourceSnapshotId,
                    payload = basePayload.copy(learningAnalysis = cached.analysis)
                )
            }
        }
        val analyzed = prepareAnalyzedSnapshot(
            snapshotId = snapshotId,
            buildSnapshot = { basePayload },
            analysisGenerator = analysisGenerator,
            fallbackGenerator = fallbackGenerator
        )
        localStore.saveLatest(
            requireNotNull(analyzed.learningAnalysis),
            analyzed,
            fingerprint
        )
        return PreparedSyncSnapshot(snapshotId, analyzed)
    }

    companion object {
        /**
         * 复用上限。日/周窗口与内容已在指纹内，TTL 只兜底时钟回拨与极陈旧缓存；
         * 6 小时覆盖「同一天内连续同步」这一主要收益场景。
         */
        const val ANALYSIS_REUSE_MAX_AGE_MS = 6L * 60 * 60 * 1000

        /** 同一进程中独立生成与局域网同步不得并发覆盖“最近分析”。 */
        val operationMutex = Mutex()
    }
}
