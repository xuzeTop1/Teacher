package com.hxz.alerttime.app.ui.sync

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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.zxing.integration.android.IntentIntegrator
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.sync.SyncProposalDto
import com.hxz.alerttime.app.ui.components.FormButtonRow
import com.hxz.alerttime.app.ui.components.FormCaption
import com.hxz.alerttime.app.ui.components.FormScrollColumn
import com.hxz.alerttime.app.ui.components.FormSection
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * “Teacher 同步”对话框：配对状态、立即同步、建议列表（采纳/拒绝）、解除配对。
 *
 * 网络限制说明必须展示给用户：学校、公司和公共 WiFi 可能存在 AP isolation、
 * VLAN 或防火墙限制，局域网同步不能保证任意网络下可用。
 */
@Composable
fun TeacherSyncDialogHost(
    database: AlertTimeDatabase,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val viewModel: TeacherSyncViewModel = viewModel(
        factory = TeacherSyncViewModel.Factory(
            database = database,
            context = context.applicationContext
        )
    )
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    // 扫码：zxing ScanContract（Activity Result API），结果经回调直接进入 ViewModel。
    var pendingScan by remember { mutableStateOf(false) }
    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        pendingScan = false
        viewModel.pairWithScanResult(result.contents)
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            if (pendingScan) {
                pendingScan = false
                scanLauncher.launch(scanOptions())
            }
        } else {
            pendingScan = false
            // 相机权限被拒绝：明确显示错误，不静默失败。
            viewModel.reportError("需要相机权限才能扫描配对二维码，请在系统设置中允许后重试")
        }
    }

    fun launchScanner() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            context.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingScan = true
            permissionLauncher.launch(Manifest.permission.CAMERA)
        } else {
            scanLauncher.launch(scanOptions())
        }
    }

    // 解除配对确认：区分「安全撤销（服务端）」与「仅忘记本地（风险警告）」。
    var showUnpairConfirm by remember { mutableStateOf(false) }

    TeacherSyncDialog(
        state = state,
        onScanQr = ::launchScanner,
        onSyncNow = viewModel::syncNow,
        onAccept = viewModel::acceptProposal,
        onReject = viewModel::rejectProposal,
        onRequestUnpair = { showUnpairConfirm = true },
        onConsumeMessages = viewModel::clearMessages,
        onSaveSubjectTag = viewModel::saveSubjectTag,
        onDismiss = onDismiss
    )

    if (showUnpairConfirm) {
        AlertDialog(
            onDismissRequest = { showUnpairConfirm = false },
            title = { Text("解除配对") },
            text = {
                Text(
                    "「安全解除配对」会先在 TeacherAgent 撤销当前设备凭据（需要网络可用），" +
                        "撤销后旧凭据立即失效。\n\n" +
                        "「仅忘记本地配对」只清除本机状态，服务端凭据仍然有效，" +
                        "除非之后在 TeacherAgent 设备列表中手工撤销，否则旧凭据仍可访问。",
                    style = MaterialTheme.typography.bodySmall
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showUnpairConfirm = false
                    viewModel.unpair()
                }) {
                    Text("安全解除配对", fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = {
                        showUnpairConfirm = false
                        viewModel.forgetLocalPairing()
                    }) {
                        Text("仅忘记本地配对")
                    }
                    TextButton(onClick = { showUnpairConfirm = false }) { Text("取消") }
                }
            }
        )
    }
}

