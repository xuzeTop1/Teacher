package com.hxz.alerttime.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface AppSettingDao {
    @Query("SELECT * FROM app_settings WHERE key = :key")
    fun observeSetting(key: String): Flow<AppSettingEntity?>

    @Query("SELECT * FROM app_settings WHERE key = :key LIMIT 1")
    suspend fun getSetting(key: String): AppSettingEntity?

    /** Full snapshot for backup export. */
    @Query("SELECT * FROM app_settings ORDER BY key")
    suspend fun exportAll(): List<AppSettingEntity>

    @Query("DELETE FROM app_settings")
    suspend fun deleteAll()

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertAll(settings: List<AppSettingEntity>)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAllIgnoring(settings: List<AppSettingEntity>)

    @Upsert
    suspend fun upsert(setting: AppSettingEntity)

    @Upsert
    suspend fun upsertAll(settings: List<AppSettingEntity>)

    @Query("DELETE FROM app_settings WHERE key = :key")
    suspend fun delete(key: String)

    /** Provider 非敏感字段和密文先落库，enabled=true 最后生效；任一步失败整体回滚。 */
    @Transaction
    suspend fun saveSettingsThenEnable(
        settings: List<AppSettingEntity>,
        enabledSetting: AppSettingEntity
    ) {
        upsertAll(settings)
        upsert(enabledSetting)
    }

    /** 无认证 Provider 切换时，先写配置、删除旧密文，最后才启用。 */
    @Transaction
    suspend fun saveSettingsThenEnableAndDeleteSecret(
        settings: List<AppSettingEntity>,
        enabledSetting: AppSettingEntity,
        secretKey: String
    ) {
        upsertAll(settings)
        delete(secretKey)
        upsert(enabledSetting)
    }

    /** 停用与删除设备绑定密文不可分割，避免留下 UI 看似启用的半状态。 */
    @Transaction
    suspend fun disableSettingAndDeleteSecret(
        disabledSetting: AppSettingEntity,
        secretKey: String
    ) {
        upsert(disabledSetting)
        delete(secretKey)
    }

    /**
     * Atomically clears all sync runtime state without touching regular settings.
     * The stable owner identity is intentionally preserved so that user-config
     * (e.g. subject mappings) survives re-pairing.
     */
    @Query("DELETE FROM app_settings WHERE substr(key, 1, 5) = 'sync_' AND key <> 'sync_owner_identity_v1'")
    suspend fun deleteSyncRuntimeSettings()
}
