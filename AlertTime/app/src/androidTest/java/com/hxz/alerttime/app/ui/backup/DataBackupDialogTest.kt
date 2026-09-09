package com.hxz.alerttime.app.ui.backup

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hxz.alerttime.app.data.backup.BackupDataSummary
import com.hxz.alerttime.app.data.backup.RecentBackupMeta
import com.hxz.alerttime.app.data.backup.RestorePreview
import com.hxz.alerttime.app.data.backup.RestoreSource
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DataBackupDialogTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun showDialog(state: BackupUiState, timerBusy: Boolean = false) {
        composeRule.setContent {
            MaterialTheme {
                DataBackupDialog(
                    state = state,
                    timerBusy = timerBusy,
                    onExportTo = {},
                    onInspectFile = {},
                    onCreateRecent = {},
                    onInspectRecent = {},
                    onConfirmRestore = {},
                    onDismissRestore = {},
                    onConsumeMessages = {},
                    onDismiss = {}
                )
            }
        }
    }

    private fun recentBackupMeta() = RecentBackupMeta(
        exportedAt = 1_785_600_000_000L,
        fileSizeBytes = 2_048,
        schemaVersion = 1,
        databaseVersion = 4,
        appVersion = "0.1.0",
        dataSummary = BackupDataSummary(
            users = 1,
            subjects = 5,
            tasks = 12,
            weeklyGoals = 2,
            studySessions = 30,
            studySessionEvents = 120,
            diaries = 8,
            appSettings = 3
        )
    )

    @Test
    fun allActionsDisabled_whileTimerBusy_withExplanation() {
        showDialog(
            state = BackupUiState(hasRecentBackupFile = true, recentBackup = recentBackupMeta()),
            timerBusy = true
        )
        composeRule.onNodeWithText("创建本地备份").assertIsNotEnabled()
        composeRule.onNodeWithText("合并最近本地备份").assertIsNotEnabled()
        composeRule.onNodeWithText("导出 JSON 备份").assertIsNotEnabled()
        composeRule.onNodeWithText("从 JSON 文件合并恢复").assertIsNotEnabled()
        composeRule.onNodeWithText("请先结束当前专注，再进行数据备份", substring = true).assertIsDisplayed()
    }

    @Test
    fun restoreRecent_disabled_whenNoRecentBackup_exists() {
        showDialog(state = BackupUiState())
        composeRule.onNodeWithText("合并最近本地备份").assertIsNotEnabled()
        composeRule.onNodeWithText("创建本地备份").assertIsEnabled()
    }

    @Test
    fun restoreRecent_disabled_whenRecentBackup_unreadable() {
        showDialog(
            state = BackupUiState(
                hasRecentBackupFile = true,
                recentBackup = null,
                recentBackupUnreadable = true
            )
        )
        composeRule.onNodeWithText("合并最近本地备份").assertIsNotEnabled()
    }

    @Test
    fun restoreRecent_enabled_whenRecentBackup_available() {
        showDialog(
            state = BackupUiState(hasRecentBackupFile = true, recentBackup = recentBackupMeta())
        )
        composeRule.onNodeWithText("合并最近本地备份").assertIsEnabled()
    }

    @Test
    fun recentBackupCard_showsTimeSizeAndSummary() {
        showDialog(
            state = BackupUiState(hasRecentBackupFile = true, recentBackup = recentBackupMeta())
        )
        composeRule.onNodeWithText("创建时间：${formatBackupTime(1_785_600_000_000L)}")
            .performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("大小：${formatBackupFileSize(2_048)}")
            .performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("内容：科目 5 · 计划 12 · 学习 30 次 · 日记 8 · 用户 1 · 周目标 2 · 设置 3 项")
            .performScrollTo().assertIsDisplayed()
    }

    @Test
    fun restoreRequires_secondConfirmation_withSummaryAndWarning() {
        val preview = RestorePreview(
            exportedAt = 1_785_600_000_000L,
            schemaVersion = 1,
            databaseVersion = 4,
            appVersion = "0.1.0",
            data = com.hxz.alerttime.app.data.backup.BackupDataDto(),
            source = RestoreSource.FILE
        )
        showDialog(state = BackupUiState(pendingRestore = preview))
        composeRule.onNodeWithText("确认合并恢复").assertIsDisplayed()
        composeRule.onNodeWithText("导出时间：${formatBackupTime(1_785_600_000_000L)}")
            .performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("将补入备份中缺失的数据", substring = true)
            .performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("确认合并").assertIsDisplayed()
        composeRule.onNodeWithText("取消").assertIsDisplayed()
    }

    @Test
    fun failureMessage_isVisible() {
        composeRule.mainClock.autoAdvance = false
        showDialog(state = BackupUiState(errorMessage = "备份文件格式不正确"))
        composeRule.onNodeWithText("备份文件格式不正确")
            .performScrollTo().assertIsDisplayed()
    }

    @Test
    fun successMessage_isVisible_afterRestore() {
        composeRule.mainClock.autoAdvance = false
        // After a successful restore the pending confirm dialog is gone and the
        // success message is shown; the in-memory state has been refreshed.
        showDialog(state = BackupUiState(successMessage = "数据已合并恢复"))
        composeRule.onNodeWithText("数据已合并恢复")
            .performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("确认合并恢复").assertDoesNotExist()
    }
}
