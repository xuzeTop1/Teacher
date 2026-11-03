package com.hxz.alerttime.app.ui.assessment

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import com.hxz.alerttime.app.ui.components.FormCaption
import com.hxz.alerttime.app.ui.components.FormScrollColumn
import com.hxz.alerttime.app.ui.components.FormSection
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
            // 只保留滚动、不叠加 heightIn：高度上限交给 Material3 的 AlertDialog 自身约束。
            // 嵌套的受限滚动列会把超出部分的子项压成 0 高度（实测保存按钮 t==b），导致按钮不可点。
            FormScrollColumn {
                FormCaption(
                    "无需连接 TeacherAgent。你可以随时在手机生成并保存学习画像、计划评估和测试草稿；" +
                        "以后连接桌面时，同步会生成并携带一份新的分析。"
                )
                state.successMessage?.let {
                    FormCaption(it, color = MaterialTheme.colorScheme.primary)
                }
                state.errorMessage?.let {
                    FormCaption(it, color = MaterialTheme.colorScheme.error)
                }

                LearnerContextSection(state, onSaveContext, onDirtyChanged = { contextDirty = it })

                ProviderSection(
                    state,
                    onSaveProvider,
                    onDisableProvider,
                    onDirtyChanged = { providerDirty = it }
                )

                FormSection(title = "生成手机学习分析") {
                    if (hasUnsavedDrafts) {
                        FormCaption(
                            "设置有未保存修改，请先保存后再生成，确保本次分析使用你当前填写的内容。",
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
                    FormCaption(
                        "生成时会发送全部未删除的科目、周目标、计划和已结束专注会话；" +
                            "不会发送日记、会话 note、API Key、应用设置或任何本地/远程 ID。"
                    )
                    FormCaption(
                        "点击后才会调用你配置的模型服务；未配置或调用失败时使用手机本地规则。" +
                            "结果是建议与草稿，不会自动修改计划或掌握度。"
                    )
                }

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

    // 字段一律整行排布：并排时「重点科目」的多行 supporting 会把同一行的另一个字段
    // 拉出高度差，长标签还会被压成两行盖住输入框（实测目标日期标签换行重叠）。
    FormSection(
        title = "你的学习目标",
        caption = "全部由你填写，应用不预设你在准备什么考试。这些字段会进入评估 Prompt。"
    ) {
        OutlinedTextField(
            value = purpose,
            onValueChange = { purpose = it },
            label = { Text("学习目的") },
            supportingText = { Text("如：考研") },
            singleLine = true,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = examName,
            onValueChange = { examName = it },
            label = { Text("考试名称") },
            supportingText = { Text("可选") },
            singleLine = true,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = subjects,
            onValueChange = { subjects = it },
            label = { Text("重点科目") },
            supportingText = { Text("多个科目用逗号、顿号或换行分隔") },
            enabled = enabled,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = targetDate,
            onValueChange = { targetDate = it },
            label = { Text("目标日期") },
            supportingText = { Text("YYYY-MM-DD") },
            singleLine = true,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth()
        )
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
    // 成功落库、停用服务、以及任何一次保存失败之后都清空密钥输入框（见 apiKeyClearVersion 说明）。
    // 例外：本地表单格式校验失败不清空——那类失败不涉及密钥本身，清空只会逼用户重填无关内容。
    //
    // 这里不显式调用 onDirtyChanged(false)：脏标记统一由下方 LaunchedEffect(dirty) 推导。
    // 否则清空密钥后若 baseUrl / model 仍是草稿（dirty 仍为 true），dirty 这个键没有变化，
    // LaunchedEffect(dirty) 不会重跑，就会把「设置有未保存修改」误清掉。
    LaunchedEffect(provider.apiKeyClearVersion) {
        apiKey = ""
        localValidationError = null
    }
    val form = LlmProviderForm(baseUrl, model, authMode, apiKey)
    val dirty = isProviderDraftDirty(form, provider)
    LaunchedEffect(dirty) { onDirtyChanged(dirty) }
    val enabled = canEditLearningAnalysisSettings(state)
    val providerError = localValidationError ?: state.providerErrorMessage

    FormSection(
        title = "你自己的模型服务（可选）",
        caption = "应用不内置默认 Provider、模型或公共密钥。只有保存并启用后，主动生成/同步才会请求该地址。"
    ) {
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
        Text("认证方式", style = MaterialTheme.typography.bodyMedium)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
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
            FormCaption(
                "无认证模式仅适合你信任的本地服务；HTTP 不加密，且不会携带任何 API Key。",
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
            FormCaption(
                it,
                color = MaterialTheme.colorScheme.error,
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
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("learning-analysis-provider-save")
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
}

@Composable
private fun AuthModeButton(
    selected: Boolean,
    text: String,
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    // 三等分宽度下默认 24dp 水平内边距会把「Bearer」挤到省略号，这里收紧内边距并保底高度。
    val contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp)
    if (selected) {
        Button(
            onClick = onClick,
            enabled = enabled,
            modifier = modifier.heightIn(min = 44.dp),
            contentPadding = contentPadding
        ) {
            Text(text, maxLines = 1)
        }
    } else {
        OutlinedButton(
            onClick = onClick,
            enabled = enabled,
            modifier = modifier.heightIn(min = 44.dp),
            contentPadding = contentPadding
        ) {
            Text(text, maxLines = 1)
        }
    }
}

@Composable
private fun LearningAnalysisResult(analysis: SyncLearningAnalysisDto) {
    FormSection(
        title = "最近一次手机分析",
        caption = "${formatAnalysisTime(analysis.generatedAt)} · ${analysisGeneratorLabel(analysis.generator)}"
    ) {
        analysis.inputSummary?.let { summary ->
            Text("本次分析实际纳入范围", fontWeight = FontWeight.Medium)
            FormCaption(
                "同一次快照已纳入：科目 ${summary.subjectCount} 个、周目标 ${summary.weeklyGoalCount} 个、" +
                    "计划 ${summary.taskCount} 个、已结束专注会话 ${summary.completedSessionCount} 个。" +
                    "不含已删除记录和进行中会话。"
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
                FormCaption("· ${fact.label}：${formatFactValue(fact.value)}")
            }
        }
        if (analysis.profile.inferences.isNotEmpty()) {
            Text("谨慎推断", fontWeight = FontWeight.Medium)
            analysis.profile.inferences.forEach { inference ->
                FormCaption("· ${inference.statement}（置信度 ${(inference.confidence * 100).toInt()}%）")
            }
        }
        analysis.planEvaluation.dimensions.forEach { dimension ->
            FormCaption("· ${dimension.summary}${dimension.score?.let { "（${it.toInt()} 分）" }.orEmpty()}")
        }
        if (analysis.planEvaluation.risks.isNotEmpty()) {
            Text("风险", fontWeight = FontWeight.Medium)
            analysis.planEvaluation.risks.forEach { FormCaption("· $it") }
        }
        if (analysis.planEvaluation.suggestions.isNotEmpty()) {
            Text("建议", fontWeight = FontWeight.Medium)
            analysis.planEvaluation.suggestions.forEach { FormCaption("· $it") }
        }

        Text("评估测试草稿", fontWeight = FontWeight.Medium)
        FormCaption(analysis.assessmentDraft.scopeSummary)
        // 每题一张卡片：题干与「用途 / 检查要点」原先同色同字号连排，4 道题糊成一片。
        analysis.assessmentDraft.questions.forEachIndexed { index, question ->
            Surface(
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        "${index + 1}. [${questionTypeLabel(question.type)}] ${question.prompt}",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    FormCaption("用途：${question.rationale}")
                    if (question.rubric.isNotEmpty()) {
                        FormCaption("检查要点：${question.rubric.joinToString("；")}")
                    }
                }
            }
        }
        FormCaption("测试草稿不含答案，完成情况不会自动更新掌握度。")
        analysis.warnings.forEach { warning ->
            FormCaption(
                "· ${learningAnalysisWarningLabel(warning)}",
                color = MaterialTheme.colorScheme.tertiary
            )
        }
    }
}

private fun formatAnalysisTime(value: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).format(Date(value))