package com.hxz.alerttime.app.data.llm

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** 独立于同步凭据的 Android Keystore AES-GCM 存储。明文 key 不进入 AppSetting。 */
interface LlmApiKeyCipher {
    fun encrypt(apiKey: String): String
    fun decrypt(encoded: String): String
}

class AssessmentLlmKeyStore internal constructor(
    private val keyAlias: String = KEY_ALIAS
) : LlmApiKeyCipher {
    private val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    override fun encrypt(apiKey: String): String {
        require(apiKey.isNotBlank()) { "API key must not be blank" }
        require(apiKey.length <= MAX_KEY_LENGTH) { "API key is too long" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        return Base64.encodeToString(cipher.iv + cipher.doFinal(apiKey.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    override fun decrypt(encoded: String): String {
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        require(combined.size > IV_SIZE + TAG_BYTES) { "Encrypted API key is invalid" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_BYTES * 8, combined.copyOfRange(0, IV_SIZE)))
        return String(cipher.doFinal(combined.copyOfRange(IV_SIZE, combined.size)), Charsets.UTF_8)
            .also { require(it.isNotBlank() && it.length <= MAX_KEY_LENGTH) { "Decrypted API key is invalid" } }
    }

    private fun getOrCreateKey(): SecretKey {
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).apply {
            init(KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build())
        }.generateKey()
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "alerttime_learning_analysis_llm_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_SIZE = 12
        private const val TAG_BYTES = 16
        private const val MAX_KEY_LENGTH = 4096
    }
}
