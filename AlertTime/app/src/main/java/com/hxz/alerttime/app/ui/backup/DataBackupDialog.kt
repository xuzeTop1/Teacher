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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
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
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (timerBusy) {
                    Text(
                        text = "正在计时中（包含暂停与异常恢复），请先结束当前专注，再进行数据备份。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }

                RecentBackupCard(state = state)

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = onCreateRecent,
                        enabled = actionsEnabled
                    ) {
                        Text("备份到手机文件夹")
                    }
                    OutlinedButton(
                        onClick = onInspectRecent,
                        enabled = actionsEnabled && state.canRestoreRecent
                    ) {
                        Text("合并最近手机备份")
                    }
                }
                if (state.hasRecentBackupFile && state.recentBackupUnreadable) {
                    Text(
                        text = "最近手机备份损坏或无法读取，恢复已禁用；可重新创建或从 JSON 文件恢复。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }

                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))

                OutlinedButton(
                    onClick = onExportTo,
                    enabled = actionsEnabled,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("导出 JSON 备份")
                }
                Text(
                    text = "保存到你选择的位置，用于跨卸载、换机或长期保存。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                OutlinedButton(
                    onClick = onInspectFile,
                    enabled = actionsEnabled,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("从 JSON 文件合并恢复")
                }

                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))

                Text(
                    text = "备份文件包含日记、学习计划、专注记录及可能的分心应用信息。备份文件为明文，请妥善保管，不要发送给不可信的人。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "「备份到手机文件夹」会保存到下载/AlertTime，卸载应用后仍保留。清除应用数据后，请从该 JSON 文件合并恢复。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "备份保存在你选择的位置，应用不会自动上传。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                if (busy) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(top = 4.dp)
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        Text(
                            text = "正在处理，请稍候…",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
                state.successMessage?.let { message ->
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                state.errorMessage?.let { message ->
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error
                    )
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
private fun RecentBackupCard(state: BackupUiState) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = "最近手机备份",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface
            )
            val meta = state.recentBackup
            when {
                meta == null && !state.hasRecentBackupFile -> {
                    Text(
                        text = "还没有最近本地备份。备份保存在应用私有目录，卸载应用或清除数据后会丢失。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                meta != null -> {
                    Text(
                        text = "创建时间：${formatBackupTime(meta.exportedAt)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "大小：${formatBackupFileSize(meta.fileSizeBytes)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "内容：${formatBackupSummary(meta.dataSummary)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                state.recentBackupUnreadable -> {
                    Text(
                        text = "备份文件损坏或无法读取。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }
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
