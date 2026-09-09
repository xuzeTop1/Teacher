package com.hxz.alerttime.app.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import android.util.Log
import com.hxz.alerttime.app.core.time.formatCompactStudyDuration
import com.hxz.alerttime.app.core.time.formatStudyDuration
import com.hxz.alerttime.app.core.time.todayBounds
import com.hxz.alerttime.app.core.coroutines.runSuspendCatching
import com.hxz.alerttime.app.data.backup.BackupTimerGate
import com.hxz.alerttime.app.core.notifications.PauseReminderKind
import com.hxz.alerttime.app.core.notifications.ReminderScheduler
import com.hxz.alerttime.app.core.notifications.ReminderSettings
import com.hxz.alerttime.app.core.usage.ForegroundAppInfo
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.SubjectEntity
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import com.hxz.alerttime.app.data.local.entity.WeeklyGoalEntity
import com.hxz.alerttime.app.data.repository.HomeRepository
import com.hxz.alerttime.app.data.repository.PlanRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.math.max

enum class TimerStatus {
    Idle,
    Starting,
    Running,
    Paused,
    Saving
}

data class HomeUiState(
    val todaySeconds: Long = 0,
    val todayElapsedSeconds: Long = 0,
    val todayAiHelpSeconds: Long = 0,
    val todayPauseSeconds: Long = 0,
    val activeSeconds: Long = 0,
    val todayActiveSeconds: Long = 0,
    val activeElapsedSeconds: Long = 0,
    val todayActiveElapsedSeconds: Long = 0,
    val todayActiveAiHelpSeconds: Long = 0,
    val todayTargetSeconds: Long? = null,
    val pendingTaskCount: Int = 0,
    val nextPlan: NextPlanUi? = null,
    val pendingPlans: List<StudyPlanUi> = emptyList(),
    val subjects: List<StudySubjectUi> = emptyList(),
    val currentWeeklyGoals: List<HomeWeeklyGoalUi> = emptyList(),
    val nextWeeklyGoals: List<HomeWeeklyGoalUi> = emptyList(),
    val isRestDay: Boolean = false,
    val reminderSettings: ReminderSettings = ReminderSettings(),
    val activeTaskId: Long? = null,
    val activePlanTitle: String? = null,
    val activeSubjectName: String? = null,
    val activePlanTargetSeconds: Long? = null,
    val activePlanCompletedBeforeSeconds: Long = 0,
    val distractionCount: Int = 0,
    val aiHelpCount: Int = 0,
    val aiHelpSeconds: Long = 0,
    /** 是否处于 AI 求助时段（开始事件已持久化、结束事件未写入）。 */
    val aiHelpActive: Boolean = false,
    val lastAiHelpLabel: String? = null,
    val distractionRecords: List<DistractionRecordUi> = emptyList(),
    val distractionAppLabels: List<String> = emptyList(),
    val lastDistractionAppLabel: String? = null,
    val pausedByDistraction: Boolean = false,
    val showRunningSessionRecovery: Boolean = false,
    val recoveryGapSeconds: Long = 0,
    val shouldRequestNotificationPermission: Boolean = false,
    val timerStatus: TimerStatus = TimerStatus.Idle,
    val lastCompletionSummary: CompletionSummaryUi? = null,
    val isLoading: Boolean = true,
    val errorMessage: String? = null
) {
    val visiblePendingPlans: List<StudyPlanUi> = pendingPlans.filterNot { it.id == activeTaskId }
    val visiblePendingTaskCount: Int = visiblePendingPlans.size
    val visibleNextPlan: NextPlanUi? = nextPlan
        ?.takeUnless { it.id == activeTaskId }
        ?: visiblePendingPlans.firstOrNull()?.let { plan ->
            NextPlanUi(
                id = plan.id,
                title = plan.title,
                content = plan.content,
                dueAt = plan.dueAt,
                subjectId = plan.subjectId,
                targetDurationSeconds = plan.targetDurationSeconds
            )
        }
    val todayTotalStudySeconds: Long = todayElapsedSeconds + todayActiveElapsedSeconds
    val todayFocusTotalSeconds: Long = todaySeconds + todayActiveSeconds
    val todayAiHelpTotalSeconds: Long = todayAiHelpSeconds + todayActiveAiHelpSeconds
    val todayPauseTotalSeconds: Long = (
        todayTotalStudySeconds - todayFocusTotalSeconds - todayAiHelpTotalSeconds
    ).coerceAtLeast(todayPauseSeconds)
    val todayDurationText: String = formatStudyDuration(todayTotalStudySeconds)
    val todayCompactDurationText: String = formatCompactStudyDuration(todayTotalStudySeconds)
    val todayFocusDurationText: String = formatCompactStudyDuration(todayFocusTotalSeconds)
    val todayAiHelpDurationText: String = formatCompactStudyDuration(todayAiHelpTotalSeconds)
    val todayPauseDurationText: String = formatCompactStudyDuration(todayPauseTotalSeconds)
    val activeDurationText: String = formatStudyDuration(activeSeconds)
    val activeElapsedText: String = formatStudyDuration(activeElapsedSeconds)
    val aiHelpDurationText: String = formatStudyDuration(aiHelpSeconds)
    val activePlanElapsedSeconds: Long = activePlanCompletedBeforeSeconds + activeSeconds
    val activePlanElapsedText: String = formatStudyDuration(activePlanElapsedSeconds)
    val activeFocusClockLabel: String = if (activeTaskId != null) "计划累计专注" else "本次有效专注"
    val activeFocusClockText: String = if (activeTaskId != null) {
        activePlanElapsedText
    } else {
        activeDurationText
    }
    val activePlanTargetText: String? = activePlanTargetSeconds?.let(::formatStudyDuration)
    val activePlanProgress: Float = activePlanTargetSeconds
        ?.takeIf { it > 0 }
        ?.let { target -> (activePlanElapsedSeconds.toFloat() / target).coerceIn(0f, 1f) }
        ?: 0f
    val timerDurationText: String = if (timerStatus != TimerStatus.Idle && activePlanTitle != null) {
        activeElapsedText
    } else if (timerStatus != TimerStatus.Idle) {
        activeElapsedText
    } else {
        todayDurationText
    }
    val primaryActionText: String = when (timerStatus) {
        TimerStatus.Idle -> "选择 Plan 开始"
        TimerStatus.Starting -> "正在开始"
        TimerStatus.Running -> "暂停"
        TimerStatus.Paused -> "继续"
        TimerStatus.Saving -> "正在保存"
    }
}

