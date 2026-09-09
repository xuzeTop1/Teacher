package com.hxz.alerttime.app.data.assessment

import com.hxz.alerttime.app.data.local.dao.AppSettingDao
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import com.hxz.alerttime.app.data.sync.SyncLearningAnalysisDto
import com.hxz.alerttime.app.data.sync.SyncLearningInputSummaryDto
import com.hxz.alerttime.app.data.sync.SyncSnapshotPayload
import com.hxz.alerttime.app.data.sync.SyncStudySessionDto
import com.hxz.alerttime.app.data.sync.SyncSubjectDto
import com.hxz.alerttime.app.data.sync.SyncTaskDto
import com.hxz.alerttime.app.data.sync.SyncWeeklyGoalDto
import com.hxz.alerttime.app.data.sync.SyncCodec
import kotlinx.serialization.encodeToString
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** 缓存条目：分析体 + 生成它的输入内容指纹 + 保存时刻（用于同步复用判定）。 */
data class CachedLearningAnalysis(
    val analysis: SyncLearningAnalysisDto,
    val contentFingerprint: String,
    val savedAtMs: Long
)

interface LocalLearningAnalysisStore {
    suspend fun loadLatest(): SyncLearningAnalysisDto?
    suspend fun loadLatestCache(): CachedLearningAnalysis?
    suspend fun saveLatest(
        analysis: SyncLearningAnalysisDto,
        sourceSnapshot: SyncSnapshotPayload,
        contentFingerprint: String
    )
}

@Serializable
private data class StoredLearningAnalysisCache(
    val format: String,
    val version: Int,
    val analysis: SyncLearningAnalysisDto,
    val subjectRemoteIds: List<String> = emptyList(),
    val weeklyGoalRemoteIds: List<String> = emptyList(),
    val taskRemoteIds: List<String> = emptyList(),
    val studySessionRemoteIds: List<String> = emptyList(),
    // 旧版缓存缺少该字段时按空串处理；空串永不匹配任何真实指纹，首次同步会重新生成。
    val contentFingerprint: String = ""
)

/**
 * 保存手机最近一次派生分析，使分析能力不依赖 TeacherAgent 是否在线。
 * 该缓存可由原始计划与学习记录重新生成，因此不进入备份 JSON，也不作为掌握度事实。
 */
