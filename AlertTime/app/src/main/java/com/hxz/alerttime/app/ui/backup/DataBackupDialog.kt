package com.hxz.alerttime.app.ui.backup

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hxz.alerttime.app.data.backup.BackupTimerGate
import com.hxz.alerttime.app.data.backup.toSummary
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.ui.components.FormCaption
import com.hxz.alerttime.app.ui.components.FormScrollColumn
import com.hxz.alerttime.app.ui.components.FormSection
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Stateful entry point shown from the "关于自律" dialog.
 * Owns the BackupViewModel and the SAF file pickers; renders [DataBackupDialog].
 */
@Composable
fun DataBackupDialogHost(
    database: AlertTimeDatabase,
    backupGate: BackupTimerGate,
    timerBusy: Boolean,
    onRestoreCompleted: () -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    // The repository gate is the shared atomic coordination point with the timer
    // (see BackupTimerGate); timerBusy only disables the UI buttons for UX.
    val backupViewModel: BackupViewModel = viewModel(
        factory = BackupViewModel.Factory(
            database = database,
            context = context.applicationContext,
            backupGate = backupGate,
            onRestoreCompleted = onRestoreCompleted
        )
    )
    val state by backupViewModel.uiState.collectAsStateWithLifecycle()

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri: Uri? ->
        if (uri != null) backupViewModel.exportTo(uri)
    }
    val openLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri != null) backupViewModel.inspectFile(uri)
    }

    DataBackupDialog(
        state = state,
        timerBusy = timerBusy,
        onExportTo = { exportLauncher.launch(defaultExportFileName()) },
        onInspectFile = {
            openLauncher.launch(
                arrayOf("application/json", "text/json", "application/octet-stream")
            )
        },
        onCreateRecent = backupViewModel::createRecentBackup,
        onInspectRecent = backupViewModel::inspectRecent,
        onConfirmRestore = backupViewModel::confirmRestore,
        onDismissRestore = backupViewModel::dismissRestorePreview,
        onConsumeMessages = backupViewModel::consumeMessages,
        onDismiss = onDismiss
    )
}

/** Stateless content; kept pure so Compose tests can drive every state directly. */
@Composable
internal fun DataBackupDialog(
    state: BackupUiState,
    timerBusy: Boolean,
    onExportTo: () -> Unit,
    onInspectFile: () -> Unit,
    onCreateRecent: () -> Unit,
    onInspectRecent: () -> Unit,
    onConfirmRestore: () -> Unit,
    onDismissRestore: () -> Unit,
    onConsumeMessages: () -> Unit,
    onDismiss: () -> Unit
) {
    LaunchedEffect(state.successMessage, state.errorMessage) {
        if (state.successMessage != null || state.errorMessage != null) {
            delay(6_000)
            onConsumeMessages()
        }
    }
    val busy = state.operationRunning
    val actionsEnabled = !timerBusy && !busy

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        shape = RoundedCornerShape(28.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        title = { Text("数据与备份", fontWeight = FontWeight.SemiBold) },
        text = {
            FormScrollColumn(modifier = Modifier.padding(vertical = 4.dp)) {
                if (timerBusy) {
                    FormCaption(
                        "正在计时中（包含暂停与异常恢复），请先结束当前专注，再进行数据备份。",
                        color = MaterialTheme.colorScheme.error
                    )
                }

                RecentBackupSection(state)

                FormSection(title = "本机备份") {
                    // 整行按钮：并排时「备份到手机文件夹」「合并最近手机备份」会按文字宽度
                    // 各占一半，后者的 8 个字放不下就折成两行。
                    Button(
                        onClick = onCreateRecent,
                        enabled = actionsEnabled,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("备份到手机文件夹")
                    }
                    OutlinedButton(
                        onClick = onInspectRecent,
                        enabled = actionsEnabled && state.canRestoreRecent,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("合并最近手机备份")
                    }
                    if (state.hasRecentBackupFile && state.recentBackupUnreadable) {
                        FormCaption(
                            "最近手机备份损坏或无法读取，恢复已禁用；可重新创建或从 JSON 文件恢复。",
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                    FormCaption("「备份到手机文件夹」会保存到下载/AlertTime，卸载应用后仍保留。清除应用数据后，请从该 JSON 文件合并恢复。")
                }

                FormSection(title = "导出与恢复") {
                    OutlinedButton(
                        onClick = onExportTo,
                        enabled = actionsEnabled,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("导出 JSON 备份")
                    }
                    FormCaption("保存到你选择的位置，用于跨卸载、换机或长期保存。")
                    OutlinedButton(
                        onClick = onInspectFile,
                        enabled = actionsEnabled,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("从 JSON 文件合并恢复")
                    }
                    FormCaption("备份文件包含日记、学习计划、专注记录及可能的分心应用信息。备份文件为明文，请妥善保管，不要发送给不可信的人。")
                    FormCaption("备份保存在你选择的位置，应用不会自动上传。")
                }

                if (busy) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        FormCaption("正在处理，请稍候…")
                    }
                }
                state.successMessage?.let { message ->
                    FormCaption(message, color = MaterialTheme.colorScheme.primary)
                }
                state.errorMessage?.let { message ->
                    FormCaption(message, color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss, enabled = !busy) {
                Text("完成", fontWeight = FontWeight.SemiBold)
            }
        }
    )

    state.pendingRestore?.let { preview ->
        RestoreConfirmDialog(
            preview = preview,
            restoring = busy,
            onConfirm = onConfirmRestore,
            onDismiss = onDismissRestore
        )
    }
}

@Composable
private fun RecentBackupSection(state: BackupUiState) {
    FormSection(title = "最近手机备份") {
        val meta = state.recentBackup
        when {
            meta == null && !state.hasRecentBackupFile -> {
                FormCaption("还没有最近本地备份。备份保存在应用私有目录，卸载应用或清除数据后会丢失。")
            }
            meta != null -> {
                FormCaption("创建时间：${formatBackupTime(meta.exportedAt)}")
                FormCaption("大小：${formatBackupFileSize(meta.fileSizeBytes)}")
                FormCaption("内容：${formatBackupSummary(meta.dataSummary)}")
            }
            state.recentBackupUnreadable -> {
                FormCaption("备份文件损坏或无法读取。", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun RestoreConfirmDialog(
    preview: com.hxz.alerttime.app.data.backup.RestorePreview,
    restoring: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = { if (!restoring) onDismiss() },
        shape = RoundedCornerShape(28.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        title = { Text("确认合并恢复", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "导出时间：${formatBackupTime(preview.exportedAt)}",
                    style = MaterialTheme.typography.bodySmall
                )
                Text(
                    text = "协议版本：schemaVersion ${preview.schemaVersion}",
                    style = MaterialTheme.typography.bodySmall
                )
                Text(
                    text = formatRestoreDetail(preview.data.toSummary()),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "将补入备份中缺失的数据；同主键或设置键冲突时保留当前本地数据，不会删除现有数据。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = !restoring) {
                Text("确认合并", fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !restoring) {
                Text("取消")
            }
        }
    )
}

internal fun defaultExportFileName(): String {
    val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(System.currentTimeMillis()))
    return "AlertTime-backup-$stamp.json"
}