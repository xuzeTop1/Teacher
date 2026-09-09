package com.hxz.alerttime.app.ui.plan.components

import com.hxz.alerttime.app.data.repository.PlanRepository
import com.hxz.alerttime.app.ui.plan.PlanTaskUi
import com.hxz.alerttime.app.core.time.todayBounds
import java.text.SimpleDateFormat
import java.util.Locale

internal fun formatPlanDuration(seconds: Long): String {
    val hours = seconds / 3600.0
    return if (hours % 1.0 == 0.0) {
        "${hours.toInt()}小时"
    } else {
        "%.1f小时".format(Locale.US, hours)
    }
}

internal fun taskTitleLooksLikeDuration(title: String): Boolean {
    return parsePlanDurationSeconds(title) != null
}

internal fun parsePlanDurationSeconds(text: String): Long? {
    val compact = text.replace(" ", "")
    val hourMatch = Regex("""^(\d+(?:\.\d+)?)(?:小时|时|h|H)$""").find(compact)
    if (hourMatch != null) {
        return ((hourMatch.groupValues[1].toDoubleOrNull() ?: return null) * 3600).toLong()
    }
    val minuteMatch = Regex("""^(\d+(?:\.\d+)?)(?:分钟|分|m|M)$""").find(compact)
    if (minuteMatch != null) {
        return ((minuteMatch.groupValues[1].toDoubleOrNull() ?: return null) * 60).toLong()
    }
    return null
}

internal fun formatTaskPrimaryText(task: PlanTaskUi, subjectName: String?): String {
    val durationSeconds = task.targetDurationSeconds ?: parsePlanDurationSeconds(task.title)
    return if (!subjectName.isNullOrBlank() && durationSeconds != null && taskTitleLooksLikeDuration(task.title)) {
        "$subjectName ${formatPlanDuration(durationSeconds)}"
    } else {
        task.title
    }
}

internal fun formatPlanDateHeader(dateMillis: Long): String {
    if (dateMillis == 0L) return "未安排日期"
    val formatter = SimpleDateFormat("M月d日 E", Locale.CHINA)
    return formatter.format(dateMillis)
}

internal fun filterTasks(tasks: List<PlanTaskUi>, filter: PlanFilter): List<PlanTaskUi> {
    val todayStart = PlanRepository.startOfDay(System.currentTimeMillis())
    val tomorrowStart = todayBounds().endExclusive
    return when (filter) {
        PlanFilter.All -> tasks
        PlanFilter.Today -> tasks.filter { task ->
            val dueAt = task.dueAt
            dueAt == null || (dueAt >= todayStart && dueAt < tomorrowStart)
        }
        PlanFilter.Future -> tasks.filter { task ->
            val dueAt = task.dueAt
            dueAt != null && dueAt >= tomorrowStart
        }
        PlanFilter.Pending -> tasks.filter { task ->
            task.status == PlanRepository.STATUS_TODO &&
                (task.dueAt == null || (task.dueAt >= todayStart && task.dueAt < tomorrowStart))
        }
        PlanFilter.Overdue -> tasks.filter { task ->
            task.status == PlanRepository.STATUS_TODO &&
                task.dueAt != null && task.dueAt < todayStart
        }
        PlanFilter.Done -> tasks.filter { task ->
            task.status == PlanRepository.STATUS_DONE
        }
    }
}

enum class PlanFilter(val label: String) {
    All("全部"),
    Today("今天"),
    Future("未来"),
    Pending("待完成"),
    Overdue("逾期"),
    Done("已完成")
}
