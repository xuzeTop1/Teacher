package com.hxz.alerttime.app.ui.home.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.hxz.alerttime.app.ui.home.HomeUiState
import com.hxz.alerttime.app.ui.home.TimerStatus
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

@Composable
internal fun HeroTimerCard(
    uiState: HomeUiState,
    onPrimaryAction: () -> Unit,
    onFinish: () -> Unit
) {
    val isRunning = uiState.timerStatus == TimerStatus.Running
    val isActive = uiState.timerStatus != TimerStatus.Idle
    val isTransitioning = uiState.timerStatus == TimerStatus.Starting ||
        uiState.timerStatus == TimerStatus.Saving
    val canFinish = uiState.timerStatus == TimerStatus.Running ||
        uiState.timerStatus == TimerStatus.Paused

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        FocusClock(uiState)

        val activeText = listOfNotNull(
            uiState.activeSubjectName?.takeIf(String::isNotBlank),
            uiState.activePlanTitle?.takeIf(String::isNotBlank)
        ).joinToString(" · ")
        if (activeText.isNotBlank()) {
            Text(
                text = activeText,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1
            )
        }
        uiState.activePlanTargetText?.takeIf { isActive }?.let { targetText ->
            Text(
                text = "计划进度 ${uiState.activePlanElapsedText} / $targetText",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            TimeMetric(
                label = if (isActive) "本次总历时" else "今日总历时",
                value = if (isActive) uiState.activeElapsedText else uiState.todayCompactDurationText,
                modifier = Modifier.weight(1f)
            )
            TimeMetric(
                label = "今日有效专注",
                value = uiState.todayFocusDurationText,
                modifier = Modifier.weight(1f)
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Button(
                onClick = onPrimaryAction,
                enabled = !isTransitioning && !uiState.isLoading,
                modifier = Modifier
                    .weight(1f)
                    .height(54.dp)
                    .semantics { contentDescription = uiState.primaryActionText },
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary
                )
            ) {
                if (isTransitioning) {
                    CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                } else {
                    Icon(
                        imageVector = if (isRunning) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        contentDescription = null,
                        modifier = Modifier.size(24.dp)
                    )
                    Text(
                        text = uiState.primaryActionText,
                        modifier = Modifier.padding(start = 8.dp),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
            if (canFinish) {
                FilledTonalIconButton(
                    onClick = onFinish,
                    modifier = Modifier.size(54.dp),
                    shape = CircleShape
                ) {
                    Icon(Icons.Filled.Check, contentDescription = "结束本次学习")
                }
            }
        }
    }
}

@Composable
private fun FocusClock(uiState: HomeUiState) {
    val trackColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.42f)
    val activeColor = MaterialTheme.colorScheme.primary
    val isActive = uiState.timerStatus != TimerStatus.Idle

    Box(modifier = Modifier.size(204.dp), contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.size(190.dp)) {
            val strokeWidth = 8.dp.toPx()
            val arcSize = Size(size.width - strokeWidth, size.height - strokeWidth)
            val topLeft = Offset(strokeWidth / 2, strokeWidth / 2)
            drawArc(
                color = trackColor,
                startAngle = -90f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(strokeWidth, cap = StrokeCap.Round)
            )
            if (isActive) {
                drawArc(
                    color = activeColor.copy(alpha = 0.9f),
                    startAngle = -90f,
                    sweepAngle = if (uiState.activePlanTargetSeconds != null) {
                        uiState.activePlanProgress * 360f
                    } else {
                        360f
                    },
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(strokeWidth, cap = StrokeCap.Round)
                )
            }
            val center = Offset(size.width / 2f, size.height / 2f)
            val outerTickRadius = size.minDimension / 2f - strokeWidth - 14.dp.toPx()
            repeat(60) { index ->
                val angle = (index * 6f - 90f) * PI.toFloat() / 180f
                val tickLength = if (index % 5 == 0) 8.dp.toPx() else 4.dp.toPx()
                val outer = Offset(
                    center.x + cos(angle) * outerTickRadius,
                    center.y + sin(angle) * outerTickRadius
                )
                val inner = Offset(
                    center.x + cos(angle) * (outerTickRadius - tickLength),
                    center.y + sin(angle) * (outerTickRadius - tickLength)
                )
                drawLine(
                    color = trackColor,
                    start = inner,
                    end = outer,
                    strokeWidth = if (index % 5 == 0) 2.dp.toPx() else 1.dp.toPx(),
                    cap = StrokeCap.Round
                )
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = if (isActive) uiState.activeFocusClockLabel else "今日有效专注",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = if (isActive) uiState.activeFocusClockText else uiState.todayFocusDurationText,
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
            if (isActive) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
                    modifier = Modifier.padding(top = 8.dp)
                ) {
                    Text(
                        text = when (uiState.timerStatus) {
                            TimerStatus.Running -> "正在投入"
                            TimerStatus.Saving -> "正在完成"
                            else -> "已暂停"
                        },
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun TimeMetric(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.48f)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        }
    }
}
