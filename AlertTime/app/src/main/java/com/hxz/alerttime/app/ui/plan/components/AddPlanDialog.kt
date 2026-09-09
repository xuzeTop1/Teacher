package com.hxz.alerttime.app.ui.plan.components

import android.app.DatePickerDialog
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.hxz.alerttime.app.data.repository.PlanScheduleMode
import com.hxz.alerttime.app.data.repository.PlanRepository
import com.hxz.alerttime.app.ui.components.FormBottomSheet
import com.hxz.alerttime.app.ui.plan.PlanSubjectUi
import com.hxz.alerttime.app.ui.plan.PlanTaskUi
import java.util.Calendar

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AddPlanDialog(
    subjects: List<PlanSubjectUi>,
    initialTask: PlanTaskUi?,
    isSaving: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String, String?, Long?, String?, Long?, Long, PlanScheduleMode, Int) -> Unit
) {
    val context = LocalContext.current
    val isEditing = initialTask != null
    var title by rememberSaveable(initialTask?.id) { mutableStateOf(initialTask?.title.orEmpty()) }
    var content by rememberSaveable(initialTask?.id) { mutableStateOf(initialTask?.content.orEmpty()) }
    var selectedSubjectId by rememberSaveable(initialTask?.id, subjects) {
        mutableStateOf(initialTask?.subjectId ?: subjects.firstOrNull()?.id)
    }
    var customSubjectName by rememberSaveable { mutableStateOf("") }
    var targetMinutesText by rememberSaveable(initialTask?.id) {
        mutableStateOf(initialTask?.targetDurationSeconds?.div(60)?.toString().orEmpty())
    }
    var selectedDateMillis by rememberSaveable(initialTask?.id) {
        mutableLongStateOf(initialTask?.dueAt ?: PlanRepository.startOfDay(System.currentTimeMillis()))
    }
    var scheduleMode by rememberSaveable { mutableStateOf(PlanScheduleMode.SingleDay) }
    var repeatCountText by rememberSaveable { mutableStateOf("7") }
    var showMore by rememberSaveable(initialTask?.id) {
        mutableStateOf(isEditing && (!initialTask?.content.isNullOrBlank() || initialTask?.targetDurationSeconds != null))
    }

    val selectedCalendar = remember(selectedDateMillis) {
        Calendar.getInstance().apply { timeInMillis = selectedDateMillis }
    }
    val datePicker = remember(selectedDateMillis) {
        DatePickerDialog(
            context,
            { _, year, month, dayOfMonth ->
                selectedDateMillis = Calendar.getInstance().apply {
                    set(year, month, dayOfMonth, 0, 0, 0)
                    set(Calendar.MILLISECOND, 0)
                }.timeInMillis
            },
            selectedCalendar.get(Calendar.YEAR),
            selectedCalendar.get(Calendar.MONTH),
            selectedCalendar.get(Calendar.DAY_OF_MONTH)
        )
    }
    DisposableEffect(datePicker) {
        onDispose { datePicker.dismiss() }
    }

    FormBottomSheet(
        title = if (isEditing) "编辑计划" else "添加计划",
        subtitle = if (isEditing) "调整计划信息，保存后立即生效" else "先写清做什么、归属和执行日期",
        confirmLabel = if (isEditing) "保存修改" else "添加计划",
        confirmEnabled = title.isNotBlank(),
        isSubmitting = isSaving,
        onDismiss = onDismiss,
        onConfirm = {
            onConfirm(
                title.trim(),
                content.trim().ifBlank { null },
                selectedSubjectId,
                customSubjectName.trim().ifBlank { null },
                targetMinutesText.toLongOrNull()?.takeIf { it > 0 }?.times(60),
                selectedDateMillis,
                scheduleMode,
                repeatCountText.toIntOrNull() ?: 1
            )
        }
    ) {
        Text(
            text = "基本信息",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary
        )

        OutlinedTextField(
            value = title,
            onValueChange = { title = it.take(120) },
            label = { Text("计划标题") },
            placeholder = { Text("例如：高等数学错题复盘") },
            supportingText = {
                Text(if (title.isBlank()) "必填，写成一个可以立即开始的动作" else "${title.length}/120")
            },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth()
        )

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "科目",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                subjects.forEach { subject ->
                    FilterChip(
                        selected = selectedSubjectId == subject.id && customSubjectName.isBlank(),
                        onClick = {
                            selectedSubjectId = subject.id
                            customSubjectName = ""
                        },
                        label = { Text(subject.name) }
                    )
                }
            }
        }

        OutlinedButton(
            onClick = { datePicker.show() },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Filled.DateRange, contentDescription = null)
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("执行日期", style = MaterialTheme.typography.labelMedium)
                    Text(
                        text = formatPlanDateHeader(selectedDateMillis),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }

        TextButton(
            onClick = { showMore = !showMore },
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(
                imageVector = if (showMore) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                contentDescription = null
            )
            Spacer(Modifier.width(6.dp))
            Text(if (showMore) "收起更多设置" else "备注、预计投入与重复")
        }

        if (showMore) {
            HorizontalDivider()
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "目标投入",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "达到目标时自动完成计划；不填写则由你手动完成。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    listOf(25, 45, 60, 90).forEach { minutes ->
                        FilterChip(
                            selected = targetMinutesText == minutes.toString(),
                            onClick = {
                                targetMinutesText = if (targetMinutesText == minutes.toString()) "" else minutes.toString()
                            },
                            label = { Text("约 ${minutes} 分钟") }
                        )
                    }
                }
            }
            OutlinedTextField(
                value = targetMinutesText,
                onValueChange = { targetMinutesText = it.filter(Char::isDigit).take(4) },
                label = { Text("自定义投入（分钟）") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = content,
                onValueChange = { content = it.take(2_000) },
                label = { Text("备注（可选）") },
                minLines = 2,
                maxLines = 5,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = customSubjectName,
                onValueChange = { value ->
                    customSubjectName = value.take(40)
                    if (value.isNotBlank()) selectedSubjectId = null
                },
                label = { Text("临时新建科目（可选）") },
                supportingText = { Text("填写后将同时创建该科目") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            if (!isEditing) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "计划方式",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        PlanScheduleMode.entries.forEach { mode ->
                            FilterChip(
                                selected = scheduleMode == mode,
                                onClick = { scheduleMode = mode },
                                label = { Text(mode.label()) }
                            )
                        }
                    }
                }
                if (scheduleMode != PlanScheduleMode.SingleDay) {
                    OutlinedTextField(
                        value = repeatCountText,
                        onValueChange = { repeatCountText = it.filter(Char::isDigit).take(3) },
                        label = { Text("重复次数") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }
    }
}

internal fun PlanScheduleMode.label(): String = when (this) {
    PlanScheduleMode.SingleDay -> "单日"
    PlanScheduleMode.ContinuousDays -> "连续多日"
    PlanScheduleMode.DailyCycle -> "每日循环"
    PlanScheduleMode.WeeklyCycle -> "每周循环"
}
