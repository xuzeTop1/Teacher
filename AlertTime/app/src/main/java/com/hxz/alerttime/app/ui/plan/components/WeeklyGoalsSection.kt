package com.hxz.alerttime.app.ui.plan.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.hxz.alerttime.app.data.repository.PlanRepository
import com.hxz.alerttime.app.ui.plan.WeeklyGoalUi
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun WeeklyGoalsSection(
    currentGoals: List<WeeklyGoalUi>,
    nextGoals: List<WeeklyGoalUi>,
    restDays: Set<Int>,
    isRestDay: Boolean,
    currentWeekStart: Long,
    nextWeekStart: Long,
    isSavingGoal: Boolean,
    onAddWeeklyGoal: (Long, String, String?, () -> Unit) -> Unit,
    onSetRestDays: (Set<Int>) -> Unit,
    onSetCompleted: (WeeklyGoalUi, Boolean) -> Unit,
    onDefer: (WeeklyGoalUi, String) -> Unit,
    onCancel: (WeeklyGoalUi, String) -> Unit,
    modifier: Modifier = Modifier
) {
    var showAddDialog by remember { mutableStateOf(false) }
    var showRestDayDialog by remember { mutableStateOf(false) }
    var exceptionRequest by remember { mutableStateOf<GoalExceptionRequest?>(null) }
    var expanded by remember {
        mutableStateOf(isRestDay || currentGoals.isNotEmpty() || nextGoals.isNotEmpty())
    }

    ElevatedCard(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.elevatedCardColors(
            containerColor = if (isRestDay) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceContainerLow
            }
        ),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = 0.dp)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    Text(
                        text = if (isRestDay) "休息日 · 回顾与规划" else "周目标",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = if (isRestDay) {
                            "补充本周成果，或提前规定下周目标。"
                        } else {
                            "自由安排每天，只对一周最终成果负责。"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { showRestDayDialog = true }) {
                        Icon(Icons.Outlined.Tune, contentDescription = null)
                        Text("休息日")
                    }
                    IconButton(onClick = { expanded = !expanded }) {
                        Icon(
                            imageVector = if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                            contentDescription = if (expanded) "收起周目标" else "展开周目标"
                        )
                    }
                }
            }

            if (expanded) {
                GoalGroup(
                    title = "本周要完成",
                    goals = currentGoals,
                    emptyText = "本周还没有设定周目标",
                    onSetCompleted = onSetCompleted,
                    onRequestDefer = { exceptionRequest = GoalExceptionRequest(it, GoalExceptionAction.Defer) },
                    onRequestCancel = { exceptionRequest = GoalExceptionRequest(it, GoalExceptionAction.Cancel) }
                )

                if (nextGoals.isNotEmpty()) {
                    GoalGroup(
                        title = "下周已规定 · ${formatWeekRange(nextWeekStart)}",
                        goals = nextGoals,
                        emptyText = "",
                        onSetCompleted = onSetCompleted,
                        onRequestDefer = { exceptionRequest = GoalExceptionRequest(it, GoalExceptionAction.Defer) },
                        onRequestCancel = { exceptionRequest = GoalExceptionRequest(it, GoalExceptionAction.Cancel) }
                    )
                }

                Button(
                    onClick = { showAddDialog = true },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Icon(Icons.Outlined.EventAvailable, contentDescription = null)
                    Text(
                        text = "添加周目标",
                        modifier = Modifier.padding(start = 8.dp)
                    )
                }
            } else {
                Text(
                    text = "本周 ${currentGoals.size} 项 · 下周 ${nextGoals.size} 项",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }

    if (showAddDialog) {
        AddWeeklyGoalDialog(
            currentWeekStart = currentWeekStart,
            nextWeekStart = nextWeekStart,
            isSaving = isSavingGoal,
            onDismiss = { showAddDialog = false },
            onConfirm = { weekStart, title, criteria ->
                onAddWeeklyGoal(weekStart, title, criteria) {
                    showAddDialog = false
                }
            }
        )
    }

    if (showRestDayDialog) {
        RestDaysDialog(
            selectedDays = restDays,
            onDismiss = { showRestDayDialog = false },
            onConfirm = { days ->
                onSetRestDays(days)
                showRestDayDialog = false
            }
        )
    }

    exceptionRequest?.let { request ->
        WeeklyGoalExceptionDialog(
            action = request.action,
            goalTitle = request.goal.title,
            onDismiss = { exceptionRequest = null },
            onConfirm = { reason ->
                when (request.action) {
                    GoalExceptionAction.Defer -> onDefer(request.goal, reason)
                    GoalExceptionAction.Cancel -> onCancel(request.goal, reason)
                }
                exceptionRequest = null
            }
        )
    }
}

