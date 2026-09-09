package com.hxz.alerttime.app.ui.home.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import com.hxz.alerttime.app.core.notifications.ReminderSettings

@Composable
internal fun ReminderSettingsDialog(
    initial: ReminderSettings,
    onDismiss: () -> Unit,
    onSave: (ReminderSettings) -> Unit
) {
    var settings by remember(initial) { mutableStateOf(initial) }
    var awayMinutes by remember(initial) { mutableStateOf(initial.awayMinutes.toString()) }
    var pauseMinutes by remember(initial) { mutableStateOf(initial.manualPauseMinutes.toString()) }
    var aiMinutes by remember(initial) { mutableStateOf(initial.aiPauseMinutes.toString()) }
    var dailyHour by remember(initial) { mutableStateOf(initial.dailyReminderHour.toString()) }
    var quietStart by remember(initial) {
        mutableStateOf(formatMinuteOfDay(initial.quietStartMinuteOfDay))
    }
    var quietEnd by remember(initial) {
        mutableStateOf(formatMinuteOfDay(initial.quietEndMinuteOfDay))
    }

    val parsed = settings.copy(
        awayMinutes = awayMinutes.toIntOrNull() ?: -1,
        manualPauseMinutes = pauseMinutes.toIntOrNull() ?: -1,
        aiPauseMinutes = aiMinutes.toIntOrNull() ?: -1,
        dailyReminderHour = dailyHour.toIntOrNull() ?: -1,
        quietStartMinuteOfDay = parseTime(quietStart) ?: -1,
        quietEndMinuteOfDay = parseTime(quietEnd) ?: -1
    )
    val valid = parsed.awayMinutes in 1..180 &&
        parsed.manualPauseMinutes in 1..180 &&
        parsed.aiPauseMinutes in 1..180 &&
        parsed.dailyReminderHour in 0..23 &&
        parsed.quietStartMinuteOfDay in 0..1439 &&
        parsed.quietEndMinuteOfDay in 0..1439

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = MaterialTheme.shapes.large,
        title = { Text("提醒设置", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .heightIn(max = 520.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                ReminderToggle("每日未完成计划提醒", settings.planRemindersEnabled) {
                    settings = settings.copy(planRemindersEnabled = it)
                }
                ReminderToggle("休息日周目标提醒", settings.weeklyGoalRemindersEnabled) {
                    settings = settings.copy(weeklyGoalRemindersEnabled = it)
                }
                // 时长输入并入开关行：左标签、中数字框、右开关，纵向行数减半。
                ReminderToggleWithMinutes(
                    label = "离开应用提醒（离开后）",
                    checked = settings.awayReminderEnabled,
                    value = awayMinutes,
                    onCheckedChange = { settings = settings.copy(awayReminderEnabled = it) },
                    onValueChange = { awayMinutes = it }
                )
                ReminderToggleWithMinutes(
                    label = "手动暂停提醒（暂停后）",
                    checked = settings.manualPauseReminderEnabled,
                    value = pauseMinutes,
                    onCheckedChange = { settings = settings.copy(manualPauseReminderEnabled = it) },
                    onValueChange = { pauseMinutes = it }
                )
                ReminderToggleWithMinutes(
                    label = "AI 求助暂停提醒（求助后）",
                    checked = settings.aiPauseReminderEnabled,
                    value = aiMinutes,
                    onCheckedChange = { settings = settings.copy(aiPauseReminderEnabled = it) },
                    onValueChange = { aiMinutes = it }
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = dailyHour,
                        onValueChange = { dailyHour = it.filter(Char::isDigit).take(2) },
                        modifier = Modifier.weight(0.9f),
                        label = { Text("每日提醒（0—23 时）") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = quietStart,
                        onValueChange = { quietStart = it.take(5) },
                        modifier = Modifier.weight(1f),
                        label = { Text("免打扰开始") },
                        placeholder = { Text("22:30") },
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = quietEnd,
                        onValueChange = { quietEnd = it.take(5) },
                        modifier = Modifier.weight(1f),
                        label = { Text("免打扰结束") },
                        placeholder = { Text("08:00") },
                        singleLine = true
                    )
                }
                Text(
                    text = "免打扰开始与结束相同表示关闭免打扰；锁屏或息屏不会被视为离开；同一次暂停只提醒一次。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = valid,
                onClick = { onSave(parsed.normalized()) }
            ) {
                Text("保存", fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}

@Composable
private fun ReminderToggle(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun ReminderToggleWithMinutes(
    label: String,
    checked: Boolean,
    value: String,
    onCheckedChange: (Boolean) -> Unit,
    onValueChange: (String) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(
            value = value,
            onValueChange = { onValueChange(it.filter(Char::isDigit).take(3)) },
            modifier = Modifier.width(96.dp),
            suffix = { Text("分", style = MaterialTheme.typography.bodySmall) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium
        )
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

private fun formatMinuteOfDay(value: Int): String {
    return "%02d:%02d".format(value / 60, value % 60)
}

private fun parseTime(value: String): Int? {
    val parts = value.trim().split(':')
    if (parts.size != 2) return null
    val hour = parts[0].toIntOrNull() ?: return null
    val minute = parts[1].toIntOrNull() ?: return null
    if (hour !in 0..23 || minute !in 0..59) return null
    return hour * 60 + minute
}
