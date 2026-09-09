package com.hxz.alerttime.app.ui.assessment

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hxz.alerttime.app.data.llm.LlmProviderSettings
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.sync.SyncLearningAnalysisDto
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun LearningAnalysisDialogHost(
    database: AlertTimeDatabase,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val viewModel: LearningAnalysisViewModel = viewModel(
        factory = LearningAnalysisViewModel.Factory(database, context.applicationContext)
    )
    // Dialog 关闭后 ViewModel 可能仍由 Activity 保留；每次重新打开都重新读取最近分析与设置。
    LaunchedEffect(viewModel) { viewModel.refresh() }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    LearningAnalysisDialog(
        state = state,
        onSaveContext = viewModel::saveLearnerContext,
        onSaveProvider = viewModel::saveProvider,
        onDisableProvider = viewModel::disableProvider,
        onGenerate = viewModel::generateNow,
        onDismiss = onDismiss
    )
}

@Composable
internal fun LearningAnalysisDialog(
    state: LearningAnalysisUiState,
    onSaveContext: (String, String, String, String) -> Unit,
    onSaveProvider: (LlmProviderForm) -> Unit,
    onDisableProvider: () -> Unit,
    onGenerate: () -> Unit,
    onDismiss: () -> Unit
) {
    var contextDirty by remember { mutableStateOf(false) }
    var providerDirty by remember { mutableStateOf(false) }
    val hasUnsavedDrafts = contextDirty || providerDirty
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("学习分析与模型设置") },
        text = {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .heightIn(max = 520.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    "无需连接 TeacherAgent。你可以随时在手机生成并保存学习画像、计划评估和测试草稿；" +
                        "以后连接桌面时，同步会生成并携带一份新的分析。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                state.successMessage?.let {
                    Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
                }
                state.errorMessage?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }

                LearnerContextSection(state, onSaveContext, onDirtyChanged = { contextDirty = it })
                HorizontalDivider()
                ProviderSection(
                    state,
                    onSaveProvider,
                    onDisableProvider,
                    onDirtyChanged = { providerDirty = it }
                )
                HorizontalDivider()

                if (hasUnsavedDrafts) {
                    Text(
                        "设置有未保存修改，请先保存后再生成，确保本次分析使用你当前填写的内容。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }

                Button(
                    onClick = onGenerate,
                    enabled = canGenerateLearningAnalysis(state, hasUnsavedDrafts),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (state.generating) {
                        CircularProgressIndicator(
                            modifier = Modifier.width(16.dp).height(16.dp),
                            strokeWidth = 2.dp
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(if (state.latestAnalysis == null) "在手机生成学习分析" else "更新手机学习分析")
                }
                Text(
                    "生成时会发送全部未删除的科目、周目标、计划和已结束专注会话；不会发送日记、会话 note、API Key、应用设置或任何本地/远程 ID。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    "点击后才会调用你配置的模型服务；未配置或调用失败时使用手机本地规则。" +
                        "结果是建议与草稿，不会自动修改计划或掌握度。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                state.latestAnalysis?.let { LearningAnalysisResult(it) }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("完成") }
        }
    )
}

@Composable
private fun LearnerContextSection(
    state: LearningAnalysisUiState,
    onSave: (String, String, String, String) -> Unit,
    onDirtyChanged: (Boolean) -> Unit
) {
    val context = state.learnerContext
    var purpose by remember(context) { mutableStateOf(context.purpose) }
    var examName by remember(context) { mutableStateOf(context.examName) }
    var subjects by remember(context) { mutableStateOf(context.focusSubjects.joinToString("、")) }
    var targetDate by remember(context) { mutableStateOf(context.targetDate) }
    val dirty = purpose.trim() != context.purpose ||
        examName.trim() != context.examName ||
        parseFocusSubjects(subjects) != context.focusSubjects ||
        targetDate.trim() != context.targetDate
    LaunchedEffect(dirty) { onDirtyChanged(dirty) }
    val enabled = canEditLearningAnalysisSettings(state)

    Text("你的学习目标", fontWeight = FontWeight.SemiBold)
    Text(
        "全部由你填写，应用不预设你在准备什么考试。这些字段会进入评估 Prompt。",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
    // 两两并排压缩纵向高度；所有节点仍在组合树内（仪器测试依赖滚动可达）。
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = purpose,
            onValueChange = { purpose = it },
            label = { Text("学习目的（如：考研）") },
            singleLine = true,
            enabled = enabled,
            modifier = Modifier.weight(1f)
        )
        OutlinedTextField(
            value = examName,
            onValueChange = { examName = it },
            label = { Text("考试名称（可选）") },
            singleLine = true,
            enabled = enabled,
            modifier = Modifier.weight(1f)
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = subjects,
            onValueChange = { subjects = it },
            label = { Text("重点科目") },
            supportingText = { Text("多个科目用逗号、顿号或换行分隔") },
            enabled = enabled,
            modifier = Modifier.weight(1.4f)
        )
        OutlinedTextField(
            value = targetDate,
            onValueChange = { targetDate = it },
            label = { Text("目标日期（YYYY-MM-DD）") },
            singleLine = true,
            enabled = enabled,
            modifier = Modifier.weight(1f)
        )
    }
    OutlinedButton(
        onClick = { onSave(purpose, examName, subjects, targetDate) },
        enabled = enabled
    ) {
        if (state.savingLearnerContext) {
            CircularProgressIndicator(
                modifier = Modifier.width(16.dp).height(16.dp),
                strokeWidth = 2.dp
            )
            Spacer(Modifier.width(8.dp))
        }
        Text(if (state.savingLearnerContext) "正在保存" else "保存学习目标")
    }
}

@Composable
private fun ProviderSection(
    state: LearningAnalysisUiState,
    onSave: (LlmProviderForm) -> Unit,
    onDisable: () -> Unit,
    onDirtyChanged: (Boolean) -> Unit
) {
    val provider = state.provider
    var baseUrl by remember(provider.baseUrl) { mutableStateOf(provider.baseUrl) }
    var model by remember(provider.model) { mutableStateOf(provider.model) }
    var authMode by remember(provider.authMode) { mutableStateOf(provider.authMode) }
    var apiKey by remember { mutableStateOf("") }
    var localValidationError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(provider.savedVersion) {
        apiKey = ""
        localValidationError = null
        onDirtyChanged(false)
    }
    val form = LlmProviderForm(baseUrl, model, authMode, apiKey)
    val dirty = isProviderDraftDirty(form, provider)
    LaunchedEffect(dirty) { onDirtyChanged(dirty) }
    val enabled = canEditLearningAnalysisSettings(state)
    val providerError = localValidationError ?: state.providerErrorMessage

    Text("你自己的模型服务（可选）", fontWeight = FontWeight.SemiBold)
    Text(
        "应用不内置默认 Provider、模型或公共密钥。只有保存并启用后，主动生成/同步才会请求该地址。",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
    OutlinedTextField(
        value = baseUrl,
        onValueChange = { baseUrl = it; localValidationError = null },
        label = { Text("Base URL") },
        supportingText = { Text("OpenAI-compatible 服务地址（如 https://api.deepseek.com 或 https://api.moonshot.cn/v1）；带密钥时使用 HTTPS") },
        singleLine = true,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().testTag("learning-analysis-provider-base-url")
    )
    OutlinedTextField(
        value = model,
        onValueChange = { model = it; localValidationError = null },
        label = { Text("模型名称") },
        singleLine = true,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().testTag("learning-analysis-provider-model")
    )
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("认证方式", style = MaterialTheme.typography.labelMedium)
        AuthModeButton(
            selected = authMode == LlmProviderSettings.AUTH_MODE_BEARER,
            text = "Bearer",
            onClick = {
                authMode = LlmProviderSettings.AUTH_MODE_BEARER
                localValidationError = null
            },
            enabled = enabled,
            modifier = Modifier.weight(1f).testTag("learning-analysis-auth-bearer")
        )
        AuthModeButton(
            selected = authMode == LlmProviderSettings.AUTH_MODE_API_KEY,
            text = "api-key",
            onClick = {
                authMode = LlmProviderSettings.AUTH_MODE_API_KEY
                localValidationError = null
            },
            enabled = enabled,
            modifier = Modifier.weight(1f).testTag("learning-analysis-auth-api-key")
        )
        AuthModeButton(
            selected = authMode == LlmProviderSettings.AUTH_MODE_NONE,
            text = "无认证",
            onClick = {
                apiKey = ""
                authMode = LlmProviderSettings.AUTH_MODE_NONE
                localValidationError = null
            },
            enabled = enabled,
            modifier = Modifier.weight(1f).testTag("learning-analysis-auth-none")
        )
    }
    if (authMode == LlmProviderSettings.AUTH_MODE_NONE) {
        Text(
            "无认证模式仅适合你信任的本地服务；HTTP 不加密，且不会携带任何 API Key。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.tertiary
        )
    } else {
        OutlinedTextField(
            value = apiKey,
            onValueChange = { apiKey = it; localValidationError = null },
            label = { Text(if (provider.hasStoredApiKey) "API Key（已保存，可留空）" else "API Key") },
            supportingText = { Text("由 Android Keystore 保护，不会回填、同步或写入备份") },
            singleLine = true,
            enabled = enabled,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth().testTag("learning-analysis-provider-api-key")
        )
    }
    providerError?.let {
        Text(
            it,
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("learning-analysis-provider-error")
        )
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(
            onClick = {
                val validationError = validateLlmProviderForm(form, provider.hasStoredApiKey)
                if (validationError != null) {
                    localValidationError = validationError
                } else {
                    localValidationError = null
                    onSave(form)
                }
            },
            enabled = enabled,
            modifier = Modifier.fillMaxWidth().testTag("learning-analysis-provider-save")
        ) {
            Text(if (provider.enabled) "保存设置" else "保存并启用")
        }
        if (provider.enabled || provider.hasStoredApiKey) {
            OutlinedButton(onClick = onDisable, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                Text("停用并删除 Key")
            }
        }
        if (provider.saving) {
            CircularProgressIndicator(
                modifier = Modifier.width(16.dp).height(16.dp),
                strokeWidth = 2.dp
            )
        }
    }
}

@Composable
private fun AuthModeButton(
    selected: Boolean,
    text: String,
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    if (selected) {
        Button(onClick = onClick, enabled = enabled, modifier = modifier) {
            Text(text, maxLines = 1)
        }
    } else {
        OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier) {
            Text(text, maxLines = 1)
        }
    }
}

