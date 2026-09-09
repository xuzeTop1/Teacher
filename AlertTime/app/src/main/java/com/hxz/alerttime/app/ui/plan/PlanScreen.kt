package com.hxz.alerttime.app.ui.plan

import android.content.Context
import android.content.Intent
import android.provider.CalendarContract
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.repository.PlanRepository
import com.hxz.alerttime.app.ui.components.AppPageHeader
import com.hxz.alerttime.app.ui.plan.components.AddPlanDialog
import com.hxz.alerttime.app.ui.plan.components.EmptyPlanState
import com.hxz.alerttime.app.ui.plan.components.PlanFilter
import com.hxz.alerttime.app.ui.plan.components.SubjectManageDialog
import com.hxz.alerttime.app.ui.plan.components.TaskListItem
import com.hxz.alerttime.app.ui.plan.components.WeeklyGoalsSection
import com.hxz.alerttime.app.ui.plan.components.filterTasks
import com.hxz.alerttime.app.ui.plan.components.formatPlanDateHeader
import com.hxz.alerttime.app.ui.plan.components.formatPlanDuration
import com.hxz.alerttime.app.ui.plan.components.formatTaskPrimaryText
import com.hxz.alerttime.app.ui.plan.components.taskTitleLooksLikeDuration
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId

