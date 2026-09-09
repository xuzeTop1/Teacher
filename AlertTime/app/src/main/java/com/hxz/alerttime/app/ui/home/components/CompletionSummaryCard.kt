package com.hxz.alerttime.app.ui.home.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hxz.alerttime.app.core.time.formatStudyDuration
import com.hxz.alerttime.app.ui.home.CompletionSummaryUi
import java.text.SimpleDateFormat
import java.util.Locale

@Composable
internal fun CompletionSummaryCard(summary: CompletionSummaryUi) {
    ElevatedCard(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = 0.dp),
        colors = CardDefaults.elevatedCardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
        )
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = "最近一次学习",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.75f)
            )
            summary.endReason?.let { reason ->
                Text(
                    text = reason,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.82f)
                )
            }
            Text(
                text = summary.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
            Text(
                text = "开始 ${formatClockTime(summary.startedAt)} · 结束 ${formatClockTime(summary.endedAt)}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.82f)
            )
            Text(
                text = "有效学习 ${formatStudyDuration(summary.effectiveSeconds)} · 实际经过 ${formatStudyDuration(summary.elapsedSeconds)}" +
                    (summary.aiHelpSeconds.takeIf { it > 0 }?.let { " · AI 求助 ${formatStudyDuration(it)}" } ?: ""),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.82f)
            )
            summary.targetSeconds?.let { targetSeconds ->
                Text(
                    text = if (summary.effectiveSeconds >= targetSeconds) {
                        "已达到计划目标 ${formatStudyDuration(targetSeconds)}"
                    } else {
                        "计划目标 ${formatStudyDuration(targetSeconds)}，本次结束未自动完成计划"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.82f)
                )
            }
        }
    }
}

private fun formatClockTime(timestamp: Long): String {
    return SimpleDateFormat("HH:mm", Locale.CHINA).format(timestamp)
}
