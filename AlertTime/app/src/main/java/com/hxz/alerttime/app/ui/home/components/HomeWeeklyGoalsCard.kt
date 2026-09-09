package com.hxz.alerttime.app.ui.home.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.ui.home.HomeWeeklyGoalUi

@Composable
internal fun HomeWeeklyGoalsCard(
    currentGoals: List<HomeWeeklyGoalUi>,
    nextGoals: List<HomeWeeklyGoalUi>,
    isRestDay: Boolean,
    onOpenPlanning: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpenPlanning),
        shape = RoundedCornerShape(14.dp),
        color = if (isRestDay) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceContainerLow
        }
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = if (isRestDay) "休息日 · 回顾与展望" else "本周目标",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = if (isRestDay) "回顾规划 →" else "查看 →",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            if (currentGoals.isEmpty()) {
                Text(
                    text = if (isRestDay) {
                        "回顾本周，并补录本周目标或规划下周成果。"
                    } else {
                        "还没有本周目标，可在计划页随时补录。"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                currentGoals.take(2).forEach { goal ->
                    val done = goal.status == StatusCodes.WEEKLY_GOAL_DONE
                    Text(
                        text = "${if (done) "✓" else "○"} ${goal.title}",
                        style = MaterialTheme.typography.bodyMedium,
                        textDecoration = if (done) TextDecoration.LineThrough else null,
                        color = if (done) {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        }
                    )
                }
            }
            if (isRestDay && nextGoals.isNotEmpty()) {
                Text(
                    text = "下周已规定 ${nextGoals.size} 项成果",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}
