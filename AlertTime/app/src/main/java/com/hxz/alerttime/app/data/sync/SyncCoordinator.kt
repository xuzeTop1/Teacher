package com.hxz.alerttime.app.data.sync

import android.util.Log
import com.hxz.alerttime.app.data.assessment.LearningAnalysisRepository
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * 同步协调器：配对、立即同步、解除配对。
 *
 * - 独立 Mutex 串行化同步操作；不调用 BackupRepository 的任何恢复/合并逻辑。
 * - 网络失败不删除、不覆盖本地数据（同步从不写业务表，除用户明确采纳外）。
 * - 所有步骤可安全重试：snapshotId 幂等、决策幂等、采纳幂等。
 * - 配对一次性 token 只在内存中使用，绝不持久化。
 */
class SyncCoordinator(
    private val pairingStore: SyncPairingStore,
    private val proposalStore: SyncProposalStore,
    private val learningAnalysisRepository: LearningAnalysisRepository
) {
    data class SyncOutcome(
        val snapshotId: String,
        val subjects: Int,
        val weeklyGoals: Int,
        val tasks: Int,
        val studySessions: Int,
        val proposalsReceived: Int,
        val decisionsSent: Int,
        val decisionsPending: Int,
        val analysisGenerator: String,
        val planVerdict: String,
        val planScore: Double?,
        val assessmentQuestionCount: Int,
        val analysisWarnings: List<String>
    )

    data class PairOutcome(
        val deviceId: String,
        val displayName: String
    )

    // ── 配对 ────────────────────────────────────────────────────────


    /**
     * 使用一次性 token 配对；成功后保存服务信息与设备凭据（Keystore 加密）。
     * token 只存在于本方法调用栈中。
     *
     * 重新配对安全语义：
     * - 已有配对时先安全撤销旧凭据（服务端确认后才继续），否则拒绝配对；
     * - 绝不把旧 credential 发送给新服务器；
     * - 新配对保存失败时清除已写的一半状态，不允许形成混合状态。
     */
    suspend fun pair(qrText: String): PairOutcome = operationMutex.withLock {
        if (pairingStore.hasPairing()) {
            // 先撤销旧凭据；网络不可用时不假装已撤销。
            revokeExistingPairingOrThrow()
            pairingStore.clearAll()
        }

        val qr = parsePairingQr(qrText)
        val client = SyncHttpClient(qr.host, qr.port, qr.pin)
        val ownerIdentity = pairingStore.loadOrCreateOwnerIdentity().ownerId
        val body = SyncCodec.encodePair(
            SyncPairPayload(
                token = qr.token,
                deviceId = qr.deviceId,
                ownerIdentity = ownerIdentity
            )
        )
        val response = withContextIo { client.postJson("/v1/pair", body) }
        // 校验响应 messageType=pairAck 且 deviceId 与请求一致。
        val ack = SyncCodec.decodePairAck(response, expectedDeviceId = qr.deviceId)

        // 配对成功后换发设备凭据；服务信息 + 密文持久化。
        val now = System.currentTimeMillis()
        pairingStore.saveServerInfo(
            SyncServerInfo(
                host = qr.host,
                port = qr.port,
                pin = qr.pin,
                deviceId = ack.deviceId,
                pairedAtMs = now
            )
        )
        try {
            pairingStore.saveCredential(ack.credential)
        } catch (error: Exception) {
            // 服务端已消费 token 并登记设备：凭据保存失败后，本机无法再持有该凭据，
            // 必须用内存中的 credential 尽力在服务端撤销，避免留下孤立设备记录。
            runCatching {
                withContextIo { client.postJson("/v1/unpair", "{}", ack.credential) }
            }.onFailure { revokeError ->
                Log.w(TAG, "failed to revoke orphan device after credential save failure: ${revokeError.message}")
            }
            // 不允许用旧凭据访问新服务器；清掉已写的一半状态。
            pairingStore.clearAll()
            throw SyncValidationException("保存新设备凭据失败，已取消本次配对：${error.message}")
        }
        // 不保留旧 Teacher 的 proposal / 决策 / 已处理标记。
        proposalStore.clearPairingRuntimeState()
        Log.i(TAG, "paired device=${ack.deviceId.take(8)}")
        PairOutcome(deviceId = ack.deviceId, displayName = ack.displayName)
    }

    /**
     * 安全解除配对：先用当前 Bearer 凭据在服务端撤销自己，确认成功后清除本地状态。
     * 网络不可用时不得假装已撤销。
     */
    suspend fun unpair() = operationMutex.withLock {
        revokeExistingPairingOrThrow()
        pairingStore.clearAll()
    }

    /**
     * 仅忘记本地配对（风险提示由 UI 展示）：不清除服务端凭据。
     * 旧凭据在 TeacherAgent 服务端仍然有效，只能用于再次同步或等待服务端撤销。
     */
    suspend fun forgetLocalPairing() = operationMutex.withLock {
        pairingStore.clearAll()
    }

    private suspend fun revokeExistingPairingOrThrow() {
        val serverInfo = pairingStore.loadServerInfo() ?: return
        val credential = pairingStore.loadCredential() ?: return
        val client = SyncHttpClient(serverInfo.host, serverInfo.port, serverInfo.pin)
        val response = try {
            withContextIo { client.postJson("/v1/unpair", "{}", credential) }
        } catch (error: Exception) {
            throw SyncValidationException(
                "无法连接 TeacherAgent 撤销旧凭据（${error.message}）。" +
                    "请在网络可用时重试，或在 TeacherAgent 设备列表中手工撤销；也可以选择「仅忘记本地配对」" +
                    "（注意：旧凭据在服务端仍有效）。"
            )
        }
        SyncCodec.decodeUnpairAck(response, expectedDeviceId = serverInfo.deviceId)
    }

    // ── 立即同步 ────────────────────────────────────────────────────

    /**
     * 完整同步流程（可安全重试）：
     * 1. 一致快照 → 2. 上传 → 3. 拉取 proposal → 4. 上传待处理决策。
     */
    suspend fun syncNow(): SyncOutcome = operationMutex.withLock {
        val serverInfo = pairingStore.loadServerInfo()
            ?: throw SyncValidationException("尚未配对，请先扫描二维码配对")
        val credential = pairingStore.loadCredential()
            ?: throw SyncValidationException("设备凭据缺失，请重新配对")

        val client = SyncHttpClient(serverInfo.host, serverInfo.port, serverInfo.pin)

        // 1) 先冻结本次幂等 ID，再构建一致快照和同一次分析，保证 analysis.sourceSnapshotId
        // 与 envelope.snapshotId 永远相同。LLM/Provider 失败由服务降级；即使服务本身异常，
        // 协调器仍会生成 deterministic_fallback，不让分析缺失阻断同步。
        // 输入未变时仓库会复用上一次「快照 ID + 分析」（prepared.snapshotId 变为旧 ID），
        // 桌面端按 snapshotId 幂等确认，本次同步不再等待模型服务。
        val freshSnapshotId = SyncSnapshotBuilder.newUuid()
        // 在任何桌面网络请求之前生成并保存到手机。即使 TeacherAgent 当前不可达，
        // 本次分析仍可在“学习分析与模型设置”中查看；以后重试同步会再生成新分析。
        val (prepared, ackResponse) = prepareSnapshotBeforeFirstNetworkRequest(
            snapshotId = freshSnapshotId,
            learningAnalysisRepository = learningAnalysisRepository
        ) { preparedSnapshot ->
            // 2) 沿用既有 HTTPS、证书 pin、Bearer 凭据和 snapshot ack 校验路径上传。
            val snapshotBody = SyncCodec.encodeSnapshot(
                serverInfo.deviceId,
                preparedSnapshot.snapshotId,
                preparedSnapshot.payload
            )
            withContextIo { client.postJson("/v1/snapshots", snapshotBody, credential) }
        }
        val snapshot = prepared.payload
        val snapshotId = prepared.snapshotId
        // 校验响应 messageType=snapshotAck、deviceId 与 snapshotId 关联。
        val ack = SyncCodec.decodeSnapshotAck(
            text = ackResponse,
            expectedDeviceId = serverInfo.deviceId,
            expectedSnapshotId = snapshotId,
            expectedEntityCounts = SyncEntityCounts(
                subjects = snapshot.subjects.size,
                weeklyGoals = snapshot.weeklyGoals.size,
                tasks = snapshot.tasks.size,
                studySessions = snapshot.studySessions.size
            )
        )

        // 3) 分页拉取 proposal（只展示，不自动创建）。所有页面先校验并聚合，
        // 中间任何一页失败都不会触发本地 merge。
        val proposals = fetchAllProposalPages(
            expectedDeviceId = serverInfo.deviceId,
            maxProposals = SyncProposalStore.MAX_STORED_PROPOSALS
        ) { cursor ->
            val path = proposalPath(cursor)
            val response = withContextIo { client.getJson(path, credential) }
            SyncCodec.decodeProposalsResponse(response, serverInfo.deviceId)
        }
        proposalStore.mergeFromServer(proposals)

        // 4) 上传待处理决策（服务端幂等；成功后才从本地待发列表移除）。
        val decisions = proposalStore.pendingDecisions()
        val sentIds = mutableSetOf<String>()
        for (decision in decisions) {
            try {
                val decisionBody = SyncCodec.encodeDecision(serverInfo.deviceId, decision)
                val ackText = withContextIo {
                    client.postJson("/v1/proposal-decisions", decisionBody, credential)
                }
                SyncCodec.decodeDecisionAck(
                    text = ackText,
                    expectedDeviceId = serverInfo.deviceId,
                    expectedProposalId = decision.proposalId,
                    expectedDecision = decision.decision
                )
                sentIds += decision.proposalId
            } catch (_: Exception) {
                // 单个决策失败不阻断其余同步；保留待发列表下次重试。
                Log.w(TAG, "decision push failed; retained for retry")
            }
        }
        if (sentIds.isNotEmpty()) {
            proposalStore.dropSentDecisions(sentIds)
        }

        pairingStore.markSyncedAt(System.currentTimeMillis())

        Log.i(
            TAG,
            "sync ok snapshot=${snapshotId.take(8)} subjects=${ack.entityCounts.subjects} " +
                "goals=${ack.entityCounts.weeklyGoals} tasks=${ack.entityCounts.tasks} " +
                "sessions=${ack.entityCounts.studySessions} proposals=${proposals.size} " +
                "decisions=$sentIds"
        )
        SyncOutcome(
            snapshotId = snapshotId,
            subjects = ack.entityCounts.subjects,
            weeklyGoals = ack.entityCounts.weeklyGoals,
            tasks = ack.entityCounts.tasks,
            studySessions = ack.entityCounts.studySessions,
            proposalsReceived = proposals.size,
            decisionsSent = sentIds.size,
            decisionsPending = decisions.size - sentIds.size,
            analysisGenerator = requireNotNull(snapshot.learningAnalysis).generator,
            planVerdict = snapshot.learningAnalysis.planEvaluation.verdict,
            planScore = snapshot.learningAnalysis.planEvaluation.score,
            assessmentQuestionCount = snapshot.learningAnalysis.assessmentDraft.questions.size,
            analysisWarnings = snapshot.learningAnalysis.warnings
        )
    }

    private suspend fun <T> withContextIo(block: () -> T): T {
        return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { block() }
    }

    companion object {
        private const val TAG = "AlertTimeSync"
        /** ViewModel 重建或多入口并发时仍保证整个进程只有一个配对/同步操作。 */
        private val operationMutex = Mutex()

        /** 桌面端二维码只下发 IPv4/主机名；显式排除路径、userinfo 与查询成分。 */
        private val QR_HOST_PATTERN = Regex("^[A-Za-z0-9.-]{1,253}$")

        /**
         * 解析并校验二维码内容（不持久化 token）。纯函数，无 Android 依赖，便于单元测试。
         * 二维码字段全部为 URL 安全字符（IPv4 / hex / base64url / UUID），无需解码。
         */
        fun parsePairingQr(qrText: String, nowMs: Long = System.currentTimeMillis()): PairingQrInfo {
            val text = qrText.trim()
            val scheme = "ta-sync://v1?"
            if (!text.startsWith(scheme)) {
                throw SyncValidationException("不是有效的 TeacherAgent 配对二维码")
            }
            val params = text.substring(scheme.length)
                .split('&')
                .mapNotNull { part ->
                    val index = part.indexOf('=')
                    if (index <= 0) null else part.substring(0, index) to part.substring(index + 1)
                }
                .toMap()
            val host = params["host"]
            val port = params["port"]?.toIntOrNull()
            val pin = params["pin"]
            val token = params["token"]
            val expiresAt = params["expiresAt"]?.toLongOrNull()
            val deviceId = params["deviceId"]
            if (host.isNullOrBlank() || port == null || pin.isNullOrBlank() ||
                token.isNullOrBlank() || expiresAt == null || deviceId.isNullOrBlank()
            ) {
                throw SyncValidationException("配对二维码信息不完整")
            }
            // host 会直接拼进 https URL；只允许 IPv4/主机名字符，
            // 防止损坏或恶意二维码注入路径、userinfo 或查询成分。
            if (!QR_HOST_PATTERN.matches(host)) {
                throw SyncValidationException("配对二维码主机地址非法")
            }
            if (nowMs > expiresAt) {
                throw SyncValidationException("配对二维码已过期，请在 TeacherAgent 重新生成")
            }
            return PairingQrInfo(host, port, pin, token, expiresAt, deviceId)
        }
    }
}

