package com.hxz.alerttime.app.ui.assessment

import com.hxz.alerttime.app.data.llm.LlmProviderSettings
import com.hxz.alerttime.app.data.llm.EndpointPolicy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

data class LlmProviderConfigUiState(
    val enabled: Boolean = false,
    val baseUrl: String = "",
    val model: String = "",
    val authMode: String = LlmProviderSettings.AUTH_MODE_BEARER,
    val hasStoredApiKey: Boolean = false,
    val saving: Boolean = false,
    /** 仅作为 UI 清空密码输入框的信号；永远不携带明文 Key。 */
    val savedVersion: Long = 0
)

/**
 * Provider 表单提交值。用带字段名的对象跨越 Compose -> ViewModel 回调，避免多个 String
 * 参数在调用点发生 Base URL、模型、认证方式和 API Key 的位置错配。
 * API Key 只存在一次提交调用的瞬时参数中，不进入 UI State。
 */
data class LlmProviderForm(
    val baseUrl: String,
    val model: String,
    val authMode: String,
    val apiKey: String
)

/** 目标和 Provider 必须先完整落库，本次生成才允许读取它们。 */
internal fun canGenerateLearningAnalysis(
    state: LearningAnalysisUiState,
    hasUnsavedDrafts: Boolean = false
): Boolean = canEditLearningAnalysisSettings(state) && !hasUnsavedDrafts

/** 刷新、设置保存和生成共享一个前台操作槽，禁止空初始状态覆盖已保存配置。 */
internal fun canEditLearningAnalysisSettings(state: LearningAnalysisUiState): Boolean =
    !state.loading &&
        !state.savingLearnerContext &&
        !state.generating &&
        !state.provider.saving

/** 已有操作进行时不重复刷新；首次和重新打开仍会读取持久化状态。 */
internal fun canRefreshLearningAnalysis(state: LearningAnalysisUiState): Boolean =
    !state.savingLearnerContext && !state.generating && !state.provider.saving

/** 底层校验不把 URL、Key 或密文回显给用户；设置页只显示稳定中文提示。 */
internal fun providerSettingsErrorMessage(error: Throwable): String {
    val message = error.message.orEmpty().lowercase()
    return when {
        "api key" in message || "encrypted" in message || "decrypt" in message || "keystore" in message ->
            "API Key 不可用，请重新填写"
        "无认证模式" in message -> "无认证模式不能填写 API Key"
        ("带密钥 provider" in message && "https" in message) ||
            ("https" in message && ("bearer" in message || "api key" in message)) ||
            ("http" in message && ("unauthenticated" in message || "local" in message || "lan" in message)) ->
            "Bearer/API Key 模式必须使用 HTTPS；HTTP 仅限无认证本地服务"
        "query or fragment" in message || "credentials" in message ->
            "模型服务地址不能包含账号、查询参数或片段"
        "https" in message || "http" in message ->
            "Bearer/API Key 模式必须使用 HTTPS；HTTP 仅限无认证本地服务"
        "url" in message || "provider 配置" in message -> "模型服务地址格式无效或配置不完整"
        else -> "模型设置保存失败，请检查地址、模型和认证方式"
    }
}

internal fun validateLlmProviderForm(
    form: LlmProviderForm,
    hasStoredApiKey: Boolean
): String? {
    providerModelValidationError(form.model)?.let { return it }
    if (form.baseUrl.isBlank()) return "请填写你自己的模型服务地址"
    if (form.model.isBlank()) return "请填写模型名称"
    if (!LlmProviderSettings.isSupportedAuthMode(form.authMode)) return "请选择受支持的认证方式"
    if (form.authMode == LlmProviderSettings.AUTH_MODE_NONE && form.apiKey.isNotBlank()) {
        return "无认证模式不能填写 API Key"
    }
    if (form.authMode == LlmProviderSettings.AUTH_MODE_NONE) return null
    if (form.apiKey.isBlank() && !hasStoredApiKey) return "请填写 API Key"
    val endpointError = runCatching {
        EndpointPolicy.chatCompletionsUrl(form.baseUrl, form.authMode)
    }.exceptionOrNull()
    if (endpointError != null) return providerSettingsErrorMessage(endpointError)
    return null
}

