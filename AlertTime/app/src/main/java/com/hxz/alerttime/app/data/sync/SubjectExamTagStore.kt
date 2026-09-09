package com.hxz.alerttime.app.data.sync

import com.hxz.alerttime.app.data.local.dao.AppSettingDao
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * 科目「考试体系标签」（可选）：用户可给手机端科目声明 examTrackId / examSubjectId / examModuleId，
 * 随同步快照的 subject 可选字段上报。只用于 TeacherAgent 展示与映射建议，不是权威映射。
 *
 * 存储位置：AppSetting（非敏感、非 sync_ 前缀，因此可随备份保留）；
 * 不改 Room schema（遵守 docs/decisions/2026-08-03-alerttime-lan-sync.md：本阶段不改 Room schema）。
 * 默认没有任何标签 → 协议行为与旧版完全一致（字段为 null）。
 */
@Serializable
data class SubjectExamTag(
    @SerialName("examTrackId") val examTrackId: String,
    @SerialName("examSubjectId") val examSubjectId: String,
    @SerialName("examModuleId") val examModuleId: String? = null
)

class SubjectExamTagStore(private val appSettingDao: AppSettingDao) {

    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        private const val KEY_PREFIX = "exam_tag_"

        fun keyFor(remoteId: String): String = "$KEY_PREFIX$remoteId"
    }

    suspend fun get(remoteId: String): SubjectExamTag? {
        val setting = appSettingDao.getSetting(keyFor(remoteId)) ?: return null
        return runCatching { json.decodeFromString<SubjectExamTag>(setting.value) }
            .getOrNull()
    }

    suspend fun save(remoteId: String, tag: SubjectExamTag) {
        val setting = AppSettingEntity(
            key = keyFor(remoteId),
            value = json.encodeToString(SubjectExamTag.serializer(), tag),
            updatedAt = System.currentTimeMillis()
        )
        appSettingDao.upsert(setting)
    }

    suspend fun clear(remoteId: String) {
        appSettingDao.delete(keyFor(remoteId))
    }

    /** 全部标签（快照构建用）：remoteId → tag。 */
    suspend fun all(): Map<String, SubjectExamTag> {
        val result = mutableMapOf<String, SubjectExamTag>()
        for (setting in appSettingDao.exportAll()) {
            if (!setting.key.startsWith(KEY_PREFIX)) continue
            val remoteId = setting.key.removePrefix(KEY_PREFIX)
            val tag = runCatching { json.decodeFromString<SubjectExamTag>(setting.value) }.getOrNull()
            if (tag != null) result[remoteId] = tag
        }
        return result
    }
}
