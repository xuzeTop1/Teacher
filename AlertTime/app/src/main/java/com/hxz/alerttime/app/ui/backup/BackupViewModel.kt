package com.hxz.alerttime.app.ui.backup

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.hxz.alerttime.app.data.backup.BackupDataSummary
import com.hxz.alerttime.app.data.backup.BackupOperationResult
import com.hxz.alerttime.app.data.backup.BackupRepository
import com.hxz.alerttime.app.data.backup.BackupTimerGate
import com.hxz.alerttime.app.data.backup.RecentBackupMeta
import com.hxz.alerttime.app.data.backup.RestorePreview
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class BackupUiState(
    val hasRecentBackupFile: Boolean = false,
    val recentBackup: RecentBackupMeta? = null,
    /** The recent backup file exists but cannot be read or validated. */
    val recentBackupUnreadable: Boolean = false,
    val operationRunning: Boolean = false,
    val pendingRestore: RestorePreview? = null,
    val successMessage: String? = null,
    val errorMessage: String? = null
) {
    val canRestoreRecent: Boolean
        get() = hasRecentBackupFile && !recentBackupUnreadable
}

class BackupViewModel(
    private val repository: BackupRepository,
    private val onRestoreCompleted: () -> Unit
) : ViewModel() {

    private val _uiState = MutableStateFlow(BackupUiState())
    val uiState: StateFlow<BackupUiState> = _uiState.asStateFlow()

    init {
        refreshRecentBackup()
    }

    fun refreshRecentBackup() {
        viewModelScope.launch {
            val meta = repository.loadRecentBackupMeta()
            // loadRecentBackupMeta may rediscover a shared MediaStore backup after
            // app data/URI metadata was lost; read the flag after that attempt.
            val hasFile = repository.hasRecentBackupFile() || meta != null
            _uiState.update {
                it.copy(
                    hasRecentBackupFile = hasFile,
                    recentBackup = meta,
                    recentBackupUnreadable = hasFile && meta == null
                )
            }
        }
    }

    fun createRecentBackup() {
        if (_uiState.value.operationRunning) return
        _uiState.update { it.copy(operationRunning = true) }
        viewModelScope.launch {
            when (val result = repository.createRecentBackup()) {
                is BackupOperationResult.Success -> {
                    refreshRecentBackup()
                    _uiState.update {
                        it.copy(
                            operationRunning = false,
                            successMessage = "已保存到手机下载目录 AlertTime 文件夹"
                        )
                    }
                }
                is BackupOperationResult.Failure -> {
                    _uiState.update {
                        it.copy(operationRunning = false, errorMessage = result.message)
                    }
                }
            }
        }
    }

    fun exportTo(uri: Uri) {
        if (_uiState.value.operationRunning) return
        _uiState.update { it.copy(operationRunning = true) }
        viewModelScope.launch {
            when (val result = repository.exportToUri(uri)) {
                is BackupOperationResult.Success -> {
                    refreshRecentBackup()
                    _uiState.update {
                        it.copy(
                            operationRunning = false,
                            successMessage = "导出成功，备份已保存到所选位置"
                        )
                    }
                }
                is BackupOperationResult.Failure -> {
                    _uiState.update {
                        it.copy(operationRunning = false, errorMessage = result.message)
                    }
                }
            }
        }
    }

    fun inspectRecent() {
        if (_uiState.value.operationRunning) return
        if (!_uiState.value.canRestoreRecent) return
        _uiState.update { it.copy(operationRunning = true) }
        viewModelScope.launch {
            val preview = runCatching { repository.inspectRecentBackup() }.getOrNull()
            _uiState.update {
                if (preview != null) {
                    it.copy(operationRunning = false, pendingRestore = preview)
                } else {
                    it.copy(
                        operationRunning = false,
                        recentBackupUnreadable = true,
                        errorMessage = "最近本地备份不可用，请先重新创建"
                    )
                }
            }
        }
    }

    fun inspectFile(uri: Uri) {
        if (_uiState.value.operationRunning) return
        _uiState.update { it.copy(operationRunning = true) }
        viewModelScope.launch {
            val result = runCatching { repository.inspectFile(uri) }
            _uiState.update {
                result.fold(
                    onSuccess = { preview ->
                        it.copy(operationRunning = false, pendingRestore = preview)
                    },
                    onFailure = { throwable ->
                        it.copy(
                            operationRunning = false,
                            errorMessage = throwable.message ?: "无法读取所选备份文件"
                        )
                    }
                )
            }
        }
    }

    fun confirmRestore() {
        val preview = _uiState.value.pendingRestore ?: return
        if (_uiState.value.operationRunning) return
        _uiState.update { it.copy(operationRunning = true) }
        viewModelScope.launch {
            when (val result = repository.mergeValidated(preview)) {
                is BackupOperationResult.Success -> {
                    onRestoreCompleted()
                    refreshRecentBackup()
                    _uiState.update {
                        it.copy(
                            operationRunning = false,
                            pendingRestore = null,
                            successMessage = "数据已合并恢复"
                        )
                    }
                }
                is BackupOperationResult.Failure -> {
                    _uiState.update {
                        it.copy(operationRunning = false, errorMessage = result.message)
                    }
                }
            }
        }
    }

    fun dismissRestorePreview() {
        _uiState.update { it.copy(pendingRestore = null) }
    }

    fun consumeMessages() {
        _uiState.update { it.copy(successMessage = null, errorMessage = null) }
    }

    class Factory(
        database: AlertTimeDatabase,
        context: Context,
        backupGate: BackupTimerGate,
        onRestoreCompleted: () -> Unit
    ) : ViewModelProvider.Factory {
        private val repository = BackupRepository(
            database = database,
            context = context,
            backupGate = backupGate
        )
        private val restoreCompleted = onRestoreCompleted

        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return BackupViewModel(repository, restoreCompleted) as T
        }
    }
}

