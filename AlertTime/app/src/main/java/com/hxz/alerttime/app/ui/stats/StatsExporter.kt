package com.hxz.alerttime.app.ui.stats

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import androidx.core.content.FileProvider
import androidx.core.graphics.createBitmap
import com.hxz.alerttime.app.core.time.formatCompactStudyDuration
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max

data class StatsShareDistributionItem(
    val label: String,
    val seconds: Long
)

data class StatsShareTrendItem(
    val dayLabel: String,
    val seconds: Long
)

data class StatsShareContent(
    val todayFocusSeconds: Long,
    val todayTotalSeconds: Long,
    val weekFocusSeconds: Long,
    val cumulativeFocusSeconds: Long,
    val distributionLabel: String,
    val distributionItems: List<StatsShareDistributionItem>,
    val trendLabel: String,
    val trendItems: List<StatsShareTrendItem>
)

object StatsExporter {
    private const val imageWidth = 1080
    private const val horizontalPadding = 72
    private val palette = intArrayOf(
        0xFF3E7E62.toInt(),
        0xFF537794.toInt(),
        0xFFB07B4B.toInt(),
        0xFF7E679F.toInt(),
        0xFF978B4E.toInt(),
        0xFF5B8B88.toInt(),
        0xFF995D69.toInt()
    )

