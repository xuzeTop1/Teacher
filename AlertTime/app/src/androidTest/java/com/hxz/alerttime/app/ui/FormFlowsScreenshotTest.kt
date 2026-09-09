package com.hxz.alerttime.app.ui

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hxz.alerttime.app.MainActivity
import java.io.File
import java.io.FileOutputStream
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FormFlowsScreenshotTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun primaryFormFlows_areReachableAndResponsive() {
        composeRule.onNodeWithContentDescription("计划").performClick()

        composeRule.onNodeWithText("添加计划").performClick()
        composeRule.onNodeWithText("基本信息").assertExists()
        composeRule.onNodeWithText("执行日期").assertExists()
        capture("form-add-plan.png")
        composeRule.onNodeWithContentDescription("关闭").performClick()

        composeRule.onNodeWithContentDescription("展开周目标").performClick()
        composeRule.onNodeWithText("添加周目标").performClick()
        composeRule.onNodeWithText("本周").assertExists()
        composeRule.onNodeWithText("下周").assertExists()
        capture("form-weekly-goal.png")
        composeRule.onNodeWithText("取消").performClick()

        composeRule.onNodeWithText("休息日").performClick()
        composeRule.onNodeWithText("每周休息日").assertExists()
        capture("form-rest-days.png")
        composeRule.onNodeWithText("取消").performClick()

        composeRule.onNodeWithText("科目").performClick()
        composeRule.onNodeWithText("已有科目", substring = true).assertExists()
        capture("form-subjects.png")
        composeRule.onNodeWithContentDescription("关闭").performClick()

        composeRule.onNodeWithContentDescription("日记").performClick()
        composeRule.onNodeWithText("新建").performClick()
        composeRule.onNodeWithText("复盘正文").assertExists()
        capture("form-diary.png")
    }

    private fun capture(fileName: String) {
        composeRule.waitForIdle()
        val context = ApplicationProvider.getApplicationContext<Context>()
        val screenshot = File(requireNotNull(context.externalCacheDir), fileName)
        FileOutputStream(screenshot).use { output ->
            composeRule.onRoot()
                .captureToImage()
                .asAndroidBitmap()
                .compress(Bitmap.CompressFormat.PNG, 100, output)
        }
    }
}
