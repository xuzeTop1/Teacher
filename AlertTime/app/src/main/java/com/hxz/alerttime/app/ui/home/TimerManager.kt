package com.hxz.alerttime.app.ui.home

import android.os.SystemClock
import com.hxz.alerttime.app.core.time.todayBounds
import com.hxz.alerttime.app.core.coroutines.runSuspendCatching
import com.hxz.alerttime.app.data.backup.BackupTimerGate
import com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity
import com.hxz.alerttime.app.data.repository.HomeRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.math.max

/**
 * Encapsulates the timer state machine: start/pause/resume/finish lifecycle,
 * ticker job management, active duration calculation, and event insertion.
 *
 * [backupGate] is the shared coordination point with backup/restore: while a
 * backup operation holds the gate, [start] refuses to begin a session, so a
 * restore can never race with timer writes; while a session is active the gate
 * blocks backup/restore.
 */
class TimerManager(
    private val repository: HomeRepository,
    private val scope: CoroutineScope,
    private val listener: Listener,
    private val backupGate: BackupTimerGate = BackupTimerGate()
) {
    interface Listener {
        /** Called every second while timer is Running. */
        fun onTimerTick()
        /** Called when timer status changes (Running/Paused/Idle). */
        fun onTimerStatusChanged(status: TimerStatus)
        /** Persists an automatically completed target session and its linked task. */
        suspend fun onTargetReached(
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
        ): Boolean
        /** Called when a new session has started successfully. */
        fun onSessionStarted(
            taskId: Long?,
            subjectId: Long?,
            targetDurationSeconds: Long?,
            title: String,
            completedBeforeSeconds: Long
        )
        /** Called when start() fails. */
        fun onStartFailed(message: String)
        /** Reports a non-fatal persistence failure instead of letting a coroutine crash the app. */
        fun onTimerPersistenceFailed(message: String) {}
        /** Builds the note used when a target is reached automatically. */
        fun onBuildSessionNote(): String?
        /** Called when a new day is detected during ticking. */
        fun onDayChanged()
    }

    // --- State tracking ---
    var activeSessionId: Long? = null
        private set
    var activeTaskId: Long? = null
        private set
    var activeSubjectId: Long? = null
        private set
    var activeTaskTargetSeconds: Long? = null
        private set
    var activeTaskCompletedBeforeSeconds: Long = 0
        private set
    var activeTitle: String = "专注学习"
        private set
    var activeStartedAt: Long = 0
        private set
    var lastResumedAt: Long = 0
        private set
    var accumulatedActiveSeconds: Long = 0
        private set
    var accumulatedPauseSeconds: Long = 0
        private set
    var accumulatedAiHelpSeconds: Long = 0
        private set
    var aiHelpStartedAt: Long = 0
        private set
    var pauseStartedAt: Long = 0
        private set
    var status: TimerStatus = TimerStatus.Idle
        private set

    private var tickerJob: Job? = null
    private var lastResumedElapsedRealtime: Long = 0
    private var completionRequested: Boolean = false
    private var recoveryPending: Boolean = false
    private var recoveryGapStartedAt: Long = 0
    private var activeDayStartMillis: Long = 0
    private var activeSecondsBeforeDay: Long = 0
    private var aiHelpSecondsBeforeDay: Long = 0
    private val persistenceMutex = Mutex()

    // --- Public state accessors ---
    val isActive: Boolean get() = activeSessionId != null && status != TimerStatus.Idle
    val isRunning: Boolean get() = status == TimerStatus.Running
    val isIdle: Boolean get() = status == TimerStatus.Idle
    /** 是否处于 AI 求助时段（开始事件已持久化、结束事件未写入）。 */
    val isAiHelpActive: Boolean get() = aiHelpStartedAt > 0

    fun shouldClosePausedSessionAt(dayStartMillis: Long): Boolean {
        return shouldClosePausedSessionAtDayBoundary(
            status = status,
            pauseStartedAt = pauseStartedAt,
            dayStartMillis = dayStartMillis
        )
    }

    // --- Lifecycle methods ---

    fun start(
        userId: Long,
        taskId: Long?,
        subjectId: Long?,
        fallbackTitle: String? = null,
        fallbackTargetDurationSeconds: Long? = null,
        pendingPlans: List<StudyPlanUi>,
        subjects: List<StudySubjectUi>
    ) {
        if (userId == 0L || status != TimerStatus.Idle) return
        if (!backupGate.tryStartTimer()) {
            listener.onStartFailed("正在进行数据备份，请稍后再开始学习")
            return
        }
        val now = System.currentTimeMillis()
        val selectedPlan = pendingPlans.firstOrNull { it.id == taskId }
        val selectedSubjectId = subjectId ?: selectedPlan?.subjectId
        val selectedSubject = subjects.firstOrNull { it.id == selectedSubjectId }
        val targetDurationSeconds = selectedPlan?.targetDurationSeconds
            ?: fallbackTargetDurationSeconds
            ?: selectedPlan?.title?.let(::parseDurationSeconds)
        val title = selectedPlan?.title ?: fallbackTitle ?: selectedSubject?.let { "${it.name}学习" } ?: "专注学习"

        status = TimerStatus.Starting
        listener.onTimerStatusChanged(status)
        scope.launch {
            runSuspendCatching {
                activeTaskCompletedBeforeSeconds = selectedPlan?.id
                    ?.let { repository.completedTaskDurationSeconds(it) }
                    ?: taskId?.let { repository.completedTaskDurationSeconds(it) }
                    ?: 0
                activeSessionId = repository.startSession(
                    userId = userId,
                    startedAt = now,
                    taskId = selectedPlan?.id ?: taskId,
                    subjectId = selectedSubjectId,
                    title = title
                )
                activeTaskId = selectedPlan?.id ?: taskId
                activeSubjectId = selectedSubjectId
                activeTaskTargetSeconds = targetDurationSeconds
                activeTitle = title
                activeStartedAt = now
                lastResumedAt = now
                lastResumedElapsedRealtime = SystemClock.elapsedRealtime()
                accumulatedActiveSeconds = 0
                accumulatedPauseSeconds = 0
                accumulatedAiHelpSeconds = 0
                aiHelpStartedAt = 0
                pauseStartedAt = 0
                activeDayStartMillis = todayBounds().startInclusive
                activeSecondsBeforeDay = 0
                aiHelpSecondsBeforeDay = 0
                completionRequested = false
                status = TimerStatus.Running

                listener.onSessionStarted(
                    taskId = activeTaskId,
                    subjectId = selectedSubjectId,
                    targetDurationSeconds = targetDurationSeconds,
                    title = title,
                    completedBeforeSeconds = activeTaskCompletedBeforeSeconds
                )
                listener.onTimerStatusChanged(status)
                startTicker()
            }.onFailure { throwable ->
                resetTimerState()
                listener.onStartFailed(throwable.message ?: "开始学习失败")
            }
        }
    }

    fun pause() {
        val sessionId = activeSessionId ?: return
        val now = System.currentTimeMillis()
        rollActiveDayIfNeeded(now)
        accumulatedActiveSeconds = currentActiveSeconds(now)
        lastResumedAt = now
        lastResumedElapsedRealtime = 0
        pauseStartedAt = now
        val aiEndedAt = endAiHelpInternal(now)
        tickerJob?.cancel()
        persistTimerMutation {
            if (aiEndedAt != null) {
                repository.insertEvent(sessionId, HomeRepository.EVENT_AI_HELP_ENDED, aiEndedAt)
            }
            repository.insertEvent(sessionId, HomeRepository.EVENT_PAUSE, now)
            persistRunningProgressLocked(now)
        }
        status = TimerStatus.Paused
        listener.onTimerStatusChanged(status)
    }

    fun resume() {
        val sessionId = activeSessionId ?: return
        if (!canResumeTimer(status, pauseStartedAt, sessionId)) return
        val now = System.currentTimeMillis()
        accumulatedPauseSeconds += ((now - pauseStartedAt).coerceAtLeast(0) / 1000)
        val aiEndedAt = endAiHelpInternal(now)
        lastResumedAt = now
        lastResumedElapsedRealtime = SystemClock.elapsedRealtime()
        pauseStartedAt = 0
        persistTimerMutation {
            if (aiEndedAt != null) {
                repository.insertEvent(sessionId, HomeRepository.EVENT_AI_HELP_ENDED, aiEndedAt)
            }
            repository.insertEvent(sessionId, HomeRepository.EVENT_RESUME, now)
            persistRunningProgressLocked(now)
        }
        status = TimerStatus.Running
        listener.onTimerStatusChanged(status)
        startTicker()
    }

    fun resetTimer() {
        resetTimerState()
    }

    fun requestManualCompletion(): Boolean {
        if (!isActive || completionRequested) return false
        completionRequested = true
        tickerJob?.cancel()
        return true
    }

    fun releaseManualCompletionRequest() {
        if (!isActive) return
        completionRequested = false
        if (status == TimerStatus.Running) startTicker()
    }

    /**
     * 进入 AI 求助模式（显式开始语义）：
     * - 插入 EVENT_AI_HELP（开始）+ EVENT_PAUSE（AI 期间计时器暂停）；
     * - 幂等：已在 AI 模式中重复调用直接忽略；
     * - 打开 AI 求助模式时立即持久化开始事件。
     */
    fun pauseForAiHelp(sessionId: Long, label: String) {
        if (aiHelpStartedAt > 0) return // 已在 AI 模式：幂等，不重复开始
        val now = System.currentTimeMillis()
        rollActiveDayIfNeeded(now)
        accumulatedActiveSeconds = currentActiveSeconds(now)
        lastResumedAt = now
        lastResumedElapsedRealtime = 0
        pauseStartedAt = now
        aiHelpStartedAt = now
        tickerJob?.cancel()

        persistTimerMutation {
            repository.insertEvent(
                sessionId = sessionId,
                eventType = HomeRepository.EVENT_AI_HELP,
                eventTime = now,
                eventDetail = label
            )
            repository.insertEvent(sessionId, HomeRepository.EVENT_PAUSE, now)
            persistRunningProgressLocked(now)
        }

        status = TimerStatus.Paused
        listener.onTimerStatusChanged(status)
    }

    /**
     * 结束 AI 求助模式（显式结束语义）：插入 EVENT_AI_HELP_ENDED + EVENT_RESUME。
     * 幂等：不在 AI 模式中调用无效果。
     */
    fun endAiHelp() {
        val sessionId = activeSessionId ?: return
        if (aiHelpStartedAt <= 0) return // 幂等：不在 AI 模式中
        val now = System.currentTimeMillis()
        val aiEndedAt = endAiHelpInternal(now)
        if (aiEndedAt == null) return
        pauseStartedAt = 0
        lastResumedAt = now
        lastResumedElapsedRealtime = SystemClock.elapsedRealtime()
        persistTimerMutation {
            repository.insertEvent(sessionId, HomeRepository.EVENT_AI_HELP_ENDED, aiEndedAt)
            repository.insertEvent(sessionId, HomeRepository.EVENT_RESUME, now)
            persistRunningProgressLocked(now)
        }
        status = TimerStatus.Running
        listener.onTimerStatusChanged(status)
        startTicker()
    }

    /**
     * 因生命周期离开前台而暂停（真正后台或检测到的外部悬浮窗覆盖）。
     *
     * @param recordDistraction true=真正后台（记录一次分心）；false=检测到外部悬浮窗覆盖（不记录分心）。
     * @return 暂停时刻；不适用（未在学习）时返回 null。
     */
    fun pauseBecauseAppBackgrounded(sessionId: Long, recordDistraction: Boolean): Long? {
        if (status != TimerStatus.Running && aiHelpStartedAt <= 0) return null
        val now = System.currentTimeMillis()
        rollActiveDayIfNeeded(now)
        accumulatedActiveSeconds = currentActiveSeconds(now)
        lastResumedAt = now
        lastResumedElapsedRealtime = 0
        pauseStartedAt = now
        val aiEndedAt = endAiHelpInternal(now)
        tickerJob?.cancel()
        status = TimerStatus.Paused
        listener.onTimerStatusChanged(status)
        persistTimerMutation {
            if (aiEndedAt != null) {
                repository.insertEvent(sessionId, HomeRepository.EVENT_AI_HELP_ENDED, aiEndedAt)
            }
            if (recordDistraction) {
                repository.insertEvent(sessionId, HomeRepository.EVENT_DISTRACTION, now)
            }
            repository.insertEvent(sessionId, HomeRepository.EVENT_PAUSE, now)
            persistRunningProgressLocked(now)
        }
        return now
    }

    /**
     * 内存侧结束 AI 时段并累计秒数（幂等）：
     * 返回 AI 结束时刻（= now），未在 AI 模式时返回 null。事件落库由调用方完成。
     */
    private fun endAiHelpInternal(now: Long): Long? {
        val startedAt = aiHelpStartedAt
        if (startedAt <= 0) return null
        accumulatedAiHelpSeconds += ((now - startedAt).coerceAtLeast(0) / 1000)
        aiHelpStartedAt = 0
        return now
    }

    fun insertEvent(sessionId: Long, eventType: Int, eventTime: Long, eventDetail: String? = null) {
        scope.launch {
            runSuspendCatching {
                repository.insertEvent(sessionId, eventType, eventTime, eventDetail)
            }
        }
    }

    // --- Calculation methods ---

    fun currentActiveSeconds(now: Long): Long {
        return if (status == TimerStatus.Running) {
            val elapsedMillis = if (lastResumedElapsedRealtime > 0) {
                SystemClock.elapsedRealtime() - lastResumedElapsedRealtime
            } else {
                now - lastResumedAt
            }
            accumulatedActiveSeconds + (elapsedMillis.coerceAtLeast(0) / 1000)
        } else {
            accumulatedActiveSeconds
        }
    }

    /** Active learning time belonging to the current calendar day only. */
    fun currentTodayActiveSeconds(now: Long): Long {
        rollActiveDayIfNeeded(now)
        return (currentActiveSeconds(now) - activeSecondsBeforeDay).coerceAtLeast(0)
    }

    fun currentElapsedSeconds(now: Long): Long {
        return if (activeStartedAt > 0) {
            max(0, (now - activeStartedAt) / 1000)
        } else {
            0
        }
    }

    /** Wall-clock learning time belonging to the current calendar day only. */
    fun currentTodayElapsedSeconds(now: Long): Long {
        if (activeStartedAt <= 0) return 0
        val start = max(activeStartedAt, todayBounds().startInclusive)
        return max(0, (now - start) / 1000)
    }

    fun currentAiHelpSeconds(now: Long): Long {
        return accumulatedAiHelpSeconds + if (aiHelpStartedAt > 0) {
            (now - aiHelpStartedAt).coerceAtLeast(0) / 1000
        } else {
            0
        }
    }

    /** AI-help pause time belonging to the current calendar day only. */
    fun currentTodayAiHelpSeconds(now: Long): Long {
        rollActiveDayIfNeeded(now)
        return (currentAiHelpSeconds(now) - aiHelpSecondsBeforeDay).coerceAtLeast(0)
    }

    fun buildSessionNote(distractionCount: Int, aiHelpCount: Int, distractionAppLabels: List<String>, lastAiHelpLabel: String?, aiHelpDurationText: String): String? {
        if (distractionCount <= 0 && aiHelpCount <= 0) return null
        val openedApps = distractionAppLabels.take(5).joinToString(separator = "、")
        val aiHelpText = lastAiHelpLabel?.let {
            "；AI 求助 $aiHelpCount 次，共 $aiHelpDurationText，最近使用：$it"
        }.orEmpty()
        return if (distractionCount <= 0) {
            aiHelpText.removePrefix("；")
        } else if (openedApps.isBlank()) {
            "本次学习记录到 $distractionCount 次分心$aiHelpText"
        } else {
            "本次学习记录到 $distractionCount 次分心；打开过：$openedApps$aiHelpText"
        }
    }

    fun buildCompletionSummary(endedAt: Long, effectiveSeconds: Long): CompletionSummaryUi {
        return CompletionSummaryUi(
            title = activeTitle,
            startedAt = activeStartedAt,
            endedAt = endedAt,
            effectiveSeconds = max(0, effectiveSeconds),
            elapsedSeconds = max(0, (endedAt - activeStartedAt) / 1000),
            aiHelpSeconds = max(0, currentAiHelpSeconds(endedAt)),
            targetSeconds = activeTaskTargetSeconds
        )
    }

    // --- Persistence ---

    fun currentPauseSeconds(now: Long = System.currentTimeMillis()): Long {
        return pauseSecondsAt(
            accumulatedPauseSeconds = accumulatedPauseSeconds,
            status = status,
            pauseStartedAt = pauseStartedAt,
            now = now
        )
    }

    private fun persistTimerMutation(block: suspend () -> Unit) {
        scope.launch {
            runSuspendCatching {
                persistenceMutex.withLock { block() }
            }.onFailure { throwable ->
                listener.onTimerPersistenceFailed(throwable.message ?: "保存学习进度失败")
            }
        }
    }

    /** Suspend version for callers already inside a coroutine that need to await persistence. */
    suspend fun awaitPersistRunningProgress(now: Long = System.currentTimeMillis()) {
        persistenceMutex.withLock {
            persistRunningProgressLocked(now)
        }
    }

    private suspend fun persistRunningProgressLocked(now: Long) {
        val sessionId = activeSessionId ?: return
        repository.updateRunningSessionProgress(
            sessionId = sessionId,
            durationSeconds = max(0, currentActiveSeconds(now)),
            pauseSeconds = max(0, currentPauseSeconds(now)),
            aiHelpSeconds = max(0, currentAiHelpSeconds(now)),
            updatedAt = now
        )
    }

    // --- Restore session ---

    suspend fun restoreFromSession(
        session: com.hxz.alerttime.app.data.local.entity.StudySessionEntity,
        events: List<StudySessionEventEntity>,
        pendingPlans: List<StudyPlanUi>
    ): RestoredTimerState {
        // A restored running session makes the timer active: backup/restore must
        // be blocked while it exists.
        backupGate.markTimerBusy()
        val lastTimingEvent = events
            .lastOrNull { it.eventType in timingEventTypes }
        val persistedStatus = when (lastTimingEvent?.eventType) {
            HomeRepository.EVENT_PAUSE -> TimerStatus.Paused
            else -> TimerStatus.Running
        }
        val now = System.currentTimeMillis()
        val runningGapMillis = (now - session.updatedAt).coerceAtLeast(0)
        val needsRecoveryConfirmation = requiresRunningSessionRecovery(
            persistedStatus = persistedStatus,
            runningGapMillis = runningGapMillis,
            thresholdMillis = RECOVERY_CONFIRMATION_THRESHOLD_MS
        )
        val restoredStatus = if (needsRecoveryConfirmation) TimerStatus.Paused else persistedStatus

        activeSessionId = session.id
        activeTaskId = session.taskId
        activeSubjectId = session.subjectId
        if (session.taskId != null) {
            activeTaskCompletedBeforeSeconds = repository.completedTaskDurationSeconds(session.taskId)
        } else {
            activeTaskCompletedBeforeSeconds = 0
        }
        activeTaskTargetSeconds = session.taskId?.let { taskId ->
            repository.task(taskId)?.targetDurationSeconds
                ?: pendingPlans.firstOrNull { it.id == taskId }?.targetDurationSeconds
                ?: session.title?.let(::parseDurationSeconds)
        }
        activeTitle = session.title ?: "专注学习"
        activeStartedAt = session.startTime
        accumulatedActiveSeconds = session.durationSeconds + if (
            persistedStatus == TimerStatus.Running && !needsRecoveryConfirmation
        ) {
            runningGapMillis / 1000
        } else {
            0
        }
        accumulatedPauseSeconds = session.pauseSeconds
        // AI 时段恢复采用「安全截断」：只恢复已闭合时段（ENDED/RESUME/END 成对）的累计值，
        // 不把未闭合的 AI 时段恢复为「进行中」——进程重建无法区分「正常暂停等待回来」
        // 与「崩溃遗留」，恢复进行中会造成 AI 时长无限增长。用户回来后如需继续 AI 求助，
        // 会重新进入 AI 模式（重新写入开始事件）。
        accumulatedAiHelpSeconds = calculateAiHelpSeconds(events)
        pauseStartedAt = if (needsRecoveryConfirmation) {
            now
        } else if (restoredStatus == TimerStatus.Paused) {
            lastTimingEvent?.eventTime ?: session.updatedAt
        } else {
            0
        }
        aiHelpStartedAt = 0
        lastResumedAt = if (restoredStatus == TimerStatus.Running) {
            now
        } else {
            0
        }
        lastResumedElapsedRealtime = if (restoredStatus == TimerStatus.Running) {
            SystemClock.elapsedRealtime()
        } else {
            0
        }
        recoveryPending = needsRecoveryConfirmation
        recoveryGapStartedAt = if (needsRecoveryConfirmation) session.updatedAt else 0
        status = restoredStatus
        initializeActiveDayTracking(session, events, restoredStatus)

        if (restoredStatus == TimerStatus.Running) {
            startTicker()
        }

        return RestoredTimerState(
            status = restoredStatus,
            activeSeconds = currentActiveSeconds(now),
            elapsedSeconds = currentElapsedSeconds(now),
            targetSeconds = activeTaskTargetSeconds,
            completedBeforeSeconds = activeTaskCompletedBeforeSeconds,
            distractionCount = events.count { it.eventType == HomeRepository.EVENT_DISTRACTION },
            distractionLabels = events
                .filter { it.eventType == HomeRepository.EVENT_DISTRACTION_APP }
                .mapNotNull { it.eventDetail }
                .map(::stripPackageName)
                .distinct(),
            distractionRecords = events
                .filter { it.eventType == HomeRepository.EVENT_DISTRACTION_APP }
                .mapNotNull { event ->
                    event.eventDetail?.let { detail ->
                        DistractionRecordUi(
                            appLabel = stripPackageName(detail),
                            timestamp = event.eventTime
                        )
                    }
                },
            aiHelpCount = events
                .filter { it.eventType == HomeRepository.EVENT_AI_HELP }
                .mapNotNull { it.eventDetail }
                .size,
            aiHelpSeconds = currentAiHelpSeconds(now),
            aiHelpActive = aiHelpStartedAt > 0,
            aiHelpLabels = events
                .filter { it.eventType == HomeRepository.EVENT_AI_HELP }
                .mapNotNull { it.eventDetail },
            lastDistractionAt = events
                .lastOrNull { it.eventType == HomeRepository.EVENT_DISTRACTION }
                ?.eventTime,
            lastTimingEventTime = lastTimingEvent?.eventTime,
            needsRecoveryConfirmation = needsRecoveryConfirmation,
            recoveryGapSeconds = runningGapMillis / 1000
        )
    }

    fun resolveRunningSessionRecovery(includeGapAsFocus: Boolean) {
        if (!recoveryPending || activeSessionId == null) return
        val now = System.currentTimeMillis()
        val gapMillis = (now - recoveryGapStartedAt).coerceAtLeast(0)
        if (includeGapAsFocus) {
            accumulatedActiveSeconds += gapMillis / 1000
        } else {
            accumulatedPauseSeconds += gapMillis / 1000
            insertEvent(
                sessionId = activeSessionId ?: return,
                eventType = HomeRepository.EVENT_PAUSE,
                eventTime = recoveryGapStartedAt
            )
        }
        recoveryPending = false
        recoveryGapStartedAt = 0
        pauseStartedAt = 0  // 修复：Gap 已累计，不应再认为处于暂停状态
        resume()
    }

    // --- Ticker management ---

    private fun startTicker() {
        tickerJob?.cancel()
        tickerJob = scope.launch {
            while (status == TimerStatus.Running) {
                val now = System.currentTimeMillis()
                listener.onDayChanged()
                listener.onTimerTick()
                checkTaskTargetReached(now)
                delay(1000)
            }
        }
    }

    private fun checkTaskTargetReached(now: Long) {
        if (completionRequested || recoveryPending) return
        val taskId = activeTaskId ?: return
        val targetSeconds = activeTaskTargetSeconds?.takeIf { it > 0 } ?: return
        val activeSeconds = currentActiveSeconds(now)
        if (!shouldCompleteTaskAtTarget(
                completedBeforeSeconds = activeTaskCompletedBeforeSeconds,
                activeSessionSeconds = activeSeconds,
                targetSeconds = targetSeconds
            )
        ) {
            return
        }

        completionRequested = true
        tickerJob?.cancel()
        val sessionId = activeSessionId ?: return
        val finalActiveSeconds = max(0, activeSeconds)
        val pauseSeconds = max(0, accumulatedPauseSeconds)
        val aiHelpSeconds = max(0, currentAiHelpSeconds(now))
        accumulatedActiveSeconds = finalActiveSeconds
        lastResumedAt = now
        lastResumedElapsedRealtime = 0
        status = TimerStatus.Saving
        listener.onTimerStatusChanged(status)

        scope.launch {
            val completed = runSuspendCatching {
                awaitPersistRunningProgress(now)
                val note = listener.onBuildSessionNote()
                    ?.let { "$it；已达到计划目标" }
                    ?: "已达到计划目标"
                listener.onTargetReached(
                    sessionId = sessionId,
                    startedAt = activeStartedAt,
                    endedAt = now,
                    finalActiveSeconds = finalActiveSeconds,
                    pauseSeconds = pauseSeconds,
                    taskId = taskId,
                    subjectId = activeSubjectId,
                    title = activeTitle,
                    note = note,
                    targetSeconds = targetSeconds,
                    aiHelpSeconds = aiHelpSeconds
                )
            }.getOrDefault(false)
            if (completed) {
                resetTimerState()
            } else {
                completionRequested = false
                pauseStartedAt = now
                status = TimerStatus.Paused
                listener.onTimerStatusChanged(status)
                runSuspendCatching {
                    persistenceMutex.withLock {
                        repository.insertEvent(sessionId, HomeRepository.EVENT_PAUSE, now)
                        persistRunningProgressLocked(now)
                    }
                }.onFailure { throwable ->
                    listener.onTimerPersistenceFailed(throwable.message ?: "保存学习进度失败")
                }
            }
        }
    }

    private fun resetTimerState() {
        tickerJob?.cancel()
        backupGate.markTimerIdle()
        activeSessionId = null
        activeTaskId = null
        activeSubjectId = null
        activeTaskTargetSeconds = null
        activeTaskCompletedBeforeSeconds = 0
        activeTitle = "专注学习"
        activeStartedAt = 0
        lastResumedAt = 0
        lastResumedElapsedRealtime = 0
        accumulatedActiveSeconds = 0
        accumulatedPauseSeconds = 0
        accumulatedAiHelpSeconds = 0
        aiHelpStartedAt = 0
        pauseStartedAt = 0
        recoveryPending = false
        recoveryGapStartedAt = 0
        activeDayStartMillis = 0
        activeSecondsBeforeDay = 0
        aiHelpSecondsBeforeDay = 0
        completionRequested = false
        status = TimerStatus.Idle
        listener.onTimerStatusChanged(status)
    }

    private fun rollActiveDayIfNeeded(now: Long) {
        val latestDayStart = todayBounds().startInclusive
        if (activeDayStartMillis == latestDayStart) return
        activeSecondsBeforeDay = when {
            activeStartedAt <= 0 || activeStartedAt >= latestDayStart -> 0
            status == TimerStatus.Running && lastResumedAt in 1 until latestDayStart -> {
                accumulatedActiveSeconds + (latestDayStart - lastResumedAt) / 1000
            }
            else -> accumulatedActiveSeconds
        }.coerceAtMost(currentActiveSeconds(now).coerceAtLeast(0))
        aiHelpSecondsBeforeDay = when {
            activeStartedAt <= 0 || activeStartedAt >= latestDayStart -> 0
            aiHelpStartedAt in 1 until latestDayStart -> {
                accumulatedAiHelpSeconds + (latestDayStart - aiHelpStartedAt) / 1000
            }
            else -> accumulatedAiHelpSeconds
        }.coerceAtMost(currentAiHelpSeconds(now).coerceAtLeast(0))
        activeDayStartMillis = latestDayStart
    }

    private fun initializeActiveDayTracking(
        session: com.hxz.alerttime.app.data.local.entity.StudySessionEntity,
        events: List<StudySessionEventEntity>,
        restoredStatus: TimerStatus
    ) {
        val dayStart = todayBounds().startInclusive
        activeDayStartMillis = dayStart
        activeSecondsBeforeDay = when {
            session.startTime >= dayStart -> 0
            session.updatedAt <= dayStart -> {
                session.durationSeconds + if (restoredStatus == TimerStatus.Running) {
                    (dayStart - session.updatedAt) / 1000
                } else {
                    0
                }
            }
            else -> {
                val activeAfterDayStart = activeSecondsBetween(
                    startInclusive = dayStart,
                    endExclusive = session.updatedAt,
                    sessionStartedAt = session.startTime,
                    events = events
                )
                (session.durationSeconds - activeAfterDayStart).coerceAtLeast(0)
            }
        }
        aiHelpSecondsBeforeDay = when {
            session.startTime >= dayStart -> 0
            session.updatedAt <= dayStart -> accumulatedAiHelpSeconds
            else -> {
                val aiHelpAfterDayStart = aiHelpSecondsBetween(
                    startInclusive = dayStart,
                    endExclusive = session.updatedAt,
                    events = events
                )
                (accumulatedAiHelpSeconds - aiHelpAfterDayStart).coerceAtLeast(0)
            }
        }
    }

    private fun aiHelpSecondsBetween(
        startInclusive: Long,
        endExclusive: Long,
        events: List<StudySessionEventEntity>
    ): Long {
        if (endExclusive <= startInclusive) return 0
        val sortedEvents = events.sortedBy { it.eventTime }
        var inAiHelp = false
        sortedEvents.filter { it.eventTime <= startInclusive }.forEach { event ->
            when (event.eventType) {
                HomeRepository.EVENT_AI_HELP -> inAiHelp = true
                HomeRepository.EVENT_AI_HELP_ENDED,
                HomeRepository.EVENT_RESUME,
                HomeRepository.EVENT_END -> inAiHelp = false
            }
        }
        var cursor = startInclusive
        var totalMillis = 0L
        sortedEvents
            .filter { it.eventTime > startInclusive && it.eventTime < endExclusive }
            .forEach { event ->
                if (inAiHelp) totalMillis += event.eventTime - cursor
                when (event.eventType) {
                    HomeRepository.EVENT_AI_HELP -> inAiHelp = true
                    HomeRepository.EVENT_AI_HELP_ENDED,
                    HomeRepository.EVENT_RESUME,
                    HomeRepository.EVENT_END -> inAiHelp = false
                }
                cursor = event.eventTime
            }
        if (inAiHelp) totalMillis += endExclusive - cursor
        return (totalMillis / 1000).coerceAtLeast(0)
    }

    private fun activeSecondsBetween(
        startInclusive: Long,
        endExclusive: Long,
        sessionStartedAt: Long,
        events: List<StudySessionEventEntity>
    ): Long {
        if (endExclusive <= startInclusive) return 0
        val timingEvents = events
            .asSequence()
            .filter { it.eventType in timingEventTypes }
            .sortedBy { it.eventTime }
            .toList()
        var isActive = sessionStartedAt < startInclusive
        timingEvents.filter { it.eventTime <= startInclusive }.forEach { event ->
            isActive = event.eventType != HomeRepository.EVENT_PAUSE
        }
        var cursor = startInclusive
        var activeMillis = 0L
        timingEvents
            .filter { it.eventTime > startInclusive && it.eventTime < endExclusive }
            .forEach { event ->
                if (isActive) activeMillis += event.eventTime - cursor
                isActive = event.eventType != HomeRepository.EVENT_PAUSE
                cursor = event.eventTime
            }
        if (isActive) activeMillis += endExclusive - cursor
        return (activeMillis / 1000).coerceAtLeast(0)
    }

    // --- Utility methods ---

    fun parseDurationSeconds(text: String): Long? {
        val compact = text.replace(" ", "")
        val hourMatch = Regex("""(\d+(?:\.\d+)?)(?:小时|时|h|H)""").find(compact)
        if (hourMatch != null) {
            return ((hourMatch.groupValues[1].toDoubleOrNull() ?: return null) * 3600).toLong()
        }
        val minuteMatch = Regex("""(\d+(?:\.\d+)?)(?:分钟|分|m|M)""").find(compact)
        if (minuteMatch != null) {
            return ((minuteMatch.groupValues[1].toDoubleOrNull() ?: return null) * 60).toLong()
        }
        return null
    }

    fun stripPackageName(label: String): String {
        return label.replace(Regex("""\s*\([^)]*\)\s*$"""), "")
    }

    /**
     * 从事件计算 AI 求助总时长（显式 STARTED/ENDED 语义，见 [calculateAiHelpSecondsFromEvents]）。
     */
    fun calculateAiHelpSeconds(events: List<StudySessionEventEntity>): Long {
        return calculateAiHelpSecondsFromEvents(events)
    }

    companion object {
        const val RECOVERY_CONFIRMATION_THRESHOLD_MS = 5L * 60L * 1000L

        val timingEventTypes = setOf(
            HomeRepository.EVENT_START,
            HomeRepository.EVENT_PAUSE,
            HomeRepository.EVENT_RESUME
        )
    }
}

