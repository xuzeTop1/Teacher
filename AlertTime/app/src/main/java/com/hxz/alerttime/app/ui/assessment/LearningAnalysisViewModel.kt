package com.hxz.alerttime.app.ui.assessment

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.hxz.alerttime.app.core.usage.AppUsageExternalAiReader
import com.hxz.alerttime.app.core.usage.AppUsageReader
import com.hxz.alerttime.app.data.assessment.AppSettingLearnerContextStore
import com.hxz.alerttime.app.data.assessment.AppSettingLocalLearningAnalysisStore
import com.hxz.alerttime.app.data.assessment.LearnerContext
import com.hxz.alerttime.app.data.assessment.LearningAnalysisRepository
import com.hxz.alerttime.app.data.assessment.LearningAnalysisService
import com.hxz.alerttime.app.data.llm.AppSettingLlmProviderSettingsStore
import com.hxz.alerttime.app.data.llm.AssessmentLlmKeyStore
import com.hxz.alerttime.app.data.llm.LlmProviderSettingsSummary
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.sync.DeterministicLearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.SubjectExamTagStore
import com.hxz.alerttime.app.data.sync.SyncLearningAnalysisDto
import com.hxz.alerttime.app.data.sync.SyncSnapshotBuilder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

data class LearningAnalysisUiState(
    val learnerContext: LearnerContext = LearnerContext(),
    val provider: LlmProviderConfigUiState = LlmProviderConfigUiState(),
    val latestAnalysis: SyncLearningAnalysisDto? = null,
    val loading: Boolean = true,
    val savingLearnerContext: Boolean = false,
    val generating: Boolean = false,
    val successMessage: String? = null,
    val errorMessage: String? = null,
    val providerErrorMessage: String? = null
)