@Composable
private fun GoalGroup(
    title: String,
    goals: List<WeeklyGoalUi>,
    emptyText: String,
    onSetCompleted: (WeeklyGoalUi, Boolean) -> Unit,
    onRequestDefer: (WeeklyGoalUi) -> Unit,
    onRequestCancel: (WeeklyGoalUi) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary
        )
        if (goals.isEmpty()) {
            Text(
                text = emptyText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        } else {
            goals.forEach { goal ->
                WeeklyGoalItem(
                    goal = goal,
                    onSetCompleted = onSetCompleted,
                    onRequestDefer = onRequestDefer,
                    onRequestCancel = onRequestCancel
                )
            }
        }
    }
}

@Composable
private fun WeeklyGoalItem(
    goal: WeeklyGoalUi,
    onSetCompleted: (WeeklyGoalUi, Boolean) -> Unit,
    onRequestDefer: (WeeklyGoalUi) -> Unit,
    onRequestCancel: (WeeklyGoalUi) -> Unit
) {
    val isDone = goal.status == PlanRepository.WEEKLY_GOAL_DONE
    val isPending = goal.status == PlanRepository.WEEKLY_GOAL_TODO
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.72f)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = goal.title,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    textDecoration = if (isDone) TextDecoration.LineThrough else null
                )
                AssistChip(
                    onClick = {},
                    label = { Text(goalStatusText(goal.status)) }
                )
            }
            goal.successCriteria?.let {
                Text(
                    text = "完成标准：$it",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            goal.exceptionReason?.let {
                Text(
                    text = "特殊情况：$it",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                when {
                    isPending -> {
                        TextButton(onClick = { onSetCompleted(goal, true) }) { Text("完成") }
                        TextButton(onClick = { onRequestDefer(goal) }) { Text("延期") }
                        TextButton(onClick = { onRequestCancel(goal) }) { Text("取消") }
                    }
                    isDone -> {
                        TextButton(onClick = { onSetCompleted(goal, false) }) { Text("撤销完成") }
                    }
                }
            }
        }
    }
}

