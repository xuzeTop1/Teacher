package com.hxz.alerttime.app.data.llm

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okio.Buffer
import java.io.IOException
import java.util.concurrent.TimeUnit

@Serializable data class LlmChatMessage(val role: String, val content: String)
@Serializable private data class ChatResponseFormat(val type: String)
@Serializable private data class ChatThinking(val type: String)
@Serializable private data class ChatRequest(
    val model: String,
    val messages: List<LlmChatMessage>,
    @SerialName("max_tokens") val maxTokens: Int,
    @SerialName("response_format") val responseFormat: ChatResponseFormat,
    val thinking: ChatThinking? = null
)
@Serializable private data class ChatResponse(val choices: List<ChatChoice> = emptyList())
@Serializable private data class ChatChoice(
    val message: ChatMessageResponse? = null,
    @SerialName("finish_reason") val finishReason: String? = null
)
@Serializable private data class ChatMessageResponse(val content: String? = null)

fun interface LlmCompletionClient {
    suspend fun complete(settings: LlmProviderSettings, systemPrompt: String, userPayload: String): String
}

class OpenAiCompatibleClient(
    private val json: Json = Json { ignoreUnknownKeys = true; isLenient = false },
    private val timeoutPolicy: LlmTimeoutPolicy = LlmTimeoutPolicy.DEFAULT,
    private val client: OkHttpClient = defaultClient(timeoutPolicy)
) : LlmCompletionClient {
    override suspend fun complete(settings: LlmProviderSettings, systemPrompt: String, userPayload: String): String {
        require(settings.enabled)
        if (systemPrompt.length > MAX_PROMPT_CHARS || userPayload.length > MAX_PROMPT_CHARS) {
            throw LlmProviderException(LlmFailureCategory.REQUEST_TOO_LARGE, "LLM prompt is too large")
        }
        val endpoint = EndpointPolicy.chatCompletionsUrl(settings.baseUrl, settings.authMode)
        val requestJson = json.encodeToString(
            ChatRequest.serializer(),
            ChatRequest(
                model = settings.model,
                messages = listOf(
                    LlmChatMessage("system", systemPrompt),
                    LlmChatMessage("user", userPayload)
                ),
                maxTokens = MAX_COMPLETION_TOKENS,
                responseFormat = ChatResponseFormat(type = "json_object"),
                thinking = if (ProviderCompatibilityPolicy.shouldDisableThinking(endpoint.host, settings.model)) {
                    ChatThinking(type = "disabled")
                } else {
                    null
                }
            )
        )
        if (requestJson.toByteArray(Charsets.UTF_8).size > MAX_REQUEST_BYTES) {
            throw LlmProviderException(LlmFailureCategory.REQUEST_TOO_LARGE, "LLM request is too large")
        }
        val builder = Request.Builder().url(endpoint).post(requestJson.toRequestBody(JSON_MEDIA_TYPE)).header("Accept", "application/json")
        when (settings.authMode) {
            LlmProviderSettings.AUTH_MODE_BEARER -> builder.header("Authorization", "Bearer ${settings.apiKey.requireNotBlankKey()}")
            LlmProviderSettings.AUTH_MODE_API_KEY -> builder.header("api-key", settings.apiKey.requireNotBlankKey())
            LlmProviderSettings.AUTH_MODE_NONE -> require(settings.apiKey.isBlank()) { "无认证模式不能携带 API Key" }
            else -> error("Unsupported auth mode")
        }
        return try {
            withContext(Dispatchers.IO) {
                client.newCall(builder.build()).execute().use { response ->
                    val category = when (response.code) {
                        401, 403 -> LlmFailureCategory.HTTP_401_403
                        404 -> LlmFailureCategory.HTTP_404
                        429 -> LlmFailureCategory.HTTP_429
                        else -> null
                    }
                    if (!response.isSuccessful) {
                        throw LlmProviderException(
                            category ?: LlmFailureCategory.HTTP_OTHER,
                            "LLM request failed with HTTP ${response.code}"
                        )
                    }
                    val body = response.body ?: throw LlmProviderException(
                        LlmFailureCategory.RESPONSE_NON_JSON,
                        "LLM response body is empty"
                    )
                    val bytes = body.source().use { source ->
                        val buffer = Buffer()
                        while (!source.exhausted()) {
                            source.read(buffer, 8192L)
                            if (buffer.size > MAX_RESPONSE_BYTES) {
                                throw LlmProviderException(
                                    LlmFailureCategory.RESPONSE_NON_JSON,
                                    "LLM response is too large"
                                )
                            }
                        }
                        buffer.readByteArray()
                    }
                    val parsed = runCatching {
                        json.decodeFromString(ChatResponse.serializer(), bytes.toString(Charsets.UTF_8))
                    }.getOrElse {
                        throw LlmProviderException(
                            LlmFailureCategory.RESPONSE_NON_JSON,
                            "LLM response is not valid JSON"
                        )
                    }
                    val choice = parsed.choices.firstOrNull()
                        ?: throw LlmProviderException(
                            LlmFailureCategory.RESPONSE_NON_JSON,
                            "LLM response has no choice"
                        )
                    if (choice.finishReason == "length") {
                        throw LlmProviderException(
                            LlmFailureCategory.RESPONSE_TRUNCATED,
                            "LLM response was truncated by the token limit"
                        )
                    }
                    choice.message?.content?.trim()?.takeIf { it.isNotEmpty() }
                        ?: throw LlmProviderException(
                            LlmFailureCategory.RESPONSE_NON_JSON,
                            "LLM response has no assistant content"
                        )
                }
            }
        } catch (error: LlmProviderException) {
            throw error
        } catch (_: IOException) {
            throw LlmProviderException(LlmFailureCategory.TIMEOUT_NETWORK, "LLM network request failed")
        }
    }

    private fun String.requireNotBlankKey(): String = trim().also {
        require(it.isNotEmpty()) { "带密钥认证模式必须提供 API Key" }
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private const val MAX_PROMPT_CHARS = MAX_LLM_PROMPT_CHARS
        private const val MAX_REQUEST_BYTES = 256 * 1024
        private const val MAX_RESPONSE_BYTES = 512 * 1024
        private const val MAX_COMPLETION_TOKENS = 8192
        private fun defaultClient(timeoutPolicy: LlmTimeoutPolicy) =
            timeoutPolicy.applyTo(
                OkHttpClient.Builder()
                    .followRedirects(false)
                    .followSslRedirects(false)
                    .retryOnConnectionFailure(false)
            ).build()
    }
}