@Composable
fun PlanScreen(
    database: AlertTimeDatabase,
    modifier: Modifier = Modifier,
    activeTaskId: Long? = null,
    hasActiveTimer: Boolean = false,
    activeTaskProgressSeconds: Long = 0,
    onStartTask: (PlanTaskUi) -> Unit = {},
    viewModel: PlanViewModel = viewModel(factory = PlanViewModel.Factory(database))
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()
    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    var showSubjectDialog by rememberSaveable { mutableStateOf(false) }
    var editingTask by remember { mutableStateOf<PlanTaskUi?>(null) }
    var deletingTask by remember { mutableStateOf<PlanTaskUi?>(null) }
    var selectedFilter by rememberSaveable { mutableStateOf(PlanFilter.Today) }
    var exportMenuExpanded by remember { mutableStateOf(false) }
    val visibleTasks = remember(uiState.tasks, selectedFilter) {
        filterTasks(uiState.tasks, selectedFilter)
    }
    val todayTasks = remember(uiState.tasks) {
        filterTasks(uiState.tasks, PlanFilter.Today)
    }

    LaunchedEffect(uiState.errorMessage) {
        val message = uiState.errorMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        viewModel.clearError()
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 20.dp)
                .padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            AppPageHeader(
                title = "计划",
                subtitle = "安排要完成的事，选择一项开始投入。"
            ) {
                Box {
                    TextButton(
                        onClick = { exportMenuExpanded = true },
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Share,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Text("导出")
                    }
                    DropdownMenu(
                        expanded = exportMenuExpanded,
                        onDismissRequest = { exportMenuExpanded = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("导出当天计划为图片") },
                            onClick = {
                                exportMenuExpanded = false
                                coroutineScope.launch {
                                    runCatching {
                                        DailyPlanExporter.shareImage(
                                            context = context,
                                            items = todayTasks.toDailyPlanExportItems()
                                        )
                                    }.onFailure {
                                        Toast.makeText(context, "导出图片失败", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("导出当天计划为纯文本") },
                            onClick = {
                                exportMenuExpanded = false
                                DailyPlanExporter.shareText(
                                    context = context,
                                    text = DailyPlanExporter.buildText(todayTasks.toDailyPlanExportItems())
                                )
                            }
                        )
                    }
                }
                TextButton(
                    onClick = { showSubjectDialog = true },
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(
                        imageVector = Icons.Filled.School,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Text("科目")
                }
            }

            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(bottom = 16.dp)
            ) {
                item(key = "weekly-goals") {
                    WeeklyGoalsSection(
                        currentGoals = uiState.currentWeekGoals,
                        nextGoals = uiState.nextWeekGoals,
                        restDays = uiState.restDays,
                        isRestDay = uiState.isRestDay,
                        currentWeekStart = uiState.currentWeekStart,
                        nextWeekStart = uiState.nextWeekStart,
                        isSavingGoal = uiState.isSavingWeeklyGoal,
                        onAddWeeklyGoal = viewModel::addWeeklyGoal,
                        onSetRestDays = viewModel::saveRestDays,
                        onSetCompleted = viewModel::setWeeklyGoalCompleted,
                        onDefer = viewModel::deferWeeklyGoal,
                        onCancel = viewModel::cancelWeeklyGoal
                    )
                }

                item(key = "filters") {
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        PlanFilter.entries.forEach { filter ->
                            FilterChip(
                                selected = selectedFilter == filter,
                                onClick = { selectedFilter = filter },
                                label = { Text(filter.label) }
                            )
                        }
                    }
                }

                item(key = "add-plan") {
                    Button(
                        onClick = { showAddDialog = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primaryContainer,
                            contentColor = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    ) {
                        Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(20.dp))
                        Text(
                            "添加计划",
                            modifier = Modifier.padding(start = 8.dp),
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                if (visibleTasks.isEmpty() && !uiState.isLoading) {
                    item(key = "empty") {
                        EmptyPlanState(selectedFilter.label)
                    }
                } else {
                    visibleTasks
                        .groupBy { it.dueAt ?: 0L }
                        .toSortedMap()
                        .forEach { (dateMillis, tasks) ->
                            item(key = "date-$dateMillis") {
                                Text(
                                    text = formatPlanDateHeader(dateMillis),
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.padding(top = 4.dp)
                                )
                            }
                            items(tasks, key = { it.id }) { task ->
                                TaskListItem(
                                    task = task,
                                    subjectName = task.subjectName,
                                    completedDurationSeconds = if (hasActiveTimer && activeTaskId == task.id) {
                                        activeTaskProgressSeconds
                                    } else {
                                        uiState.completedDurationByTask[task.id] ?: 0
                                    },
                                    isActive = hasActiveTimer && activeTaskId == task.id,
                                    startEnabled = !hasActiveTimer || activeTaskId == task.id,
                                    onStartTask = { onStartTask(task) },
                                    onAddToCalendar = {
                                        val opened = openCalendarInsert(
                                            context = context,
                                            task = task,
                                            subjectName = task.subjectName
                                        )
                                        if (!opened) {
                                            Toast.makeText(context, "未找到可用的日历应用", Toast.LENGTH_SHORT).show()
                                        }
                                    },
                                    onEdit = { editingTask = task },
                                    onToggleDone = { viewModel.toggleDone(task) },
                                    onDeferToTomorrow = { viewModel.deferToTomorrow(task) },
                                    onDelete = { deletingTask = task }
                                )
                            }
                        }
                }
            }
        }
    }

    if (showAddDialog) {
        AddPlanDialog(
            subjects = uiState.subjects,
            initialTask = null,
            isSaving = uiState.isSavingPlan,
            onDismiss = { showAddDialog = false },
            onConfirm = { title, content, subjectId, customSubjectName, targetDurationSeconds, startDateMillis, mode, repeatCount ->
                viewModel.addPlan(
                    title = title,
                    content = content,
                    subjectId = subjectId,
                    customSubjectName = customSubjectName,
                    targetDurationSeconds = targetDurationSeconds,
                    startDateMillis = startDateMillis,
                    scheduleMode = mode,
                    repeatCount = repeatCount,
                    onSuccess = { showAddDialog = false }
                )
            }
        )
    }

    editingTask?.let { task ->
        AddPlanDialog(
            subjects = uiState.subjects,
            initialTask = task,
            isSaving = uiState.isSavingPlan,
            onDismiss = { editingTask = null },
            onConfirm = { title, content, subjectId, customSubjectName, targetDurationSeconds, dueAt, _, _ ->
                viewModel.updatePlan(
                    task = task,
                    title = title,
                    content = content,
                    subjectId = subjectId,
                    customSubjectName = customSubjectName,
                    targetDurationSeconds = targetDurationSeconds,
                    dueAt = dueAt,
                    onSuccess = { editingTask = null }
                )
            }
        )
    }

    deletingTask?.let { task ->
        AlertDialog(
            onDismissRequest = { deletingTask = null },
            shape = MaterialTheme.shapes.large,
            title = { Text("删除计划", fontWeight = FontWeight.SemiBold) },
            text = { Text("删除后将不再出现在计划列表，历史学习记录会保留。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.deletePlan(task)
                        deletingTask = null
                    },
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("删除", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = {
                TextButton(onClick = { deletingTask = null }, shape = RoundedCornerShape(10.dp)) {
                    Text("取消")
                }
            }
        )
    }

    if (showSubjectDialog) {
        SubjectManageDialog(
            subjects = uiState.subjects,
            onDismiss = { showSubjectDialog = false },
            onAddSubject = viewModel::addSubject,
            onDeleteSubject = viewModel::deleteSubject
        )
    }
}

private fun List<PlanTaskUi>.toDailyPlanExportItems(): List<DailyPlanExportItem> {
    return map { task ->
        DailyPlanExportItem(
            subjectName = task.subjectName,
            title = formatTaskPrimaryText(task, task.subjectName),
            content = task.content,
            targetDurationLabel = task.targetDurationSeconds
                ?.takeUnless { taskTitleLooksLikeDuration(task.title) }
                ?.let(::formatPlanDuration),
            isCompleted = task.status == PlanRepository.STATUS_DONE
        )
    }
}

private fun openCalendarInsert(
    context: Context,
    task: PlanTaskUi,
    subjectName: String?
): Boolean {
    val beginTime = task.dueAt ?: PlanRepository.startOfDay(System.currentTimeMillis())
    val zoneId = ZoneId.systemDefault()
    val endTime = Instant.ofEpochMilli(beginTime)
        .atZone(zoneId)
        .toLocalDate()
        .plusDays(1)
        .atStartOfDay(zoneId)
        .toInstant()
        .toEpochMilli()
    val title = formatTaskPrimaryText(task, subjectName)
    val description = buildString {
        if (!subjectName.isNullOrBlank()) {
            append("科目：")
            append(subjectName)
            append('\n')
        }
        task.targetDurationSeconds?.let {
            append("预计投入：")
            append(formatPlanDuration(it))
            append('\n')
        }
        if (!task.content.isNullOrBlank()) {
            append(task.content)
            append('\n')
        }
        append("来自 AlertTime 计划")
    }
    val intent = Intent(Intent.ACTION_INSERT)
        .setData(CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.Events.TITLE, title)
        .putExtra(CalendarContract.Events.DESCRIPTION, description)
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginTime)
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endTime)
        .putExtra(CalendarContract.Events.ALL_DAY, true)
    return runCatching { context.startActivity(intent) }.isSuccess
}
