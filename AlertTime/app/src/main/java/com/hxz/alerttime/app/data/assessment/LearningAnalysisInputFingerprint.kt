package com.hxz.alerttime.app.data.assessment

import com.hxz.alerttime.app.data.sync.SyncSnapshotPayload
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import java.security.MessageDigest
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

/**
 * 学习分析「输入内容指纹」：把一次分析的全部决定因素压成一个稳定摘要，用于判断
 * 同步时能否复用上一次的「快照 ID + 分析」而不再调用模型。
 *
 * 覆盖范围：
 *  1. 快照内容（去掉 learningAnalysis 后的完整 payload 序列化）——科目/目标/
 *     计划/会话任一字段变化都会改变指纹；
 *  2. 学习上下文（purpose/exam/focusSubjects/targetDate）——用户改了设置需重算；
 *  3. 日窗口与周窗口（本地时区的今天与本周一起始日）——确定性生成器的今日/本周
 *     facts 依赖当前日期，跨天或跨周必须失效。
 *
 * 不覆盖：Provider 地址/模型/密钥（属敏感信息且不影响分析语义）、快照 ID 本身
 * （复用时刻意保留旧 ID）。指纹为空串表示不可复用（安全默认）。
 */
internal object LearningAnalysisInputFingerprint {
    private val codec = Json {
        encodeDefaults = true
        explicitNulls = true
        ignoreUnknownKeys = false
    }

    fun of(
        snapshot: SyncSnapshotPayload,
        context: LearnerContext,
        nowMs: Long,
        zoneId: ZoneId
    ): String = try {
        val today = Instant.ofEpochMilli(nowMs).atZone(zoneId).toLocalDate()
        val weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        val canonical = buildString {
            append(codec.encodeToString(snapshot.copy(learningAnalysis = null)))
            append('\u0000').append(context.purpose.trim())
            append('\u0000').append(context.examName.trim())
            append('\u0000').append(context.focusSubjects.map { it.trim() }.sorted().joinToString(","))
            append('\u0000').append(context.targetDate.trim())
            append('\u0000').append(today.toString())
            append('\u0000').append(weekStart.toString())
        }
        MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    } catch (_: Exception) {
        // 任何异常（缺 SHA-256、序列化失败）都退化为「不复用」，由调用方重新生成。
        ""
    }
}
