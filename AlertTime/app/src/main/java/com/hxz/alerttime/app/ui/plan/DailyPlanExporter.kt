package com.hxz.alerttime.app.ui.plan

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import androidx.core.content.FileProvider
import androidx.core.graphics.createBitmap
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.max

data class DailyPlanExportItem(
    val subjectName: String?,
    val title: String,
    val content: String?,
    val targetDurationLabel: String?,
    val isCompleted: Boolean
)

object DailyPlanExporter {
    private const val imageWidth = 1080
    private const val horizontalPadding = 72
    private const val maxExportItems = 50
    private const val maxTitleChars = 200
    private const val maxContentChars = 2_000
    private const val maxImageLines = 120
    private const val maxImageHeight = 8_192

    fun buildText(
        items: List<DailyPlanExportItem>,
        now: Long = System.currentTimeMillis()
    ): String {
        val date = SimpleDateFormat("yyyy年M月d日 EEEE", Locale.CHINA).format(Date(now))
        val body = if (items.isEmpty()) {
            "今天暂无计划"
        } else {
            items.take(maxExportItems).mapIndexed { index, item ->
                buildString {
                    append(index + 1)
                    append(". ")
                    append(if (item.isCompleted) "[已完成] " else "[待完成] ")
                    item.subjectName?.takeIf { it.isNotBlank() }?.let {
                        append(it)
                        append(" · ")
                    }
                    append(item.title.take(maxTitleChars))
                    item.targetDurationLabel?.let {
                        append("（预计")
                        append(it)
                        append("）")
                    }
                    item.content?.takeIf { it.isNotBlank() }?.let {
                        append("\n   ")
                        append(it.take(maxContentChars))
                    }
                }
            }.joinToString("\n\n") + if (items.size > maxExportItems) {
                "\n\n……另有 ${items.size - maxExportItems} 项未展开"
            } else {
                ""
            }
        }
        return "AlertTime · 今日计划\n$date\n\n$body"
    }

    fun shareText(context: Context, text: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        context.startActivity(Intent.createChooser(intent, "导出当天计划"))
    }

    suspend fun shareImage(
        context: Context,
        items: List<DailyPlanExportItem>,
        now: Long = System.currentTimeMillis()
    ) {
        val intent = withContext(Dispatchers.IO) {
            val bitmap = createImage(items, now)
            val exportDirectory = File(context.cacheDir, "exports").apply { mkdirs() }
            val file = File(exportDirectory, "daily-plan-${System.currentTimeMillis()}.png")
            try {
                FileOutputStream(file).use { output ->
                    check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                        "导出图片压缩失败"
                    }
                }
            } finally {
                bitmap.recycle()
            }
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file
            )
            Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
        context.startActivity(Intent.createChooser(intent, "导出当天计划"))
    }

    private fun createImage(items: List<DailyPlanExportItem>, now: Long): Bitmap {
        val titlePaint = paint(44f, Color.rgb(31, 41, 55), Typeface.create(Typeface.DEFAULT, Typeface.BOLD))
        val datePaint = paint(28f, Color.rgb(100, 116, 139), Typeface.create(Typeface.DEFAULT, Typeface.NORMAL))
        val itemPaint = paint(32f, Color.rgb(31, 41, 55), Typeface.create(Typeface.DEFAULT, Typeface.NORMAL))
        val detailPaint = paint(26f, Color.rgb(71, 85, 105), Typeface.create(Typeface.DEFAULT, Typeface.NORMAL))
        val cardLines = if (items.isEmpty()) {
            listOf(listOf("今天暂无计划"))
        } else {
            val result = mutableListOf<List<String>>()
            var lineCount = 0
            items.take(maxExportItems).forEachIndexed { index, item ->
                val prefix = "${index + 1}. ${if (item.isCompleted) "已完成" else "待完成"}  "
                val main = buildString {
                    item.subjectName?.takeIf { it.isNotBlank() }?.let {
                        append(it)
                        append(" · ")
                    }
                    append(item.title.take(maxTitleChars))
                    item.targetDurationLabel?.let {
                        append("（预计")
                        append(it)
                        append("）")
                    }
                }
                val lines = buildList {
                    addAll(wrapText(prefix + main, itemPaint, imageWidth - horizontalPadding * 2 - 48))
                    item.content?.takeIf { it.isNotBlank() }?.let { content ->
                        addAll(
                            wrapText(
                                content.take(maxContentChars),
                                detailPaint,
                                imageWidth - horizontalPadding * 2 - 48
                            )
                        )
                    }
                }
                val remainingLines = maxImageLines - lineCount
                if (remainingLines <= 0) return@forEachIndexed
                val visibleLines = lines.take(remainingLines)
                result += if (visibleLines.size < lines.size && visibleLines.isNotEmpty()) {
                    visibleLines.dropLast(1) + "${visibleLines.last()}……"
                } else {
                    visibleLines
                }
                lineCount += visibleLines.size
            }
            result
        }
        val cardHeight = cardLines.sumOf { lines -> 48 + lines.size * 46 + 24 }
        val imageHeight = max(460, 190 + cardHeight + 72).coerceAtMost(maxImageHeight)
        val bitmap = createBitmap(imageWidth, imageHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.rgb(248, 250, 252))

        canvas.drawText("AlertTime · 今日计划", horizontalPadding.toFloat(), 82f, titlePaint)
        val date = SimpleDateFormat("yyyy年M月d日 EEEE", Locale.CHINA).format(Date(now))
        canvas.drawText(date, horizontalPadding.toFloat(), 126f, datePaint)

        var top = 166f
        cardLines.forEachIndexed { index, lines ->
            val height = 48 + lines.size * 46 + 24
            val cardPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = if (items.getOrNull(index)?.isCompleted == true) {
                    Color.rgb(236, 253, 245)
                } else {
                    Color.WHITE
                }
            }
            canvas.drawRoundRect(
                horizontalPadding.toFloat(),
                top,
                (imageWidth - horizontalPadding).toFloat(),
                top + height,
                28f,
                28f,
                cardPaint
            )
            var lineY = top + 50f
            lines.forEachIndexed { lineIndex, line ->
                canvas.drawText(
                    line,
                    (horizontalPadding + 24).toFloat(),
                    lineY,
                    if (lineIndex == 0) itemPaint else detailPaint
                )
                lineY += 46f
            }
            top += height + 18f
        }
        return bitmap
    }

    private fun wrapText(text: String, paint: Paint, maxWidth: Int): List<String> {
        if (text.isBlank()) return emptyList()
        return text.split('\n').flatMap { paragraph ->
            if (paragraph.isBlank()) return@flatMap listOf("")
            buildList {
                var start = 0
                while (start < paragraph.length) {
                    val count = paint.breakText(paragraph, start, paragraph.length, true, maxWidth.toFloat(), null)
                    val end = (start + max(1, count)).coerceAtMost(paragraph.length)
                    add(paragraph.substring(start, end))
                    start = end
                }
            }
        }
    }

    private fun paint(size: Float, color: Int, typeface: Typeface): Paint {
        return Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = size
            this.color = color
            this.typeface = typeface
        }
    }
}
