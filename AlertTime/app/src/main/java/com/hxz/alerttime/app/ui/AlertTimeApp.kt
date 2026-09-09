package com.hxz.alerttime.app.ui

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.core.net.toUri
import com.hxz.alerttime.app.core.usage.AppUsageReader
import com.hxz.alerttime.app.core.notifications.ReminderScheduler
import com.hxz.alerttime.app.core.window.OverlayDetectionService
import com.hxz.alerttime.app.core.window.WindowMode
import com.hxz.alerttime.app.core.window.WindowStateHolder
import com.hxz.alerttime.app.core.window.pausesTimerOnStop
import com.hxz.alerttime.app.core.window.recordsDistractionOnStop
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.ui.diary.DiaryScreen
import com.hxz.alerttime.app.ui.home.HomeScreen
import com.hxz.alerttime.app.ui.home.HomeViewModel
import com.hxz.alerttime.app.ui.home.DistractionLookupToken
import com.hxz.alerttime.app.ui.home.TimerStatus
import com.hxz.alerttime.app.ui.plan.PlanScreen
import com.hxz.alerttime.app.ui.stats.StatsScreen
import com.hxz.alerttime.app.ui.stats.StatsViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private data class TabItem(
    val tab: MainTab,
    val filledIcon: ImageVector,
    val outlinedIcon: ImageVector
)

private enum class MainTab(val label: String) {
    Home("首页"),
    Plan("计划"),
    Stats("统计"),
    Diary("日记")
}

private val Tabs = listOf(
    TabItem(MainTab.Home, Icons.Filled.Home, Icons.Outlined.Home),
    TabItem(MainTab.Plan, Icons.Filled.TaskAlt, Icons.Outlined.TaskAlt),
    TabItem(MainTab.Stats, Icons.Filled.BarChart, Icons.Outlined.BarChart),
    TabItem(MainTab.Diary, Icons.Filled.EditNote, Icons.Outlined.EditNote)
)