@Composable
private fun LearningAnalysisResult(analysis: SyncLearningAnalysisDto) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        HorizontalDivider()
        Text("最近一次手机分析", fontWeight = FontWeight.SemiBold)
        Text(
            "${formatAnalysisTime(analysis.generatedAt)} · ${analysisGeneratorLabel(analysis.generator)}",
            style = MaterialTheme.typography.bodySmall
        )
        analysis.inputSummary?.let { summary ->
            Text("本次分析实际纳入范围", fontWeight = FontWeight.Medium)
            Text(
                "同一次快照已纳入：科目 ${summary.subjectCount} 个、周目标 ${summary.weeklyGoalCount} 个、" +
                    "计划 ${summary.taskCount} 个、已结束专注会话 ${summary.completedSessionCount} 个。" +
                    "不含已删除记录和进行中会话。",
                style = MaterialTheme.typography.bodySmall
            )
        }
        Text(
            "计划结论：${planVerdictLabel(analysis.planEvaluation.verdict)}" +
                analysis.planEvaluation.score?.let { "（${it.toInt()} 分）" }.orEmpty(),
            fontWeight = FontWeight.Medium
        )

        if (analysis.profile.facts.isNotEmpty()) {
            Text("画像事实", fontWeight = FontWeight.Medium)
            analysis.profile.facts.forEach { fact ->
                Text("· ${fact.label}：${formatFactValue(fact.value)}", style = MaterialTheme.typography.bodySmall)
            }
        }
        if (analysis.profile.inferences.isNotEmpty()) {
            Text("谨慎推断", fontWeight = FontWeight.Medium)
            analysis.profile.inferences.forEach { inference ->
                Text(
                    "· ${inference.statement}（置信度 ${(inference.confidence * 100).toInt()}%）",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
        analysis.planEvaluation.dimensions.forEach { dimension ->
            Text(
                "· ${dimension.summary}${dimension.score?.let { "（${it.toInt()} 分）" }.orEmpty()}",
                style = MaterialTheme.typography.bodySmall
            )
        }
        if (analysis.planEvaluation.risks.isNotEmpty()) {
            Text("风险", fontWeight = FontWeight.Medium)
            analysis.planEvaluation.risks.forEach { Text("· $it", style = MaterialTheme.typography.bodySmall) }
        }
        if (analysis.planEvaluation.suggestions.isNotEmpty()) {
            Text("建议", fontWeight = FontWeight.Medium)
            analysis.planEvaluation.suggestions.forEach { Text("· $it", style = MaterialTheme.typography.bodySmall) }
        }

        Text("评估测试草稿", fontWeight = FontWeight.Medium)
        Text(analysis.assessmentDraft.scopeSummary, style = MaterialTheme.typography.bodySmall)
        analysis.assessmentDraft.questions.forEachIndexed { index, question ->
            Text(
                "${index + 1}. [${questionTypeLabel(question.type)}] ${question.prompt}",
                style = MaterialTheme.typography.bodyMedium
            )
            Text("用途：${question.rationale}", style = MaterialTheme.typography.bodySmall)
            if (question.rubric.isNotEmpty()) {
                Text("检查要点：${question.rubric.joinToString("；")}", style = MaterialTheme.typography.bodySmall)
            }
        }
        Text(
            "测试草稿不含答案，完成情况不会自动更新掌握度。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        analysis.warnings.forEach { warning ->
            Text(
                "· ${learningAnalysisWarningLabel(warning)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.tertiary
            )
        }
    }
}

private fun formatAnalysisTime(value: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).format(Date(value))