/**
 * 有限且可测试的 Provider 请求时限。
 * 思考模型可能有较长首 token 延迟，但分析 POST 没有幂等依据，因此不自动重试。
 */
data class LlmTimeoutPolicy(
    val connectTimeoutSeconds: Long,
    val readTimeoutSeconds: Long,
    val writeTimeoutSeconds: Long,
    val callTimeoutSeconds: Long
) {
    init {
        require(connectTimeoutSeconds > 0)
        require(readTimeoutSeconds > 0)
        require(writeTimeoutSeconds > 0)
        require(callTimeoutSeconds >= readTimeoutSeconds)
    }

    internal fun applyTo(builder: OkHttpClient.Builder): OkHttpClient.Builder = builder
        .retryOnConnectionFailure(false)
        .connectTimeout(connectTimeoutSeconds, TimeUnit.SECONDS)
        .readTimeout(readTimeoutSeconds, TimeUnit.SECONDS)
        .writeTimeout(writeTimeoutSeconds, TimeUnit.SECONDS)
        .callTimeout(callTimeoutSeconds, TimeUnit.SECONDS)

    companion object {
        val DEFAULT = LlmTimeoutPolicy(
            connectTimeoutSeconds = 15,
            readTimeoutSeconds = 300,
            writeTimeoutSeconds = 15,
            callTimeoutSeconds = 330
        )

        /**
         * 同步链路使用的分析 LLM 时限。局域网同步不应被慢/卡住的 Provider 阻塞数分钟；
         * 超时后由确定性生成器降级，保证同步仍能完成。
         */
        val SYNC_ANALYSIS = LlmTimeoutPolicy(
            connectTimeoutSeconds = 10,
            readTimeoutSeconds = 30,
            writeTimeoutSeconds = 10,
            callTimeoutSeconds = 45
        )
    }
}

