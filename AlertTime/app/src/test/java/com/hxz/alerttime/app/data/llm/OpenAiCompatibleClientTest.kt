package com.hxz.alerttime.app.data.llm

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenAiCompatibleClientTest {
    @Test
    fun `default timeout policy is finite and leaves room for thinking model first token`() {
        val client = LlmTimeoutPolicy.DEFAULT.applyTo(OkHttpClient.Builder()).build()

        assertEquals(15_000, client.connectTimeoutMillis)
        assertEquals(300_000, client.readTimeoutMillis)
        assertEquals(15_000, client.writeTimeoutMillis)
        assertEquals(330_000, client.callTimeoutMillis)
        assertFalse(client.retryOnConnectionFailure)
    }

    @Test
    fun `sync analysis timeout budget is bounded so a hanging provider cannot stall the sync`() {
        val client = LlmTimeoutPolicy.SYNC_ANALYSIS.applyTo(OkHttpClient.Builder()).build()

        assertEquals(30_000, client.readTimeoutMillis)
        assertTrue("sync read budget must be well under the 300s default", client.readTimeoutMillis < 300_000)
        assertTrue("call budget must exceed read budget", client.callTimeoutMillis > client.readTimeoutMillis)
        assertTrue("call budget must be bounded under 60s", client.callTimeoutMillis < 60_000)
        assertFalse(client.retryOnConnectionFailure)
    }

    @Test
    fun `network timeout is safely classified and post is not retried`() = runBlocking {
        var calls = 0
        val client = OpenAiCompatibleClient(
            client = OkHttpClient.Builder()
                .addInterceptor {
                    calls += 1
                    throw SocketTimeoutException("provider took too long")
                }
                .build()
        )

        val error = runCatching {
            client.complete(
                settings = settings(),
                systemPrompt = "system",
                userPayload = "payload"
            )
        }.exceptionOrNull()

        assertTrue(error is LlmProviderException)
        assertEquals(LlmFailureCategory.TIMEOUT_NETWORK, (error as LlmProviderException).category)
        assertEquals(1, calls)
        assertFalse(error.message.orEmpty().contains("provider took too long"))
    }

    @Test
    fun `bearer request uses only user supplied endpoint model key and prompts`() = runBlocking {
        val interceptor = CapturingInterceptor { request -> successResponse(request, "assistant-result") }
        val client = OpenAiCompatibleClient(client = OkHttpClient.Builder().addInterceptor(interceptor).build())
        val result = client.complete(
            settings = settings(
                baseUrl = "https://provider.example/v1",
                model = "user-model",
                authMode = LlmProviderSettings.AUTH_MODE_BEARER,
                apiKey = SECRET_KEY
            ),
            systemPrompt = "system-from-app",
            userPayload = "payload-from-local-plan"
        )

        assertEquals("assistant-result", result)
        val request = requireNotNull(interceptor.request)
        assertEquals("https://provider.example/v1/chat/completions", request.url.toString())
        assertEquals("Bearer $SECRET_KEY", request.header("Authorization"))
        assertNull(request.header("api-key"))
        val body = requestBody(request)
        val json = Json.parseToJsonElement(body).jsonObject
        assertEquals("user-model", json.getValue("model").jsonPrimitive.content)
        assertFalse(json.containsKey("temperature"))
        assertEquals("8192", json.getValue("max_tokens").jsonPrimitive.content)
        assertEquals(
            "json_object",
            json.getValue("response_format").jsonObject.getValue("type").jsonPrimitive.content
        )
        assertFalse(json.containsKey("thinking"))
        val messages = json.getValue("messages").jsonArray
        assertEquals("system-from-app", messages[0].jsonObject.getValue("content").jsonPrimitive.content)
        assertEquals("payload-from-local-plan", messages[1].jsonObject.getValue("content").jsonPrimitive.content)
        assertFalse(body.contains(SECRET_KEY))
    }

    @Test
    fun `length finish reason is safely classified before assistant content is returned`() = runBlocking {
        var calls = 0
        val interceptor = CapturingInterceptor { request ->
            calls += 1
            response(
                request,
                200,
                """{"choices":[{"finish_reason":"length","message":{"content":"partial provider body $SECRET_KEY"}}]}"""
            )
        }
        val client = OpenAiCompatibleClient(
            client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        )

        val error = runCatching {
            client.complete(
                settings = settings(apiKey = SECRET_KEY),
                systemPrompt = "system",
                userPayload = "payload"
            )
        }.exceptionOrNull()

        assertTrue(error is LlmProviderException)
        assertEquals(LlmFailureCategory.RESPONSE_TRUNCATED, (error as LlmProviderException).category)
        assertEquals("response_truncated", error.category.warningCode)
        assertEquals(1, calls)
        assertFalse(error.message.orEmpty().contains(SECRET_KEY))
        assertFalse(error.message.orEmpty().contains("partial provider body"))
    }

    @Test
    fun `official Moonshot K2 models explicitly disable thinking`() = runBlocking {
        listOf("kimi-k2.6", "kimi-k2.5").forEach { model ->
            val interceptor = CapturingInterceptor { request -> successResponse(request, "ok") }
            val client = OpenAiCompatibleClient(
                client = OkHttpClient.Builder().addInterceptor(interceptor).build()
            )

            client.complete(
                settings = settings(
                    baseUrl = "https://api.moonshot.cn/v1",
                    model = model,
                    apiKey = SECRET_KEY
                ),
                systemPrompt = "system",
                userPayload = "payload"
            )

            val body = requestBody(requireNotNull(interceptor.request))
            val requestJson = Json.parseToJsonElement(body).jsonObject
            assertEquals(
                "disabled",
                requestJson.getValue("thinking").jsonObject.getValue("type").jsonPrimitive.content
            )
            assertFalse(body.contains(SECRET_KEY))
        }
    }

    @Test
    fun `thinking compatibility policy requires exact official host and model`() = runBlocking {
        val excludedProviders = listOf(
            "https://api.moonshot.cn/v1" to "other-model",
            "https://api.moonshot.cn/v1" to "kimi-k2.6-latest",
            "https://api.moonshot.cn.evil/v1" to "kimi-k2.6",
            "https://proxy.example/v1" to "kimi-k2.6"
        )

        excludedProviders.forEach { (baseUrl, model) ->
            val interceptor = CapturingInterceptor { request -> successResponse(request, "ok") }
            val client = OpenAiCompatibleClient(
                client = OkHttpClient.Builder().addInterceptor(interceptor).build()
            )

            client.complete(
                settings = settings(baseUrl = baseUrl, model = model, apiKey = SECRET_KEY),
                systemPrompt = "system",
                userPayload = "payload"
            )

            val body = requestBody(requireNotNull(interceptor.request))
            assertFalse(Json.parseToJsonElement(body).jsonObject.containsKey("thinking"))
            assertFalse(body.contains(SECRET_KEY))
        }

        assertTrue(ProviderCompatibilityPolicy.shouldDisableThinking("API.MOONSHOT.CN", "kimi-k2.6"))
        assertFalse(ProviderCompatibilityPolicy.shouldDisableThinking("api.moonshot.cn.evil", "kimi-k2.6"))
        assertFalse(ProviderCompatibilityPolicy.shouldDisableThinking("api.moonshot.cn", "KIMI-K2.6"))
    }

    @Test
    fun `api key mode uses api-key header without bearer fallback over https`() = runBlocking {
        val interceptor = CapturingInterceptor { request -> successResponse(request, "ok") }
        val client = OpenAiCompatibleClient(client = OkHttpClient.Builder().addInterceptor(interceptor).build())

        client.complete(
            settings = settings(
                baseUrl = "https://provider.example/v1",
                model = "lan-model",
                authMode = LlmProviderSettings.AUTH_MODE_API_KEY,
                apiKey = SECRET_KEY
            ),
            systemPrompt = "system",
            userPayload = "payload"
        )

        val request = requireNotNull(interceptor.request)
        assertEquals("https://provider.example/v1/chat/completions", request.url.toString())
        assertEquals(SECRET_KEY, request.header("api-key"))
        assertNull(request.header("Authorization"))
    }

    @Test
    fun `private http none request succeeds without authentication headers`() = runBlocking {
        val interceptor = CapturingInterceptor { request -> successResponse(request, "local-result") }
        val client = OpenAiCompatibleClient(client = OkHttpClient.Builder().addInterceptor(interceptor).build())

        assertEquals(
            "local-result",
            client.complete(
                settings = settings(
                    baseUrl = "http://192.168.20.5:8787/v1",
                    authMode = LlmProviderSettings.AUTH_MODE_NONE,
                    apiKey = ""
                ),
                systemPrompt = "system",
                userPayload = "payload"
            )
        )

        val request = requireNotNull(interceptor.request)
        assertNull(request.header("Authorization"))
        assertNull(request.header("api-key"))
    }

    @Test
    fun `https none request has no authentication headers`() = runBlocking {
        val interceptor = CapturingInterceptor { request -> successResponse(request, "ok") }
        val client = OpenAiCompatibleClient(client = OkHttpClient.Builder().addInterceptor(interceptor).build())

        client.complete(
            settings = settings(
                authMode = LlmProviderSettings.AUTH_MODE_NONE,
                apiKey = ""
            ),
            systemPrompt = "system",
            userPayload = "payload"
        )

        val request = requireNotNull(interceptor.request)
        assertNull(request.header("Authorization"))
        assertNull(request.header("api-key"))
    }

    @Test
    fun `private http keyed modes are rejected before request`() = runBlocking {
        listOf(LlmProviderSettings.AUTH_MODE_BEARER, LlmProviderSettings.AUTH_MODE_API_KEY).forEach { mode ->
            val interceptor = CapturingInterceptor { request -> successResponse(request, "should-not-run") }
            val client = OpenAiCompatibleClient(client = OkHttpClient.Builder().addInterceptor(interceptor).build())
            val error = runCatching {
                client.complete(
                    settings = settings(
                        baseUrl = "http://192.168.20.5:8787/v1",
                        authMode = mode
                    ),
                    systemPrompt = "system",
                    userPayload = "payload"
                )
            }.exceptionOrNull()
            assertTrue(error is IllegalArgumentException)
            assertNull(interceptor.request)
        }
    }

    @Test
    fun `none mode rejects a supplied key before request`() = runBlocking {
        val interceptor = CapturingInterceptor { request -> successResponse(request, "should-not-run") }
        val client = OpenAiCompatibleClient(client = OkHttpClient.Builder().addInterceptor(interceptor).build())
        val error = runCatching {
            client.complete(
                settings = settings(authMode = LlmProviderSettings.AUTH_MODE_NONE),
                systemPrompt = "system",
                userPayload = "payload"
            )
        }.exceptionOrNull()
        assertTrue(error is IllegalArgumentException)
        assertNull(interceptor.request)
    }

    @Test
    fun `keyed modes reject a blank key before request`() = runBlocking {
        listOf(LlmProviderSettings.AUTH_MODE_BEARER, LlmProviderSettings.AUTH_MODE_API_KEY).forEach { mode ->
            val interceptor = CapturingInterceptor { request -> successResponse(request, "should-not-run") }
            val client = OpenAiCompatibleClient(client = OkHttpClient.Builder().addInterceptor(interceptor).build())
            val error = runCatching {
                client.complete(
                    settings = settings(authMode = mode, apiKey = ""),
                    systemPrompt = "system",
                    userPayload = "payload"
                )
            }.exceptionOrNull()
            assertTrue(error is IllegalArgumentException)
            assertNull(interceptor.request)
        }
    }

    @Test
    fun `http failure exposes only status and never response body or key`() = runBlocking {
        val interceptor = CapturingInterceptor { request ->
            response(request, 401, "provider echoed $SECRET_KEY")
        }
        val client = OpenAiCompatibleClient(client = OkHttpClient.Builder().addInterceptor(interceptor).build())

        val error = runCatching {
            client.complete(
                settings = settings(apiKey = SECRET_KEY),
                systemPrompt = "system",
                userPayload = "payload"
            )
        }.exceptionOrNull()

        assertTrue(error is LlmProviderException)
        assertEquals("LLM request failed with HTTP 401", error?.message)
        assertFalse(error?.message.orEmpty().contains(SECRET_KEY))
        assertFalse(error?.message.orEmpty().contains("provider echoed"))
    }

    @Test
    fun `http 429 maps to HTTP_429 category without leaking body`() = runBlocking {
        val interceptor = CapturingInterceptor { request ->
            response(request, 429, "provider rate-limited $SECRET_KEY")
        }
        val client = OpenAiCompatibleClient(client = OkHttpClient.Builder().addInterceptor(interceptor).build())

        val error = runCatching {
            client.complete(
                settings = settings(apiKey = SECRET_KEY),
                systemPrompt = "system",
                userPayload = "payload"
            )
        }.exceptionOrNull()

        assertTrue(error is LlmProviderException)
        assertEquals(LlmFailureCategory.HTTP_429, (error as LlmProviderException).category)
        assertEquals("http_429", error.category.warningCode)
        assertEquals("LLM request failed with HTTP 429", error.message)
        assertFalse(error.message.orEmpty().contains(SECRET_KEY))
        assertFalse(error.message.orEmpty().contains("rate-limited"))
    }

    private fun settings(
        baseUrl: String = "https://provider.example/v1",
        model: String = "user-model",
        authMode: String = LlmProviderSettings.AUTH_MODE_BEARER,
        apiKey: String = SECRET_KEY
    ) = LlmProviderSettings(
        enabled = true,
        baseUrl = baseUrl,
        model = model,
        authMode = authMode,
        apiKey = apiKey
    )

    private fun successResponse(request: Request, content: String): Response = response(
        request,
        200,
        """{"choices":[{"message":{"content":"$content"}}]}"""
    )

    private fun response(request: Request, code: Int, body: String): Response = Response.Builder()
        .request(request)
        .protocol(Protocol.HTTP_1_1)
        .code(code)
        .message(if (code in 200..299) "OK" else "Error")
        .body(body.toResponseBody("application/json; charset=utf-8".toMediaType()))
        .build()

    private fun requestBody(request: Request): String = Buffer().use { buffer ->
        requireNotNull(request.body).writeTo(buffer)
        buffer.readUtf8()
    }

    private class CapturingInterceptor(
        private val responder: (Request) -> Response
    ) : Interceptor {
        var request: Request? = null
            private set

        override fun intercept(chain: Interceptor.Chain): Response {
            return responder(chain.request().also { request = it })
        }
    }

    companion object {
        private const val SECRET_KEY = "secret-user-key-123"
    }
}
