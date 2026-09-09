package com.hxz.alerttime.app.ui.sync

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.hxz.alerttime.app.data.assessment.AppSettingLearnerContextStore
import com.hxz.alerttime.app.data.assessment.AppSettingLocalLearningAnalysisStore
import com.hxz.alerttime.app.data.assessment.LearningAnalysisRepository
import com.hxz.alerttime.app.data.assessment.LearningAnalysisService
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.core.usage.AppUsageExternalAiReader
import com.hxz.alerttime.app.core.usage.AppUsageReader
import com.hxz.alerttime.app.data.llm.AppSettingLlmProviderSettingsStore
import com.hxz.alerttime.app.data.llm.AssessmentLlmKeyStore
import com.hxz.alerttime.app.data.llm.LlmTimeoutPolicy
import com.hxz.alerttime.app.data.llm.OpenAiCompatibleClient
import com.hxz.alerttime.app.data.sync.SyncCoordinator
import com.hxz.alerttime.app.data.sync.DeterministicLearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.SyncPairingStore
import com.hxz.alerttime.app.data.sync.SyncProposalDto
import com.hxz.alerttime.app.data.sync.SyncProposalStore
import com.hxz.alerttime.app.data.sync.SyncServerInfo
import com.hxz.alerttime.app.data.sync.SyncSnapshotBuilder
import com.hxz.alerttime.app.data.sync.SubjectExamTag
import com.hxz.alerttime.app.data.sync.SubjectExamTagStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TeacherSyncUiState(
    val paired: Boolean = false,
    val serverInfo: SyncServerInfo? = null,
    val lastSyncAt: Long? = null,
    val proposals: List<SyncProposalDto> = emptyList(),
    val operationRunning: Boolean = false,
    val successMessage: String? = null,
    val errorMessage: String? = null,
    /** 科目考试体系标签（可选；只用于同步上报与展示，不参与本地学习统计） */
    val subjectTags: List<SubjectTagEntry> = emptyList()
)

data class SubjectTagEntry(
    val remoteId: String,
    val name: String,
    val tag: SubjectExamTag? = null
)

