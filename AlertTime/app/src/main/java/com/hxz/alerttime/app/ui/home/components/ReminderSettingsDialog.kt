package com.hxz.alerttime.app.ui.home.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.dp
import com.hxz.alerttime.app.core.notifications.ReminderSettings
import com.hxz.alerttime.app.ui.components.FormButtonRow
import com.hxz.alerttime.app.ui.components.FormCaption
import com.hxz.alerttime.app.ui.components.FormNumberField
import com.hxz.alerttime.app.ui.components.FormScrollColumn
import com.hxz.alerttime.app.ui.components.FormSection
import com.hxz.alerttime.app.ui.components.FormSwitchRow
import com.hxz.alerttime.app.ui.components.FormTimeField

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
            FormScrollColumn {
                FormSection("提醒开关") {
                    FormSwitchRow(
                        label = "每日未完成计划提醒",
                        checked = settings.planRemindersEnabled,
                        onCheckedChange = { settings = settings.copy(planRemindersEnabled = it) }
                    )
                    FormSwitchRow(
                        label = "休息日周目标提醒",
                        checked = settings.weeklyGoalRemindersEnabled,
                        onCheckedChange = { settings = settings.copy(weeklyGoalRemindersEnabled = it) }
                    )
                }

                FormSection("离开与暂停提醒") {
                    FormSwitchRow(
                        label = "离开应用提醒",
                        supporting = "离开应用后多久提醒",
                        checked = settings.awayReminderEnabled,
                        onCheckedChange = { settings = settings.copy(awayReminderEnabled = it) },
                        control = {
                            FormNumberField(awayMinutes, { awayMinutes = it }, suffix = "分")
                        }
                    )
                    FormSwitchRow(
                        label = "手动暂停提醒",
                        supporting = "暂停后多久提醒",
                        checked = settings.manualPauseReminderEnabled,
                        onCheckedChange = { settings = settings.copy(manualPauseReminderEnabled = it) },
                        control = {
                            FormNumberField(pauseMinutes, { pauseMinutes = it }, suffix = "分")
                        }
                    )
                    FormSwitchRow(
                        label = "AI 求助暂停提醒",
                        supporting = "求助后多少分钟提醒",
                        checked = settings.aiPauseReminderEnabled,
                        onCheckedChange = { settings = settings.copy(aiPauseReminderEnabled = it) },
                        control = {
                            FormNumberField(aiMinutes, { aiMinutes = it }, suffix = "分")
                        }
                    )
                }

                FormSection("每日提醒与免打扰") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "每日提醒（0—23 时）",
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.bodyMedium
                        )
                        FormNumberField(dailyHour, { dailyHour = it }, suffix = "时", maxDigits = 2)
                    }
                    FormButtonRow {
                        FormTimeField(
                            value = quietStart,
                            onValueChange = { quietStart = it },
                            label = "免打扰开始",
                            modifier = Modifier.weight(1f)
                        )
                        FormTimeField(
                            value = quietEnd,
                            onValueChange = { quietEnd = it },
                            label = "免打扰结束",
                            modifier = Modifier.weight(1f)
                        )
                    }
                    FormCaption("免打扰开始与结束相同表示关闭免打扰；锁屏或息屏不会被视为离开；同一次暂停只提醒一次。")
                }
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