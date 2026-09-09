package com.hxz.alerttime.app.ui.plan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.core.coroutines.runSuspendCatching
import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.data.repository.PlanScheduleMode
import com.hxz.alerttime.app.data.repository.PlanRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

data class PlanUiState(
    val tasks: List<PlanTaskUi> = emptyList(),
    val subjects: List<PlanSubjectUi> = emptyList(),
    val completedDurationByTask: Map<Long, Long> = emptyMap(),
    val currentWeekGoals: List<WeeklyGoalUi> = emptyList(),
    val nextWeekGoals: List<WeeklyGoalUi> = emptyList(),
    val restDays: Set<Int> = PlanRepository.DEFAULT_REST_DAYS,
    val isRestDay: Boolean = false,
    val currentWeekStart: Long = PlanRepository.startOfWeek(System.currentTimeMillis()),
    val nextWeekStart: Long = PlanRepository.nextWeekStart(System.currentTimeMillis()),
    val isLoading: Boolean = true,
    val isSavingPlan: Boolean = false,
    val isSavingWeeklyGoal: Boolean = false,
    val errorMessage: String? = null
)

class PlanViewModel(
    private val repository: PlanRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(PlanUiState())
    val uiState: StateFlow<PlanUiState> = _uiState.asStateFlow()
    private val calendarNow = MutableStateFlow(System.currentTimeMillis())

    private var userId: Long = 0

    init {
        viewModelScope.launch {
            while (true) {
                delay(60_000)
                calendarNow.value = System.currentTimeMillis()
            }
        }
        viewModelScope.launch {
            runSuspendCatching {
                userId = repository.ensureUserId()
                val baseFlow = combine(
                    repository.observeTasks(userId),
                    repository.observeSubjects(userId),
                    repository.observeCompletedTaskDurations(userId)
                ) { tasks, subjects, durations ->
                    val subjectNames = subjects.associate { it.id to it.name }
                    Triple(
                        tasks.map { task ->
                            PlanTaskUi(
                                id = task.id,
                                subjectId = task.subjectId,
                                subjectName = when (val subjectId = task.subjectId) {
                                    null -> StatusCodes.DEFAULT_SUBJECT_NAME
                                    else -> subjectNames[subjectId] ?: DELETED_SUBJECT_NAME
                                },
                                title = task.title,
                                content = task.content,
                                status = task.status,
                                targetDurationSeconds = task.targetDurationSeconds,
                                dueAt = task.dueAt
                            )
                        },
                        subjects.map { subject ->
                            PlanSubjectUi(
                                id = subject.id,
                                name = subject.name,
                                canDelete = subject.name != StatusCodes.DEFAULT_SUBJECT_NAME
                            )
                        },
                        durations
                    )
                }
                combine(
                    baseFlow,
                    repository.observeWeeklyGoals(userId),
                    repository.observeRestDays(),
                    calendarNow
                ) { base, weeklyGoals, restDays, now ->
                    val currentWeekStart = PlanRepository.startOfWeek(now)
                    val nextWeekStart = PlanRepository.nextWeekStart(currentWeekStart)
                    PlanCombinedUi(
                        tasks = base.first,
                        subjects = base.second,
                        durations = base.third,
                        currentWeekGoals = weeklyGoals
                            .filter { it.weekStart == currentWeekStart }
                            .map { it.toUi() },
                        nextWeekGoals = weeklyGoals
                            .filter { it.weekStart == nextWeekStart }
                            .map { it.toUi() },
                        restDays = restDays,
                        isRestDay = PlanRepository.isRestDay(restDays, now),
                        currentWeekStart = currentWeekStart,
                        nextWeekStart = nextWeekStart
                    )
                }.collectLatest { data ->
                    _uiState.update {
                        it.copy(
                            tasks = data.tasks,
                            subjects = data.subjects,
                            completedDurationByTask = data.durations,
                            currentWeekGoals = data.currentWeekGoals,
                            nextWeekGoals = data.nextWeekGoals,
                            restDays = data.restDays,
                            isRestDay = data.isRestDay,
                            currentWeekStart = data.currentWeekStart,
                            nextWeekStart = data.nextWeekStart,
                            isLoading = false,
                            errorMessage = null
                        )
                    }
                }
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = throwable.message ?: "加载计划失败"
                    )
                }
            }
        }
    }

    fun addWeeklyGoal(
        weekStart: Long,
        title: String,
        successCriteria: String?,
        onSuccess: () -> Unit = {}
    ) {
        val cleanTitle = title.trim()
        val state = _uiState.value
        if (cleanTitle.isBlank() || userId == 0L || state.isSavingWeeklyGoal) return
        if (!isSelectableWeeklyGoalWeek(weekStart, state.currentWeekStart, state.nextWeekStart)) {
            _uiState.update { it.copy(errorMessage = "只能为本周或下周添加周目标") }
            return
        }
        _uiState.update { it.copy(isSavingWeeklyGoal = true) }
        viewModelScope.launch {
            runSuspendCatching {
                repository.addWeeklyGoal(
                    userId = userId,
                    weekStart = weekStart,
                    title = cleanTitle,
                    successCriteria = successCriteria
                )
            }.onSuccess {
                _uiState.update { it.copy(isSavingWeeklyGoal = false) }
                onSuccess()
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(
                        isSavingWeeklyGoal = false,
                        errorMessage = throwable.message ?: "添加周目标失败"
                    )
                }
            }
        }
    }

    fun setWeeklyGoalCompleted(goal: WeeklyGoalUi, completed: Boolean) {
        viewModelScope.launch {
            runSuspendCatching {
                repository.setWeeklyGoalCompleted(goal.id, completed)
            }.onFailure { throwable ->
                _uiState.update { it.copy(errorMessage = throwable.message ?: "更新周目标失败") }
            }
        }
    }

    fun deferWeeklyGoal(goal: WeeklyGoalUi, reason: String) {
        viewModelScope.launch {
            runSuspendCatching {
                repository.deferWeeklyGoal(
                    goalId = goal.id,
                    targetWeekStart = PlanRepository.nextWeekStart(goal.weekStart),
                    reason = reason
                )
            }.onFailure { throwable ->
                _uiState.update { it.copy(errorMessage = throwable.message ?: "延期周目标失败") }
            }
        }
    }

    fun cancelWeeklyGoal(goal: WeeklyGoalUi, reason: String) {
        viewModelScope.launch {
            runSuspendCatching {
                repository.cancelWeeklyGoal(goal.id, reason)
            }.onFailure { throwable ->
                _uiState.update { it.copy(errorMessage = throwable.message ?: "取消周目标失败") }
            }
        }
    }

    fun saveRestDays(days: Set<Int>) {
        viewModelScope.launch {
            runSuspendCatching {
                repository.saveRestDays(days)
            }.onFailure { throwable ->
                _uiState.update { it.copy(errorMessage = throwable.message ?: "保存休息日失败") }
            }
        }
    }

    fun addPlan(
        title: String,
        content: String?,
        subjectId: Long?,
        customSubjectName: String?,
        targetDurationSeconds: Long?,
        startDateMillis: Long,
        scheduleMode: PlanScheduleMode,
        repeatCount: Int,
        onSuccess: () -> Unit = {}
    ) {
        val cleanTitle = title.trim()
        if (cleanTitle.isBlank() || userId == 0L || _uiState.value.isSavingPlan) return
        _uiState.update { it.copy(isSavingPlan = true) }
        viewModelScope.launch {
            runSuspendCatching {
                val finalSubjectId = customSubjectName
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                    ?.let { repository.addSubject(userId, it) }
                    ?: subjectId
                repository.addPlan(
                    userId = userId,
                    title = cleanTitle,
                    content = content,
                    subjectId = finalSubjectId,
                    targetDurationSeconds = targetDurationSeconds,
                    startDateMillis = startDateMillis,
                    scheduleMode = scheduleMode,
                    repeatCount = repeatCount
                )
            }.onSuccess {
                _uiState.update { it.copy(isSavingPlan = false) }
                onSuccess()
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(
                        isSavingPlan = false,
                        errorMessage = throwable.message ?: "添加计划失败"
                    )
                }
            }
        }
    }

    fun toggleDone(task: PlanTaskUi) {
        viewModelScope.launch {
            runSuspendCatching {
                repository.toggleDone(task.id)
            }.onFailure { throwable ->
                _uiState.update { it.copy(errorMessage = throwable.message ?: "更新计划失败") }
            }
        }
    }

    fun deferToTomorrow(task: PlanTaskUi) {
        viewModelScope.launch {
            runSuspendCatching {
                repository.deferTaskToTomorrow(task.id)
            }.onFailure { throwable ->
                _uiState.update { it.copy(errorMessage = throwable.message ?: "顺延计划失败") }
            }
        }
    }

    fun updatePlan(
        task: PlanTaskUi,
        title: String,
        content: String?,
        subjectId: Long?,
        customSubjectName: String?,
        targetDurationSeconds: Long?,
        dueAt: Long?,
        onSuccess: () -> Unit = {}
    ) {
        val cleanTitle = title.trim()
        if (cleanTitle.isBlank() || userId == 0L || _uiState.value.isSavingPlan) return
        _uiState.update { it.copy(isSavingPlan = true) }
        viewModelScope.launch {
            runSuspendCatching {
                val finalSubjectId = customSubjectName
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                    ?.let { repository.addSubject(userId, it) }
                    ?: subjectId
                repository.updatePlan(
                    taskId = task.id,
                    title = cleanTitle,
                    content = content,
                    subjectId = finalSubjectId,
                    targetDurationSeconds = targetDurationSeconds,
                    dueAt = dueAt
                )
            }.onSuccess {
                _uiState.update { it.copy(isSavingPlan = false) }
                onSuccess()
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(
                        isSavingPlan = false,
                        errorMessage = throwable.message ?: "编辑计划失败"
                    )
                }
            }
        }
    }

    fun deletePlan(task: PlanTaskUi) {
        viewModelScope.launch {
            runSuspendCatching {
                repository.softDeletePlan(task.id)
            }.onFailure { throwable ->
                _uiState.update { it.copy(errorMessage = throwable.message ?: "删除计划失败") }
            }
        }
    }

    fun addSubject(name: String) {
        val cleanName = name.trim()
        if (cleanName.isBlank() || userId == 0L) return
        viewModelScope.launch {
            runSuspendCatching {
                repository.addSubject(userId, cleanName)
            }.onFailure { throwable ->
                _uiState.update { it.copy(errorMessage = throwable.message ?: "添加科目失败") }
            }
        }
    }

    fun deleteSubject(subject: PlanSubjectUi) {
        if (!subject.canDelete) return
        viewModelScope.launch {
            runSuspendCatching {
                repository.deleteSubject(subject.id)
            }.onFailure { throwable ->
                _uiState.update { it.copy(errorMessage = throwable.message ?: "删除科目失败") }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    class Factory(
        private val database: AlertTimeDatabase
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return PlanViewModel(PlanRepository(database)) as T
        }
    }

    private companion object {
        const val DELETED_SUBJECT_NAME = "已删除科目"
    }
}

internal fun isSelectableWeeklyGoalWeek(
    candidateWeekStart: Long,
    currentWeekStart: Long,
    nextWeekStart: Long
): Boolean {
    return candidateWeekStart == currentWeekStart || candidateWeekStart == nextWeekStart
}

private data class PlanCombinedUi(
    val tasks: List<PlanTaskUi>,
    val subjects: List<PlanSubjectUi>,
    val durations: Map<Long, Long>,
    val currentWeekGoals: List<WeeklyGoalUi>,
    val nextWeekGoals: List<WeeklyGoalUi>,
    val restDays: Set<Int>,
    val isRestDay: Boolean,
    val currentWeekStart: Long,
    val nextWeekStart: Long
)

private fun com.hxz.alerttime.app.data.local.entity.WeeklyGoalEntity.toUi(): WeeklyGoalUi {
    return WeeklyGoalUi(
        id = id,
        weekStart = weekStart,
        title = title,
        successCriteria = successCriteria,
        status = status,
        deferredToWeekStart = deferredToWeekStart,
        exceptionReason = exceptionReason
    )
}
