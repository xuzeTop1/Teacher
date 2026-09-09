package com.hxz.alerttime.app.data.backup

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 备份导出白名单：设备绑定/同步运行时状态（sync_*）和设备级 Provider 配置
 *（learning_analysis_llm_*）不得进入明文 JSON 备份，
 * 普通 AppSetting 仍正常备份。
 */
class BackupEligibilityTest {

    @Test
    fun `sync runtime keys are excluded from backup`() {
        assertFalse(BackupRepository.isBackupEligibleAppSetting("sync_server_info_v1"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("sync_credential_v1"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("sync_last_sync_at_v1"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("sync_proposals_v1"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("sync_pending_decisions_v1"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("sync_processed_proposal_ids_v1"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("sync_proposal_sources_v1"))
    }

    @Test
    fun `regular app settings remain backup eligible`() {
        assertTrue(BackupRepository.isBackupEligibleAppSetting("default_daily_goal_seconds"))
        assertTrue(BackupRepository.isBackupEligibleAppSetting("theme_mode"))
        assertTrue(BackupRepository.isBackupEligibleAppSetting("reminder_enabled"))
        assertTrue(BackupRepository.isBackupEligibleAppSetting("timer_keep_screen_on"))
    }

    @Test
    fun `learning analysis provider settings are excluded from backup`() {
        assertFalse(BackupRepository.isBackupEligibleAppSetting("learning_analysis_llm_enabled_v1"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("learning_analysis_llm_base_url_v1"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("learning_analysis_llm_model_v1"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("learning_analysis_llm_auth_mode_v1"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("learning_analysis_llm_api_key_ciphertext_v1"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("learning_analysis_runtime_latest_v1"))
    }

    @Test
    fun `prefix matching is exact - sync suffix does not matter`() {
        // 只有受保护前缀被排除；普通 key 带 sync 字样不受影响。
        assertTrue(BackupRepository.isBackupEligibleAppSetting("my_sync_note"))
        assertFalse(BackupRepository.isBackupEligibleAppSetting("sync_anything"))
        assertTrue(BackupRepository.isBackupEligibleAppSetting("my_learning_analysis_llm_note"))
    }
}
