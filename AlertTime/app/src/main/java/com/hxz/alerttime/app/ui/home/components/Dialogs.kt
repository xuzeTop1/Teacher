package com.hxz.alerttime.app.ui.home.components

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.hxz.alerttime.app.ui.home.StudyPlanUi
import com.hxz.alerttime.app.ui.home.StudySubjectUi
import java.text.SimpleDateFormat
import java.util.Locale

@Composable
internal fun TodayTargetDialog(
    currentTargetSeconds: Long?,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    val currentHours = currentTargetSeconds
        ?.takeIf { it > 0 }
        ?.let { seconds ->
            val hours = seconds / 3600.0
            if (hours % 1.0 == 0.0) hours.toInt().toString() else "%.1f".format(Locale.US, hours)
        }
        .orEmpty()
    var targetHours by rememberSaveable { mutableStateOf(currentHours) }

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(28.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        title = { Text("今日目标", fontWeight = FontWeight.SemiBold) },
        text = {
            OutlinedTextField(
                value = targetHours,
                onValueChange = { value ->
                    targetHours = value.filter { it.isDigit() || it == '.' }.take(4)
                },
                label = { Text("目标小时数") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            )
        },
        confirmButton = {
            TextButton(
                enabled = targetHours.toDoubleOrNull()?.let { it > 0 } == true,
                onClick = { onConfirm(targetHours) }
            ) {
                Text("保存", fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

@Composable
internal fun StudyContextDialog(
    plans: List<StudyPlanUi>,
    subjects: List<StudySubjectUi>,
    onDismiss: () -> Unit,
    onConfirm: (Long?, Long?) -> Unit
) {
    val defaultPlan = plans.firstOrNull()
    val defaultSubjectId = subjects.firstOrNull { it.name != "未分类" }?.id
        ?: subjects.firstOrNull()?.id
    var selectedPlanId by rememberSaveable(plans) { mutableStateOf(defaultPlan?.id) }
    var selectedSubjectId by rememberSaveable(subjects, selectedPlanId) {
        mutableStateOf(defaultPlan?.subjectId ?: defaultSubjectId)
    }
    val selectedPlan = plans.firstOrNull { it.id == selectedPlanId }

    LaunchedEffect(selectedPlanId) {
        val planSubjectId = plans.firstOrNull { it.id == selectedPlanId }?.subjectId
        if (planSubjectId != null) {
            selectedSubjectId = planSubjectId
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = MaterialTheme.shapes.large,
        title = { Text("本次学习", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(
                    text = "选择计划",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FilterChip(
                        selected = selectedPlanId == null,
                        onClick = { selectedPlanId = null },
                        label = { Text("不关联计划") }
                    )
                    plans.forEach { plan ->
                        FilterChip(
                            selected = selectedPlanId == plan.id,
                            onClick = { selectedPlanId = plan.id },
                            label = { Text(formatStudyPlanLabel(plan, subjects)) }
                        )
                    }
                }
                selectedPlan?.let { plan ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = plan.dueAt?.let { formatDialogPlanDate(it) } ?: "未安排日期",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (!plan.content.isNullOrBlank()) {
                            Text(
                                text = plan.content,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }

                Text(
                    text = "记录到科目",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    subjects.forEach { subject ->
                        FilterChip(
                            selected = selectedSubjectId == subject.id,
                            onClick = { selectedSubjectId = subject.id },
                            label = { Text(subject.name) }
                        )
                    }
                }
                if (subjects.isEmpty()) {
                    Text(
                        text = "还没有可用科目，会暂记为未分类。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(selectedPlanId, selectedSubjectId) },
                shape = RoundedCornerShape(10.dp)
            ) {
                Text("开始", fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, shape = RoundedCornerShape(10.dp)) {
                Text("取消")
            }
        }
    )
}

@Composable
internal fun AboutDialog(
    onDismiss: () -> Unit,
    onOpenBackup: () -> Unit,
    onOpenTeacherSync: () -> Unit = {}
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = MaterialTheme.shapes.large,
        title = { Text("关于自律", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "这是一个面向学习者的专注工具，用来记录真正投入的学习时间、计划和复盘。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "它不追求复杂，只希望在想偷懒、分心、失去节奏的时候，给自己一个温和但明确的提醒。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "如果它也能帮到正在备考、学习或想重新找回专注的人，那就更好了。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "作者：Xuze",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        },
        confirmButton = {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                TextButton(
                    onClick = onOpenBackup,
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("数据与备份", fontWeight = FontWeight.SemiBold)
                }
                TextButton(
                    onClick = onOpenTeacherSync,
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("Teacher 同步", fontWeight = FontWeight.SemiBold)
                }
                TextButton(onClick = onDismiss, shape = RoundedCornerShape(10.dp)) {
                    Text("知道了", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    )
}

private fun formatStudyPlanLabel(
    plan: StudyPlanUi,
    subjects: List<StudySubjectUi>
): String {
    val subjectName = subjects.firstOrNull { it.id == plan.subjectId }?.name
    return if (subjectName.isNullOrBlank()) plan.title else "$subjectName · ${plan.title}"
}

private fun formatDialogPlanDate(dateMillis: Long): String {
    return SimpleDateFormat("M月d日 E", Locale.CHINA).format(dateMillis)
}
