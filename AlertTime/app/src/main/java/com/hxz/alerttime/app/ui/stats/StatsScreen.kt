package com.hxz.alerttime.app.ui.stats

import android.graphics.Paint
import android.widget.Toast
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hxz.alerttime.app.core.time.formatStudyDuration
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.repository.DailyStudyStat
import com.hxz.alerttime.app.ui.components.AppPageHeader
import com.hxz.alerttime.app.ui.theme.AlertTimeExtras
import java.time.DayOfWeek
import java.util.Locale
import kotlin.math.max

private enum class DistributionMode(val label: String) {
    Subject("按学科"),
    Plan("按计划")
}

private enum class TrendMode(val label: String) {
    Focus("有效专注"),
    Total("总历时")
}

private data class DistributionEntry(
    val label: String,
    val seconds: Long
)

private val DistributionListMaxHeight = 360.dp

@Composable
fun StatsScreen(
    database: AlertTimeDatabase,
    modifier: Modifier = Modifier,
    viewModel: StatsViewModel = viewModel(factory = StatsViewModel.Factory(database))
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var distributionMode by rememberSaveable { mutableStateOf(DistributionMode.Plan) }
    var trendMode by rememberSaveable { mutableStateOf(TrendMode.Focus) }
    val entries = remember(
        distributionMode,
        uiState.todaySubjectDistribution,
        uiState.todayPlanDistribution
    ) {
        when (distributionMode) {
            DistributionMode.Subject -> uiState.todaySubjectDistribution.map {
                DistributionEntry(it.subjectName, it.durationSeconds)
            }
            DistributionMode.Plan -> uiState.todayPlanDistribution.map {
                DistributionEntry(it.planTitle, it.durationSeconds)
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 18.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        AppPageHeader(
            title = "统计",
            subtitle = "先看今天的时间分配，再回顾长期节奏。"
        ) {
            TextButton(
                onClick = {
                    runCatching {
                        StatsExporter.shareImage(
                            context = context,
                            content = buildStatsShareContent(
                                uiState = uiState,
                                distributionMode = distributionMode,
                                entries = entries,
                                trendMode = trendMode
                            )
                        )
                    }.onFailure {
                        Toast.makeText(context, "分享图片失败", Toast.LENGTH_SHORT).show()
                    }
                },
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(
                    imageVector = Icons.Filled.Share,
                    contentDescription = "分享统计图片",
                    modifier = Modifier.size(18.dp)
                )
                Text("分享")
            }
        }
        TodayOverview(uiState)
        DistributionSection(
            selectedMode = distributionMode,
            onModeSelected = { distributionMode = it },
            entries = entries,
            totalSeconds = uiState.todayFocusSeconds
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))
        TrendSection(
            stats = uiState.recentTrend,
            selectedMode = trendMode,
            onModeSelected = { trendMode = it }
        )
        LongRangeMetrics(
            weekSeconds = uiState.weekSeconds,
            totalSeconds = uiState.totalSeconds
        )
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun TodayOverview(uiState: StatsUiState) {
    val focusRatio = if (uiState.todayTotalSeconds > 0) {
        uiState.todayFocusSeconds.toFloat() / uiState.todayTotalSeconds.toFloat()
    } else {
        0f
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Bottom
        ) {
            Column(modifier = Modifier.weight(1.15f)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        Modifier
                            .size(8.dp)
                            .background(MaterialTheme.colorScheme.primary, CircleShape)
                    )
                    Text(
                        text = "今日专注",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Text(
                    text = formatStudyDuration(uiState.todayFocusSeconds),
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold
                )
            }
            VerticalDivider(
                modifier = Modifier
                    .height(56.dp)
                    .padding(horizontal = 12.dp),
                color = MaterialTheme.colorScheme.outlineVariant
            )
            OverviewMetric(
                label = "投入总历时",
                value = formatStudyDuration(uiState.todayTotalSeconds),
                modifier = Modifier.weight(1f)
            )
            OverviewMetric(
                label = "专注占比",
                value = formatPercentage(focusRatio),
                modifier = Modifier.weight(0.82f)
            )
        }
        Text(
            text = "占比基于已记录的实际有效专注，不使用计划预计时长。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun OverviewMetric(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
private fun DistributionSection(
    selectedMode: DistributionMode,
    onModeSelected: (DistributionMode) -> Unit,
    entries: List<DistributionEntry>,
    totalSeconds: Long
) {
    val palette = distributionPalette()
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        ModeSelector(
            options = DistributionMode.entries,
            selected = selectedMode,
            label = { it.label },
            onSelected = onModeSelected
        )
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(22.dp),
            color = MaterialTheme.colorScheme.surfaceContainerLow
        ) {
            if (entries.isEmpty()) {
                Text(
                    text = "今天还没有可统计的专注记录。",
                    modifier = Modifier.padding(20.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 18.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    DonutChart(
                        entries = entries,
                        colors = palette,
                        totalSeconds = totalSeconds,
                        modeLabel = if (selectedMode == DistributionMode.Plan) "计划分配" else "学科分配",
                        modifier = Modifier.size(132.dp)
                    )
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(max = DistributionListMaxHeight)
                            .verticalScroll(rememberScrollState())
                            .semantics {
                                contentDescription = "${if (selectedMode == DistributionMode.Plan) "计划" else "学科"}分配列表，可上下滑动查看全部 ${entries.size} 项"
                            },
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        entries.forEachIndexed { index, entry ->
                            DistributionRow(
                                rank = index + 1,
                                entry = entry,
                                totalSeconds = totalSeconds,
                                color = palette[index % palette.size]
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DistributionRow(
    rank: Int,
    entry: DistributionEntry,
    totalSeconds: Long,
    color: Color
) {
    val fraction = if (totalSeconds > 0) entry.seconds.toFloat() / totalSeconds else 0f
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(22.dp)
                .background(color.copy(alpha = 0.2f), RoundedCornerShape(7.dp)),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = rank.toString(),
                style = MaterialTheme.typography.labelSmall,
                color = color,
                fontWeight = FontWeight.Bold
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = entry.label,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = formatStudyDuration(entry.seconds),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Text(
            text = formatPercentage(fraction),
            style = MaterialTheme.typography.labelMedium,
            color = color,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
private fun DonutChart(
    entries: List<DistributionEntry>,
    colors: List<Color>,
    totalSeconds: Long,
    modeLabel: String,
    modifier: Modifier = Modifier
) {
    val description = entries.joinToString { entry ->
        "${entry.label}${formatPercentage(if (totalSeconds > 0) entry.seconds.toFloat() / totalSeconds else 0f)}"
    }
    val emptyTrackColor = MaterialTheme.colorScheme.surfaceVariant
    Box(
        modifier = modifier.semantics {
            contentDescription = "$modeLabel，$description"
        },
        contentAlignment = Alignment.Center
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val strokeWidth = 24.dp.toPx()
            if (totalSeconds <= 0) {
                drawCircle(
                    color = emptyTrackColor,
                    style = Stroke(strokeWidth)
                )
            } else {
                var startAngle = -90f
                entries.forEachIndexed { index, entry ->
                    val sweep = entry.seconds.toFloat() / totalSeconds.toFloat() * 360f
                    drawArc(
                        color = colors[index % colors.size],
                        startAngle = startAngle,
                        sweepAngle = (sweep - 2f).coerceAtLeast(0.5f),
                        useCenter = false,
                        style = Stroke(strokeWidth, cap = StrokeCap.Butt)
                    )
                    startAngle += sweep
                }
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = modeLabel,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = entries.size.toString(),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = if (modeLabel.startsWith("计划")) "项计划" else "门学科",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun TrendSection(
    stats: List<DailyStudyStat>,
    selectedMode: TrendMode,
    onModeSelected: (TrendMode) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "近 7 天趋势",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            ModeSelector(
                options = TrendMode.entries,
                selected = selectedMode,
                label = { it.label },
                onSelected = onModeSelected,
                compact = true
            )
        }
        if (stats.none { selectedMode.seconds(it) > 0 }) {
            Text(
                text = "近 7 天还没有学习记录。",
                modifier = Modifier.padding(vertical = 28.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        } else {
            TrendLineChart(stats = stats, selectedMode = selectedMode)
        }
    }
}

@Composable
private fun TrendLineChart(
    stats: List<DailyStudyStat>,
    selectedMode: TrendMode
) {
    val lineColor = MaterialTheme.colorScheme.primary
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant
    val outlineColor = MaterialTheme.colorScheme.outlineVariant
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(164.dp)
            .semantics { contentDescription = "近七天${selectedMode.label}趋势" }
    ) {
        if (stats.isEmpty()) return@Canvas
        val values = stats.map { selectedMode.seconds(it) }
        val maxValue = values.maxOrNull()?.coerceAtLeast(1L) ?: 1L
        val left = 14.dp.toPx()
        val right = size.width - 14.dp.toPx()
        val chartTop = 24.dp.toPx()
        val chartBottom = 112.dp.toPx()
        val step = if (stats.size > 1) (right - left) / (stats.size - 1) else 0f
        val points = values.mapIndexed { index, value ->
            val fraction = value.toFloat() / maxValue.toFloat()
            Offset(
                x = left + step * index,
                y = chartBottom - fraction * (chartBottom - chartTop)
            )
        }
        drawLine(
            color = outlineColor,
            start = Offset(left, chartBottom),
            end = Offset(right, chartBottom),
            strokeWidth = 1.dp.toPx()
        )
        if (points.size > 1) {
            val path = Path().apply {
                moveTo(points.first().x, points.first().y)
                points.zipWithNext().forEach { (previous, current) ->
                    val middleX = (previous.x + current.x) / 2
                    cubicTo(
                        middleX,
                        previous.y,
                        middleX,
                        current.y,
                        current.x,
                        current.y
                    )
                }
            }
            drawPath(path, lineColor, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
        }
        points.forEach { point ->
            drawCircle(lineColor.copy(alpha = 0.22f), radius = 7.dp.toPx(), center = point)
            drawCircle(lineColor, radius = 4.dp.toPx(), center = point)
        }

        val valuePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = textColor.toArgb()
            textSize = 10.sp.toPx()
            textAlign = Paint.Align.CENTER
        }
        val dayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = textColor.toArgb()
            textSize = 11.sp.toPx()
            textAlign = Paint.Align.CENTER
        }
        stats.forEachIndexed { index, stat ->
            val point = points[index]
            drawContext.canvas.nativeCanvas.drawText(
                if (values[index] > 0) formatCompactDuration(values[index]) else "0m",
                point.x,
                (point.y - 10.dp.toPx()).coerceAtLeast(10.dp.toPx()),
                valuePaint
            )
            drawContext.canvas.nativeCanvas.drawText(
                stat.date.dayOfWeek.shortLabel(),
                point.x,
                142.dp.toPx(),
                dayPaint
            )
        }
    }
}

@Composable
private fun LongRangeMetrics(weekSeconds: Long, totalSeconds: Long) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        LongRangeMetric(
            label = "本周有效专注",
            value = formatStudyDuration(weekSeconds),
            modifier = Modifier.weight(1f)
        )
        VerticalDivider(
            modifier = Modifier.height(48.dp),
            color = MaterialTheme.colorScheme.outlineVariant
        )
        LongRangeMetric(
            label = "累计有效专注",
            value = formatStudyDuration(totalSeconds),
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun LongRangeMetric(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
private fun <T> ModeSelector(
    options: List<T>,
    selected: T,
    label: (T) -> String,
    onSelected: (T) -> Unit,
    compact: Boolean = false
) {
    Surface(
        shape = RoundedCornerShape(if (compact) 14.dp else 18.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)
    ) {
        Row(
            modifier = Modifier.padding(3.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            options.forEach { option ->
                val isSelected = option == selected
                Box(
                    modifier = Modifier
                        .then(if (!compact) Modifier.weight(1f) else Modifier)
                        .background(
                            color = if (isSelected) {
                                MaterialTheme.colorScheme.primaryContainer
                            } else {
                                Color.Transparent
                            },
                            shape = RoundedCornerShape(if (compact) 11.dp else 15.dp)
                        )
                        .clickable { onSelected(option) }
                        .padding(
                            horizontal = if (compact) 12.dp else 20.dp,
                            vertical = if (compact) 7.dp else 10.dp
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = label(option),
                        style = if (compact) {
                            MaterialTheme.typography.labelMedium
                        } else {
                            MaterialTheme.typography.labelLarge
                        },
                        color = if (isSelected) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium
                    )
                }
            }
        }
    }
}

@Composable
private fun distributionPalette(): List<Color> {
    return AlertTimeExtras.SubjectPalette + listOf(
        MaterialTheme.colorScheme.tertiary,
        Color(0xFF8C8A54)
    )
}

private fun TrendMode.seconds(stat: DailyStudyStat): Long = when (this) {
    TrendMode.Focus -> stat.durationSeconds
    TrendMode.Total -> stat.totalSeconds
}

private fun DayOfWeek.shortLabel(): String = when (this) {
    DayOfWeek.MONDAY -> "一"
    DayOfWeek.TUESDAY -> "二"
    DayOfWeek.WEDNESDAY -> "三"
    DayOfWeek.THURSDAY -> "四"
    DayOfWeek.FRIDAY -> "五"
    DayOfWeek.SATURDAY -> "六"
    DayOfWeek.SUNDAY -> "日"
}

private fun formatCompactDuration(totalSeconds: Long): String {
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    return when {
        hours > 0 && minutes > 0 -> "${hours}h${minutes}m"
        hours > 0 -> "${hours}h"
        minutes > 0 -> "${minutes}m"
        else -> "0m"
    }
}

private fun formatPercentage(fraction: Float): String {
    return String.format(Locale.US, "%.1f%%", fraction.coerceIn(0f, 1f) * 100f)
}

private fun buildStatsShareContent(
    uiState: StatsUiState,
    distributionMode: DistributionMode,
    entries: List<DistributionEntry>,
    trendMode: TrendMode
): StatsShareContent {
    return StatsShareContent(
        todayFocusSeconds = uiState.todayFocusSeconds,
        todayTotalSeconds = uiState.todayTotalSeconds,
        weekFocusSeconds = uiState.weekSeconds,
        cumulativeFocusSeconds = uiState.totalSeconds,
        distributionLabel = if (distributionMode == DistributionMode.Plan) {
            "今日计划分配"
        } else {
            "今日学科分配"
        },
        distributionItems = entries.map {
            StatsShareDistributionItem(label = it.label, seconds = it.seconds)
        },
        trendLabel = trendMode.label,
        trendItems = uiState.recentTrend.map {
            StatsShareTrendItem(
                dayLabel = it.date.dayOfWeek.shortLabel(),
                seconds = trendMode.seconds(it)
            )
        }
    )
}