/**
 * Data class holding the restored timer state returned by [TimerManager.restoreFromSession].
 */
data class RestoredTimerState(
    val status: TimerStatus,
    val activeSeconds: Long,
    val elapsedSeconds: Long,
    val targetSeconds: Long?,
    val completedBeforeSeconds: Long,
    val distractionCount: Int,
    val distractionLabels: List<String>,
    val distractionRecords: List<DistractionRecordUi>,
    val aiHelpCount: Int,
    val aiHelpSeconds: Long,
    /** 恢复后是否仍处于 AI 求助时段（AI_HELP_STARTED 未配对的正常暂停恢复场景）。 */
    val aiHelpActive: Boolean,
    val aiHelpLabels: List<String>,
    val lastDistractionAt: Long?,
    val lastTimingEventTime: Long?,
    val needsRecoveryConfirmation: Boolean,
    val recoveryGapSeconds: Long
)

internal fun shouldClosePausedSessionAtDayBoundary(
    status: TimerStatus,
    pauseStartedAt: Long,
    dayStartMillis: Long
): Boolean {
    return status == TimerStatus.Paused && pauseStartedAt in 1 until dayStartMillis
}

internal fun canResumeTimer(
    status: TimerStatus,
    pauseStartedAt: Long,
    activeSessionId: Long?
): Boolean {
    return status == TimerStatus.Paused && pauseStartedAt > 0 && activeSessionId != null
}

