package com.hxz.alerttime.app.data.assessment

import com.hxz.alerttime.app.data.local.dao.AppSettingDao
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import com.hxz.alerttime.app.data.sync.SyncCodec
import java.time.LocalDate

/**
 * 用户主动填写的学习场景。所有字段默认留空，应用不得内嵌考试、科目或目标日期。
 * 这些内容仅在用户主动生成学习分析或同步时进入其自行配置的 Provider Prompt。
 */
data class LearnerContext(
    val purpose: String = "",
    val examName: String = "",
    val focusSubjects: List<String> = emptyList(),
    val targetDate: String = ""
) {
    fun isEmpty(): Boolean =
        purpose.isBlank() && examName.isBlank() && focusSubjects.isEmpty() && targetDate.isBlank()
}

interface LearnerContextStore {
    suspend fun load(): LearnerContext
}

object EmptyLearnerContextStore : LearnerContextStore {
    override suspend fun load(): LearnerContext = LearnerContext()
}

/** 普通用户设置，可随备份迁移；不包含 Provider 地址、模型或 API Key。 */
class AppSettingLearnerContextStore(
    private val appSettingDao: AppSettingDao
) : LearnerContextStore {
    override suspend fun load(): LearnerContext {
        val values = appSettingDao.exportAll().associateBy { it.key }
        return LearnerContext(
            purpose = values[KEY_PURPOSE]?.value.orEmpty(),
            examName = values[KEY_EXAM_NAME]?.value.orEmpty(),
            focusSubjects = SyncCodec.decodeStringList(values[KEY_FOCUS_SUBJECTS]?.value)
                .map(String::trim)
                .filter(String::isNotEmpty)
                .distinct()
                .take(MAX_SUBJECTS),
            targetDate = values[KEY_TARGET_DATE]?.value.orEmpty()
        ).normalized().also(::validate)
    }

    suspend fun save(
        purpose: String,
        examName: String,
        focusSubjects: List<String>,
        targetDate: String,
        nowMs: Long = System.currentTimeMillis()
    ): LearnerContext {
        val normalized = LearnerContext(
            purpose = purpose,
            examName = examName,
            focusSubjects = focusSubjects,
            targetDate = targetDate
        ).normalized()
        validate(normalized)
        appSettingDao.upsertAll(
            listOf(
                AppSettingEntity(KEY_PURPOSE, normalized.purpose, nowMs),
                AppSettingEntity(KEY_EXAM_NAME, normalized.examName, nowMs),
                AppSettingEntity(
                    KEY_FOCUS_SUBJECTS,
                    SyncCodec.encodeStringList(normalized.focusSubjects),
                    nowMs
                ),
                AppSettingEntity(KEY_TARGET_DATE, normalized.targetDate, nowMs)
            )
        )
        return normalized
    }

    private fun LearnerContext.normalized(): LearnerContext = copy(
        purpose = purpose.trim(),
        examName = examName.trim(),
        focusSubjects = focusSubjects
            .map(String::trim)
            .filter(String::isNotEmpty)
            .distinct(),
        targetDate = targetDate.trim()
    )

    private fun validate(context: LearnerContext) {
        require(context.purpose.length <= MAX_CONTEXT_TEXT) { "学习目的不能超过 $MAX_CONTEXT_TEXT 个字符" }
        require(context.examName.length <= MAX_CONTEXT_TEXT) { "考试名称不能超过 $MAX_CONTEXT_TEXT 个字符" }
        require(context.focusSubjects.size <= MAX_SUBJECTS) { "考试科目不能超过 $MAX_SUBJECTS 项" }
        require(context.focusSubjects.all { it.length <= MAX_SUBJECT_TEXT }) {
            "每个考试科目不能超过 $MAX_SUBJECT_TEXT 个字符"
        }
        if (context.targetDate.isNotEmpty()) {
            require(runCatching { LocalDate.parse(context.targetDate) }.isSuccess) {
                "目标日期应为 YYYY-MM-DD"
            }
        }
    }

    companion object {
        const val KEY_PURPOSE = "learner_context_purpose_v1"
        const val KEY_EXAM_NAME = "learner_context_exam_name_v1"
        const val KEY_FOCUS_SUBJECTS = "learner_context_focus_subjects_v1"
        const val KEY_TARGET_DATE = "learner_context_target_date_v1"
        const val MAX_CONTEXT_TEXT = 200
        const val MAX_SUBJECT_TEXT = 100
        const val MAX_SUBJECTS = 20
    }
}
