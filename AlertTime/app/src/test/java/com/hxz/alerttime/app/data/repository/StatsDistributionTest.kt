package com.hxz.alerttime.app.data.repository

import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class StatsDistributionTest {
    @Test
    fun planDistribution_groupsSessionsByLinkedPlanAndSortsByFocusTime() {
        val sessions = listOf(
            session(id = 1, taskId = 10, title = "积分练习", start = 0, seconds = 40),
            session(id = 2, taskId = 10, title = "积分练习", start = 40_000, seconds = 30),
            session(id = 3, taskId = 20, title = "背单词", start = 70_000, seconds = 20)
        )

        val result = buildPlanDistribution(
            sessions = sessions,
            startInclusive = 0,
            endExclusive = 100_000
        )

        assertEquals(listOf("积分练习", "背单词"), result.map { it.planTitle })
        assertEquals(listOf(70L, 20L), result.map { it.durationSeconds })
    }

    @Test
    fun planDistribution_usesTheCurrentPlanTitleAfterAPlanIsEdited() {
        val result = buildPlanDistribution(
            sessions = listOf(
                session(id = 1, taskId = 10, title = "修改前标题", start = 0, seconds = 60)
            ),
            startInclusive = 0,
            endExclusive = 100_000,
            activePlanTitles = mapOf(10L to "修改后标题")
        )

        assertEquals(listOf("修改后标题"), result.map { it.planTitle })
    }

    @Test
    fun subjectDistribution_keepsUnclassifiedAndUsesSubjectNames() {
        val sessions = listOf(
            session(id = 1, subjectId = 8, title = "数学", start = 0, seconds = 60),
            session(id = 2, subjectId = null, title = "自由学习", start = 60_000, seconds = 15)
        )

        val result = buildSubjectDistribution(
            sessions = sessions,
            subjectNames = mapOf(8L to "高等数学"),
            startInclusive = 0,
            endExclusive = 100_000
        )

        assertEquals(listOf("高等数学", "未分类"), result.map { it.subjectName })
        assertEquals(listOf(60L, 15L), result.map { it.durationSeconds })
    }

    private fun session(
        id: Long,
        taskId: Long? = null,
        subjectId: Long? = null,
        title: String,
        start: Long,
        seconds: Long
    ): StudySessionEntity {
        return StudySessionEntity(
            id = id,
            userId = 1,
            subjectId = subjectId,
            taskId = taskId,
            title = title,
            startTime = start,
            endTime = start + seconds * 1000,
            durationSeconds = seconds,
            createdAt = start,
            updatedAt = start + seconds * 1000
        )
    }
}
