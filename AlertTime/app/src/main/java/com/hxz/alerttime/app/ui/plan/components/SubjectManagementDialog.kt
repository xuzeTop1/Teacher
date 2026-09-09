package com.hxz.alerttime.app.ui.plan.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hxz.alerttime.app.ui.components.FormBottomSheet
import com.hxz.alerttime.app.ui.plan.PlanSubjectUi

@Composable
internal fun SubjectManageDialog(
    subjects: List<PlanSubjectUi>,
    onDismiss: () -> Unit,
    onAddSubject: (String) -> Unit,
    onDeleteSubject: (PlanSubjectUi) -> Unit
) {
    var subjectName by rememberSaveable { mutableStateOf("") }
    var pendingDelete by rememberSaveable { mutableStateOf<Long?>(null) }
    val subjectToDelete = subjects.firstOrNull { it.id == pendingDelete }

    FormBottomSheet(
        title = "科目管理",
        subtitle = "新建科目，或整理不再使用的科目",
        confirmLabel = "完成",
        confirmEnabled = true,
        isSubmitting = false,
        onDismiss = onDismiss,
        onConfirm = onDismiss,
        showDismissButton = false
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedTextField(
                value = subjectName,
                onValueChange = { subjectName = it.take(16) },
                label = { Text("新科目") },
                placeholder = { Text("例如：线性代数") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.weight(1f)
            )
            Button(
                enabled = subjectName.isNotBlank(),
                onClick = {
                    onAddSubject(subjectName.trim())
                    subjectName = ""
                },
                shape = RoundedCornerShape(14.dp)
            ) {
                Text("添加")
            }
        }
        Text(
            text = "已有科目 · ${subjects.size}",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            subjects.forEach { subject ->
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerLow
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 14.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = subject.name,
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Medium
                        )
                        if (subject.canDelete) {
                            IconButton(onClick = { pendingDelete = subject.id }) {
                                Icon(
                                    imageVector = Icons.Filled.Delete,
                                    contentDescription = "删除${subject.name}",
                                    tint = MaterialTheme.colorScheme.error,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        } else {
                            Text(
                                text = "默认",
                                modifier = Modifier
                                    .background(
                                        color = MaterialTheme.colorScheme.primaryContainer,
                                        shape = RoundedCornerShape(8.dp)
                                    )
                                    .padding(horizontal = 9.dp, vertical = 5.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }
                }
            }
        }
    }

    subjectToDelete?.let { subject ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            shape = MaterialTheme.shapes.large,
            title = { Text("删除科目", fontWeight = FontWeight.SemiBold) },
            text = {
                Text("确定删除“${subject.name}”吗？已有计划和历史记录不会被删除。")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDeleteSubject(subject)
                        pendingDelete = null
                    }
                ) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) {
                    Text("取消")
                }
            }
        )
    }
}
