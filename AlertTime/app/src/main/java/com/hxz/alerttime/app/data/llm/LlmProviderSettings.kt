package com.hxz.alerttime.app.data.llm

import com.hxz.alerttime.app.data.local.dao.AppSettingDao
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity

data class LlmProviderSettings(
    val enabled: Boolean,
    val baseUrl: String,
    val model: String,
    val authMode: String,
    val apiKey: String
) {
    companion object {
        const val AUTH_MODE_BEARER = "bearer"
        const val AUTH_MODE_API_KEY = "api_key"
        const val AUTH_MODE_NONE = "none"
        fun isSupportedAuthMode(value: String): Boolean = value == AUTH_MODE_BEARER ||
            value == AUTH_MODE_API_KEY ||
            value == AUTH_MODE_NONE
    }
}

interface LlmProviderSettingsStore { suspend fun load(): LlmProviderSettings? }

/** UI 可见的非敏感摘要；不含密文，更不含解密后的 API Key。 */
data class LlmProviderSettingsSummary(
    val enabled: Boolean = false,
    val baseUrl: String = "",
    val model: String = "",
    val authMode: String = LlmProviderSettings.AUTH_MODE_BEARER,
    val hasStoredApiKey: Boolean = false
)

/** 非敏感项进入 AppSetting，密文 API key 由 Keystore 解密后只存在本次调用内存。 */
class AppSettingLlmProviderSettingsStore(
    private val appSettingDao: AppSettingDao,
    private val keyCipher: LlmApiKeyCipher
) : LlmProviderSettingsStore {
    override suspend fun load(): LlmProviderSettings? {
        val values = loadValues()
        if (values[KEY_ENABLED]?.value?.toBooleanStrictOrNull() != true) return null
        val baseUrl = values[KEY_BASE_URL]?.value?.trim().orEmpty()
        val model = values[KEY_MODEL]?.value?.trim().orEmpty()
        val authMode = values[KEY_AUTH_MODE]?.value?.trim().orEmpty()
        if (!isValidNonSecretConfig(baseUrl, model, authMode)) return null
        if (authMode == LlmProviderSettings.AUTH_MODE_NONE) {
            return LlmProviderSettings(true, baseUrl, model, authMode, "")
        }
        val apiKey = decryptUsableKey(values[KEY_API_KEY]?.value.orEmpty()) ?: return null
        return LlmProviderSettings(true, baseUrl, model, authMode, apiKey)
    }

    suspend fun loadSummary(): LlmProviderSettingsSummary {
        val values = runCatching { loadValues() }.getOrElse { return LlmProviderSettingsSummary() }
        val baseUrl = values[KEY_BASE_URL]?.value?.trim().orEmpty()
        val model = values[KEY_MODEL]?.value?.trim().orEmpty()
        val storedAuthMode = values[KEY_AUTH_MODE]?.value?.trim().orEmpty()
        val authMode = storedAuthMode.takeIf(LlmProviderSettings::isSupportedAuthMode)
            ?: LlmProviderSettings.AUTH_MODE_BEARER
        val hasUsableKey = storedAuthMode != LlmProviderSettings.AUTH_MODE_NONE &&
            decryptUsableKey(values[KEY_API_KEY]?.value.orEmpty()) != null
        val complete = isValidNonSecretConfig(baseUrl, model, storedAuthMode) &&
            (storedAuthMode == LlmProviderSettings.AUTH_MODE_NONE || hasUsableKey)
        return LlmProviderSettingsSummary(
            enabled = values[KEY_ENABLED]?.value?.toBooleanStrictOrNull() == true && complete,
            baseUrl = baseUrl,
            model = model,
            authMode = authMode,
            hasStoredApiKey = hasUsableKey
        )
    }

    /**
     * 保存并启用。apiKey 为空时只在 Store 内验证并沿用既有密文，明文不会返回 ViewModel。
     * Room 事务先写完整配置与密文，最后才写 enabled=true。
     */
    suspend fun save(
        baseUrl: String,
        model: String,
        authMode: String,
        apiKey: String,
        nowMs: Long = System.currentTimeMillis()
    ): LlmProviderSettingsSummary {
        val normalizedBaseUrl = baseUrl.trim().also { EndpointPolicy.chatCompletionsUrl(it, authMode) }
        val normalizedModel = model.trim()
        require(isValidNonSecretConfig(normalizedBaseUrl, normalizedModel, authMode)) {
            "Provider 配置不完整或不受支持"
        }
        val enteredKey = apiKey.trim()
        if (authMode == LlmProviderSettings.AUTH_MODE_NONE) {
            require(enteredKey.isEmpty()) { "无认证模式不能填写 API Key" }
            appSettingDao.saveSettingsThenEnableAndDeleteSecret(
                settings = providerSettings(normalizedBaseUrl, normalizedModel, authMode, nowMs),
                enabledSetting = AppSettingEntity(KEY_ENABLED, "true", nowMs),
                secretKey = KEY_API_KEY
            )
            return loadSummary()
        }
        val encrypted = if (enteredKey.isNotEmpty()) {
            keyCipher.encrypt(enteredKey)
        } else {
            val existing = loadValues()[KEY_API_KEY]?.value.orEmpty()
            require(decryptUsableKey(existing) != null) { "已保存的 API Key 不可用，请重新填写" }
            existing
        }
        appSettingDao.saveSettingsThenEnable(
            settings = listOf(
                AppSettingEntity(KEY_BASE_URL, normalizedBaseUrl, nowMs),
                AppSettingEntity(KEY_MODEL, normalizedModel, nowMs),
                AppSettingEntity(KEY_AUTH_MODE, authMode, nowMs),
                AppSettingEntity(KEY_API_KEY, encrypted, nowMs)
            ),
            enabledSetting = AppSettingEntity(KEY_ENABLED, "true", nowMs)
        )
        return loadSummary()
    }

    private fun providerSettings(baseUrl: String, model: String, authMode: String, nowMs: Long) = listOf(
        AppSettingEntity(KEY_BASE_URL, baseUrl, nowMs),
        AppSettingEntity(KEY_MODEL, model, nowMs),
        AppSettingEntity(KEY_AUTH_MODE, authMode, nowMs)
    )

    suspend fun disable(nowMs: Long = System.currentTimeMillis()): LlmProviderSettingsSummary {
        appSettingDao.disableSettingAndDeleteSecret(
            disabledSetting = AppSettingEntity(KEY_ENABLED, "false", nowMs),
            secretKey = KEY_API_KEY
        )
        return loadSummary()
    }

    private suspend fun loadValues(): Map<String, AppSettingEntity> =
        appSettingDao.exportAll().associateBy { it.key }

    private fun decryptUsableKey(encrypted: String): String? {
        if (encrypted.isBlank()) return null
        return runCatching { keyCipher.decrypt(encrypted) }
            .getOrNull()
            ?.takeIf { it.isNotBlank() }
    }

    private fun isValidNonSecretConfig(baseUrl: String, model: String, authMode: String): Boolean {
        if (baseUrl.isBlank() || !isValidModelId(model) || !LlmProviderSettings.isSupportedAuthMode(authMode)) {
            return false
        }
        return runCatching { EndpointPolicy.chatCompletionsUrl(baseUrl, authMode) }.isSuccess
    }

    private fun isValidModelId(model: String): Boolean {
        val normalized = model.trim()
        return normalized.isNotEmpty() &&
            !normalized.startsWith("http://", ignoreCase = true) &&
            !normalized.startsWith("https://", ignoreCase = true)
    }

    companion object {
        const val KEY_ENABLED = "learning_analysis_llm_enabled_v1"
        const val KEY_BASE_URL = "learning_analysis_llm_base_url_v1"
        const val KEY_MODEL = "learning_analysis_llm_model_v1"
        const val KEY_AUTH_MODE = "learning_analysis_llm_auth_mode_v1"
        const val KEY_API_KEY = "learning_analysis_llm_api_key_ciphertext_v1"
    }
}
