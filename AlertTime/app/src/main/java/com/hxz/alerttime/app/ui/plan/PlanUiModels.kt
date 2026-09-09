package com.hxz.alerttime.app.ui.plan

data class PlanTaskUi(
    val id: Long,
    val subjectId: Long?,
    val subjectName: String,
    val title: String,
    val content: String?,
    val status: Int,
    val targetDurationSeconds: Long?,
    val dueAt: Long?
)

data class PlanSubjectUi(
    val id: Long,
    val name: String,
    val canDelete: Boolean
)

data class WeeklyGoalUi(
    val id: Long,
    val weekStart: Long,
    val title: String,
    val successCriteria: String?,
    val status: Int,
    val deferredToWeekStart: Long?,
    val exceptionReason: String?
)
