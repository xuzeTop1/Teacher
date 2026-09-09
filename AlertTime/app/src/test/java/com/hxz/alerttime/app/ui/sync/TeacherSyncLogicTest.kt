package com.hxz.alerttime.app.ui.sync

import com.hxz.alerttime.app.data.sync.SyncCoordinator
import org.junit.Assert.assertTrue
import org.junit.Test

class TeacherSyncLogicTest {

    @Test
    fun `sync success summary exposes generator verdict score questions and warnings`() {
        val outcome = SyncCoordinator.SyncOutcome(
            snapshotId = "snapshot-id",
            subjects = 2,
            weeklyGoals = 1,
            tasks = 3,
            studySessions = 4,
            proposalsReceived = 1,
            decisionsSent = 0,
            decisionsPending = 2,
            analysisGenerator = "deterministic_fallback",
            planVerdict = "needs_adjustment",
            planScore = 67.0,
            assessmentQuestionCount = 3,
            analysisWarnings = listOf("learning_time_is_not_mastery_evidence")
        )

        assertTrue(formatSyncSuccessMessage(outcome).contains("建议调整"))
        assertTrue(formatSyncSuccessMessage(outcome).contains("67 分"))
        assertTrue(formatSyncSuccessMessage(outcome).contains("3 道评估草稿题"))
        assertTrue(formatSyncSuccessMessage(outcome).contains("2 条建议处理结果未送达"))
        assertTrue(formatSyncSuccessMessage(outcome).contains("下次同步重试"))
    }

}
