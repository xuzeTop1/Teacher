package com.hxz.alerttime.app.data.sync

import androidx.room.withTransaction
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.dao.AppSettingDao
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import com.hxz.alerttime.app.data.local.entity.WeeklyGoalEntity
import com.hxz.alerttime.app.core.StatusCodes
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Proposal 本地存储与原子采纳。
 *
 * - 建议稿列表：AppSetting JSON（非敏感，TeacherAgent 是唯一权威来源，本端只做镜像与状态覆盖）。
 * - 采纳：在【单个 Room 事务】中创建周目标与任务，并写入「已处理 proposalId」幂等标记；
 *   崩溃重试不会重复创建。决策记录与标记在同一事务内落盘，下一次同步上传给 TeacherAgent。
 * - 拒绝：只记录决策与标记，不创建任何业务数据。
 * - 配对 token 不进入本存储。
 */
class SyncProposalStore(
    private val database: AlertTimeDatabase,
    private val appSettingDao: AppSettingDao
) {

    /** 操作级互斥：并发采纳/拒绝只能有一个执行（配合事务内幂等判定）。 */
    private val operationMutex = Mutex()

    suspend fun proposals(): List<SyncProposalDto> {
        return SyncCodec.decodeStoredProposalList(appSettingDao.getSetting(KEY_PROPOSALS)?.value)
    }

    /** 服务端下发合并：以服务端状态为准，按 proposalId 去重。 */
    suspend fun mergeFromServer(incoming: List<SyncProposalDto>): List<SyncProposalDto> =
        operationMutex.withLock {
            database.withTransaction {
                val merged = LinkedHashMap<String, SyncProposalDto>()
                for (proposal in incoming) {
                    merged[proposal.proposalId] = proposal
                }
                // 本地已有但服务端未返回的建议保留（离线容错），但状态以服务端为准。
                val localProposals = SyncCodec.decodeStoredProposalList(
                    appSettingDao.getSetting(KEY_PROPOSALS)?.value
                )
                for (local in localProposals) {
                    val serverVersion = merged[local.proposalId]
                    if (serverVersion == null) {
                        merged[local.proposalId] = local
                    } else {
                        merged[local.proposalId] = serverVersion
                    }
                }
                val list = merged.values.sortedByDescending { it.createdAt }
                saveList(list)
                return@withTransaction list
            }
        }

    suspend fun pendingDecisions(): List<SyncProposalDecisionPayload> {
        val raw = appSettingDao.getSetting(KEY_PENDING_DECISIONS)?.value
        if (raw.isNullOrBlank()) return emptyList()
        return runCatching {
            SyncCodec.decodeStringList(raw).map { line ->
                kotlinx.serialization.json.Json.decodeFromString(
                    SyncProposalDecisionPayload.serializer(),
                    line
                )
            }
        }.getOrDefault(emptyList())
    }

    suspend fun dropSentDecisions(proposalIds: Set<String>) = operationMutex.withLock {
        database.withTransaction {
            val remaining = pendingDecisions().filter { it.proposalId !in proposalIds }
            saveDecisions(remaining)
        }
    }

    private suspend fun saveDecisions(decisions: List<SyncProposalDecisionPayload>) {
        val json = kotlinx.serialization.json.Json
        val lines = decisions.map { json.encodeToString(SyncProposalDecisionPayload.serializer(), it) }
        appSettingDao.upsert(
            AppSettingEntity(
                key = KEY_PENDING_DECISIONS,
                value = SyncCodec.encodeStringList(lines),
                updatedAt = System.currentTimeMillis()
            )
        )
    }

    suspend fun processedProposalIds(): List<String> {
        return SyncCodec.decodeStringList(appSettingDao.getSetting(KEY_PROCESSED_PROPOSAL_IDS)?.value)
    }

    /** Local-only proposal provenance; malformed settings fail closed to no attribution. */
    suspend fun sourceMappings(): List<ProposalSourceMappingDto> {
        return ProposalSourceMappingCodec.decodeOrEmpty(
            appSettingDao.getSetting(ProposalSourceMappingCodec.KEY)?.value
        )
    }

    // ── 重新配对前的运行时状态清理 ─────────────────────────────────

    suspend fun clearProposals() {
        appSettingDao.delete(KEY_PROPOSALS)
    }

    suspend fun clearPendingDecisions() {
        appSettingDao.delete(KEY_PENDING_DECISIONS)
    }

    suspend fun clearProcessedProposalIds() {
        appSettingDao.delete(KEY_PROCESSED_PROPOSAL_IDS)
    }

    /** 清除全部 proposal 运行时状态（重新配对前调用；不删除任何业务数据）。 */
    suspend fun clearPairingRuntimeState() = operationMutex.withLock {
        database.withTransaction {
            appSettingDao.delete(KEY_PROPOSALS)
            appSettingDao.delete(KEY_PENDING_DECISIONS)
            appSettingDao.delete(KEY_PROCESSED_PROPOSAL_IDS)
            appSettingDao.delete(ProposalSourceMappingCodec.KEY)
        }
    }

    /**
     * 原子采纳：单个事务内创建周目标与任务 + 写入已处理标记 + 记录决策 + 更新本地状态。
     *
     * 幂等与并发保证：
     * - 操作级 Mutex 串行化 accept/reject，并发点击只能创建一次；
     * - 「是否已处理」的读取与写入在同一个 Room 事务内；
     * - 崩溃/重启重试不会重复创建（标记与创建同事务）；
     * - 已过期（expiresAt < now）的建议不得采纳；
     * - 非法科目引用整批回滚，不写任何行。
     * @throws SyncValidationException 引用不存在的手机科目或建议已过期时整批拒绝
     */
    suspend fun acceptProposal(proposal: SyncProposalDto): Boolean = operationMutex.withLock {
        val created = database.withTransaction {
            val now = System.currentTimeMillis()
            if (proposal.status != "pending") {
                return@withTransaction false
            }
            // 「是否已处理」读取必须进入同一事务（幂等判定的权威来源）。
            val processed = readProcessedIds()
            val decisions = pendingDecisions()
            val sourceMappings = readSourceMappings()
            if (proposal.proposalId in processed || decisions.any { it.proposalId == proposal.proposalId }) {
                // 幂等：已经处理过（可能是崩溃后重试），不重复创建。
                return@withTransaction false
            }
            if (isExpired(proposal, now)) {
                throw SyncValidationException("该建议已过期，无法采纳")
            }

            val userId = AlertTimeDatabase.ensureLocalUserId(database)

            // 校验：建议任务引用的科目必须存在于当前手机科目中（按 remote_id）。
            val localSubjects = database.subjectDao().getActiveSubjectsForProposal(userId)
            val remoteToLocal = localSubjects.associate { it.remoteId to it.id }
            for (task in proposal.proposedTasks) {
                val subjectRemoteId = task.subjectRemoteId
                if (subjectRemoteId != null && remoteToLocal[subjectRemoteId] == null) {
                    throw SyncValidationException(
                        "建议引用的科目（$subjectRemoteId）不是当前用户的未删除未归档科目，已拒绝整批采纳"
                    )
                }
            }

            // 1) 创建周目标（只创建，不自动完成）。
            val createdWeeklyGoalIds = mutableListOf<Long>()
            for (goal in proposal.proposedWeeklyGoals) {
                createdWeeklyGoalIds += database.weeklyGoalDao().insert(
                    WeeklyGoalEntity(
                        userId = userId,
                        weekStart = goal.weekStart,
                        title = goal.title,
                        successCriteria = goal.successCriteria,
                        status = StatusCodes.WEEKLY_GOAL_TODO,
                        createdAt = now,
                        updatedAt = now
                    )
                )
            }

            // 2) 创建计划任务（type=1，未完成；采纳不自动完成任务）。
            val createdTaskIds = mutableListOf<Long>()
            proposal.proposedTasks.forEachIndexed { index, task ->
                createdTaskIds += database.taskDao().upsert(
                    TaskEntity(
                        userId = userId,
                        subjectId = task.subjectRemoteId?.let { remoteToLocal[it] },
                        title = task.title,
                        type = StatusCodes.TYPE_PLAN,
                        status = StatusCodes.TASK_TODO,
                        targetDurationSeconds = task.targetDurationSeconds,
                        dueAt = task.dueAt,
                        sortOrder = index,
                        createdAt = now,
                        updatedAt = now
                    )
                )
            }

            // 3) 记录本次实际创建的本地行来源（同一事务）。
            if (createdWeeklyGoalIds.isNotEmpty() || createdTaskIds.isNotEmpty()) {
                val nextSources = (sourceMappings.filterNot { it.proposalId == proposal.proposalId } +
                    ProposalSourceMappingDto(
                        proposalId = proposal.proposalId,
                        weeklyGoalLocalIds = createdWeeklyGoalIds,
                        taskLocalIds = createdTaskIds
                    )).takeLast(MAX_SOURCE_MAPPINGS)
                saveSourceMappings(nextSources, now)
            }

            // 4) 写入「已处理 proposalId」幂等标记（同一事务），并限制缓存长度。
            val nextProcessed = (processed + proposal.proposalId).takeLast(MAX_PROCESSED_IDS)
            appSettingDao.upsert(
                AppSettingEntity(
                    key = KEY_PROCESSED_PROPOSAL_IDS,
                    value = SyncCodec.encodeStringList(nextProcessed),
                    updatedAt = now
                )
            )

            // 5) 记录待上传决策（同一事务）。
            val decision = SyncProposalDecisionPayload(
                proposalId = proposal.proposalId,
                decision = "accepted",
                decidedAt = now
            )
            saveDecisions(decisions.filter { it.proposalId != proposal.proposalId } + decision)

            // 6) 更新本地建议状态（同一事务）。
            updateLocalStatus(proposal.proposalId, "accepted", now)
            return@withTransaction true
        }
        created
    }

    /** 拒绝：只记录决策与标记，不创建任何业务数据（幂等与并发规则同采纳）。 */
    suspend fun rejectProposal(proposal: SyncProposalDto): Boolean = operationMutex.withLock {
        val recorded = database.withTransaction {
            val now = System.currentTimeMillis()
            if (proposal.status != "pending") {
                return@withTransaction false
            }
            val processed = readProcessedIds()
            val decisions = pendingDecisions()
            if (proposal.proposalId in processed || decisions.any { it.proposalId == proposal.proposalId }) {
                return@withTransaction false
            }
            if (isExpired(proposal, now)) {
                throw SyncValidationException("该建议已过期，无法处理")
            }
            appSettingDao.upsert(
                AppSettingEntity(
                    key = KEY_PROCESSED_PROPOSAL_IDS,
                    value = SyncCodec.encodeStringList((processed + proposal.proposalId).takeLast(MAX_PROCESSED_IDS)),
                    updatedAt = now
                )
            )
            val decision = SyncProposalDecisionPayload(
                proposalId = proposal.proposalId,
                decision = "rejected",
                decidedAt = now
            )
            saveDecisions(decisions.filter { it.proposalId != proposal.proposalId } + decision)
            updateLocalStatus(proposal.proposalId, "rejected", now)
            return@withTransaction true
        }
        recorded
    }

    /** 建议是否已过期（expiresAt 非空且早于当前时间）。 */
    fun isExpired(proposal: SyncProposalDto, nowMs: Long): Boolean {
        val expiresAt = proposal.expiresAt ?: return false
        return expiresAt < nowMs
    }

    private suspend fun updateLocalStatus(proposalId: String, status: String, now: Long) {
        val updated = proposals().map { proposal ->
            if (proposal.proposalId == proposalId) proposal.copy(status = status) else proposal
        }
        saveList(updated)
    }

    private suspend fun saveList(proposals: List<SyncProposalDto>) {
        // 缓存列表设上限，防止无限增长。
        val capped = proposals.take(MAX_STORED_PROPOSALS)
        appSettingDao.upsert(
            AppSettingEntity(
                key = KEY_PROPOSALS,
                value = SyncCodec.encodeStoredProposalList(capped),
                updatedAt = System.currentTimeMillis()
            )
        )
    }

    /** 事务内读取「已处理 proposalId」列表（幂等判定的权威来源）。 */
    private suspend fun readProcessedIds(): List<String> {
        return SyncCodec.decodeStringList(appSettingDao.getSetting(KEY_PROCESSED_PROPOSAL_IDS)?.value)
    }

    /** Transaction-local read. Invalid provenance is ignored so ordinary sync stays usable. */
    private suspend fun readSourceMappings(): List<ProposalSourceMappingDto> {
        return ProposalSourceMappingCodec.decodeOrEmpty(
            appSettingDao.getSetting(ProposalSourceMappingCodec.KEY)?.value
        )
    }

    private suspend fun saveSourceMappings(
        mappings: List<ProposalSourceMappingDto>,
        now: Long
    ) {
        appSettingDao.upsert(
            AppSettingEntity(
                key = ProposalSourceMappingCodec.KEY,
                value = ProposalSourceMappingCodec.encode(mappings),
                updatedAt = now
            )
        )
    }

    companion object {
        const val KEY_PROPOSALS = "sync_proposals_v1"
        const val KEY_PENDING_DECISIONS = "sync_pending_decisions_v1"
        const val KEY_PROCESSED_PROPOSAL_IDS = "sync_processed_proposal_ids_v1"

        /** 本地建议缓存上限。 */
        const val MAX_STORED_PROPOSALS = 100

        /** 已处理 proposalId 标记上限（超出后丢弃最旧的）。 */
        const val MAX_PROCESSED_IDS = 200

        /** Source mappings are bounded independently from the proposal cache. */
        const val MAX_SOURCE_MAPPINGS = ProposalSourceMappingCodec.MAX_ENTRIES
    }
}
