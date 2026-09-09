package com.hxz.alerttime.app.data.llm

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore

@RunWith(AndroidJUnit4::class)
class LlmProviderSettingsStoreInstrumentedTest {
    private lateinit var context: Context
    private var database: AlertTimeDatabase? = null

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteDatabase(DATABASE_NAME)
        deleteTestKey()
    }

    @After
    fun tearDown() {
        database?.close()
        database = null
        context.deleteDatabase(DATABASE_NAME)
        deleteTestKey()
    }

    @Test
    fun userProviderSettingsSurviveRoomReopenWithEncryptedApiKey() = runBlocking {
        database = openDatabase()
        val firstStore = AppSettingLlmProviderSettingsStore(
            requireNotNull(database).appSettingDao(),
            AssessmentLlmKeyStore(TEST_KEY_ALIAS)
        )
        firstStore.save(
            baseUrl = BASE_URL,
            model = MODEL,
            authMode = LlmProviderSettings.AUTH_MODE_API_KEY,
            apiKey = API_KEY,
            nowMs = 123L
        )

        val ciphertext = requireNotNull(
            requireNotNull(database).appSettingDao()
                .getSetting(AppSettingLlmProviderSettingsStore.KEY_API_KEY)
        ).value
        assertNotEquals(API_KEY, ciphertext)
        assertFalse(ciphertext.contains(API_KEY))
        requireNotNull(database).close()

        database = openDatabase()
        val reopenedStore = AppSettingLlmProviderSettingsStore(
            requireNotNull(database).appSettingDao(),
            AssessmentLlmKeyStore(TEST_KEY_ALIAS)
        )
        val restored = reopenedStore.load()

        assertNotNull(restored)
        assertEquals(BASE_URL, restored?.baseUrl)
        assertEquals(MODEL, restored?.model)
        assertEquals(LlmProviderSettings.AUTH_MODE_API_KEY, restored?.authMode)
        assertEquals(API_KEY, restored?.apiKey)
    }

    private fun openDatabase(): AlertTimeDatabase = Room.databaseBuilder(
        context,
        AlertTimeDatabase::class.java,
        DATABASE_NAME
    ).build()

    private fun deleteTestKey() {
        KeyStore.getInstance(ANDROID_KEYSTORE).apply {
            load(null)
            if (containsAlias(TEST_KEY_ALIAS)) deleteEntry(TEST_KEY_ALIAS)
        }
    }

    companion object {
        private const val DATABASE_NAME = "llm-provider-settings-instrumented.db"
        private const val TEST_KEY_ALIAS = "alerttime_learning_analysis_llm_instrumented_v1"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val BASE_URL = "http://192.168.43.1:8080/v1"
        private const val MODEL = "user-selected-model"
        private const val API_KEY = "user-entered-secret"
    }
}