internal fun providerModelValidationError(model: String): String? {
    val normalized = model.trim()
    return if (normalized.startsWith("http://", ignoreCase = true) ||
        normalized.startsWith("https://", ignoreCase = true)
    ) {
        "模型名称不能填写服务地址，请填写服务商提供的模型 ID"
    } else {
        null
    }
}

internal fun isProviderDraftDirty(
    form: LlmProviderForm,
    saved: LlmProviderConfigUiState
): Boolean = form.baseUrl.trim() != saved.baseUrl ||
    form.model.trim() != saved.model ||
    form.authMode != saved.authMode ||
    form.apiKey.isNotBlank()

internal fun parseFocusSubjects(value: String): List<String> = value
    .split(Regex("[,，、;；\\n\\r]+"))
    .map(String::trim)
    .filter(String::isNotEmpty)
    .distinct()

internal fun formatFactValue(value: kotlinx.serialization.json.JsonElement): String = when (value) {
    JsonNull -> "未填写"
    is JsonPrimitive -> value.content
    is JsonArray -> value.joinToString("、") { formatFactValue(it) }
    is JsonObject -> value.entries.joinToString("；") { (key, item) -> "$key：${formatFactValue(item)}" }
}

internal fun analysisGeneratorLabel(generator: String): String = when (generator) {
    "android_llm" -> "你配置的模型服务"
    "deterministic_fallback" -> "手机本地规则评估"
    else -> "手机端评估"
}

internal fun planVerdictLabel(verdict: String): String = when (verdict) {
    "reasonable" -> "安排基本合理"
    "needs_adjustment" -> "建议调整"
    "insufficient_data" -> "数据不足"
    else -> "待确认"
}

internal fun questionTypeLabel(type: String): String = when (type) {
    "concept_check" -> "概念检查"
    "diagnostic" -> "诊断题"
    "reflection" -> "反思题"
    else -> "评估题"
}

internal fun learningAnalysisWarningLabel(code: String): String = when (code) {
    "llm_fallback_http_401_403" -> "模型服务拒绝认证，请检查 API Key 与账号权限"
    "llm_fallback_http_404" -> "模型接口或模型不存在，请检查 Base URL 与模型 ID"
    "llm_fallback_http_429" -> "模型服务限流或额度不足，请稍后重试或检查额度"
    "llm_fallback_http_other" -> "模型服务拒绝本次请求，请检查模型 ID 与服务兼容性"
    "llm_fallback_timeout_network" -> "连接模型服务超时或网络不可用"
    "llm_fallback_response_non_json" -> "模型返回内容不是可识别的 JSON"
    "llm_fallback_response_truncated" -> "模型输出达到长度上限，内容被截断；本次已使用手机本地评估"
    "llm_fallback_output_root_shape" -> "模型返回的 JSON 顶层不是对象"
    "llm_fallback_output_answer_guard" -> "模型返回内容包含不允许保存的答案字段"
    "llm_fallback_output_schema" -> "模型返回的分析字段缺失或类型不正确"
    "llm_fallback_output_constraints" -> "模型返回的分析内容超出安全范围"
    "llm_fallback_output_task_binding" -> "模型生成的测试题无法可靠绑定当前计划"
    "llm_fallback_output_protocol" -> "模型分析未通过本地同步协议校验"
    "llm_fallback_output_validation" -> "模型返回的分析结构不符合安全要求"
    "llm_fallback_request_too_large" -> "学习记录过多，未发送给模型；本次使用手机本地评估"
    "learning_time_is_not_mastery_evidence" -> "学习时长只作为投入证据，不代表已经掌握"
    "no_reliable_today_plan" -> "今天没有可识别的计划；分析已使用历史记录补充判断"
    "weekly_goal_success_criteria_missing" -> "部分周目标缺少可验证的成功标准"
    "assessment_draft_not_counted_toward_mastery" -> "测试草稿不会直接计入掌握度"
    "cross_day_session_uses_proportional_split" -> "跨日专注会话已按日期比例计算"
    else -> code
}
