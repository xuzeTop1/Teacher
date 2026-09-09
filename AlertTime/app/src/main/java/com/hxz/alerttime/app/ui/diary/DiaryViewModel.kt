package com.hxz.alerttime.app.ui.diary

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.core.coroutines.runSuspendCatching
import com.hxz.alerttime.app.data.local.entity.DiaryEntity
import com.hxz.alerttime.app.data.repository.DiaryRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DiaryUiState(
    val diaries: List<DiaryEntity> = emptyList(),
    val isLoading: Boolean = true,
    val isSavingDiary: Boolean = false,
    val errorMessage: String? = null,
    val editingDiary: DiaryEntity? = null,
    val deleteConfirmDiary: DiaryEntity? = null
)

class DiaryViewModel(
    private val repository: DiaryRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(DiaryUiState())
    val uiState: StateFlow<DiaryUiState> = _uiState.asStateFlow()

    private var userId: Long = 0

    init {
        viewModelScope.launch {
            runSuspendCatching {
                userId = repository.ensureUserId()
                repository.observeDiaries(userId).collectLatest { diaries ->
                    _uiState.update {
                        it.copy(
                            diaries = diaries,
                            isLoading = false,
                            errorMessage = null
                        )
                    }
                }
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = throwable.message ?: "加载日记失败"
                    )
                }
            }
        }
    }

    fun addDiary(
        title: String?,
        content: String,
        mood: Int?,
        onSuccess: () -> Unit = {}
    ) {
        val cleanContent = content.trim()
        if (cleanContent.isBlank() || _uiState.value.isSavingDiary) return
        if (userId == 0L) {
            _uiState.update { it.copy(errorMessage = "日记仍在初始化，请稍后重试") }
            return
        }

        _uiState.update { it.copy(isSavingDiary = true) }
        viewModelScope.launch {
            runSuspendCatching {
                repository.addDiary(
                    userId = userId,
                    title = title,
                    content = cleanContent,
                    mood = mood
                )
            }.onSuccess {
                _uiState.update { it.copy(isSavingDiary = false) }
                onSuccess()
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(
                        isSavingDiary = false,
                        errorMessage = throwable.message ?: "保存日记失败"
                    )
                }
            }
        }
    }

    fun updateDiary(
        diaryId: Long,
        title: String?,
        content: String,
        mood: Int?
    ) {
        val cleanContent = content.trim()
        if (cleanContent.isBlank() || _uiState.value.isSavingDiary) return

        _uiState.update { it.copy(isSavingDiary = true) }
        viewModelScope.launch {
            runSuspendCatching {
                repository.updateDiary(
                    diaryId = diaryId,
                    title = title,
                    content = cleanContent,
                    mood = mood
                )
            }.onSuccess {
                _uiState.update {
                    it.copy(
                        isSavingDiary = false,
                        editingDiary = null
                    )
                }
            }.onFailure { throwable ->
                _uiState.update {
                    it.copy(
                        isSavingDiary = false,
                        errorMessage = throwable.message ?: "更新日记失败"
                    )
                }
            }
        }
    }

    fun deleteDiary(diaryId: Long) {
        viewModelScope.launch {
            runSuspendCatching {
                repository.softDeleteDiary(diaryId)
            }.onSuccess {
                _uiState.update { it.copy(deleteConfirmDiary = null) }
            }.onFailure { throwable ->
                _uiState.update { it.copy(errorMessage = throwable.message ?: "删除日记失败") }
            }
        }
    }

    fun startEditing(diary: DiaryEntity) {
        _uiState.update { it.copy(editingDiary = diary) }
    }

    fun cancelEditing() {
        _uiState.update { it.copy(editingDiary = null) }
    }

    fun requestDelete(diary: DiaryEntity) {
        _uiState.update { it.copy(deleteConfirmDiary = diary) }
    }

    fun cancelDelete() {
        _uiState.update { it.copy(deleteConfirmDiary = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    class Factory(
        private val database: AlertTimeDatabase
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return DiaryViewModel(DiaryRepository(database)) as T
        }
    }
}
