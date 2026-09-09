package com.hxz.alerttime.app.ui.home

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hxz.alerttime.app.core.time.formatStudyDuration
import com.hxz.alerttime.app.core.window.WindowMode
import com.hxz.alerttime.app.core.window.displayLabel
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.ui.assessment.LearningAnalysisDialogHost
import com.hxz.alerttime.app.ui.backup.DataBackupDialogHost
import com.hxz.alerttime.app.ui.components.AppPageHeader
import com.hxz.alerttime.app.ui.sync.TeacherSyncDialogHost
import com.hxz.alerttime.app.ui.home.components.AboutDialog
import com.hxz.alerttime.app.ui.home.components.CompletionSummaryCard
import com.hxz.alerttime.app.ui.home.components.DistractionAccessCard
import com.hxz.alerttime.app.ui.home.components.HeroTimerCard
import com.hxz.alerttime.app.ui.home.components.HomeWeeklyGoalsCard
import com.hxz.alerttime.app.ui.home.components.NextPlanCard
import com.hxz.alerttime.app.ui.home.components.ReminderSettingsDialog
import com.hxz.alerttime.app.ui.home.components.StudyContextDialog
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun HomeScreen(
    database: AlertTimeDatabase,
    onNavigateToPlan: () -> Unit,
    windowMode: WindowMode = WindowMode.NORMAL,
    usageAccessGranted: Boolean,
    onOpenUsageAccessSettings: () -> Unit,
    accessibilityEnabled: Boolean = false,
    onOpenAccessibilitySettings: () -> Unit = {},
    onOpenGemini: () -> Unit,
    onOpenChatGpt: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = viewModel(factory = HomeViewModel.Factory(database))
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }
    LaunchedEffect(uiState.shouldRequestNotificationPermission) {
        if (!uiState.shouldRequestNotificationPermission) return@LaunchedEffect
        viewModel.markNotificationPermissionRequested()
        if (uiState.reminderSettings.hasAnyEnabledReminder() &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    LaunchedEffect(uiState.errorMessage) {
        val message = uiState.errorMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        viewModel.clearError()
    }
    var showBackupDialog by rememberSaveable { mutableStateOf(false) }
    var showTeacherSyncDialog by rememberSaveable { mutableStateOf(false) }
    var showLearningAnalysisDialog by rememberSaveable { mutableStateOf(false) }
    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        contentWindowInsets = WindowInsets(0, 0, 0, 0)
    ) { innerPadding ->
        HomeContent(
            uiState = uiState,
            windowMode = windowMode,
            accessibilityEnabled = accessibilityEnabled,
            onOpenAccessibilitySettings = onOpenAccessibilitySettings,
            onPrimaryAction = viewModel::onPrimaryAction,
            onStartWithContext = viewModel::startWithContext,
            onFinish = viewModel::finish,
            onResolveRunningSessionRecovery = viewModel::resolveRunningSessionRecovery,
            onAddPlan = onNavigateToPlan,
            onSaveReminderSettings = { settings ->
                viewModel.saveReminderSettings(settings)
                val anyEnabled = settings.planRemindersEnabled ||
                    settings.weeklyGoalRemindersEnabled ||
                    settings.awayReminderEnabled ||
                    settings.manualPauseReminderEnabled ||
                    settings.aiPauseReminderEnabled
                if (anyEnabled &&
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
                ) {
                    viewModel.markNotificationPermissionRequested()
                    notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            },
            usageAccessGranted = usageAccessGranted,
            onOpenUsageAccessSettings = onOpenUsageAccessSettings,
            onOpenGemini = { viewModel.pauseForAiHelp("Gemini"); onOpenGemini() },
            onOpenChatGpt = { viewModel.pauseForAiHelp("ChatGPT"); onOpenChatGpt() },
            onOpenBackup = { showBackupDialog = true },
            onOpenTeacherSync = { showTeacherSyncDialog = true },
            onOpenLearningAnalysis = { showLearningAnalysisDialog = true },
            modifier = Modifier.padding(innerPadding)
        )
    }
    if (showBackupDialog) {
        DataBackupDialogHost(
            database = database,
            backupGate = viewModel.backupGate,
            timerBusy = uiState.timerStatus != TimerStatus.Idle ||
                uiState.showRunningSessionRecovery,
            onRestoreCompleted = viewModel::refreshAfterBackupRestore,
            onDismiss = { showBackupDialog = false }
        )
    }
    if (showTeacherSyncDialog) {
        TeacherSyncDialogHost(
            database = database,
            onDismiss = { showTeacherSyncDialog = false }
        )
    }
    if (showLearningAnalysisDialog) {
        LearningAnalysisDialogHost(
            database = database,
            onDismiss = { showLearningAnalysisDialog = false }
        )
    }
}

@Composable
private fun HomeContent(
    uiState: HomeUiState,
    windowMode: WindowMode = WindowMode.NORMAL,
    accessibilityEnabled: Boolean = false,
    onOpenAccessibilitySettings: () -> Unit = {},
    onPrimaryAction: () -> Unit,
    onStartWithContext: (Long?, Long?) -> Unit,
    onFinish: (markLinkedTaskDone: Boolean) -> Unit,
    onResolveRunningSessionRecovery: (Boolean) -> Unit,
    onAddPlan: () -> Unit,
    onSaveReminderSettings: (com.hxz.alerttime.app.core.notifications.ReminderSettings) -> Unit,
    usageAccessGranted: Boolean,
    onOpenUsageAccessSettings: () -> Unit,
    onOpenGemini: () -> Unit,
    onOpenChatGpt: () -> Unit,
    onOpenBackup: () -> Unit,
    onOpenTeacherSync: () -> Unit = {},
    onOpenLearningAnalysis: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    var showStudyContextDialog by rememberSaveable { mutableStateOf(false) }
    var showFinishChoiceDialog by rememberSaveable { mutableStateOf(false) }
    var showAboutDialog by rememberSaveable { mutableStateOf(false) }
    var showReminderSettings by rememberSaveable { mutableStateOf(false) }
    val dateLabel = LocalDate.now()
        .format(DateTimeFormatter.ofPattern("M月d日 EEEE", Locale.CHINA))

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        AppPageHeader(
            title = "今天",
            subtitle = dateLabel
        ) {
            IconButton(onClick = onOpenLearningAnalysis) {
                Icon(Icons.Outlined.Settings, contentDescription = "学习分析与模型设置")
            }
            IconButton(onClick = { showReminderSettings = true }) {
                Icon(Icons.Outlined.Notifications, contentDescription = "提醒设置")
            }
            IconButton(onClick = { showAboutDialog = true }) {
                Icon(Icons.Outlined.Info, contentDescription = "关于自律")
            }
        }

        // 窗口模式状态（小窗 / 分屏 / 画中画 / 后台 / 锁屏）。
        if (windowMode != WindowMode.NORMAL) {
            Text(
                text = "窗口状态：${windowMode.displayLabel()}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.tertiary
            )
        }

        HeroTimerCard(
            uiState = uiState,
            onPrimaryAction = {
                if (uiState.timerStatus == TimerStatus.Idle) showStudyContextDialog = true else onPrimaryAction()
            },
            onFinish = {
                if (uiState.activeTaskId != null) {
                    showFinishChoiceDialog = true
                } else {
                    onFinish(false)
                }
            }
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "今日计划",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = "待完成 ${uiState.visiblePendingTaskCount} 项",
                modifier = Modifier.clickable(onClick = onAddPlan),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        uiState.lastCompletionSummary?.let { CompletionSummaryCard(summary = it) }

        NextPlanCard(nextPlan = uiState.visibleNextPlan, onAddPlan = onAddPlan)
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))

        HomeWeeklyGoalsCard(
            currentGoals = uiState.currentWeeklyGoals,
            nextGoals = uiState.nextWeeklyGoals,
            isRestDay = uiState.isRestDay,
            onOpenPlanning = onAddPlan
        )

        DistractionAccessCard(
            distractionCount = uiState.distractionCount,
            lastDistractionAppLabel = uiState.lastDistractionAppLabel,
            distractionAppLabels = uiState.distractionAppLabels,
            distractionRecords = uiState.distractionRecords,
            aiHelpCount = uiState.aiHelpCount,
            aiHelpDurationText = uiState.aiHelpDurationText,
            lastAiHelpLabel = uiState.lastAiHelpLabel,
            aiHelpActive = uiState.aiHelpActive,
            usageAccessGranted = usageAccessGranted,
            onOpenUsageAccessSettings = onOpenUsageAccessSettings,
            accessibilityEnabled = accessibilityEnabled,
            onOpenAccessibilitySettings = onOpenAccessibilitySettings,
            onOpenGemini = onOpenGemini,
            onOpenChatGpt = onOpenChatGpt
        )
        Spacer(Modifier.height(8.dp))
    }

    if (showStudyContextDialog) {
        StudyContextDialog(
            plans = uiState.pendingPlans,
            subjects = uiState.subjects,
            onDismiss = { showStudyContextDialog = false },
            onConfirm = { taskId, subjectId ->
                onStartWithContext(taskId, subjectId)
                showStudyContextDialog = false
            }
        )
    }
    if (showFinishChoiceDialog) {
        FinishStudyDialog(
            onDismiss = { showFinishChoiceDialog = false },
            onFinishOnly = {
                showFinishChoiceDialog = false
                onFinish(false)
            },
            onFinishAndCompletePlan = {
                showFinishChoiceDialog = false
                onFinish(true)
            }
        )
    }
    if (showReminderSettings) {
        ReminderSettingsDialog(
            initial = uiState.reminderSettings,
            onDismiss = { showReminderSettings = false },
            onSave = {
                onSaveReminderSettings(it)
                showReminderSettings = false
            }
        )
    }
    if (showAboutDialog) {
        AboutDialog(
            onDismiss = { showAboutDialog = false },
            onOpenBackup = {
                showAboutDialog = false
                onOpenBackup()
            },
            onOpenTeacherSync = {
                showAboutDialog = false
                onOpenTeacherSync()
            }
        )
    }
    if (uiState.showRunningSessionRecovery) {
        RunningSessionRecoveryDialog(
            gapSeconds = uiState.recoveryGapSeconds,
            onExcludeGap = { onResolveRunningSessionRecovery(false) },
            onIncludeGap = { onResolveRunningSessionRecovery(true) }
        )
    }
}