data class CompletionSummaryUi(
    val title: String,
    val startedAt: Long,
    val endedAt: Long,
    val effectiveSeconds: Long,
    val elapsedSeconds: Long,
    val aiHelpSeconds: Long,
    val targetSeconds: Long?,
    val endReason: String? = null
)

data class NextPlanUi(
    val id: Long,
    val title: String,
    val content: String?,
    val dueAt: Long?,
    val subjectId: Long?,
    val targetDurationSeconds: Long?
)

data class StudyPlanUi(
    val id: Long,
    val title: String,
    val content: String?,
    val dueAt: Long?,
    val subjectId: Long?,
    val targetDurationSeconds: Long?
)

data class StudySubjectUi(
    val id: Long,
    val name: String
)

data class HomeWeeklyGoalUi(
    val id: Long,
    val title: String,
    val successCriteria: String?,
    val status: Int
)

data class DistractionRecordUi(
    val appLabel: String,
    val timestamp: Long
)

data class DistractionLookupToken(
    val sessionId: Long,
    val backgroundedAt: Long
)

class HomeViewModel(
    private val repository: HomeRepository,
    private val reminderScheduler: ReminderScheduler? = null
) : ViewModel() {
    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    /**
     * Shared coordination point between the timer and backup/restore; handed to
     * the data-backup dialog so both sides use the same atomic gate.
     */
    val backupGate = BackupTimerGate()

    private var userId: Long = 0
    private var currentDayStartMillis: Long = todayBounds().startInclusive
    private var dayPlanObservationJob: Job? = null
    private var pausedDayBoundaryCloseJob: Job? = null
    private var activePauseReminderKind: PauseReminderKind? = null
    private var latestWeeklyGoals: List<WeeklyGoalEntity> = emptyList()
    private var latestRestDays: Set<Int> = PlanRepository.DEFAULT_REST_DAYS

    private val timerManager: TimerManager = TimerManager(
        repository = repository,
        scope = viewModelScope,
        backupGate = backupGate,
        listener = object : TimerManager.Listener {
            override fun onTimerTick() {
                val now = System.currentTimeMillis()
                _uiState.update {
                    it.copy(
                        activeSeconds = timerManager.currentActiveSeconds(now),
                        todayActiveSeconds = timerManager.currentTodayActiveSeconds(now),
                        activeElapsedSeconds = timerManager.currentElapsedSeconds(now),
                        todayActiveElapsedSeconds = timerManager.currentTodayElapsedSeconds(now),
                        aiHelpSeconds = timerManager.currentAiHelpSeconds(now),
                        todayActiveAiHelpSeconds = timerManager.currentTodayAiHelpSeconds(now)
                    )
                }
            }

            override fun onTimerStatusChanged(status: TimerStatus) {
                _uiState.update {
                    if (status == TimerStatus.Idle) {
                        it.copy(
                            timerStatus = status,
                            activeTaskId = null,
                            activePlanTitle = null,
                            activeSubjectName = null,
                            activePlanTargetSeconds = null,
                            activePlanCompletedBeforeSeconds = 0,
                            activeSeconds = 0,
                            todayActiveSeconds = 0,
                            activeElapsedSeconds = 0,
                            todayActiveElapsedSeconds = 0,
                            todayActiveAiHelpSeconds = 0,
                            aiHelpSeconds = 0,
                            pausedByDistraction = false
                        )
                    } else {
                        it.copy(timerStatus = status)
                    }
                }
            }

            override fun onTimerPersistenceFailed(message: String) {
                _uiState.update { it.copy(errorMessage = message) }
            }

            override suspend fun onTargetReached(
                sessionId: Long,
                startedAt: Long,
                endedAt: Long,
                finalActiveSeconds: Long,
                pauseSeconds: Long,
                taskId: Long,
                subjectId: Long?,
                title: String,
                note: String?,
                targetSeconds: Long,
                aiHelpSeconds: Long
            ): Boolean {
                return runSuspendCatching {
                    repository.completeSession(
                        sessionId = sessionId,
                        userId = userId,
                        startedAt = startedAt,
                        endedAt = endedAt,
                        durationSeconds = finalActiveSeconds,
                        pauseSeconds = pauseSeconds,
                        aiHelpSeconds = aiHelpSeconds,
                        taskId = taskId,
                        subjectId = subjectId,
                        title = title,
                        note = note
                    )
                    reminderScheduler?.cancelPausedSessionReminder(sessionId)
                    activePauseReminderKind = null
                    refreshSummary()
                    _uiState.update {
                        it.copy(
                            lastCompletionSummary = CompletionSummaryUi(
                                title = title,
                                startedAt = startedAt,
                                endedAt = endedAt,
                                effectiveSeconds = finalActiveSeconds,
                                elapsedSeconds = ((endedAt - startedAt).coerceAtLeast(0) / 1000),
                                aiHelpSeconds = aiHelpSeconds,
                                targetSeconds = targetSeconds
                            ),
                            errorMessage = "已达到目标时长，本次学习已结束；计划仍需手动确认完成。"
                        )
                    }
                    true
                }.getOrElse { throwable ->
                    _uiState.update {
                        it.copy(errorMessage = throwable.message ?: "完成计划失败，计时已暂停")
                    }
                    false
                }
            }

            override fun onSessionStarted(
                taskId: Long?,
                subjectId: Long?,
                targetDurationSeconds: Long?,
                title: String,
                completedBeforeSeconds: Long
            ) {
                val selectedSubject = _uiState.value.subjects.firstOrNull { it.id == subjectId }
                val selectedPlan = _uiState.value.pendingPlans.firstOrNull { it.id == taskId }
                _uiState.update {
                    it.copy(
                        activeTaskId = taskId,
                        activePlanTitle = selectedPlan?.title ?: title,
                        activeSubjectName = selectedSubject?.name,
                        activePlanTargetSeconds = targetDurationSeconds,
                        activePlanCompletedBeforeSeconds = completedBeforeSeconds,
                        distractionCount = 0,
                        distractionRecords = emptyList(),
                        distractionAppLabels = emptyList(),
                        lastDistractionAppLabel = null,
                        aiHelpCount = 0,
                        aiHelpSeconds = 0,
                        aiHelpActive = false,
                        lastAiHelpLabel = null,
                        lastCompletionSummary = null,
                        pausedByDistraction = false,
                        errorMessage = null,
                        activeSeconds = 0,
                        todayActiveSeconds = 0,
                        activeElapsedSeconds = 0,
                        todayActiveElapsedSeconds = 0,
                        todayActiveAiHelpSeconds = 0
                    )
                }
            }

            override fun onStartFailed(message: String) {
                _uiState.update { it.copy(errorMessage = message) }
                viewModelScope.launch { restoreRunningSession() }
            }

            override fun onBuildSessionNote(): String? = buildSessionNote()

            override fun onDayChanged() {
                refreshSummaryIfDayChanged()
            }
        }
    )

    init {
        viewModelScope.launch {
            runSuspendCatching {
                val user = repository.ensureLocalUser()
                userId = user.id
                repository.ensureDefaultSubjects(user.id)
                refreshSummary()
                val permissionPrompted = repository.notificationPermissionPrompted()
                val reminderSettings = repository.reminderSettings()
                _uiState.update {
                    it.copy(
                        reminderSettings = reminderSettings,
                        shouldRequestNotificationPermission = !permissionPrompted &&
                            reminderSettings.hasAnyEnabledReminder()
                    )
                }
                restoreRunningSession()
                observePlanSummary(user.id)
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = throwable.message ?: "初始化失败"
                    )
                }
            }
        }
    }

    fun onPrimaryAction() {
        when (_uiState.value.timerStatus) {
            TimerStatus.Idle -> timerManager.start(
                userId = userId,
                taskId = null,
                subjectId = null,
                pendingPlans = _uiState.value.pendingPlans,
                subjects = _uiState.value.subjects
            )
            TimerStatus.Running -> {
                timerManager.pause()
                activePauseReminderKind = PauseReminderKind.Manual
                schedulePausedReminder(PauseReminderKind.Manual, timerManager.pauseStartedAt)
                _uiState.update {
                    val now = System.currentTimeMillis()
                    it.copy(
                        activeSeconds = timerManager.accumulatedActiveSeconds,
                        todayActiveSeconds = timerManager.currentTodayActiveSeconds(now),
                        activeElapsedSeconds = timerManager.currentElapsedSeconds(now),
                        todayActiveElapsedSeconds = timerManager.currentTodayElapsedSeconds(now),
                        aiHelpSeconds = timerManager.currentAiHelpSeconds(now),
                        todayActiveAiHelpSeconds = timerManager.currentTodayAiHelpSeconds(now),
                        pausedByDistraction = false
                    )
                }
            }
            TimerStatus.Paused -> {
                if (closePausedSessionFromPreviousDayIfNeeded()) return
                reminderScheduler?.cancelPausedSessionReminder(timerManager.activeSessionId)
                activePauseReminderKind = null
                val now = System.currentTimeMillis()
                timerManager.resume()
                _uiState.update {
                    it.copy(
                        activeElapsedSeconds = timerManager.currentElapsedSeconds(now),
                        aiHelpSeconds = timerManager.accumulatedAiHelpSeconds,
                        todayActiveElapsedSeconds = timerManager.currentTodayElapsedSeconds(now),
                        todayActiveAiHelpSeconds = timerManager.currentTodayAiHelpSeconds(now),
                        pausedByDistraction = false
                    )
                }
            }
            TimerStatus.Starting,
            TimerStatus.Saving -> Unit
        }
    }

    fun startWithContext(taskId: Long?, subjectId: Long?) {
        if (_uiState.value.timerStatus != TimerStatus.Idle) return
        timerManager.start(
            userId = userId,
            taskId = taskId,
            subjectId = subjectId,
            pendingPlans = _uiState.value.pendingPlans,
            subjects = _uiState.value.subjects
        )
    }

    fun startPlanNow(taskId: Long, subjectId: Long?, title: String, targetDurationSeconds: Long?) {
        if (_uiState.value.timerStatus != TimerStatus.Idle) {
            _uiState.update { it.copy(errorMessage = "当前已有进行中的学习，请先结束或暂停处理。") }
            return
        }
        timerManager.start(
            userId = userId,
            taskId = taskId,
            subjectId = subjectId,
            fallbackTitle = title,
            fallbackTargetDurationSeconds = targetDurationSeconds ?: timerManager.parseDurationSeconds(title),
            pendingPlans = _uiState.value.pendingPlans,
            subjects = _uiState.value.subjects
        )
    }

    fun finish(markLinkedTaskDone: Boolean) {
        if (!timerManager.isActive) return
        if (closePausedSessionFromPreviousDayIfNeeded()) return
        if (!timerManager.requestManualCompletion()) return
        val note = buildSessionNote()
        val now = System.currentTimeMillis()
        val finalActiveSeconds = timerManager.currentActiveSeconds(now)
        val pauseSeconds = timerManager.currentPauseSeconds(now)
        val aiHelpSeconds = timerManager.currentAiHelpSeconds(now)
        val summary = timerManager.buildCompletionSummary(now, finalActiveSeconds)
        val activeTaskId = timerManager.activeTaskId
        val activeSessionId = timerManager.activeSessionId
        val activeStartedAt = timerManager.activeStartedAt
        val activeSubjectId = timerManager.activeSubjectId
        val activeTitle = timerManager.activeTitle

        viewModelScope.launch {
            runSuspendCatching {
                timerManager.awaitPersistRunningProgress(now)
                repository.completeSession(
                    sessionId = activeSessionId ?: return@launch,
                    userId = userId,
                    startedAt = activeStartedAt,
                    endedAt = now,
                    durationSeconds = max(0, finalActiveSeconds),
                    pauseSeconds = max(0, pauseSeconds),
                    aiHelpSeconds = max(0, aiHelpSeconds),
                    taskId = activeTaskId,
                    subjectId = activeSubjectId,
                    title = activeTitle,
                    note = note,
                    markLinkedTaskDone = markLinkedTaskDone && activeTaskId != null
                )
                reminderScheduler?.cancelPausedSessionReminder(activeSessionId)
                activePauseReminderKind = null
                timerManager.resetTimer()
                refreshSummary()
                _uiState.update {
                    it.copy(
                        lastCompletionSummary = summary,
                        errorMessage = null
                    )
                }
            }.onFailure { throwable ->
                timerManager.releaseManualCompletionRequest()
                _uiState.update { it.copy(errorMessage = throwable.message ?: "保存学习记录失败") }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    /**
     * Called after a backup restore replaces the local database. The timer must not
     * keep writing the previous session back, and every in-memory snapshot must
     * reflect the restored data: cancel pending timer persistence, reset the timer
     * state machine, then re-read the summary and re-attach any restored running
     * session through the normal recovery path.
     */
    fun refreshAfterBackupRestore() {
        pausedDayBoundaryCloseJob?.cancel()
        reminderScheduler?.cancelPausedSessionReminder(timerManager.activeSessionId)
        activePauseReminderKind = null
        timerManager.resetTimer()
        currentDayStartMillis = todayBounds().startInclusive
        _uiState.update {
            it.copy(showRunningSessionRecovery = false, recoveryGapSeconds = 0)
        }
        viewModelScope.launch {
            runSuspendCatching {
                refreshSummary()
                restoreRunningSession()
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(errorMessage = throwable.message ?: "恢复后刷新数据失败")
                }
            }
        }
    }

    fun markNotificationPermissionRequested() {
        if (!_uiState.value.shouldRequestNotificationPermission) return
        _uiState.update { it.copy(shouldRequestNotificationPermission = false) }
        viewModelScope.launch {
            runSuspendCatching { repository.markNotificationPermissionPrompted() }
                .onFailure { throwable ->
                    _uiState.update {
                        it.copy(errorMessage = throwable.message ?: "保存通知权限状态失败")
                    }
                }
        }
    }

    fun resolveRunningSessionRecovery(includeGapAsFocus: Boolean) {
        timerManager.resolveRunningSessionRecovery(includeGapAsFocus)
        _uiState.update {
            it.copy(
                showRunningSessionRecovery = false,
                recoveryGapSeconds = 0,
                pausedByDistraction = false
            )
        }
        refreshTimerSnapshot()
    }

    fun refreshIfDayChanged() {
        if (closePausedSessionFromPreviousDayIfNeeded()) return
        refreshSummaryIfDayChanged()
        refreshTimerSnapshot()
    }

    fun updateTodayTargetHours(hoursText: String) {
        val hours = hoursText.trim().toDoubleOrNull() ?: return
        if (hours <= 0) return
        viewModelScope.launch {
            runSuspendCatching {
                val seconds = (hours * 3600).toLong()
                repository.saveTodayTargetSeconds(seconds)
                _uiState.update { it.copy(todayTargetSeconds = seconds) }
            }.onFailure { throwable ->
                _uiState.update { it.copy(errorMessage = throwable.message ?: "保存今日目标失败") }
            }
        }
    }

    /**
     * 因生命周期离开前台而暂停。
     *
     * @param recordDistraction true=真正后台（记一次分心，返回查询 token）；
     *   false=无法确认的外部悬浮窗覆盖（不记分心）。
     * @return 真正后台时返回外部应用查询 token；否则或未在学习时返回 null。
     */
    fun recordAppBackgrounded(recordDistraction: Boolean): DistractionLookupToken? {
        if (_uiState.value.timerStatus != TimerStatus.Running) return null
        val sessionId = timerManager.activeSessionId ?: return null
        val now = timerManager.pauseBecauseAppBackgrounded(sessionId, recordDistraction) ?: return null
        if (recordDistraction) {
            activePauseReminderKind = PauseReminderKind.Away
            schedulePausedReminder(PauseReminderKind.Away, now)
        }

        _uiState.update {
            it.copy(
                timerStatus = TimerStatus.Paused,
                activeSeconds = timerManager.currentActiveSeconds(now),
                todayActiveSeconds = timerManager.currentTodayActiveSeconds(now),
                activeElapsedSeconds = timerManager.currentElapsedSeconds(now),
                todayActiveElapsedSeconds = timerManager.currentTodayElapsedSeconds(now),
                aiHelpSeconds = timerManager.currentAiHelpSeconds(now),
                todayActiveAiHelpSeconds = timerManager.currentTodayAiHelpSeconds(now),
                distractionCount = if (recordDistraction) it.distractionCount + 1 else it.distractionCount,
                pausedByDistraction = recordDistraction
            )
        }
        return if (recordDistraction) {
            DistractionLookupToken(sessionId = sessionId, backgroundedAt = now)
        } else {
            null
        }
    }

    /** 结束进行中的 AI 求助时段（显式 ENDED 事件 + 恢复计时）。幂等。 */
    fun endAiHelp() {
        if (!timerManager.isAiHelpActive) return
        reminderScheduler?.cancelPausedSessionReminder(timerManager.activeSessionId)
        activePauseReminderKind = null
        val now = System.currentTimeMillis()
        timerManager.endAiHelp()
        _uiState.update {
            it.copy(
                timerStatus = TimerStatus.Running,
                activeSeconds = timerManager.currentActiveSeconds(now),
                todayActiveSeconds = timerManager.currentTodayActiveSeconds(now),
                activeElapsedSeconds = timerManager.currentElapsedSeconds(now),
                todayActiveElapsedSeconds = timerManager.currentTodayElapsedSeconds(now),
                aiHelpSeconds = timerManager.currentAiHelpSeconds(now),
                todayActiveAiHelpSeconds = timerManager.currentTodayAiHelpSeconds(now),
                aiHelpActive = false,
                pausedByDistraction = false
            )
        }
    }

    fun resumeAfterAppForegrounded() {
        if (!_uiState.value.pausedByDistraction || _uiState.value.timerStatus != TimerStatus.Paused) return
        if (closePausedSessionFromPreviousDayIfNeeded()) return
        reminderScheduler?.cancelPausedSessionReminder(timerManager.activeSessionId)
        activePauseReminderKind = null
        val now = System.currentTimeMillis()
        timerManager.resume()
        _uiState.update {
            it.copy(
                timerStatus = TimerStatus.Running,
                activeSeconds = timerManager.currentActiveSeconds(now),
                todayActiveSeconds = timerManager.currentTodayActiveSeconds(now),
                activeElapsedSeconds = timerManager.currentElapsedSeconds(now),
                todayActiveElapsedSeconds = timerManager.currentTodayElapsedSeconds(now),
                aiHelpSeconds = timerManager.currentAiHelpSeconds(now),
                todayActiveAiHelpSeconds = timerManager.currentTodayAiHelpSeconds(now),
                aiHelpActive = false,
                pausedByDistraction = false
            )
        }
    }

    fun pauseForAiHelp(label: String) {
        if (_uiState.value.timerStatus != TimerStatus.Running) return
        val sessionId = timerManager.activeSessionId ?: return
        val now = System.currentTimeMillis()

        timerManager.pauseForAiHelp(sessionId, label)
        activePauseReminderKind = PauseReminderKind.AiHelp
        schedulePausedReminder(PauseReminderKind.AiHelp, now)

        _uiState.update {
            it.copy(
                timerStatus = TimerStatus.Paused,
                activeSeconds = timerManager.accumulatedActiveSeconds,
                todayActiveSeconds = timerManager.currentTodayActiveSeconds(now),
                activeElapsedSeconds = timerManager.currentElapsedSeconds(now),
                todayActiveElapsedSeconds = timerManager.currentTodayElapsedSeconds(now),
                aiHelpSeconds = timerManager.currentAiHelpSeconds(now),
                todayActiveAiHelpSeconds = timerManager.currentTodayAiHelpSeconds(now),
                aiHelpCount = it.aiHelpCount + 1,
                aiHelpActive = true,
                lastAiHelpLabel = label,
                pausedByDistraction = false
            )
        }
    }

    fun recordDistractionApp(sessionId: Long, appInfo: ForegroundAppInfo?) {
        if (timerManager.activeSessionId != sessionId) return
        val info = appInfo
        if (info == null) {
            Log.d(TAG, "Distraction app not found.")
            return
        }

        timerManager.insertEvent(
            sessionId = sessionId,
            eventType = HomeRepository.EVENT_DISTRACTION_APP,
            eventTime = info.timestamp,
            eventDetail = info.displayText
        )

        _uiState.update {
            val labels = (it.distractionAppLabels + info.displayLabel).distinct()
            it.copy(
                distractionAppLabels = labels,
                distractionRecords = it.distractionRecords + DistractionRecordUi(
                    appLabel = info.displayLabel,
                    timestamp = info.timestamp
                ),
                lastDistractionAppLabel = info.displayLabel
            )
        }
        Log.d(TAG, "Distraction app recorded.")
    }

    fun saveReminderSettings(settings: ReminderSettings) {
        val normalized = settings.normalized()
        viewModelScope.launch {
            runSuspendCatching {
                repository.saveReminderSettings(normalized)
                reminderScheduler?.rescheduleDailyReminder(normalized)
                val kind = activePauseReminderKind
                if (_uiState.value.timerStatus == TimerStatus.Paused && kind != null) {
                    reminderScheduler?.schedulePausedSessionReminder(
                        sessionId = timerManager.activeSessionId ?: return@runSuspendCatching,
                        pauseStartedAt = timerManager.pauseStartedAt,
                        kind = kind,
                        settings = normalized
                    )
                }
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(errorMessage = throwable.message ?: "保存提醒设置失败")
                }
            }
        }
    }

    // --- Summary and plan observation ---

    private suspend fun refreshSummary() {
        if (userId == 0L) return
        currentDayStartMillis = todayBounds().startInclusive
        val composition = repository.todayStudyComposition(userId)
        _uiState.update {
            it.copy(
                todaySeconds = composition.focusSeconds,
                todayElapsedSeconds = composition.totalSeconds,
                todayAiHelpSeconds = composition.aiHelpSeconds,
                todayPauseSeconds = composition.pauseSeconds,
                pendingTaskCount = repository.pendingTaskCount(userId),
                todayTargetSeconds = repository.todayTargetSeconds(),
                isLoading = false
            )
        }
    }

    private suspend fun restoreRunningSession() {
        if (userId == 0L || !timerManager.isIdle) return
        val session = repository.runningSession(userId) ?: return
        val events = repository.sessionEvents(session.id)

        val restored = timerManager.restoreFromSession(
            session = session,
            events = events,
            pendingPlans = _uiState.value.pendingPlans
        )

        if (closePausedSessionFromPreviousDayIfNeeded()) return

        val now = System.currentTimeMillis()
        _uiState.update {
            it.copy(
                timerStatus = restored.status,
                activeTaskId = session.taskId,
                activeSeconds = restored.activeSeconds,
                todayActiveSeconds = timerManager.currentTodayActiveSeconds(now),
                activeElapsedSeconds = restored.elapsedSeconds,
                todayActiveElapsedSeconds = timerManager.currentTodayElapsedSeconds(now),
                activePlanTitle = session.taskId?.let { taskId ->
                    it.pendingPlans.firstOrNull { plan -> plan.id == taskId }?.title
                } ?: session.title,
                activeSubjectName = session.subjectId?.let { subjectId ->
                    it.subjects.firstOrNull { subject -> subject.id == subjectId }?.name
                },
                activePlanTargetSeconds = restored.targetSeconds,
                activePlanCompletedBeforeSeconds = restored.completedBeforeSeconds,
                distractionCount = restored.distractionCount,
                distractionAppLabels = restored.distractionLabels,
                distractionRecords = restored.distractionRecords,
                lastDistractionAppLabel = restored.distractionLabels.lastOrNull(),
                aiHelpCount = restored.aiHelpCount,
                aiHelpSeconds = restored.aiHelpSeconds,
                aiHelpActive = restored.aiHelpActive,
                todayActiveAiHelpSeconds = timerManager.currentTodayAiHelpSeconds(now),
                lastAiHelpLabel = restored.aiHelpLabels.lastOrNull(),
                pausedByDistraction = restored.status == TimerStatus.Paused &&
                    restored.lastDistractionAt != null &&
                    restored.lastTimingEventTime == restored.lastDistractionAt,
                showRunningSessionRecovery = restored.needsRecoveryConfirmation,
                recoveryGapSeconds = restored.recoveryGapSeconds,
                errorMessage = null
            )
        }
    }

    private fun refreshSummaryIfDayChanged() {
        val latestDayStart = todayBounds().startInclusive
        if (latestDayStart == currentDayStartMillis) return
        currentDayStartMillis = latestDayStart
        restartDayPlanObservation(userId)
        refreshCalendarDerivedState()
        viewModelScope.launch {
            refreshSummary()
        }
    }

    private fun closePausedSessionFromPreviousDayIfNeeded(): Boolean {
        val dayStart = todayBounds().startInclusive
        if (!timerManager.shouldClosePausedSessionAt(dayStart)) return false
        if (pausedDayBoundaryCloseJob?.isActive == true) return true

        val sessionId = timerManager.activeSessionId ?: return false
        val endedAt = System.currentTimeMillis()
        val startedAt = timerManager.activeStartedAt
        val durationSeconds = timerManager.currentActiveSeconds(endedAt).coerceAtLeast(0)
        val pauseSeconds = timerManager.currentPauseSeconds(endedAt).coerceAtLeast(0)
        val aiHelpSeconds = timerManager.currentAiHelpSeconds(endedAt).coerceAtLeast(0)
        val taskId = timerManager.activeTaskId
        val subjectId = timerManager.activeSubjectId
        val title = timerManager.activeTitle
        val note = buildSessionNote()?.let { "$it；暂停跨日，已自动结束" }
            ?: "暂停跨日，已自动结束"
        val summary = timerManager.buildCompletionSummary(endedAt, durationSeconds).copy(
            endReason = "因暂停跨日，已自动结束本次学习。"
        )

        pausedDayBoundaryCloseJob = viewModelScope.launch {
            runSuspendCatching {
                repository.completeSession(
                    sessionId = sessionId,
                    userId = userId,
                    startedAt = startedAt,
                    endedAt = endedAt,
                    durationSeconds = durationSeconds,
                    pauseSeconds = pauseSeconds,
                    aiHelpSeconds = aiHelpSeconds,
                    taskId = taskId,
                    subjectId = subjectId,
                    title = title,
                    note = note
                )
                reminderScheduler?.cancelPausedSessionReminder(sessionId)
                activePauseReminderKind = null
                timerManager.resetTimer()
                refreshSummary()
                _uiState.update {
                    it.copy(lastCompletionSummary = summary, errorMessage = null)
                }
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(errorMessage = throwable.message ?: "结束昨日暂停的学习记录失败")
                }
            }
        }
        return true
    }

    private fun refreshTimerSnapshot() {
        if (!timerManager.isActive) return
        val now = System.currentTimeMillis()
        _uiState.update {
            it.copy(
                activeSeconds = timerManager.currentActiveSeconds(now),
                todayActiveSeconds = timerManager.currentTodayActiveSeconds(now),
                activeElapsedSeconds = timerManager.currentElapsedSeconds(now),
                todayActiveElapsedSeconds = timerManager.currentTodayElapsedSeconds(now),
                aiHelpSeconds = timerManager.currentAiHelpSeconds(now),
                todayActiveAiHelpSeconds = timerManager.currentTodayAiHelpSeconds(now),
                aiHelpActive = timerManager.isAiHelpActive
            )
        }
    }

    private fun observePlanSummary(userId: Long) {
        restartDayPlanObservation(userId)
        viewModelScope.launch {
            repository.observeSubjects(userId).collect { subjectsEntities ->
                _uiState.update { state ->
                    val subjects = subjectsEntities.map { subject -> subject.toStudySubjectUi() }
                    state.copy(
                        subjects = subjects,
                        activeSubjectName = timerManager.activeSubjectId?.let { subjectId ->
                            subjects.firstOrNull { it.id == subjectId }?.name
                        } ?: state.activeSubjectName
                    )
                }
            }
        }
        viewModelScope.launch {
            repository.observeWeeklyGoals(userId).collect { goals ->
                latestWeeklyGoals = goals
                refreshCalendarDerivedState()
            }
        }
        viewModelScope.launch {
            repository.observeRestDays().collect { restDays ->
                latestRestDays = restDays
                refreshCalendarDerivedState()
            }
        }
        viewModelScope.launch {
            repository.observeReminderSettings().collect { settings ->
                _uiState.update { it.copy(reminderSettings = settings) }
            }
        }
    }

    private fun schedulePausedReminder(kind: PauseReminderKind, pauseStartedAt: Long) {
        val sessionId = timerManager.activeSessionId ?: return
        reminderScheduler?.schedulePausedSessionReminder(
            sessionId = sessionId,
            pauseStartedAt = pauseStartedAt,
            kind = kind,
            settings = _uiState.value.reminderSettings
        )
    }

    private fun refreshCalendarDerivedState(now: Long = System.currentTimeMillis()) {
        val currentWeekStart = PlanRepository.startOfWeek(now)
        val nextWeekStart = PlanRepository.nextWeekStart(currentWeekStart)
        _uiState.update {
            it.copy(
                currentWeeklyGoals = latestWeeklyGoals
                    .filter { goal ->
                        goal.weekStart == currentWeekStart &&
                            goal.status in setOf(
                                PlanRepository.WEEKLY_GOAL_TODO,
                                PlanRepository.WEEKLY_GOAL_DONE
                            )
                    }
                    .map { goal ->
                        HomeWeeklyGoalUi(
                            id = goal.id,
                            title = goal.title,
                            successCriteria = goal.successCriteria,
                            status = goal.status
                        )
                    },
                nextWeeklyGoals = latestWeeklyGoals
                    .filter { goal -> goal.weekStart == nextWeekStart }
                    .map { goal ->
                        HomeWeeklyGoalUi(
                            id = goal.id,
                            title = goal.title,
                            successCriteria = goal.successCriteria,
                            status = goal.status
                        )
                    },
                isRestDay = PlanRepository.isRestDay(latestRestDays, now)
            )
        }
    }

    private fun ReminderSettings.hasAnyEnabledReminder(): Boolean {
        return planRemindersEnabled ||
            weeklyGoalRemindersEnabled ||
            awayReminderEnabled ||
            manualPauseReminderEnabled ||
            aiPauseReminderEnabled
    }

    private fun restartDayPlanObservation(userId: Long) {
        if (userId == 0L) return
        dayPlanObservationJob?.cancel()
        dayPlanObservationJob = viewModelScope.launch {
            launch {
                repository.observePendingTaskCount(userId).collect { count ->
                    _uiState.update { it.copy(pendingTaskCount = count) }
                }
            }
            launch {
                repository.observeNextPendingTask(userId).collect { task ->
                    _uiState.update { it.copy(nextPlan = task?.toNextPlanUi()) }
                }
            }
            launch {
                repository.observePendingTasks(userId).collect { tasks ->
                    _uiState.update { state ->
                        val plans = tasks.map { task -> task.toStudyPlanUi() }
                        state.copy(
                            pendingPlans = plans,
                            activePlanTitle = timerManager.activeTaskId?.let { taskId ->
                                plans.firstOrNull { it.id == taskId }?.title
                            } ?: state.activePlanTitle
                        )
                    }
                }
            }
        }
    }

    private fun TaskEntity.toNextPlanUi(): NextPlanUi {
        return NextPlanUi(
            id = id,
            title = title,
            content = content,
            dueAt = dueAt,
            subjectId = subjectId,
            targetDurationSeconds = targetDurationSeconds ?: timerManager.parseDurationSeconds(title)
        )
    }

    private fun TaskEntity.toStudyPlanUi(): StudyPlanUi {
        return StudyPlanUi(
            id = id,
            title = title,
            content = content,
            dueAt = dueAt,
            subjectId = subjectId,
            targetDurationSeconds = targetDurationSeconds ?: timerManager.parseDurationSeconds(title)
        )
    }

    private fun SubjectEntity.toStudySubjectUi(): StudySubjectUi {
        return StudySubjectUi(id = id, name = name)
    }

    private fun buildSessionNote(): String? {
        val state = _uiState.value
        return timerManager.buildSessionNote(
            distractionCount = state.distractionCount,
            aiHelpCount = state.aiHelpCount,
            distractionAppLabels = state.distractionAppLabels,
            lastAiHelpLabel = state.lastAiHelpLabel,
            aiHelpDurationText = state.aiHelpDurationText
        )
    }

    class Factory(
        private val database: AlertTimeDatabase,
        private val reminderScheduler: ReminderScheduler? = null
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return HomeViewModel(HomeRepository(database), reminderScheduler) as T
        }
    }

    private companion object {
        const val TAG = "AlertTimeDistraction"
    }
}
