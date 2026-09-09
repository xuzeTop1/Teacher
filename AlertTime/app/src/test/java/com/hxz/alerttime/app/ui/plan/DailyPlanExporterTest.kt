package com.hxz.alerttime.app.ui.plan

import java.time.ZoneOffset
import java.time.ZonedDateTime
import org.junit.Assert.assertTrue
import org.junit.Test

class DailyPlanExporterTest {
    @Test
    fun buildText_includesStatusSubjectDurationAndContent() {
        val text = DailyPlanExporter.buildText(
            items = listOf(
                DailyPlanExportItem(
                    subjectName = "数学",
                    title = "完成函数练习",
                    content = "完成第 1 到第 10 题",
                    targetDurationLabel = "1小时",
                    isCompleted = false
                ),
                DailyPlanExportItem(
                    subjectName = "英语",
                    title = "背诵单词",
                    content = null,
                    targetDurationLabel = null,
                    isCompleted = true
                )
            ),
            now = ZonedDateTime.of(2026, 7, 29, 10, 0, 0, 0, ZoneOffset.UTC)
                .toInstant()
                .toEpochMilli()
        )

        assertTrue(text.contains("AlertTime · 今日计划"))
        assertTrue(text.contains("[待完成] 数学 · 完成函数练习（预计1小时）"))
        assertTrue(text.contains("完成第 1 到第 10 题"))
        assertTrue(text.contains("[已完成] 英语 · 背诵单词"))
    }

    @Test
    fun buildText_handlesEmptyTodayPlan() {
        val text = DailyPlanExporter.buildText(emptyList())

        assertTrue(text.contains("今天暂无计划"))
    }
}