/**
 * 构造 proposal 查询路径。cursor 必须先经过 SyncCodec 的 plausible 校验，随后才进入
 * URL query component 编码；首屏不带 query 参数。
 */
internal fun proposalPath(cursor: String?): String {
    if (cursor == null) return "/v1/proposals"
    if (!SyncCodec.isPlausibleId(cursor)) {
        throw SyncValidationException("proposal cursor 不合法")
    }
    return "/v1/proposals?cursor=${URLEncoder.encode(cursor, Charsets.UTF_8.name())}"
}

/**
 * 拉取并验证完整 proposal 分页，但不触碰本地 store。
 *
 * 返回值是本次同步实际拉到的、按服务端最新到最旧顺序排列的唯一 proposal。
 * 调用方必须在函数成功返回后再执行一次 mergeFromServer，从而保证中间页失败时
 * 本地不会部分覆盖。maxProposals 与 SyncProposalStore 的缓存上限保持同一来源。
 */
internal suspend fun fetchAllProposalPages(
    expectedDeviceId: String,
    maxProposals: Int = SyncProposalStore.MAX_STORED_PROPOSALS,
    fetchPage: suspend (cursor: String?) -> SyncProposalsListPayload
): List<SyncProposalDto> {
    require(expectedDeviceId.isNotBlank()) { "expectedDeviceId must not be blank" }
    require(maxProposals > 0) { "maxProposals must be positive" }

    val aggregated = ArrayList<SyncProposalDto>(minOf(maxProposals, SyncProtocol.MAX_PROPOSALS))
    val seenProposalIds = HashSet<String>()
    val requestedCursors = HashSet<String>()
    var cursor: String? = null

    while (true) {
        if (cursor != null && !requestedCursors.add(cursor)) {
            throw SyncValidationException("proposal cursor 循环")
        }

        val page = fetchPage(cursor)
        SyncCodec.validateProposalsResponse(page, expectedDeviceId)

        if (page.proposals.isEmpty()) {
            // SyncCodec 已要求空页 nextCursor=null；这里保留显式守卫，防止未来校验拆分时
            // 空页把编排器带入无限循环。
            if (page.nextCursor != null) {
                throw SyncValidationException("proposal 空页不能继续分页")
            }
            return aggregated
        }

        for (proposal in page.proposals) {
            if (!seenProposalIds.add(proposal.proposalId)) {
                throw SyncValidationException("跨 proposal 分页发现重复 proposalId")
            }
        }
        if (aggregated.size > maxProposals - page.proposals.size) {
            throw SyncValidationException("proposal 总数超过本地缓存上限")
        }
        aggregated += page.proposals

        if (aggregated.size >= maxProposals) {
            // 已达到明确本地上限，不再信任服务端继续提供无限页；当前页已经完整纳入。
            return aggregated
        }

        val nextCursor = page.nextCursor ?: return aggregated
        if (nextCursor == cursor || nextCursor in requestedCursors) {
            throw SyncValidationException("proposal cursor 不前进或发生循环")
        }
        cursor = nextCursor
    }
}

