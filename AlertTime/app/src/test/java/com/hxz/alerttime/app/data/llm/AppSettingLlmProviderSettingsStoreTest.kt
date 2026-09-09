package com.hxz.alerttime.app.data.llm

import com.hxz.alerttime.app.data.local.dao.AppSettingDao
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppSettingLlmProviderSettingsStoreTest {

    @Test
    fun `fresh install has no embedded provider model or usable key`() = runBlocking {
        val store = AppSettingLlmProviderSettingsStore(FakeAppSettingDao(emptyList()), FakeCipher())

        val summary = store.loadSummary()

        assertFalse(summary.enabled)
        assertEquals("", summary.baseUrl)
        assertEquals("", summary.model)
        assertFalse(summary.hasStoredApiKey)
        assertNull(store.load())
    }

    @Test
    fun `missing or undecryptable key never appears enabled`() = runBlocking {
        val dao = FakeAppSettingDao(validNonSecretSettings(enabled = true))
        val store = AppSettingLlmProviderSettingsStore(dao, FakeCipher())

        assertFalse(store.loadSummary().enabled)
        assertFalse(store.loadSummary().hasStoredApiKey)
        assertNull(store.load())

        dao.upsert(AppSettingEntity(AppSettingLlmProviderSettingsStore.KEY_API_KEY, "broken", 2))
        assertFalse(store.loadSummary().enabled)
        assertFalse(store.loadSummary().hasStoredApiKey)
        assertNull(store.load())
    }

    @Test
    fun `legacy model url is unavailable but keeps ciphertext and can be repaired`() = runBlocking {
        val cipher = FakeCipher()
        val dao = FakeAppSettingDao(
            validNonSecretSettings(enabled = true).map { setting ->
                if (setting.key == AppSettingLlmProviderSettingsStore.KEY_MODEL) {
                    setting.copy(value = "https://api.moonshot.cn/v1")
                } else {
                    setting
                }
            } + AppSettingEntity(
                AppSettingLlmProviderSettingsStore.KEY_API_KEY,
                "enc:old-secret",
                1
            )
        )
        val store = AppSettingLlmProviderSettingsStore(dao, cipher)

        val invalidSummary = store.loadSummary()
        assertFalse(invalidSummary.enabled)
        assertTrue(invalidSummary.hasStoredApiKey)
        assertNull(store.load())
        assertEquals(
            "enc:old-secret",
            dao.getSetting(AppSettingLlmProviderSettingsStore.KEY_API_KEY)?.value
        )

        val repaired = store.save(
            baseUrl = "https://api.moonshot.cn/v1",
            model = "moonshot-v1-8k",
            authMode = LlmProviderSettings.AUTH_MODE_BEARER,
            apiKey = "",
            nowMs = 2
        )
        assertTrue(repaired.enabled)
        assertTrue(repaired.hasStoredApiKey)
        assertEquals("old-secret", store.load()?.apiKey)
        assertEquals(
            "enc:old-secret",
            dao.getSetting(AppSettingLlmProviderSettingsStore.KEY_API_KEY)?.value
        )
    }

    @Test
    fun `blank key reuses existing ciphertext inside store and enables last`() = runBlocking {
        val dao = FakeAppSettingDao(
            validNonSecretSettings(enabled = false) +
                AppSettingEntity(AppSettingLlmProviderSettingsStore.KEY_API_KEY, "enc:old-secret", 1)
        )
        val store = AppSettingLlmProviderSettingsStore(dao, FakeCipher())

        val summary = store.save(
            baseUrl = "https://api.example.com/v1",
            model = "new-model",
            authMode = LlmProviderSettings.AUTH_MODE_BEARER,
            apiKey = "",
            nowMs = 2
        )

        assertEquals(
            listOf("upsertAll", "upsert:${AppSettingLlmProviderSettingsStore.KEY_ENABLED}"),
            dao.events
        )
        assertTrue(summary.enabled)
        assertTrue(summary.hasStoredApiKey)
        assertEquals("old-secret", store.load()?.apiKey)
        assertEquals("new-model", store.load()?.model)
    }

    @Test
    fun `batch write failure leaves disabled state and no false enabled summary`() = runBlocking {
        val dao = FakeAppSettingDao(validNonSecretSettings(enabled = false)).apply {
            failBatchWrite = true
        }
        val store = AppSettingLlmProviderSettingsStore(dao, FakeCipher())

        val result = runCatching {
            store.save(
                baseUrl = "https://api.example.com/v1",
                model = "model",
                authMode = LlmProviderSettings.AUTH_MODE_BEARER,
                apiKey = "new-secret",
                nowMs = 2
            )
        }

        assertTrue(result.isFailure)
        assertEquals("false", dao.getSetting(AppSettingLlmProviderSettingsStore.KEY_ENABLED)?.value)
        assertFalse(store.loadSummary().enabled)
        assertNull(store.load())
    }

    @Test
    fun `disable closes provider and deletes ciphertext through store`() = runBlocking {
        val dao = FakeAppSettingDao(
            validNonSecretSettings(enabled = true) +
                AppSettingEntity(AppSettingLlmProviderSettingsStore.KEY_API_KEY, "enc:secret", 1)
        )
        val store = AppSettingLlmProviderSettingsStore(dao, FakeCipher())

        val summary = store.disable(nowMs = 3)

        assertEquals(
            listOf(
                "upsert:${AppSettingLlmProviderSettingsStore.KEY_ENABLED}",
                "delete:${AppSettingLlmProviderSettingsStore.KEY_API_KEY}"
            ),
            dao.events
        )
        assertFalse(summary.enabled)
        assertFalse(summary.hasStoredApiKey)
        assertNull(dao.getSetting(AppSettingLlmProviderSettingsStore.KEY_API_KEY))
        assertNull(store.load())
    }

    @Test
    fun `none mode deletes old ciphertext atomically and never decrypts it`() = runBlocking {
        val cipher = FakeCipher()
        val dao = FakeAppSettingDao(
            validNonSecretSettings(enabled = true) +
                AppSettingEntity(AppSettingLlmProviderSettingsStore.KEY_API_KEY, "enc:old-secret", 1)
        )
        val store = AppSettingLlmProviderSettingsStore(dao, cipher)

        val summary = store.save(
            baseUrl = "http://192.168.1.20:8787/v1",
            model = "local-model",
            authMode = LlmProviderSettings.AUTH_MODE_NONE,
            apiKey = "",
            nowMs = 2
        )

        assertTrue(summary.enabled)
        assertFalse(summary.hasStoredApiKey)
        assertEquals(0, cipher.decryptCalls)
        assertNull(dao.getSetting(AppSettingLlmProviderSettingsStore.KEY_API_KEY))
        assertEquals(
            listOf(
                "upsertAll",
                "delete:${AppSettingLlmProviderSettingsStore.KEY_API_KEY}",
                "upsert:${AppSettingLlmProviderSettingsStore.KEY_ENABLED}"
            ),
            dao.events
        )
        assertEquals(LlmProviderSettings.AUTH_MODE_NONE, store.load()?.authMode)
        assertEquals("", store.load()?.apiKey)
    }

    @Test
    fun `switching from none to keyed mode requires a new key`() = runBlocking {
        val dao = FakeAppSettingDao(
            listOf(
                AppSettingEntity(AppSettingLlmProviderSettingsStore.KEY_ENABLED, "true", 1),
                AppSettingEntity(AppSettingLlmProviderSettingsStore.KEY_BASE_URL, "http://192.168.1.20:8787/v1", 1),
                AppSettingEntity(AppSettingLlmProviderSettingsStore.KEY_MODEL, "local-model", 1),
                AppSettingEntity(AppSettingLlmProviderSettingsStore.KEY_AUTH_MODE, LlmProviderSettings.AUTH_MODE_NONE, 1)
            )
        )
        val store = AppSettingLlmProviderSettingsStore(dao, FakeCipher())

        val missingKey = runCatching {
            store.save(
                baseUrl = "https://provider.example/v1",
                model = "cloud-model",
                authMode = LlmProviderSettings.AUTH_MODE_BEARER,
                apiKey = "",
                nowMs = 2
            )
        }
        assertTrue(missingKey.isFailure)

        val summary = store.save(
            baseUrl = "https://provider.example/v1",
            model = "cloud-model",
            authMode = LlmProviderSettings.AUTH_MODE_BEARER,
            apiKey = "new-secret",
            nowMs = 3
        )
        assertTrue(summary.enabled)
        assertTrue(summary.hasStoredApiKey)
        assertEquals("new-secret", store.load()?.apiKey)
    }

    private fun validNonSecretSettings(enabled: Boolean) = listOf(
        AppSettingEntity(AppSettingLlmProviderSettingsStore.KEY_ENABLED, enabled.toString(), 1),
        AppSettingEntity(AppSettingLlmProviderSettingsStore.KEY_BASE_URL, "https://api.example.com/v1", 1),
        AppSettingEntity(AppSettingLlmProviderSettingsStore.KEY_MODEL, "model", 1),
        AppSettingEntity(
            AppSettingLlmProviderSettingsStore.KEY_AUTH_MODE,
            LlmProviderSettings.AUTH_MODE_BEARER,
            1
        )
    )

    private class FakeCipher : LlmApiKeyCipher {
        var decryptCalls: Int = 0
        override fun encrypt(apiKey: String): String = "enc:$apiKey"

        override fun decrypt(encoded: String): String {
            decryptCalls += 1
            require(encoded.startsWith("enc:")) { "broken ciphertext" }
            return encoded.removePrefix("enc:").also { require(it.isNotBlank()) }
        }
    }

    private class FakeAppSettingDao(initial: List<AppSettingEntity>) : AppSettingDao {
        private val values = initial.associateByTo(linkedMapOf()) { it.key }
        val events = mutableListOf<String>()
        var failBatchWrite = false

        override fun observeSetting(key: String): Flow<AppSettingEntity?> = flowOf(values[key])
        override suspend fun getSetting(key: String): AppSettingEntity? = values[key]
        override suspend fun exportAll(): List<AppSettingEntity> = values.values.sortedBy { it.key }
        override suspend fun deleteAll() = values.clear()
        override suspend fun insertAll(settings: List<AppSettingEntity>) {
            settings.forEach { check(values.putIfAbsent(it.key, it) == null) }
        }
        override suspend fun insertAllIgnoring(settings: List<AppSettingEntity>) {
            settings.forEach { values.putIfAbsent(it.key, it) }
        }
        override suspend fun upsert(setting: AppSettingEntity) {
            events += "upsert:${setting.key}"
            values[setting.key] = setting
        }
        override suspend fun upsertAll(settings: List<AppSettingEntity>) {
            events += "upsertAll"
            if (failBatchWrite) error("simulated batch failure")
            settings.forEach { values[it.key] = it }
        }
        override suspend fun delete(key: String) {
            events += "delete:$key"
            values.remove(key)
        }
        override suspend fun deleteSyncRuntimeSettings() {
            values.keys.filter { it.startsWith("sync_") }.forEach(values::remove)
        }
    }
}