    fun shareImage(context: Context, content: StatsShareContent) {
        val bitmap = createImage(content)
        val exportDirectory = File(context.cacheDir, "exports").apply { mkdirs() }
        val file = File(exportDirectory, "study-stats-${System.currentTimeMillis()}.png")
        FileOutputStream(file).use { output ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
        }
        bitmap.recycle()

        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file
        )
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "分享学习统计"))
    }

    private fun createImage(content: StatsShareContent): Bitmap {
        val visibleDistribution = content.distributionItems.take(7)
        val distributionHeight = if (visibleDistribution.isEmpty()) 120 else visibleDistribution.size * 82 + 38
        val trendHeight = 330
        val imageHeight = 520 + distributionHeight + trendHeight
        val bitmap = createBitmap(imageWidth, imageHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.rgb(244, 247, 245))

        val titlePaint = paint(48f, Color.rgb(27, 39, 34), bold = true)
        val subtitlePaint = paint(27f, Color.rgb(96, 112, 104))
        val sectionPaint = paint(32f, Color.rgb(27, 39, 34), bold = true)
        val metricLabelPaint = paint(24f, Color.rgb(96, 112, 104))
        val metricValuePaint = paint(35f, Color.rgb(27, 39, 34), bold = true)
        val itemPaint = paint(27f, Color.rgb(39, 52, 46))
        val detailPaint = paint(24f, Color.rgb(96, 112, 104))
        val percentPaint = paint(25f, Color.rgb(50, 111, 83), bold = true).apply {
            textAlign = Paint.Align.RIGHT
        }

        canvas.drawText("AlertTime · 学习统计", horizontalPadding.toFloat(), 82f, titlePaint)
        val date = SimpleDateFormat("yyyy年M月d日 EEEE", Locale.CHINA)
            .format(Date(System.currentTimeMillis()))
        canvas.drawText(date, horizontalPadding.toFloat(), 126f, subtitlePaint)

        val cardLeft = horizontalPadding.toFloat()
        val cardRight = (imageWidth - horizontalPadding).toFloat()
        drawRoundCard(canvas, cardLeft, 166f, cardRight, 370f)
        val ratio = percentage(content.todayFocusSeconds, content.todayTotalSeconds)
        drawMetric(
            canvas,
            x = cardLeft + 34f,
            y = 218f,
            label = "今日有效专注",
            value = formatCompactStudyDuration(content.todayFocusSeconds),
            labelPaint = metricLabelPaint,
            valuePaint = metricValuePaint
        )
        drawMetric(
            canvas,
            x = cardLeft + 500f,
            y = 218f,
            label = "专注占比",
            value = formatPercentage(ratio),
            labelPaint = metricLabelPaint,
            valuePaint = metricValuePaint
        )
        drawMetric(
            canvas,
            x = cardLeft + 34f,
            y = 304f,
            label = "本周有效专注",
            value = formatCompactStudyDuration(content.weekFocusSeconds),
            labelPaint = metricLabelPaint,
            valuePaint = metricValuePaint
        )
        drawMetric(
            canvas,
            x = cardLeft + 500f,
            y = 304f,
            label = "累计有效专注",
            value = formatCompactStudyDuration(content.cumulativeFocusSeconds),
            labelPaint = metricLabelPaint,
            valuePaint = metricValuePaint
        )

        var top = 430f
        canvas.drawText(content.distributionLabel, cardLeft, top, sectionPaint)
        top += 42f
        if (visibleDistribution.isEmpty()) {
            canvas.drawText("今天还没有可统计的专注记录", cardLeft, top + 34f, detailPaint)
            top += 100f
        } else {
            val total = content.distributionItems.sumOf { it.seconds }
            visibleDistribution.forEachIndexed { index, item ->
                val color = palette[index % palette.size]
                val itemRatio = percentage(item.seconds, total)
                val lineY = top + 30f
                canvas.drawCircle(cardLeft + 10f, lineY - 9f, 9f, paint(1f, color))
                canvas.drawText(
                    ellipsize(
                        text = item.label,
                        paint = itemPaint,
                        maxWidth = cardRight - cardLeft - 360f
                    ),
                    cardLeft + 34f,
                    lineY,
                    itemPaint
                )
                canvas.drawText(
                    "${formatCompactStudyDuration(item.seconds)}  ${formatPercentage(itemRatio)}",
                    cardRight,
                    lineY,
                    percentPaint
                )
                val barTop = lineY + 17f
                val barRight = cardLeft + (cardRight - cardLeft) * itemRatio
                canvas.drawRoundRect(
                    cardLeft,
                    barTop,
                    cardRight,
                    barTop + 10f,
                    5f,
                    5f,
                    paint(1f, Color.rgb(219, 226, 222))
                )
                canvas.drawRoundRect(
                    cardLeft,
                    barTop,
                    max(cardLeft + 4f, barRight),
                    barTop + 10f,
                    5f,
                    5f,
                    paint(1f, color)
                )
                top += 82f
            }
        }

        top += 22f
        canvas.drawText("近7天${content.trendLabel}", cardLeft, top, sectionPaint)
        drawTrend(
            canvas = canvas,
            items = content.trendItems,
            left = cardLeft + 12f,
            top = top + 38f,
            right = cardRight - 12f,
            bottom = top + 238f,
            detailPaint = detailPaint
        )
        canvas.drawText(
            "数据来自 AlertTime 已记录的实际学习时长",
            cardLeft,
            imageHeight - 48f,
            subtitlePaint
        )
        return bitmap
    }

    private fun drawTrend(
        canvas: Canvas,
        items: List<StatsShareTrendItem>,
        left: Float,
        top: Float,
        right: Float,
        bottom: Float,
        detailPaint: Paint
    ) {
        if (items.isEmpty()) {
            canvas.drawText("近7天还没有学习记录", left, top + 48f, detailPaint)
            return
        }
        val maxSeconds = items.maxOfOrNull { it.seconds }?.coerceAtLeast(1L) ?: 1L
        val step = if (items.size > 1) (right - left) / (items.size - 1) else 0f
        val points = items.mapIndexed { index, item ->
            val fraction = item.seconds.toFloat() / maxSeconds.toFloat()
            Pair(left + step * index, bottom - fraction * (bottom - top))
        }
        canvas.drawLine(left, bottom, right, bottom, paint(1f, Color.rgb(204, 214, 208)))
        if (points.size > 1) {
            val path = Path().apply {
                moveTo(points.first().first, points.first().second)
                points.zipWithNext().forEach { (previous, current) ->
                    val middleX = (previous.first + current.first) / 2f
                    cubicTo(
                        middleX,
                        previous.second,
                        middleX,
                        current.second,
                        current.first,
                        current.second
                    )
                }
            }
            canvas.drawPath(
                path,
                paint(1f, Color.rgb(50, 111, 83)).apply {
                    style = Paint.Style.STROKE
                    strokeWidth = 6f
                    strokeCap = Paint.Cap.ROUND
                }
            )
        }
        val centeredDetailPaint = Paint(detailPaint).apply { textAlign = Paint.Align.CENTER }
        points.forEachIndexed { index, point ->
            canvas.drawCircle(point.first, point.second, 9f, paint(1f, Color.rgb(50, 111, 83)))
            canvas.drawText(
                formatCompactStudyDuration(items[index].seconds),
                point.first,
                max(top - 5f, point.second - 20f),
                centeredDetailPaint
            )
            canvas.drawText(items[index].dayLabel, point.first, bottom + 42f, centeredDetailPaint)
        }
    }

    private fun drawMetric(
        canvas: Canvas,
        x: Float,
        y: Float,
        label: String,
        value: String,
        labelPaint: Paint,
        valuePaint: Paint
    ) {
        canvas.drawText(label, x, y, labelPaint)
        canvas.drawText(value, x, y + 42f, valuePaint)
    }

    private fun drawRoundCard(
        canvas: Canvas,
        left: Float,
        top: Float,
        right: Float,
        bottom: Float
    ) {
        canvas.drawRoundRect(
            left,
            top,
            right,
            bottom,
            34f,
            34f,
            paint(1f, Color.WHITE)
        )
    }

    private fun percentage(value: Long, total: Long): Float {
        return if (total > 0) value.toFloat() / total.toFloat() else 0f
    }

    private fun formatPercentage(fraction: Float): String {
        return String.format(Locale.US, "%.1f%%", fraction.coerceIn(0f, 1f) * 100f)
    }

    private fun ellipsize(text: String, paint: Paint, maxWidth: Float): String {
        if (paint.measureText(text) <= maxWidth) return text
        val suffix = "…"
        val count = paint.breakText(
            text,
            0,
            text.length,
            true,
            (maxWidth - paint.measureText(suffix)).coerceAtLeast(1f),
            null
        )
        return text.take(max(1, count)) + suffix
    }

    private fun paint(size: Float, color: Int, bold: Boolean = false): Paint {
        return Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = size
            this.color = color
            typeface = Typeface.create(
                Typeface.DEFAULT,
                if (bold) Typeface.BOLD else Typeface.NORMAL
            )
        }
    }
}