/**
 * 严格保证“先保存手机分析，再发第一个桌面请求”。回调抛出网络错误时不回滚本地分析，
 * 同步调用仍按失败返回，不能误写 lastSyncAt 或伪造成功。
 */
internal suspend fun <T> prepareSnapshotBeforeFirstNetworkRequest(
    snapshotId: String,
    learningAnalysisRepository: LearningAnalysisRepository,
    firstNetworkRequest: suspend (LearningAnalysisRepository.PreparedSyncSnapshot) -> T
): Pair<LearningAnalysisRepository.PreparedSyncSnapshot, T> {
    val prepared = learningAnalysisRepository.prepareForSync(snapshotId)
    SyncCodec.validateSnapshotForId(prepared.payload, prepared.snapshotId)
    return prepared to firstNetworkRequest(prepared)
}

/**
 * 为一次同步准备不可分离的「快照 + 学习分析」。该函数不访问网络，也不写业务表；
 * 单元测试通过注入 lambda 验证 snapshotId 生成后的调用顺序和失败降级。
 */
internal suspend fun prepareAnalyzedSnapshot(
    snapshotId: String,
    buildSnapshot: suspend () -> SyncSnapshotPayload,
    analysisGenerator: LearningAnalysisGenerator,
    fallbackGenerator: LearningAnalysisGenerator
): SyncSnapshotPayload {
    require(snapshotId.isNotBlank()) { "snapshotId must not be blank" }
    // Room 快照仍由 SnapshotBuilder 按其事务/调度规则完成；只把可能遍历大集合的
    // 确定性聚合、最小上下文编码和协议自检移出 Main。Provider 网络调用内部另切 IO。
    val basePayload = buildSnapshot().copy(learningAnalysis = null)
    suspend fun generateValidated(generator: LearningAnalysisGenerator): SyncLearningAnalysisDto {
        return withContext(Dispatchers.Default) {
            val candidate = generator.generate(snapshotId, basePayload)
            SyncCodec.validateSnapshotForId(basePayload.copy(learningAnalysis = candidate), snapshotId)
            candidate
        }
    }
    val analysis = runCatching { generateValidated(analysisGenerator) }
        .getOrElse { generateValidated(fallbackGenerator) }
    return basePayload.copy(learningAnalysis = analysis).also {
        // fallback 也必须 fail-closed；非法 fallback 不得被上传。
        SyncCodec.validateSnapshotForId(it, snapshotId)
    }
}
