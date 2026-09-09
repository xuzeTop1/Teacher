package com.hxz.alerttime.app.ui.sync

import com.hxz.alerttime.app.data.sync.SyncCoordinator

internal fun formatSyncSuccessMessage(outcome: SyncCoordinator.SyncOutcome): String {
    val score = outcome.planScore?.let { "，计划评分 ${it.toInt()} 分" }.orEmpty()
    val proposals = if (outcome.proposalsReceived > 0) "；收到 ${outcome.proposalsReceived} 条 Teacher 建议" else ""
    val pendingDecisions = if (outcome.decisionsPending > 0) {
        "；${outcome.decisionsPending} 条建议处理结果未送达，已保留并将在下次同步重试"
    } else {
        ""
    }
    return "同步完成：科目 ${outcome.subjects}、周目标 ${outcome.weeklyGoals}、计划 ${outcome.tasks}、" +
        "会话 ${outcome.studySessions}。计划评估：${planVerdictLabel(outcome.planVerdict)}$score，" +
        "生成 ${outcome.assessmentQuestionCount} 道评估草稿题${proposals}${pendingDecisions}"
}

internal fun planVerdictLabel(verdict: String): String = when (verdict) {
    "reasonable" -> "安排基本合理"
    "needs_adjustment" -> "建议调整"
    "insufficient_data" -> "数据不足"
    else -> "待确认"
}