// --- Pure formatting helpers (unit-tested) ---

internal fun formatBackupTime(exportedAt: Long): String {
    return SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).format(Date(exportedAt))
}

internal fun formatBackupFileSize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    if (bytes < 1024 * 1024) return "%.1f KB".format(Locale.US, bytes / 1024.0)
    return "%.2f MB".format(Locale.US, bytes / (1024.0 * 1024.0))
}

/** Compact one-line summary of the backup content, e.g. "科目 5 · 计划 12 · 学习 30 次 · 日记 8". */
internal fun formatBackupSummary(summary: BackupDataSummary): String {
    val parts = buildList {
        if (summary.subjects > 0) add("科目 ${summary.subjects}")
        if (summary.tasks > 0) add("计划 ${summary.tasks}")
        if (summary.studySessions > 0) add("学习 ${summary.studySessions} 次")
        if (summary.diaries > 0) add("日记 ${summary.diaries}")
        if (summary.users > 0) add("用户 ${summary.users}")
        if (summary.weeklyGoals > 0) add("周目标 ${summary.weeklyGoals}")
        if (summary.appSettings > 0) add("设置 ${summary.appSettings} 项")
    }
    return parts.joinToString(" · ").ifEmpty { "暂无数据" }
}

/** Full per-collection breakdown shown in the restore confirmation. */
internal fun formatRestoreDetail(summary: BackupDataSummary): String = buildString {
    appendLine("用户：${summary.users}")
    appendLine("科目：${summary.subjects}")
    appendLine("计划：${summary.tasks}")
    appendLine("周目标：${summary.weeklyGoals}")
    appendLine("学习记录：${summary.studySessions}")
    appendLine("学习事件：${summary.studySessionEvents}")
    appendLine("日记：${summary.diaries}")
    append("应用设置：${summary.appSettings}")
}
