package com.hxz.alerttime.app.ui

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import com.hxz.alerttime.app.MainActivity
import org.junit.Rule
import org.junit.Test

class HomeTimerFlowTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun startPauseResumeAndFinish_showsCompletionSummary() {
        composeRule.onNodeWithContentDescription("选择 Plan 开始").assertExists().performClick()
        composeRule.onNodeWithText("本次学习").assertExists()
        composeRule.onNodeWithText("开始").performClick()

        composeRule.waitUntil(timeoutMillis = 5_000) {
            composeRule.onAllNodesWithContentDescription("暂停").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithContentDescription("暂停").performClick()
        composeRule.onNodeWithContentDescription("继续").assertExists().performClick()
        composeRule.onNodeWithContentDescription("结束本次学习").performClick()

        composeRule.waitUntil(timeoutMillis = 5_000) {
            composeRule.onAllNodesWithText("最近一次学习").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("最近一次学习").assertExists()
    }

    @Test
    fun mainTabs_showRedesignedPrimaryActions() {
        composeRule.onNodeWithContentDescription("计划").performClick()
        composeRule.onNodeWithText("添加计划").assertExists()

        composeRule.onNodeWithContentDescription("统计").performClick()
        composeRule.onNodeWithText("今日专注").assertExists()

        composeRule.onNodeWithContentDescription("日记").performClick()
        composeRule.onNodeWithText("新建").assertExists()
    }
}