@Composable
fun TeacherSyncDialog(
    state: TeacherSyncUiState,
    onScanQr: () -> Unit,
    onSyncNow: () -> Unit,
    onAccept: (SyncProposalDto) -> Unit,
    onReject: (SyncProposalDto) -> Unit,
    onRequestUnpair: () -> Unit,
    onConsumeMessages: () -> Unit,
    onSaveSubjectTag: (String, String, String, String?) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Teacher 同步") },
        text = {
            // 不再叠加 heightIn(max = 520.dp)：那个上限会把底部说明裁掉且在窄屏上
            // 只露出半行。高度交给 AlertDialog 自身约束，内容整体可滚动。
            FormScrollColumn(modifier = Modifier.padding(vertical = 4.dp)) {
                if (state.successMessage != null) {
                    FormCaption(state.successMessage, color = MaterialTheme.colorScheme.primary)
                }
                if (state.errorMessage != null) {
                    FormCaption(state.errorMessage, color = MaterialTheme.colorScheme.error)
                }

                if (!state.paired) {
                    FormSection(title = "配对") {
                        Text(
                            "未配对：先在 TeacherAgent 打开「AlertTime 同步」并生成配对二维码，然后扫描配对。",
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Button(onClick = onScanQr, enabled = !state.operationRunning) {
                            Text("扫描二维码配对")
                        }
                    }
                } else {
                    FormSection(title = "连接状态") {
                        Text(
                            "已连接：${state.serverInfo?.host ?: "—"}:${state.serverInfo?.port ?: "—"}",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                        state.lastSyncAt?.let {
                            FormCaption("最后同步：${formatTime(it)}")
                        }
                        FormButtonRow {
                            Button(
                                onClick = onSyncNow,
                                enabled = !state.operationRunning,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("立即同步")
                            }
                            OutlinedButton(
                                onClick = onRequestUnpair,
                                enabled = !state.operationRunning,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("解除配对")
                            }
                        }
                        if (state.operationRunning) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(
                                    modifier = Modifier.width(16.dp).height(16.dp),
                                    strokeWidth = 2.dp
                                )
                                Spacer(Modifier.width(8.dp))
                                FormCaption("处理中…")
                            }
                        }
                    }
                }

                // 考试体系标签（可选）：只影响同步上报的 subject 可选字段与 TeacherAgent 展示，
                // 不参与本地统计与计时；空标签与旧版行为完全一致。
                // 科目多时逐个展开编辑会把对话框拉得很长，默认折叠为一行摘要，点击展开。
                var tagsExpanded by remember { mutableStateOf(false) }
                val markedCount = state.subjectTags.count { it.tag != null }
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = state.subjectTags.isNotEmpty()) { tagsExpanded = !tagsExpanded },
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            "考试体系标签（可选）",
                            fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.weight(1f)
                        )
                        if (state.subjectTags.isNotEmpty()) {
                            FormCaption("已标记 $markedCount/${state.subjectTags.size}")
                            Icon(
                                imageVector = if (tagsExpanded) Icons.Filled.ExpandLess
                                else Icons.Filled.ExpandMore,
                                contentDescription = if (tagsExpanded) "收起" else "展开"
                            )
                        }
                    }
                    if (state.subjectTags.isEmpty()) {
                        FormCaption(
                            "暂无科目。创建科目后，可给考研科目标记考试组与课程（如 408 / 计算机网络），" +
                                "同步后 TeacherAgent 会展示这些信息并作为映射建议；标记与否不影响本机任何功能。"
                        )
                    } else if (tagsExpanded) {
                        state.subjectTags.forEach { entry ->
                            SubjectTagRow(
                                entry = entry,
                                enabled = !state.operationRunning,
                                onSave = { trackId, subjectId, moduleId ->
                                    onSaveSubjectTag(entry.remoteId, trackId, subjectId, moduleId)
                                }
                            )
                        }
                    }
                }

                FormSection(
                    title = "Teacher 建议",
                    caption = "建议只是建议稿，只有你点击「采纳」后才会创建周目标与计划；" +
                        "TeacherAgent 不会直接修改你现有的计划。采纳/拒绝结果会在下次同步时上报。"
                ) {
                    if (state.proposals.isEmpty()) {
                        FormCaption("暂无建议。同步后，TeacherAgent 会基于诊断与执行情况生成计划建议稿。")
                    } else {
                        state.proposals.forEach { proposal ->
                            ProposalCard(
                                proposal = proposal,
                                enabled = !state.operationRunning,
                                onAccept = { onAccept(proposal) },
                                onReject = { onReject(proposal) }
                            )
                        }
                    }
                }

                FormCaption(
                    "局域网同步只在家庭 WiFi 或手机热点等同一私有局域网内可用；" +
                        "学校、公司和公共 WiFi 可能存在 AP isolation、VLAN 或防火墙限制。"
                )
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("关闭") }
        }
    )

    // 消费一次性消息，避免重复展示；先保留可见时间，否则消息被瞬间清除，
    // 用户看不到失败原因（例如安全解除配对时旧服务器不可达）。
    androidx.compose.runtime.LaunchedEffect(state.successMessage, state.errorMessage) {
        if (state.successMessage != null || state.errorMessage != null) {
            kotlinx.coroutines.delay(8000)
            onConsumeMessages()
        }
    }
}