class AppSettingLocalLearningAnalysisStore(
    private val appSettingDao: AppSettingDao,
    private val now: () -> Long = { System.currentTimeMillis() }
) : LocalLearningAnalysisStore {
    override suspend fun loadLatest(): SyncLearningAnalysisDto? = loadLatestCache()?.analysis

    override suspend fun loadLatestCache(): CachedLearningAnalysis? {
        val setting = appSettingDao.getSetting(KEY_LATEST) ?: return null
        if (setting.value.toByteArray(Charsets.UTF_8).size > MAX_STORED_BYTES) return null
        return runCatching {
            val cache = codec.decodeFromString(StoredLearningAnalysisCache.serializer(), setting.value)
            validateStored(cache)
            CachedLearningAnalysis(cache.analysis, cache.contentFingerprint, setting.updatedAt)
        }.recoverCatching {
            // 兼容早期只保存 analysis 的派生缓存；无法重建证据索引时安全丢弃并允许重新生成。
            val legacy = codec.decodeFromString(SyncLearningAnalysisDto.serializer(), setting.value)
            validateStored(legacyCache(legacy))
            CachedLearningAnalysis(legacy, contentFingerprint = "", savedAtMs = setting.updatedAt)
        }.getOrNull()
    }

    override suspend fun saveLatest(
        analysis: SyncLearningAnalysisDto,
        sourceSnapshot: SyncSnapshotPayload,
        contentFingerprint: String
    ) {
        val cache = createCache(analysis, sourceSnapshot, contentFingerprint)
        validateStored(cache)
        val value = codec.encodeToString(cache)
        require(value.toByteArray(Charsets.UTF_8).size <= MAX_STORED_BYTES) {
            "学习分析结果过大，未保存"
        }
        appSettingDao.upsert(AppSettingEntity(KEY_LATEST, value, now()))
    }

    /** 缓存只保存被分析引用的 ID 索引与输入指纹，不保存计划正文、会话备注、Provider 或密钥。 */
    private fun createCache(
        analysis: SyncLearningAnalysisDto,
        sourceSnapshot: SyncSnapshotPayload,
        contentFingerprint: String
    ): StoredLearningAnalysisCache {
        val analyzedSnapshot = sourceSnapshot.copy(learningAnalysis = analysis)
        SyncCodec.validateSnapshotForId(analyzedSnapshot, analysis.sourceSnapshotId)
        val sourceSubjects = sourceSnapshot.subjects.map { it.remoteId }.toSet()
        val sourceGoals = sourceSnapshot.weeklyGoals.map { it.remoteId }.toSet()
        val sourceTasks = sourceSnapshot.tasks.map { it.remoteId }.toSet()
        val sourceSessions = sourceSnapshot.studySessions.map { it.remoteId }.toSet()
        val subjectIds = analysis.assessmentDraft.questions.mapNotNull { it.subjectRemoteId }.toMutableSet()
        val taskIds = analysis.assessmentDraft.questions.mapNotNull { it.taskRemoteId }.toMutableSet()
        val goalIds = mutableSetOf<String>()
        val sessionIds = mutableSetOf<String>()
        val evidenceRefs = analysis.profile.facts.flatMap { it.evidenceRefs } +
            analysis.profile.inferences.flatMap { it.evidenceRefs }
        evidenceRefs.forEach { evidenceRef ->
            if (evidenceRef.startsWith("task:")) {
                evidenceRef.removePrefix("task:").takeIf(sourceTasks::contains)?.let(taskIds::add)
            } else {
                if (evidenceRef in sourceSubjects) subjectIds += evidenceRef
                if (evidenceRef in sourceGoals) goalIds += evidenceRef
                if (evidenceRef in sourceTasks) taskIds += evidenceRef
                if (evidenceRef in sourceSessions) sessionIds += evidenceRef
            }
        }
        return StoredLearningAnalysisCache(
            format = CACHE_FORMAT,
            version = CACHE_VERSION,
            analysis = analysis,
            subjectRemoteIds = subjectIds.sorted(),
            weeklyGoalRemoteIds = goalIds.sorted(),
            taskRemoteIds = taskIds.sorted(),
            studySessionRemoteIds = sessionIds.sorted(),
            contentFingerprint = contentFingerprint
        )
    }

    /** 用最小占位集合复用正式协议的结构、ID、长度、外键和证据绑定校验。 */
    private fun validateStored(cache: StoredLearningAnalysisCache) {
        require(cache.format == CACHE_FORMAT && cache.version == CACHE_VERSION)
        cache.analysis.inputSummary?.let { summary ->
            require(summary.source == SyncLearningInputSummaryDto.SOURCE_SAME_ANALYSIS_INPUT_V1)
            require(
                summary.subjectCount >= 0 && summary.weeklyGoalCount >= 0 &&
                    summary.taskCount >= 0 && summary.completedSessionCount >= 0
            )
        }
        val payload = SyncSnapshotPayload(
            subjects = cache.subjectRemoteIds.map { remoteId ->
                SyncSubjectDto(
                    remoteId = remoteId,
                    name = "本地分析引用",
                    createdAt = 0,
                    updatedAt = 0
                )
            },
            weeklyGoals = cache.weeklyGoalRemoteIds.map { remoteId ->
                SyncWeeklyGoalDto(
                    remoteId = remoteId,
                    weekStart = 0,
                    title = "本地分析引用",
                    status = 0,
                    createdAt = 0,
                    updatedAt = 0
                )
            },
            tasks = cache.taskRemoteIds.map { remoteId ->
                SyncTaskDto(
                    remoteId = remoteId,
                    title = "本地分析引用",
                    type = 0,
                    priority = 0,
                    status = 0,
                    sortOrder = 0,
                    createdAt = 0,
                    updatedAt = 0
                )
            },
            studySessions = cache.studySessionRemoteIds.map { remoteId ->
                SyncStudySessionDto(
                    remoteId = remoteId,
                    startTime = 0,
                    endTime = 0,
                    durationSeconds = 0,
                    pauseSeconds = 0,
                    status = 0,
                    createdAt = 0,
                    updatedAt = 0
                )
            },
            // 这里只能用最小引用索引重载缓存，不能把它误当作完整原始快照来校验输入计数。
            // 输入摘要在保存完整快照时已由 SyncCodec 做同快照精确校验；这里仅校验其安全形状。
            learningAnalysis = cache.analysis.copy(inputSummary = null)
        )
        SyncCodec.validateSnapshotForId(payload, cache.analysis.sourceSnapshotId)
    }

    private fun legacyCache(analysis: SyncLearningAnalysisDto): StoredLearningAnalysisCache {
        return StoredLearningAnalysisCache(
            format = CACHE_FORMAT,
            version = CACHE_VERSION,
            analysis = analysis,
            subjectRemoteIds = analysis.assessmentDraft.questions.mapNotNull { it.subjectRemoteId }.distinct(),
            taskRemoteIds = analysis.assessmentDraft.questions.mapNotNull { it.taskRemoteId }.distinct()
        )
    }

    companion object {
        const val KEY_PREFIX = "learning_analysis_runtime_"
        const val KEY_LATEST = "${KEY_PREFIX}latest_v1"
        private const val CACHE_FORMAT = "alerttime-learning-analysis-cache"
        private const val CACHE_VERSION = 1
        private const val MAX_STORED_BYTES = 256 * 1024
        private val codec = Json {
            ignoreUnknownKeys = false
            isLenient = false
            explicitNulls = true
            encodeDefaults = true
            coerceInputValues = false
        }
    }
}