@Composable
private fun AddWeeklyGoalDialog(
    currentWeekStart: Long,
    nextWeekStart: Long,
    isSaving: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (Long, String, String?) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var successCriteria by remember { mutableStateOf("") }
    var selectedWeekStart by remember(currentWeekStart, nextWeekStart) {
        mutableLongStateOf(currentWeekStart)
    }
    val isCurrentWeek = selectedWeekStart == currentWeekStart
    AlertDialog(
        onDismissRequest = {
            if (!isSaving) onDismiss()
        },
        shape = MaterialTheme.shapes.large,
        title = { Text("添加周目标", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "目标周期",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FilterChip(
                        selected = isCurrentWeek,
                        onClick = { selectedWeekStart = currentWeekStart },
                        label = { Text("本周") },
                        modifier = Modifier.weight(1f)
                    )
                    FilterChip(
                        selected = !isCurrentWeek,
                        onClick = { selectedWeekStart = nextWeekStart },
                        label = { Text("下周") },
                        modifier = Modifier.weight(1f)
                    )
                }
                Text(
                    text = formatWeekRange(selectedWeekStart),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary
                )
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it.take(120) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(if (isCurrentWeek) "本周要完成什么" else "下周要完成什么") },
                    placeholder = { Text("例如：完成高数第五章") },
                    singleLine = true
                )
                OutlinedTextField(
                    value = successCriteria,
                    onValueChange = { successCriteria = it.take(500) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("怎样才算完成（可选）") },
                    placeholder = { Text("例如：完成课程并独立做完课后习题") },
                    minLines = 2,
                    maxLines = 4
                )
                Text(
                    text = if (isCurrentWeek) {
                        "可以补录本周目标，不需要分配到具体某一天。"
                    } else {
                        "提前规划下周成果，下周内自由安排。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = title.isNotBlank() && !isSaving,
                onClick = {
                    onConfirm(
                        selectedWeekStart,
                        title.trim(),
                        successCriteria.trim().ifBlank { null }
                    )
                }
            ) {
                Text(
                    if (isSaving) "保存中…" else "添加目标",
                    fontWeight = FontWeight.SemiBold
                )
            }
        },
        dismissButton = {
            TextButton(enabled = !isSaving, onClick = onDismiss) { Text("取消") }
        }
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RestDaysDialog(
    selectedDays: Set<Int>,
    onDismiss: () -> Unit,
    onConfirm: (Set<Int>) -> Unit
) {
    var selection by remember(selectedDays) { mutableStateOf(selectedDays) }
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = MaterialTheme.shapes.large,
        title = { Text("每周休息日", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "休息日不要求停止学习，而是提醒你复盘本周；你仍可补录本周目标，也可规划下周成果。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    WEEK_DAYS.forEach { (value, label) ->
                        FilterChip(
                            selected = value in selection,
                            onClick = {
                                selection = if (value in selection) {
                                    selection - value
                                } else {
                                    selection + value
                                }
                            },
                            label = { Text(label) }
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = selection.isNotEmpty(),
                onClick = { onConfirm(selection) }
            ) {
                Text("保存", fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}

@Composable
private fun WeeklyGoalExceptionDialog(
    action: GoalExceptionAction,
    goalTitle: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var reason by remember { mutableStateOf("") }
    val actionText = if (action == GoalExceptionAction.Defer) "延期" else "取消"
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = MaterialTheme.shapes.large,
        title = { Text("${actionText}周目标", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(goalTitle, style = MaterialTheme.typography.bodyLarge)
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("特殊情况或原因") },
                    placeholder = { Text("例如：临时考试、生病或计划调整") },
                    minLines = 2,
                    maxLines = 4
                )
                if (action == GoalExceptionAction.Defer) {
                    Text(
                        text = "原目标会保留延期记录，并在下一周生成新的进行中目标。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = reason.isNotBlank(),
                onClick = { onConfirm(reason) }
            ) {
                Text("确认$actionText", fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("返回") } }
    )
}

private fun goalStatusText(status: Int): String {
    return when (status) {
        PlanRepository.WEEKLY_GOAL_DONE -> "已完成"
        PlanRepository.WEEKLY_GOAL_DEFERRED -> "已延期"
        PlanRepository.WEEKLY_GOAL_CANCELED -> "已取消"
        else -> "进行中"
    }
}

private fun formatWeekRange(weekStart: Long): String {
    val zoneId = ZoneId.systemDefault()
    val start = Instant.ofEpochMilli(weekStart).atZone(zoneId).toLocalDate()
    val end = start.plusDays(6)
    val formatter = DateTimeFormatter.ofPattern("M月d日", Locale.CHINA)
    return "${start.format(formatter)}—${end.format(formatter)}"
}

private data class GoalExceptionRequest(
    val goal: WeeklyGoalUi,
    val action: GoalExceptionAction
)

private enum class GoalExceptionAction {
    Defer,
    Cancel
}

private val WEEK_DAYS = listOf(
    1 to "一",
    2 to "二",
    3 to "三",
    4 to "四",
    5 to "五",
    6 to "六",
    7 to "日"
)