/**
 * 从事件计算 AI 求助总时长（显式 STARTED/ENDED 语义）：
 * - EVENT_AI_HELP（开始）→ 进入 AI 时段；重复开始幂等（进行中忽略）；
 * - EVENT_AI_HELP_ENDED（结束）→ 结束时段并累计；
 * - 旧数据兼容：无 ENDED 时，EVENT_RESUME / EVENT_END 仍视为结束；
 * - 安全截断：AI 时段未正常结束时（进程崩溃等），截断到最后一个事件时间，
 *   不产生无限增长。
 */
internal fun calculateAiHelpSecondsFromEvents(events: List<StudySessionEventEntity>): Long {
    val sorted = events.sortedBy { it.eventTime }
    var total = 0L
    var startedAt = 0L
    var lastEventTime = 0L
    sorted.forEach { event ->
        lastEventTime = event.eventTime
        when (event.eventType) {
            HomeRepository.EVENT_AI_HELP -> if (startedAt <= 0) {
                startedAt = event.eventTime
            }
            HomeRepository.EVENT_AI_HELP_ENDED,
            HomeRepository.EVENT_RESUME,
            HomeRepository.EVENT_END -> {
                if (startedAt > 0) {
                    total += ((event.eventTime - startedAt).coerceAtLeast(0)) / 1000
                    startedAt = 0
                }
            }
            else -> Unit
        }
    }
    // 未结束的 AI 时段：安全截断到最后一个事件时间。
    if (startedAt > 0 && lastEventTime > startedAt) {
        total += (lastEventTime - startedAt) / 1000
    }
    return max(0, total)
}

internal fun pauseSecondsAt(
    accumulatedPauseSeconds: Long,
    status: TimerStatus,
    pauseStartedAt: Long,
    now: Long
): Long {
    return if (status == TimerStatus.Paused && pauseStartedAt > 0) {
        accumulatedPauseSeconds + ((now - pauseStartedAt).coerceAtLeast(0) / 1000)
    } else {
        accumulatedPauseSeconds
    }
}

internal fun shouldCompleteTaskAtTarget(
    completedBeforeSeconds: Long,
    activeSessionSeconds: Long,
    targetSeconds: Long
): Boolean {
    if (targetSeconds <= 0 || completedBeforeSeconds >= targetSeconds) return false
    return completedBeforeSeconds.coerceAtLeast(0) +
        activeSessionSeconds.coerceAtLeast(0) >= targetSeconds
}

internal fun requiresRunningSessionRecovery(
    persistedStatus: TimerStatus,
    runningGapMillis: Long,
    thresholdMillis: Long
): Boolean {
    return persistedStatus == TimerStatus.Running &&
        runningGapMillis.coerceAtLeast(0) > thresholdMillis
}
