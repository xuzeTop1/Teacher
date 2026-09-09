package com.hxz.alerttime.app.ui.stats

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.core.coroutines.runSuspendCatching
import com.hxz.alerttime.app.data.repository.DailyStudyStat
import com.hxz.alerttime.app.data.repository.PlanStudyStat
import com.hxz.alerttime.app.data.repository.StatsRepository
import com.hxz.alerttime.app.data.repository.SubjectStudyStat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class StatsUiState(
    val todayTotalSeconds: Long = 0,
    val todayFocusSeconds: Long = 0,
    val todayAiHelpSeconds: Long = 0,
    val todayPauseSeconds: Long = 0,
    val weekSeconds: Long = 0,
    val totalSeconds: Long = 0,
    val recentTrend: List<DailyStudyStat> = emptyList(),
    val subjectDistribution: List<SubjectStudyStat> = emptyList(),
    val todaySubjectDistribution: List<SubjectStudyStat> = emptyList(),
    val todayPlanDistribution: List<PlanStudyStat> = emptyList(),
    val isLoading: Boolean = true,
    val errorMessage: String? = null
)

class StatsViewModel(
    private val repository: StatsRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(StatsUiState())
    val uiState: StateFlow<StatsUiState> = _uiState.asStateFlow()

    init {
        refresh()
        viewModelScope.launch {
            val userId = repository.ensureUserId()
            repository.observePlanChanges(userId)
                .drop(1)
                .collect { refresh() }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            runSuspendCatching {
                val userId = repository.ensureUserId()
                repository.loadStats(userId)
            }.onSuccess { snapshot ->
                _uiState.update {
                    it.copy(
                        todayTotalSeconds = snapshot.todayTotalSeconds,
                        todayFocusSeconds = snapshot.todayFocusSeconds,
                        todayAiHelpSeconds = snapshot.todayAiHelpSeconds,
                        todayPauseSeconds = snapshot.todayPauseSeconds,
                        weekSeconds = snapshot.weekSeconds,
                        totalSeconds = snapshot.totalSeconds,
                        recentTrend = snapshot.recentTrend,
                        subjectDistribution = snapshot.subjectDistribution,
                        todaySubjectDistribution = snapshot.todaySubjectDistribution,
                        todayPlanDistribution = snapshot.todayPlanDistribution,
                        isLoading = false,
                        errorMessage = null
                    )
                }
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = throwable.message ?: "加载统计失败"
                    )
                }
            }
        }
    }

    class Factory(
        private val database: AlertTimeDatabase
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return StatsViewModel(StatsRepository(database)) as T
        }
    }
}