@Composable
private fun FinishStudyDialog(
    onDismiss: () -> Unit,
    onFinishOnly: () -> Unit,
    onFinishAndCompletePlan: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("结束本次学习") },
        text = {
            Text("本次学习时长会计入今天。若还未完成计划，可先仅结束学习，再到计划中选择顺延到明天。")
        },
        confirmButton = {
            TextButton(onClick = onFinishAndCompletePlan) {
                Text("结束并完成计划")
            }
        },
        dismissButton = {
            TextButton(onClick = onFinishOnly) {
                Text("仅结束学习")
            }
        }
    )
}

@Composable
private fun RunningSessionRecoveryDialog(
    gapSeconds: Long,
    onExcludeGap: () -> Unit,
    onIncludeGap: () -> Unit
) {
    AlertDialog(
        onDismissRequest = {},
        title = { Text("检测到未正常结束的计时") },
        text = {
            Text(
                "应用中断了 ${formatStudyDuration(gapSeconds)}。请选择这段时间是否属于真实学习，" +
                    "系统不会自动把它计入专注。"
            )
        },
        confirmButton = {
            TextButton(onClick = onExcludeGap) {
                Text("不计入并继续")
            }
        },
        dismissButton = {
            TextButton(onClick = onIncludeGap) {
                Text("计入并继续")
            }
        }
    )
}

private fun com.hxz.alerttime.app.core.notifications.ReminderSettings.hasAnyEnabledReminder(): Boolean {
    return planRemindersEnabled ||
        weeklyGoalRemindersEnabled ||
        awayReminderEnabled ||
        manualPauseReminderEnabled ||
        aiPauseReminderEnabled
}
