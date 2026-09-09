package com.hxz.alerttime.app.ui.assessment

import com.hxz.alerttime.app.data.llm.LlmProviderSettings
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LearningAnalysisLogicTest {
    @Test
    fun `new settings have no embedded provider url or model`() {
        val state = LlmProviderConfigUiState()
        assertEquals("", state.baseUrl)
        assertEquals("", state.model)
        assertEquals(false, state.enabled)
        assertEquals(false, state.hasStoredApiKey)
    }

    @Test
    fun `provider form requires only user supplied values`() {
        assertEquals(
            "请填写你自己的模型服务地址",
            validateLlmProviderForm(
                LlmProviderForm("", "model", LlmProviderSettings.AUTH_MODE_BEARER, "key"),
                false
            )
        )
        assertEquals(
            "请填写 API Key",
            validateLlmProviderForm(
                LlmProviderForm(
                    baseUrl = "https://example.com/v1",
                    model = "model",
                    authMode = LlmProviderSettings.AUTH_MODE_BEARER,
                    apiKey = ""
                ),
                false
            )
        )
        assertNull(
            validateLlmProviderForm(
                LlmProviderForm(
                    "https://example.com/v1",
                    "model",
                    LlmProviderSettings.AUTH_MODE_BEARER,
                    ""
                ),
                true
            )
        )
        assertNull(
            validateLlmProviderForm(
                LlmProviderForm(
                    "http://192.168.1.20:8787/v1",
                    "local-model",
                    LlmProviderSettings.AUTH_MODE_NONE,
                    ""
                ),
                false
            )
        )
        assertEquals(
            "无认证模式不能填写 API Key",
            validateLlmProviderForm(
                LlmProviderForm(
                    "http://192.168.1.20:8787/v1",
                    "local-model",
                    LlmProviderSettings.AUTH_MODE_NONE,
                    "accidental-secret"
                ),
                false
            )
        )
    }

    @Test
    fun `provider form keeps url model auth and key in their named slots`() {
        val saved = LlmProviderConfigUiState(
            enabled = false,
            baseUrl = "https://api.moonshot.cn/v1",
            model = "moonshot-v1-8k",
            authMode = LlmProviderSettings.AUTH_MODE_BEARER,
            hasStoredApiKey = false
        )
        val unchanged = LlmProviderForm(
            baseUrl = "https://api.moonshot.cn/v1",
            model = "moonshot-v1-8k",
            authMode = LlmProviderSettings.AUTH_MODE_BEARER,
            apiKey = ""
        )

        assertFalse(isProviderDraftDirty(unchanged, saved))
        assertEquals("https://api.moonshot.cn/v1", unchanged.baseUrl)
        assertEquals("moonshot-v1-8k", unchanged.model)
        assertEquals(LlmProviderSettings.AUTH_MODE_BEARER, unchanged.authMode)
        assertTrue(isProviderDraftDirty(unchanged.copy(model = "different-model"), saved))
    }

    @Test
    fun `provider form rejects a service url in the model field`() {
        assertEquals(
            "模型名称不能填写服务地址，请填写服务商提供的模型 ID",
            validateLlmProviderForm(
                LlmProviderForm(
                    baseUrl = "https://api.moonshot.cn/v1",
                    model = "https://api.moonshot.cn/v1",
                    authMode = LlmProviderSettings.AUTH_MODE_BEARER,
                    apiKey = "secret"
                ),
                false
            )
        )
        assertEquals(
            "模型名称不能填写服务地址，请填写服务商提供的模型 ID",
            providerModelValidationError(" HTTPS://api.moonshot.cn/v1 ")
        )
    }

    @Test
    fun `provider form reuses endpoint policy for unsafe base urls`() {
        assertEquals(
            "Bearer/API Key 模式必须使用 HTTPS；HTTP 仅限无认证本地服务",
            validateLlmProviderForm(
                LlmProviderForm(
                    baseUrl = "http://api.example.com/v1",
                    model = "model",
                    authMode = LlmProviderSettings.AUTH_MODE_BEARER,
                    apiKey = "secret"
                ),
                false
            )
        )
    }

    @Test
    fun `focus subjects accept common Chinese separators and remove duplicates`() {
        assertEquals(
            listOf("数学一", "英语一", "408", "政治"),
            parseFocusSubjects("数学一、英语一，408\n政治；数学一")
        )
    }

    @Test
    fun `generation waits until learner context and provider settings are fully saved`() {
        val ready = LearningAnalysisUiState(loading = false)
        assertTrue(canGenerateLearningAnalysis(ready))
        assertEquals(false, canGenerateLearningAnalysis(ready, hasUnsavedDrafts = true))
        assertTrue(canEditLearningAnalysisSettings(ready))
        assertEquals(
            false,
            canGenerateLearningAnalysis(ready.copy(savingLearnerContext = true))
        )
        assertEquals(
            false,
            canGenerateLearningAnalysis(ready.copy(provider = ready.provider.copy(saving = true)))
        )
        assertEquals(false, canGenerateLearningAnalysis(ready.copy(generating = true)))
        assertEquals(false, canGenerateLearningAnalysis(ready.copy(loading = true)))
        assertEquals(false, canEditLearningAnalysisSettings(ready.copy(loading = true)))
        assertTrue(canRefreshLearningAnalysis(ready.copy(loading = true)))
        assertEquals(
            false,
            canRefreshLearningAnalysis(ready.copy(savingLearnerContext = true))
        )
    }

    @Test
    fun `provider validation errors are stable Chinese messages without secret echo`() {
        val keyError = providerSettingsErrorMessage(IllegalArgumentException("API key secret-value is too long"))
        assertEquals("API Key 不可用，请重新填写", keyError)
        assertEquals(false, keyError.contains("secret-value"))
        assertEquals(
            "Bearer/API Key 模式必须使用 HTTPS；HTTP 仅限无认证本地服务",
            providerSettingsErrorMessage(
                IllegalArgumentException(
                    "带密钥 Provider 必须使用 HTTPS；HTTP 仅允许无认证本机或局域网服务"
                )
            )
        )
        assertEquals(
            "Bearer/API Key 模式必须使用 HTTPS；HTTP 仅限无认证本地服务",
            providerSettingsErrorMessage(
                IllegalArgumentException(
                    "Bearer provider requires HTTPS; HTTP is only allowed for unauthenticated local or LAN service"
                )
            )
        )
    }

    @Test
    fun `fact formatter renders structured values for non technical ui`() {
        val value = Json.parseToJsonElement("""["数学一","408"]""")
        assertEquals("数学一、408", formatFactValue(value))
        assertTrue(analysisGeneratorLabel("android_llm").contains("你配置"))
    }

    @Test
    fun `truncated provider output has a stable safe Chinese warning`() {
        val label = learningAnalysisWarningLabel("llm_fallback_response_truncated")
        assertEquals("模型输出达到长度上限，内容被截断；本次已使用手机本地评估", label)
        assertFalse(label.contains("API Key"))
        assertFalse(label.contains("response body"))
    }

    @Test
    fun `staged output failures have stable safe Chinese warnings`() {
        val labels = mapOf(
            "llm_fallback_output_root_shape" to "模型返回的 JSON 顶层不是对象",
            "llm_fallback_output_answer_guard" to "模型返回内容包含不允许保存的答案字段",
            "llm_fallback_output_schema" to "模型返回的分析字段缺失或类型不正确",
            "llm_fallback_output_constraints" to "模型返回的分析内容超出安全范围",
            "llm_fallback_output_task_binding" to "模型生成的测试题无法可靠绑定当前计划",
            "llm_fallback_output_protocol" to "模型分析未通过本地同步协议校验"
        )

        labels.forEach { (code, expected) ->
            val label = learningAnalysisWarningLabel(code)
            assertEquals(expected, label)
            assertFalse(label.contains("secret-key"))
            assertFalse(label.contains("provider body"))
        }
    }
}
