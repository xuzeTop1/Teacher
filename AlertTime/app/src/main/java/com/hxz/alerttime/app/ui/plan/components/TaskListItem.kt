package com.hxz.alerttime.app.ui.plan.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.hxz.alerttime.app.data.repository.PlanRepository
import com.hxz.alerttime.app.ui.plan.PlanTaskUi
import com.hxz.alerttime.app.core.time.formatCompactStudyDuration

@Composable
internal fun TaskListItem(
    task: PlanTaskUi,
    subjectName: String?,
    completedDurationSeconds: Long,
    isActive: Boolean,
    startEnabled: Boolean,
    onStartTask: () -> Unit,
    onAddToCalendar: () -> Unit,
    onEdit: () -> Unit,
    onToggleDone: () -> Unit,
    onDeferToTomorrow: () -> Unit,
    onDelete: () -> Unit
) {
    val done = task.status == PlanRepository.STATUS_DONE
    val canDeferToTomorrow = !done && !isActive && (
        task.dueAt == null || task.dueAt < PlanRepository.startOfNextDay(System.currentTimeMillis())
    )
    var menuExpanded by remember { mutableStateOf(false) }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (done) Modifier else Modifier.clickable(enabled = startEnabled, onClick = onStartTask)),
        shape = RoundedCornerShape(14.dp),
        color = when {
            done -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
            isActive -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
            else -> MaterialTheme.colorScheme.surfaceContainerLow
        }
    ) {
        Row(
            modifier = Modifier.padding(start = 12.dp, top = 11.dp, bottom = 11.dp, end = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Top
        ) {
            Surface(
                shape = CircleShape,
                color = if (done) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.size(36.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = when {
                            done -> Icons.Filled.CheckCircle
                            isActive -> Icons.Filled.Timer
                            else -> Icons.Filled.PlayArrow
                        },
                        contentDescription = when {
                            done -> "已完成"
                            isActive -> "计划进行中"
                            else -> "开始计划"
                        },
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(top = 1.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                Text(
                    text = formatTaskPrimaryText(task, subjectName),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    textDecoration = if (done) TextDecoration.LineThrough else null,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (isActive) {
                        Text(
                            "进行中",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    subjectName?.takeIf(String::isNotBlank)?.let {
                        Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    }
                    completedDurationSeconds.takeIf { it > 0 }?.let {
                        Text(
                            "累计投入 ${formatCompactStudyDuration(it)}",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                task.content?.takeIf(String::isNotBlank)?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            Box {
                IconButton(onClick = { menuExpanded = true }) {
                    Icon(Icons.Filled.MoreVert, contentDescription = "更多操作")
                }
                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(
                        text = { Text("写入日历") },
                        leadingIcon = { Icon(Icons.Filled.CalendarMonth, contentDescription = null) },
                        onClick = { menuExpanded = false; onAddToCalendar() }
                    )
                    DropdownMenuItem(
                        text = { Text("编辑") },
                        enabled = !isActive,
                        leadingIcon = { Icon(Icons.Filled.Edit, contentDescription = null) },
                        onClick = { menuExpanded = false; onEdit() }
                    )
                    DropdownMenuItem(
                        text = { Text(if (done) "撤销完成" else "完成") },
                        enabled = !isActive,
                        leadingIcon = { Icon(Icons.Filled.CheckCircle, contentDescription = null) },
                        onClick = { menuExpanded = false; onToggleDone() }
                    )
                    DropdownMenuItem(
                        text = { Text("顺延到明天") },
                        enabled = canDeferToTomorrow,
                        leadingIcon = { Icon(Icons.Filled.CalendarMonth, contentDescription = null) },
                        onClick = { menuExpanded = false; onDeferToTomorrow() }
                    )
                    DropdownMenuItem(
                        text = { Text("删除", color = MaterialTheme.colorScheme.error) },
                        enabled = !isActive,
                        leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                        onClick = { menuExpanded = false; onDelete() }
                    )
                }
            }
        }
    }
}