@Composable
fun AlertTimeApp(database: AlertTimeDatabase) {
    var selectedTab by rememberSaveable { mutableStateOf(MainTab.Home) }
    val context = LocalContext.current
    val reminderScheduler = remember(context) {
        ReminderScheduler(context.applicationContext)
    }
    val homeViewModel: HomeViewModel = viewModel(
        factory = HomeViewModel.Factory(database, reminderScheduler)
    )
    val homeUiState by homeViewModel.uiState.collectAsStateWithLifecycle()
    val statsViewModel: StatsViewModel = viewModel(factory = StatsViewModel.Factory(database))
    val lifecycleOwner = LocalLifecycleOwner.current
    val coroutineScope = rememberCoroutineScope()
    val appUsageReader = remember(context) {
        AppUsageReader(context.applicationContext)
    }
    var hasUsageAccess by remember { mutableStateOf(appUsageReader.hasUsageAccess()) }
    var hasAccessibility by remember {
        mutableStateOf(OverlayDetectionService.isEnabled(context.applicationContext))
    }
    var pendingUsageLookup by remember { mutableStateOf<DistractionLookupToken?>(null) }
    // 窗口模式显示状态（MainActivity 写入 WindowStateHolder；轮询保持 Compose 同步）。
    var windowMode by remember { mutableStateOf(WindowStateHolder.currentMode) }

    LaunchedEffect(Unit) {
        while (true) {
            windowMode = WindowStateHolder.currentMode
            delay(500)
        }
    }

    DisposableEffect(lifecycleOwner, homeViewModel) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> {
                    homeViewModel.refreshIfDayChanged()
                    hasUsageAccess = appUsageReader.hasUsageAccess()
                    hasAccessibility = OverlayDetectionService.isEnabled(context.applicationContext)
                    val lookupToken = pendingUsageLookup
                    pendingUsageLookup = null
                    // 窗口状态分类恢复：
                    // - 普通前台：真后台暂停后恢复计时；
                    // - 锁屏 / 分屏 / 画中画：专注计时本来就持续，无需恢复。
                    val mode = WindowStateHolder.currentMode
                    when (mode) {
                        WindowMode.NORMAL -> {
                            homeViewModel.resumeAfterAppForegrounded()
                        }
                        WindowMode.MULTI_WINDOW,
                        WindowMode.PICTURE_IN_PICTURE -> Unit
                        WindowMode.BACKGROUND,
                        WindowMode.SCREEN_LOCKED,
                        WindowMode.EXTERNAL_OVERLAY_UNKNOWN -> Unit
                    }
                    if (lookupToken != null && hasUsageAccess) {
                        coroutineScope.launch {
                            delay(3_500)
                            homeViewModel.recordDistractionApp(
                                sessionId = lookupToken.sessionId,
                                appInfo = appUsageReader.findForegroundAppAfter(
                                    sinceMillis = lookupToken.backgroundedAt,
                                    untilMillis = System.currentTimeMillis()
                                )
                            )
                        }
                    }
                }

                Lifecycle.Event.ON_STOP -> {
                    // 窗口状态分类（先更新锁屏/画中画/分屏/悬浮窗覆盖状态，再决定如何暂停）。
                    val mode = WindowStateHolder.resolveOnStopMode(
                        context,
                        context as? android.app.Activity,
                        overlayDetected = WindowStateHolder.overlayDetectedRecently()
                    )
                    if (!mode.pausesTimerOnStop()) {
                        // 画中画 / 分屏：仍在学习，不暂停、不记分心、AI 时段继续计时。
                        pendingUsageLookup = null
                        return@LifecycleEventObserver
                    }
                    if (mode == WindowMode.EXTERNAL_OVERLAY_UNKNOWN) {
                        // 检测到外部悬浮窗覆盖（用户可能正在 AI 悬浮窗中学习）：暂停但不记分心。
                        pendingUsageLookup = null
                        homeViewModel.recordAppBackgrounded(recordDistraction = false)
                        return@LifecycleEventObserver
                    }
                    // 真正后台：只有确认是普通后台离开时才记录分心。
                    val recordDistraction = mode.recordsDistractionOnStop()
                    val lookupToken = homeViewModel.recordAppBackgrounded(recordDistraction)
                    if (lookupToken != null && appUsageReader.hasUsageAccess()) {
                        pendingUsageLookup = lookupToken
                    }
                }

                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    LaunchedEffect(homeViewModel) {
        while (true) {
            delay(60_000)
            homeViewModel.refreshIfDayChanged()
        }
    }

    LaunchedEffect(selectedTab) {
        if (selectedTab == MainTab.Stats) {
            statsViewModel.refresh()
        }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                tonalElevation = 0.dp,
                modifier = Modifier.height(72.dp)
            ) {
                Tabs.forEach { item ->
                    val selected = selectedTab == item.tab
                    NavigationBarItem(
                        selected = selected,
                        onClick = { selectedTab = item.tab },
                        icon = {
                            Icon(
                                imageVector = if (selected) item.filledIcon else item.outlinedIcon,
                                contentDescription = item.tab.label,
                                modifier = Modifier.size(22.dp)
                            )
                        },
                        label = { Text(item.tab.label) },
                        alwaysShowLabel = true,
                        colors = NavigationBarItemDefaults.colors(
                            indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    )
                }
            }
        }
    ) { innerPadding ->
        when (selectedTab) {
            MainTab.Home -> HomeScreen(
                database = database,
                onNavigateToPlan = { selectedTab = MainTab.Plan },
                windowMode = windowMode,
                usageAccessGranted = hasUsageAccess,
                onOpenUsageAccessSettings = {
                    runCatching {
                        context.startActivity(appUsageReader.usageAccessSettingsIntent())
                    }.recoverCatching {
                        context.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS))
                    }
                    hasUsageAccess = appUsageReader.hasUsageAccess()
                },
                accessibilityEnabled = hasAccessibility,
                onOpenAccessibilitySettings = {
                    runCatching {
                        context.startActivity(OverlayDetectionService.accessibilitySettingsIntent())
                    }.recoverCatching {
                        context.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS))
                    }
                    hasAccessibility = OverlayDetectionService.isEnabled(context.applicationContext)
                },
                onOpenGemini = {
                    openExternalAiAssistant(
                        context = context,
                        packageName = GEMINI_PACKAGE,
                        fallbackUrl = GEMINI_WEB_URL
                    )
                },
                onOpenChatGpt = {
                    openExternalAiAssistant(
                        context = context,
                        packageName = CHATGPT_PACKAGE,
                        fallbackUrl = CHATGPT_WEB_URL
                    )
                },
                viewModel = homeViewModel,
                modifier = Modifier.padding(innerPadding)
            )
            MainTab.Plan -> PlanScreen(
                database = database,
                activeTaskId = homeUiState.activeTaskId,
                hasActiveTimer = homeUiState.timerStatus != TimerStatus.Idle,
                activeTaskProgressSeconds = homeUiState.activePlanElapsedSeconds,
                onStartTask = { task ->
                    if (task.status == com.hxz.alerttime.app.core.StatusCodes.TASK_DONE) return@PlanScreen
                    if (homeUiState.activeTaskId == task.id && homeUiState.timerStatus != TimerStatus.Idle) {
                        selectedTab = MainTab.Home
                        return@PlanScreen
                    }
                    homeViewModel.startPlanNow(
                        taskId = task.id,
                        subjectId = task.subjectId,
                        title = task.title,
                        targetDurationSeconds = task.targetDurationSeconds
                    )
                    selectedTab = MainTab.Home
                },
                modifier = Modifier.padding(innerPadding)
            )
            MainTab.Stats -> StatsScreen(
                database = database,
                viewModel = statsViewModel,
                modifier = Modifier.padding(innerPadding)
            )
            MainTab.Diary -> DiaryScreen(
                database = database,
                modifier = Modifier.padding(innerPadding)
            )
        }
    }
}

private fun openExternalAiAssistant(
    context: Context,
    packageName: String,
    fallbackUrl: String
) {
    val packageManager = context.packageManager
    val openedApp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        runCatching {
            packageManager.getLaunchIntentSenderForPackage(packageName).sendIntent(
                context,
                0,
                Intent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                null,
                null
            )
        }.isSuccess
    } else {
        packageManager.getLaunchIntentForPackage(packageName)?.let { launchIntent ->
            runCatching {
                context.startActivity(launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }.isSuccess
        } ?: false
    }
    if (!openedApp) {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, fallbackUrl.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}

private const val GEMINI_PACKAGE = "com.google.android.apps.bard"
private const val GEMINI_WEB_URL = "https://gemini.google.com/app"
private const val CHATGPT_PACKAGE = "com.openai.chatgpt"
private const val CHATGPT_WEB_URL = "https://chatgpt.com"