const val MAX_LLM_PROMPT_CHARS = 80_000

enum class LlmFailureCategory(val warningCode: String) {
    HTTP_401_403("http_401_403"),
    HTTP_404("http_404"),
    HTTP_429("http_429"),
    HTTP_OTHER("http_other"),
    TIMEOUT_NETWORK("timeout_network"),
    RESPONSE_NON_JSON("response_non_json"),
    RESPONSE_TRUNCATED("response_truncated"),
    OUTPUT_ROOT_SHAPE("output_root_shape"),
    OUTPUT_ANSWER_GUARD("output_answer_guard"),
    OUTPUT_SCHEMA("output_schema"),
    OUTPUT_CONSTRAINTS("output_constraints"),
    OUTPUT_TASK_BINDING("output_task_binding"),
    OUTPUT_PROTOCOL("output_protocol"),
    OUTPUT_VALIDATION("output_validation"),
    REQUEST_TOO_LARGE("request_too_large")
}

class LlmProviderException(
    val category: LlmFailureCategory,
    message: String
) : Exception(message)

internal object ProviderCompatibilityPolicy {
    private const val MOONSHOT_OFFICIAL_HOST = "api.moonshot.cn"
    private val MOONSHOT_THINKING_MODELS = setOf("kimi-k2.5", "kimi-k2.6")

    fun shouldDisableThinking(endpointHost: String, model: String): Boolean =
        endpointHost.equals(MOONSHOT_OFFICIAL_HOST, ignoreCase = true) &&
            model in MOONSHOT_THINKING_MODELS
}

object EndpointPolicy {
    fun chatCompletionsUrl(
        baseUrl: String,
        authMode: String = LlmProviderSettings.AUTH_MODE_NONE
    ): HttpUrl {
        val base = baseUrl.trim().toHttpUrlOrNull() ?: throw IllegalArgumentException("Provider URL is invalid")
        require(LlmProviderSettings.isSupportedAuthMode(authMode)) { "Unsupported auth mode" }
        require(base.username.isEmpty() && base.password.isEmpty()) { "Provider URL must not contain credentials" }
        require(base.query == null && base.fragment == null) { "Provider URL must not contain query or fragment" }
        require(base.scheme == "https" || (authMode == LlmProviderSettings.AUTH_MODE_NONE && base.scheme == "http" && isAllowedHttpHost(base.host))) {
            "带密钥 Provider 必须使用 HTTPS；HTTP 仅允许无认证本机或局域网服务"
        }
        val trimmed = base.encodedPath.trimEnd('/')
        return if (trimmed.endsWith("/chat/completions")) {
            base.newBuilder().encodedPath(trimmed).build()
        } else if (trimmed.isEmpty()) {
            base.newBuilder().addPathSegment("chat").addPathSegment("completions").build()
        } else {
            base.newBuilder().encodedPath(trimmed).addPathSegment("chat").addPathSegment("completions").build()
        }
    }

    fun isAllowedHttpHost(host: String): Boolean {
        if (host.equals("localhost", true) || host == "::1") return true
        val octets = host.split('.').takeIf { it.size == 4 }?.mapNotNull { it.toIntOrNull() } ?: return false
        if (octets.any { it !in 0..255 }) return false
        return octets[0] == 10 || (octets[0] == 172 && octets[1] in 16..31) || (octets[0] == 192 && octets[1] == 168) || octets[0] == 127
    }
}
