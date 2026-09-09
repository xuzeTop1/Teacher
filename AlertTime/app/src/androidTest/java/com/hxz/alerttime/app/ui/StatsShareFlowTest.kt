package com.hxz.alerttime.app.ui

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
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

@RunWith(AndroidJUnit4::class)
class StatsShareFlowTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun statsPage_showsDirectImageShareActionWithoutFormatMenu() {
        composeRule.onNodeWithContentDescription("统计", useUnmergedTree = true).performClick()
        composeRule.onNodeWithContentDescription("分享统计图片", useUnmergedTree = true).assertExists()
        composeRule.onNodeWithText("分享当前统计为纯文本").assertDoesNotExist()

        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val screenshot = File(requireNotNull(context.externalCacheDir), "stats-page.png")
        FileOutputStream(screenshot).use { output ->
            composeRule.onRoot()
                .captureToImage()
                .asAndroidBitmap()
                .compress(Bitmap.CompressFormat.PNG, 100, output)
        }
    }
}
