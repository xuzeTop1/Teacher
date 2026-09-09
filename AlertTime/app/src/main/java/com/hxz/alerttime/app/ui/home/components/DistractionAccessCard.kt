package com.hxz.alerttime.app.ui.home.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hxz.alerttime.app.ui.home.DistractionRecordUi
import java.text.SimpleDateFormat
import java.util.Locale

@Composable
internal fun DistractionAccessCard(
    distractionCount: Int,
    lastDistractionAppLabel: String?,
    distractionAppLabels: List<String>,
    distractionRecords: List<DistractionRecordUi>,
    aiHelpCount: Int,
    aiHelpDurationText: String,
    lastAiHelpLabel: String?,
    aiHelpActive: Boolean = false,
    usageAccessGranted: Boolean,
    onOpenUsageAccessSettings: () -> Unit,
    accessibilityEnabled: Boolean = false,
    onOpenAccessibilitySettings: () -> Unit = {},
    onOpenGemini: () -> Unit,
    onOpenChatGpt: () -> Unit
) {
    var showDistractionDetails by rememberSaveable { mutableStateOf(false) }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("AI 求助", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(
                        text = "求助时间单独统计，不计入有效专注",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                if (aiHelpActive) {
                    Text(
                        text = "AI 求助中…",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.tertiary
                    )
                } else if (aiHelpCount > 0) {
                    Text(
                        text = "$aiHelpCount 次 · $aiHelpDurationText",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.tertiary
                    )
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedButton(
                    onClick = onOpenGemini,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.weight(1f)
                ) { Text("Gemini") }
                OutlinedButton(
                    onClick = onOpenChatGpt,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.weight(1f)
                ) { Text("ChatGPT") }
            }
            if (distractionCount > 0) {
                Text(
                    text = "本次离开 $distractionCount 次" + (lastDistractionAppLabel?.let { " · 最近 $it" } ?: ""),
                    modifier = Modifier.clickable { showDistractionDetails = true },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            if (!usageAccessGranted) {
                TextButton(onClick = onOpenUsageAccessSettings) {
                    Text("开启使用情况访问，识别离开的 App")
                }
                Text(
                    "未授权时无法判断其他应用是否处于悬浮窗，也无法统计外部 AI App 使用时长；" +
                        "这些能力只会降级为「未记录」，不影响计时、备份与普通学习功能。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                Text(
                    "使用情况访问只能推测最近使用的应用，不能判断窗口位置、悬浮层级或分屏状态。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (accessibilityEnabled) {
                Text(
                    "悬浮窗覆盖检测：已开启。检测到其他应用悬浮窗覆盖时不会误记分心。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                TextButton(onClick = onOpenAccessibilitySettings) {
                    Text("开启无障碍检测（识别其他应用悬浮窗覆盖）")
                }
                Text(
                    "未开启时无法判断其他应用是否处于悬浮窗，被覆盖时可能按后台记一次分心；" +
                        "该能力可选且不阻断计时、备份与普通学习功能。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }

    if (showDistractionDetails) {
        DistractionDetailsDialog(
            distractionCount = distractionCount,
            records = distractionRecords,
            usageAccessGranted = usageAccessGranted,
            onDismiss = { showDistractionDetails = false }
        )
    }
}

@Composable
private fun DistractionDetailsDialog(
    distractionCount: Int,
    records: List<DistractionRecordUi>,
    usageAccessGranted: Boolean,
    onDismiss: () -> Unit
) {
    val unknownCount = (distractionCount - records.size).coerceAtLeast(0)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("本次离开记录", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                records.asReversed().forEachIndexed { index, record ->
                    Text("${index + 1}. ${record.appLabel} · ${formatDistractionTime(record.timestamp)}")
                }
                if (unknownCount > 0) Text("另有 $unknownCount 次未识别到具体 App。")
                if (!usageAccessGranted) {
                    Text(
                        "开启使用情况访问后可提高识别稳定性。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("知道了") } }
    )
}

private fun formatDistractionTime(timestamp: Long): String =
    SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(timestamp)
