package com.hxz.alerttime.app.data.llm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LlmProviderSecurityTest {
    @Test fun remoteHttpIsRejected() {
        runCatching { EndpointPolicy.chatCompletionsUrl("http://example.com/v1") }.onSuccess { error("expected rejection") }
    }

    @Test fun privateHttpAndHttpsAreAllowed() {
        assertTrue(EndpointPolicy.chatCompletionsUrl("http://127.0.0.1:11434/v1", LlmProviderSettings.AUTH_MODE_NONE).encodedPath.endsWith("/v1/chat/completions"))
        assertTrue(EndpointPolicy.chatCompletionsUrl("http://192.168.1.5:8787/v1", LlmProviderSettings.AUTH_MODE_NONE).encodedPath.endsWith("/v1/chat/completions"))
        assertTrue(EndpointPolicy.chatCompletionsUrl("https://api.example.com/v1", LlmProviderSettings.AUTH_MODE_NONE).encodedPath.endsWith("/v1/chat/completions"))
    }

    @Test fun keyedModesRequireHttps() {
        listOf(LlmProviderSettings.AUTH_MODE_BEARER, LlmProviderSettings.AUTH_MODE_API_KEY).forEach { mode ->
            runCatching { EndpointPolicy.chatCompletionsUrl("http://192.168.1.5:8787/v1", mode) }
                .onSuccess { error("expected keyed HTTP rejection for $mode") }
            assertTrue(EndpointPolicy.chatCompletionsUrl("https://api.example.com/v1", mode).isHttps)
        }
    }

    @Test fun publicHttpIsRejectedForEveryMode() {
        listOf(
            LlmProviderSettings.AUTH_MODE_NONE,
            LlmProviderSettings.AUTH_MODE_BEARER,
            LlmProviderSettings.AUTH_MODE_API_KEY
        ).forEach { mode ->
            runCatching { EndpointPolicy.chatCompletionsUrl("http://example.com/v1", mode) }
                .onSuccess { error("expected public HTTP rejection for $mode") }
        }
    }

    @Test fun urlCredentialsQueryAndFragmentAreRejected() {
        listOf("https://u:p@example.com/v1", "https://example.com/v1?key=secret", "https://example.com/v1#secret")
            .forEach { url -> runCatching { EndpointPolicy.chatCompletionsUrl(url) }.onSuccess { error("expected rejection for $url") } }
    }

    /** 根地址、/v1 根、完整端点地址均接受，自动拼接或去重 /chat/completions。 */
    @Test fun providerUrlAcceptsRootAndFullEndpoint() {
        assertEquals("https://api.example.com/v1/chat/completions",
            EndpointPolicy.chatCompletionsUrl("https://api.example.com/v1", LlmProviderSettings.AUTH_MODE_NONE).toString())
        assertEquals("https://api.example.com/chat/completions",
            EndpointPolicy.chatCompletionsUrl("https://api.example.com", LlmProviderSettings.AUTH_MODE_NONE).toString())
        assertEquals("https://api.example.com/chat/completions",
            EndpointPolicy.chatCompletionsUrl("https://api.example.com/", LlmProviderSettings.AUTH_MODE_NONE).toString())
        assertEquals("https://api.example.com/v1/chat/completions",
            EndpointPolicy.chatCompletionsUrl("https://api.example.com/v1/chat/completions", LlmProviderSettings.AUTH_MODE_NONE).toString())
        assertEquals("https://api.example.com/chat/completions",
            EndpointPolicy.chatCompletionsUrl("https://api.example.com/chat/completions", LlmProviderSettings.AUTH_MODE_NONE).toString())
    }

    @Test fun authModesAreExplicit() {
        assertTrue(LlmProviderSettings.isSupportedAuthMode(LlmProviderSettings.AUTH_MODE_BEARER))
        assertTrue(LlmProviderSettings.isSupportedAuthMode(LlmProviderSettings.AUTH_MODE_API_KEY))
        assertTrue(LlmProviderSettings.isSupportedAuthMode(LlmProviderSettings.AUTH_MODE_NONE))
        assertFalse(LlmProviderSettings.isSupportedAuthMode("basic"))
        assertTrue(AssessmentLlmKeyStore.KEY_ALIAS.contains("learning_analysis"))
    }
}