class TeacherSyncViewModel(
    private val coordinator: SyncCoordinator,
    private val pairingStore: SyncPairingStore,
    private val proposalStore: SyncProposalStore,
    private val examTagStore: SubjectExamTagStore,
    private val database: AlertTimeDatabase
) : ViewModel() {

    private val _uiState = MutableStateFlow(TeacherSyncUiState())
    val uiState: StateFlow<TeacherSyncUiState> = _uiState.asStateFlow()

    init {
        refreshState()
        refreshSubjectTags()
    }

    /** 刷新配对状态、最后同步时间与建议列表（不发起网络请求）。 */
    fun refreshState() {
        viewModelScope.launch {
            val serverInfo = pairingStore.loadServerInfo()
            val credentialOk = pairingStore.loadCredential() != null
            _uiState.update {
                it.copy(
                    paired = serverInfo != null && credentialOk,
                    serverInfo = serverInfo,
                    lastSyncAt = pairingStore.lastSyncAt(),
                    proposals = proposalStore.proposals()
                )
            }
        }
    }

    /** 扫码结果回调：取消扫码静默处理；成功进入配对流程（token 只走内存）。 */
    fun pairWithScanResult(contents: String?) {
        when (val outcome = ScanResultBoundary.classify(contents)) {
            is ScanOutcome.Cancelled -> Unit // 用户取消扫码不报错
            is ScanOutcome.ReadyToPair -> pairWithQrText(outcome.qrText)
        }
    }

    /** 配对（二维码已解析并确认）。 */
    fun pairWithQrText(qrText: String) {
        if (_uiState.value.operationRunning) return
        _uiState.update { it.copy(operationRunning = true, errorMessage = null) }
        viewModelScope.launch {
            runCatching { coordinator.pair(qrText) }
                .onSuccess {
                    refreshState()
                    _uiState.update {
                        it.copy(
                            operationRunning = false,
                            successMessage = "配对成功，可以开始同步"
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(operationRunning = false, errorMessage = error.userMessage())
                    }
                }
        }
    }

    /** UI 层错误（如相机权限被拒绝）显示为状态错误。 */
    fun reportError(message: String) {
        _uiState.update { it.copy(errorMessage = message) }
    }

    /** 立即同步：上报快照 → 拉取建议 → 上传决策。 */
    fun syncNow() {
        if (_uiState.value.operationRunning) return
        _uiState.update { it.copy(operationRunning = true, errorMessage = null) }
        viewModelScope.launch {
            runCatching { coordinator.syncNow() }
                .onSuccess { outcome ->
                    refreshState()
                    _uiState.update {
                        it.copy(
                            operationRunning = false,
                            successMessage = formatSyncSuccessMessage(outcome)
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(operationRunning = false, errorMessage = error.userMessage())
                    }
                }
        }
    }

    /** 用户明确采纳：原子创建周目标与计划（幂等）。 */
    fun acceptProposal(proposal: SyncProposalDto) {
        if (_uiState.value.operationRunning) return
        _uiState.update { it.copy(operationRunning = true, errorMessage = null) }
        viewModelScope.launch {
            runCatching { proposalStore.acceptProposal(proposal) }
                .onSuccess { created ->
                    refreshState()
                    _uiState.update {
                        it.copy(
                            operationRunning = false,
                            successMessage = if (created) {
                                "已采纳建议，周目标与计划已创建（下次同步会上报决策）"
                            } else {
                                "该建议已处理过，未重复创建"
                            }
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(operationRunning = false, errorMessage = error.userMessage())
                    }
                }
        }
    }

    /** 用户明确拒绝：不创建任何业务数据。 */
    fun rejectProposal(proposal: SyncProposalDto) {
        if (_uiState.value.operationRunning) return
        _uiState.update { it.copy(operationRunning = true, errorMessage = null) }
        viewModelScope.launch {
            runCatching { proposalStore.rejectProposal(proposal) }
                .onSuccess {
                    refreshState()
                    _uiState.update {
                        it.copy(operationRunning = false, successMessage = "已拒绝该建议（下次同步会上报决策）")
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(operationRunning = false, errorMessage = error.userMessage())
                    }
                }
        }
    }

    /**
     * 安全解除配对：先在服务端撤销当前凭据（确认成功后清除本地状态）。
     * 网络不可用时显示明确错误，不假装已撤销。
     */
    fun unpair() {
        if (_uiState.value.operationRunning) return
        _uiState.update { it.copy(operationRunning = true, errorMessage = null) }
        viewModelScope.launch {
            runCatching { coordinator.unpair() }
                .onSuccess {
                    _uiState.update {
                        it.copy(
                            operationRunning = false,
                            paired = false,
                            serverInfo = null,
                            lastSyncAt = null,
                            proposals = emptyList(),
                            successMessage = "已安全解除配对（服务端凭据已撤销）"
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(operationRunning = false, errorMessage = error.userMessage())
                    }
                }
        }
    }

    /** 仅忘记本地配对：不撤销服务端凭据（UI 必须展示风险警告）。 */
    fun forgetLocalPairing() {
        if (_uiState.value.operationRunning) return
        _uiState.update { it.copy(operationRunning = true, errorMessage = null) }
        viewModelScope.launch {
            runCatching { coordinator.forgetLocalPairing() }
                .onSuccess {
                    _uiState.update {
                        it.copy(
                            operationRunning = false,
                            paired = false,
                            serverInfo = null,
                            lastSyncAt = null,
                            proposals = emptyList(),
                            successMessage = "已忘记本地配对（服务端凭据仍然有效）"
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(operationRunning = false, errorMessage = error.userMessage())
                    }
                }
        }
    }

    fun clearMessages() {
        _uiState.update { it.copy(successMessage = null, errorMessage = null) }
    }

    // ── 科目考试体系标签（可选） ────────────────────────────────────

    /** 加载科目列表与现有标签（供「已映射计划可显示考试组/课程信息」）。 */
    fun refreshSubjectTags() {
        viewModelScope.launch {
            val subjects = runCatching { database.subjectDao().exportAll() }.getOrElse { return@launch }
            val tags = examTagStore.all()
            _uiState.update {
                it.copy(
                    subjectTags = subjects.map { subject ->
                        SubjectTagEntry(
                            remoteId = subject.remoteId ?: "",
                            name = subject.name,
                            tag = subject.remoteId?.let { remoteId -> tags[remoteId] }
                        )
                    }
                )
            }
        }
    }

    /** 保存科目考试标签（合法输入校验；空字符串视为清除）。 */
    fun saveSubjectTag(remoteId: String, trackId: String, subjectId: String, moduleId: String?) {
        if (remoteId.isBlank()) return
        viewModelScope.launch {
            if (trackId.isBlank() || subjectId.isBlank()) {
                examTagStore.clear(remoteId)
            } else {
                examTagStore.save(
                    remoteId,
                    SubjectExamTag(
                        examTrackId = trackId.trim(),
                        examSubjectId = subjectId.trim(),
                        examModuleId = moduleId?.trim()?.takeIf { it.isNotEmpty() }
                    )
                )
            }
            refreshSubjectTags()
        }
    }

    class Factory(private val database: AlertTimeDatabase, private val context: Context) :
        ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            val appSettingDao = database.appSettingDao()
            val pairingStore = SyncPairingStore(appSettingDao)
            val proposalStore = SyncProposalStore(database, appSettingDao)
            val examTagStore = SubjectExamTagStore(appSettingDao)
            val llmProviderStore = AppSettingLlmProviderSettingsStore(
                appSettingDao,
                AssessmentLlmKeyStore()
            )
            val learnerContextStore = AppSettingLearnerContextStore(appSettingDao)
            val learningAnalysisService = LearningAnalysisService(
                providerStore = llmProviderStore,
                learnerContextStore = learnerContextStore,
                // 同步链路的分析不应被慢/卡住的 Provider 阻塞数分钟：用有界时限，超时后降级为确定性生成。
                llmClient = OpenAiCompatibleClient(timeoutPolicy = LlmTimeoutPolicy.SYNC_ANALYSIS)
            )
            // 外部 AI App 时长：仅在 UsageStats 授权时返回非 null，未授权保持 unknown。
            val externalAiReader = AppUsageExternalAiReader(
                AppUsageReader(context.applicationContext)
            )
            val analysisRepository = LearningAnalysisRepository(
                buildSnapshot = SyncSnapshotBuilder(database, examTagStore, externalAiReader)::buildSnapshot,
                analysisGenerator = learningAnalysisService,
                fallbackGenerator = DeterministicLearningAnalysisGenerator(),
                localStore = AppSettingLocalLearningAnalysisStore(appSettingDao),
                learnerContextStore = learnerContextStore
            )
            val coordinator = SyncCoordinator(
                pairingStore = pairingStore,
                proposalStore = proposalStore,
                learningAnalysisRepository = analysisRepository
            )
            return TeacherSyncViewModel(
                coordinator,
                pairingStore,
                proposalStore,
                examTagStore,
                database
            ) as T
        }
    }
}

private fun Throwable.userMessage(): String {
    // 服务端错误已脱敏；本地校验错误不包含 token / credential。
    return message ?: "同步失败，请重试"
}