class LearningAnalysisViewModel(
    private val contextStore: AppSettingLearnerContextStore,
    private val providerStore: AppSettingLlmProviderSettingsStore,
    private val analysisRepository: LearningAnalysisRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(LearningAnalysisUiState())
    val uiState: StateFlow<LearningAnalysisUiState> = _uiState.asStateFlow()
    private var refreshJob: Job? = null

    init {
        refresh()
    }

    fun refresh() {
        if (refreshJob?.isActive == true) return
        if (!canRefreshLearningAnalysis(_uiState.value)) return
        _uiState.update { it.copy(loading = true) }
        refreshJob = viewModelScope.launch {
            val context = runCatching { contextStore.load() }.getOrDefault(LearnerContext())
            val provider = runCatching { providerStore.loadSummary() }.getOrDefault(LlmProviderSettingsSummary())
            val latest = runCatching { analysisRepository.loadLatest() }.getOrNull()
            _uiState.update { state ->
                state.copy(
                    learnerContext = context,
                    provider = state.provider.copy(
                        enabled = provider.enabled,
                        baseUrl = provider.baseUrl,
                        model = provider.model,
                        authMode = provider.authMode,
                        hasStoredApiKey = provider.hasStoredApiKey,
                        saving = false
                    ),
                    latestAnalysis = latest,
                    providerErrorMessage = providerModelValidationError(provider.model),
                    loading = false
                )
            }
        }
    }

    fun saveLearnerContext(
        purpose: String,
        examName: String,
        focusSubjectsText: String,
        targetDate: String
    ) {
        val current = _uiState.value
        if (!canEditLearningAnalysisSettings(current)) return
        // 先同步关闭“生成”入口，避免保存协程尚未落库时生成读到旧学习目标。
        _uiState.update {
            it.copy(savingLearnerContext = true, errorMessage = null, successMessage = null)
        }
        viewModelScope.launch {
            runCatching {
                contextStore.save(
                    purpose = purpose,
                    examName = examName,
                    focusSubjects = parseFocusSubjects(focusSubjectsText),
                    targetDate = targetDate
                )
            }.onSuccess { saved ->
                _uiState.update {
                    it.copy(
                        learnerContext = saved,
                        savingLearnerContext = false,
                        successMessage = "学习目标已保存在手机；下次生成时会写入评估 Prompt",
                        errorMessage = null
                    )
                }
            }.onFailure { error ->
                _uiState.update {
                    it.copy(
                        savingLearnerContext = false,
                        errorMessage = error.message ?: "保存学习目标失败",
                        successMessage = null
                    )
                }
            }
        }
    }

    fun saveProvider(form: LlmProviderForm) {
        val state = _uiState.value
        if (!canEditLearningAnalysisSettings(state)) return
        val current = state.provider
        validateLlmProviderForm(form, current.hasStoredApiKey)?.let {
            _uiState.update { state ->
                state.copy(errorMessage = null, providerErrorMessage = it, successMessage = null)
            }
            return
        }
        _uiState.update {
            it.copy(
                provider = current.copy(saving = true),
                errorMessage = null,
                providerErrorMessage = null
            )
        }
        viewModelScope.launch {
            runCatching {
                providerStore.save(
                    baseUrl = form.baseUrl,
                    model = form.model,
                    authMode = form.authMode,
                    apiKey = form.apiKey
                )
            }
                .onSuccess { summary ->
                    _uiState.update { state ->
                        state.copy(
                            provider = state.provider.copy(
                                enabled = summary.enabled,
                                baseUrl = summary.baseUrl,
                                model = summary.model,
                                authMode = summary.authMode,
                                hasStoredApiKey = summary.hasStoredApiKey,
                                saving = false,
                                savedVersion = state.provider.savedVersion + 1
                            ),
                            providerErrorMessage = null,
                            successMessage = "已启用你自己的模型服务；应用没有内置默认 Provider",
                            errorMessage = null
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            provider = it.provider.copy(saving = false),
                            errorMessage = null,
                            providerErrorMessage = providerSettingsErrorMessage(error),
                            successMessage = null
                        )
                    }
                }
        }
    }

    fun disableProvider() {
        val state = _uiState.value
        if (!canEditLearningAnalysisSettings(state)) return
        val current = state.provider
        _uiState.update {
            it.copy(
                provider = current.copy(saving = true),
                errorMessage = null,
                providerErrorMessage = null
            )
        }
        viewModelScope.launch {
            runCatching { providerStore.disable() }
                .onSuccess { summary ->
                    _uiState.update { state ->
                        state.copy(
                            provider = state.provider.copy(
                                enabled = summary.enabled,
                                baseUrl = summary.baseUrl,
                                model = summary.model,
                                authMode = summary.authMode,
                                hasStoredApiKey = summary.hasStoredApiKey,
                                saving = false,
                                savedVersion = state.provider.savedVersion + 1
                            ),
                            providerErrorMessage = null,
                            successMessage = "模型服务已停用，API Key 已删除；仍可使用手机本地规则评估",
                            errorMessage = null
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            provider = it.provider.copy(saving = false),
                            errorMessage = null,
                            providerErrorMessage = "停用模型服务失败",
                            successMessage = null
                        )
                    }
                }
        }
    }

    /** 无需配对、无需桌面在线；Provider 不可用时服务会安全回退。 */
    fun generateNow() {
        if (!canGenerateLearningAnalysis(_uiState.value)) return
        _uiState.update { it.copy(generating = true, errorMessage = null, successMessage = null) }
        viewModelScope.launch {
            runCatching { analysisRepository.generateNow() }
                .onSuccess { analysis ->
                    _uiState.update {
                        it.copy(
                            generating = false,
                            latestAnalysis = analysis,
                            successMessage = "学习画像、计划评估和测试草稿已保存在手机"
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            generating = false,
                            errorMessage = error.message ?: "生成学习分析失败"
                        )
                    }
                }
        }
    }

    fun clearMessages() {
        _uiState.update { it.copy(successMessage = null, errorMessage = null) }
    }

    class Factory(
        private val database: AlertTimeDatabase,
        private val context: Context
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            val appSettingDao = database.appSettingDao()
            val providerStore = AppSettingLlmProviderSettingsStore(appSettingDao, AssessmentLlmKeyStore())
            val learnerContextStore = AppSettingLearnerContextStore(appSettingDao)
            val analysisService = LearningAnalysisService(providerStore, learnerContextStore)
            val snapshotBuilder = SyncSnapshotBuilder(
                database = database,
                examTagStore = SubjectExamTagStore(appSettingDao),
                externalAiUsageReader = AppUsageExternalAiReader(AppUsageReader(context.applicationContext))
            )
            val repository = LearningAnalysisRepository(
                buildSnapshot = snapshotBuilder::buildSnapshot,
                analysisGenerator = analysisService,
                fallbackGenerator = DeterministicLearningAnalysisGenerator(),
                localStore = AppSettingLocalLearningAnalysisStore(appSettingDao),
                learnerContextStore = learnerContextStore
            )
            return LearningAnalysisViewModel(learnerContextStore, providerStore, repository) as T
        }
    }
}
