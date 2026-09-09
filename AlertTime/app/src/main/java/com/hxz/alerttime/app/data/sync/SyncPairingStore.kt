package com.hxz.alerttime.app.data.sync

import com.hxz.alerttime.app.data.local.dao.AppSettingDao
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * 配对状态存储（AppSetting，非敏感信息）。
 *
 * - 服务地址、证书 pin、deviceId：非敏感，明文 JSON。
 * - 设备凭据：Android Keystore 加密后的密文（密钥不出 Keystore）。
 * - 配对一次性 token：绝不写入任何持久化存储，只在内存中使用。
 */
data class SyncServerInfo(
    val host: String,
    val port: Int,
    val pin: String,
    val deviceId: String,
    val pairedAtMs: Long
)

/**
 * 手机端稳定身份：安装一次即生成并持久化，跨重新配对保持不变。
 * 用于让学科映射等「用户配置」在换一次配对（新 deviceId）后仍能保留。
 */
data class SyncOwnerIdentity(
    val ownerId: String
)

class SyncPairingStore(
    private val appSettingDao: AppSettingDao,
    private val keystore: SyncKeystore = SyncKeystore()
) {

    @Serializable
    private data class ServerInfoDto(
        val host: String,
        val port: Int,
        val pin: String,
        val deviceId: String,
        val pairedAtMs: Long
    )

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    suspend fun loadServerInfo(): SyncServerInfo? {
        val entity = appSettingDao.getSetting(KEY_SERVER_INFO) ?: return null
        return runCatching {
            val dto = json.decodeFromString(ServerInfoDto.serializer(), entity.value)
            SyncServerInfo(dto.host, dto.port, dto.pin, dto.deviceId, dto.pairedAtMs)
        }.getOrNull()
    }

    suspend fun saveServerInfo(info: SyncServerInfo) {
        val dto = ServerInfoDto(info.host, info.port, info.pin, info.deviceId, info.pairedAtMs)
        appSettingDao.upsert(
            AppSettingEntity(
                key = KEY_SERVER_INFO,
                value = json.encodeToString(ServerInfoDto.serializer(), dto),
                updatedAt = System.currentTimeMillis()
            )
        )
    }

    suspend fun saveCredential(credential: String) {
        val ciphertext = keystore.encrypt(credential)
        appSettingDao.upsert(
            AppSettingEntity(
                key = KEY_CREDENTIAL,
                value = ciphertext,
                updatedAt = System.currentTimeMillis()
            )
        )
    }

    suspend fun loadCredential(): String? {
        val entity = appSettingDao.getSetting(KEY_CREDENTIAL) ?: return null
        return runCatching { keystore.decrypt(entity.value) }.getOrNull()
    }

    suspend fun lastSyncAt(): Long? {
        val entity = appSettingDao.getSetting(KEY_LAST_SYNC_AT) ?: return null
        return entity.value.toLongOrNull()
    }

    suspend fun markSyncedAt(nowMs: Long) {
        appSettingDao.upsert(
            AppSettingEntity(key = KEY_LAST_SYNC_AT, value = nowMs.toString(), updatedAt = nowMs)
        )
    }

    /**
     * 返回（必要时生成并持久化）本机的稳定身份标识。
     * 该标识独立于配对：解除/重新配对不会改变它，用于跨配对保留业务配置。
     */
    suspend fun loadOrCreateOwnerIdentity(): SyncOwnerIdentity {
        val entity = appSettingDao.getSetting(KEY_OWNER_IDENTITY)
        val existing = entity?.value?.takeIf { it.isNotBlank() }
        if (existing != null) return SyncOwnerIdentity(existing)
        val fresh = java.util.UUID.randomUUID().toString()
        appSettingDao.upsert(
            AppSettingEntity(
                key = KEY_OWNER_IDENTITY,
                value = fresh,
                updatedAt = System.currentTimeMillis()
            )
        )
        return SyncOwnerIdentity(fresh)
    }

    /** 解除配对：清除全部同步状态（不删除任何业务数据、不删除稳定身份）。 */
    suspend fun clearAll() {
        // One DAO statement prevents a crash between per-key deletes from
        // leaving a half-cleared pairing/runtime state behind.
        appSettingDao.deleteSyncRuntimeSettings()
    }

    suspend fun hasPairing(): Boolean {
        return loadServerInfo() != null && loadCredential() != null
    }

    companion object {
        const val KEY_SERVER_INFO = "sync_server_info_v1"
        const val KEY_CREDENTIAL = "sync_credential_v1"
        const val KEY_LAST_SYNC_AT = "sync_last_sync_at_v1"
        const val KEY_OWNER_IDENTITY = "sync_owner_identity_v1"
    }
}
