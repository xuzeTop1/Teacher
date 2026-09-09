package com.hxz.alerttime.app.data.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Android Keystore 凭据保护 instrumentation 测试。
 */
@RunWith(AndroidJUnit4::class)
class SyncKeystoreInstrumentedTest {

    @Test
    fun credential_roundtripsThroughKeystore() {
        val keystore = SyncKeystore()
        val credential = "a-long-random-device-credential-1234567890"
        val ciphertext = keystore.encrypt(credential)

        // 密文不是明文。
        assertNotEquals(credential, ciphertext)
        assertTrue(ciphertext.isNotBlank())

        // 可解密还原。
        assertEquals(credential, keystore.decrypt(ciphertext))
    }

    @Test
    fun ciphertext_isNotPlaintextBase64OfCredential() {
        val keystore = SyncKeystore()
        val credential = "secret-credential-value"
        val ciphertext = keystore.encrypt(credential)
        val plainBase64 = android.util.Base64.encodeToString(
            credential.toByteArray(Charsets.UTF_8),
            android.util.Base64.NO_WRAP
        )
        assertNotEquals(plainBase64, ciphertext)
    }
}