@Composable
private fun SubjectTagRow(
    entry: SubjectTagEntry,
    enabled: Boolean,
    onSave: (String, String, String?) -> Unit
) {
    // 以 remoteId 为 key：每个科目独立的表单状态；标签刷新后重置。
    androidx.compose.runtime.key(entry.remoteId) {
        SubjectTagRowFields(entry, enabled, onSave)
    }
}

@Composable
private fun SubjectTagRowFields(
    entry: SubjectTagEntry,
    enabled: Boolean,
    onSave: (String, String, String?) -> Unit
) {
    var trackId by remember { mutableStateOf(entry.tag?.examTrackId ?: "") }
    var subjectId by remember { mutableStateOf(entry.tag?.examSubjectId ?: "") }
    var moduleId by remember { mutableStateOf(entry.tag?.examModuleId ?: "") }
    // 字段整行排布：两个长标签字段并排时标签会被压成两行盖住输入框。
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(entry.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            OutlinedTextField(
                value = trackId,
                onValueChange = { trackId = it },
                label = { Text("考试组") },
                supportingText = { Text("如 408") },
                singleLine = true,
                enabled = enabled,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = subjectId,
                onValueChange = { subjectId = it },
                label = { Text("课程") },
                supportingText = { Text("如 计算机网络") },
                singleLine = true,
                enabled = enabled,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = moduleId,
                onValueChange = { moduleId = it },
                label = { Text("模块") },
                supportingText = { Text("可选") },
                singleLine = true,
                enabled = enabled,
                modifier = Modifier.fillMaxWidth()
            )
            FormButtonRow {
                OutlinedButton(
                    onClick = { onSave(trackId, subjectId, moduleId) },
                    enabled = enabled,
                    modifier = Modifier.weight(1f)
                ) {
                    Text(if (entry.tag == null) "保存" else "更新")
                }
                OutlinedButton(
                    onClick = { onSave("", "", null) },
                    enabled = enabled && entry.tag != null,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("清除")
                }
            }
        }
    }
}

@Composable
private fun ProposalCard(
    proposal: SyncProposalDto,
    enabled: Boolean,
    onAccept: () -> Unit,
    onReject: () -> Unit
) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                "建议（${proposalStatusLabel(proposal.status)}）",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold
            )
            FormCaption(proposal.rationale)
            proposal.proposedWeeklyGoals.forEach { goal ->
                FormCaption("· 周目标：${goal.title}")
            }
            proposal.proposedTasks.forEach { task ->
                FormCaption("· 计划：${task.title}")
            }
            if (proposal.status == "pending" && isProposalExpired(proposal)) {
                FormCaption("该建议已过期，无法采纳", color = MaterialTheme.colorScheme.error)
            } else if (proposal.status == "pending") {
                FormButtonRow(modifier = Modifier.padding(top = 4.dp)) {
                    Button(onClick = onAccept, enabled = enabled, modifier = Modifier.weight(1f)) {
                        Text("采纳")
                    }
                    OutlinedButton(onClick = onReject, enabled = enabled, modifier = Modifier.weight(1f)) {
                        Text("拒绝")
                    }
                }
            }
        }
    }
}

/** 建议是否已过期（expiresAt 非空且早于当前时间）。 */
private fun isProposalExpired(proposal: SyncProposalDto): Boolean {
    val expiresAt = proposal.expiresAt ?: return false
    return expiresAt < System.currentTimeMillis()
}

/** zxing 扫码配置：只扫 QR，不发声，方向不锁定。 */
private fun scanOptions(): ScanOptions {
    return ScanOptions().apply {
        setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
        setPrompt("扫描 TeacherAgent 的配对二维码")
        setBeepEnabled(false)
        setOrientationLocked(false)
    }
}

private fun proposalStatusLabel(status: String): String {
    return when (status) {
        "pending" -> "待处理"
        "accepted" -> "已采纳"
        "rejected" -> "已拒绝"
        "superseded" -> "已被新建议取代"
        else -> status
    }
}

private fun formatTime(epochMs: Long): String {
    return SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(epochMs))
}