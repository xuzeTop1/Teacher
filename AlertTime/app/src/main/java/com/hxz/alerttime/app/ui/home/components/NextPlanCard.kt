package com.hxz.alerttime.app.ui.home.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.hxz.alerttime.app.ui.home.NextPlanUi

@Composable
internal fun NextPlanCard(
    nextPlan: NextPlanUi?,
    onAddPlan: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onAddPlan)
            .padding(vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = if (nextPlan == null) "Plan List" else "接下来 · ${nextPlan.dueAt?.let(::formatHomePlanDate) ?: "待安排"}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = nextPlan?.title ?: "添加一个清晰、可开始的计划",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = if (nextPlan == null) "写下要做的事" else "进入列表选择并开始计时",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Icon(
            imageVector = if (nextPlan == null) Icons.Outlined.Add else Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = if (nextPlan == null) "添加计划" else "查看计划",
            tint = MaterialTheme.colorScheme.primary
        )
    }
}

private fun formatHomePlanDate(dateMillis: Long): String {
    return java.text.SimpleDateFormat("M月d日 E", java.util.Locale.CHINA).format(dateMillis)
}
