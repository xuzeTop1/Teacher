package com.hxz.alerttime.app.data.sync

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * The local-only provenance written when a user accepts a Teacher proposal.
 *
 * This is deliberately separate from the wire DTOs: it contains local Room
 * primary keys and must never be restored from a backup or treated as a
 * server-authoritative record.
 */
@Serializable
data class ProposalSourceMappingDocument(
    val version: Int,
    val entries: List<ProposalSourceMappingDto>
)

@Serializable
data class ProposalSourceMappingDto(
    val proposalId: String,
    val weeklyGoalLocalIds: List<Long>,
    val taskLocalIds: List<Long>
)

/** Reverse indexes used only while building one Room-consistent snapshot. */
data class ProposalSourceIndexes(
    val weeklyGoalByLocalId: Map<Long, String>,
    val taskByLocalId: Map<Long, String>
)

object ProposalSourceMappingCodec {
    const val VERSION = 1
    const val MAX_ENTRIES = 200
    const val MAX_LOCAL_IDS_PER_ENTRY = 100
    const val MAX_TOTAL_LOCAL_IDS = 20_000
    const val MAX_ENCODED_CHARS = 1_000_000
    const val KEY = "sync_proposal_sources_v1"

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = false
        explicitNulls = true
        encodeDefaults = true
        coerceInputValues = false
    }

    /**
     * Any malformed, duplicated, or over-limit setting is treated as having
     * no provenance. This is fail-closed for attribution and never blocks a
     * normal snapshot or sync.
     */
    fun decodeOrEmpty(raw: String?): List<ProposalSourceMappingDto> {
        if (raw.isNullOrBlank()) return emptyList()
        if (raw.length > MAX_ENCODED_CHARS) return emptyList()
        return runCatching {
            val document = json.decodeFromString(ProposalSourceMappingDocument.serializer(), raw)
            validate(document)
            document.entries
        }.getOrDefault(emptyList())
    }

    fun encode(entries: List<ProposalSourceMappingDto>): String {
        val document = ProposalSourceMappingDocument(VERSION, entries)
        validate(document)
        return json.encodeToString(ProposalSourceMappingDocument.serializer(), document).also {
            require(it.length <= MAX_ENCODED_CHARS) { "proposal source mapping size limit exceeded" }
        }
    }

    fun indexesOrEmpty(raw: String?, existingWeeklyGoalIds: Set<Long>, existingTaskIds: Set<Long>): ProposalSourceIndexes {
        val entries = decodeOrEmpty(raw)
        val weekly = mutableMapOf<Long, String>()
        val tasks = mutableMapOf<Long, String>()
        entries.forEach { entry ->
            entry.weeklyGoalLocalIds.forEach { id ->
                if (id in existingWeeklyGoalIds) weekly[id] = entry.proposalId
            }
            entry.taskLocalIds.forEach { id ->
                if (id in existingTaskIds) tasks[id] = entry.proposalId
            }
        }
        return ProposalSourceIndexes(weeklyGoalByLocalId = weekly, taskByLocalId = tasks)
    }

    private fun validate(document: ProposalSourceMappingDocument) {
        require(document.version == VERSION) { "unsupported proposal source mapping version" }
        require(document.entries.size <= MAX_ENTRIES) { "proposal source mapping entry limit exceeded" }
        val totalLocalIds = document.entries.sumOf {
            it.weeklyGoalLocalIds.size + it.taskLocalIds.size
        }
        require(totalLocalIds <= MAX_TOTAL_LOCAL_IDS) { "proposal source mapping local id limit exceeded" }

        val proposalIds = mutableSetOf<String>()
        val weeklyIds = mutableSetOf<Long>()
        val taskIds = mutableSetOf<Long>()
        document.entries.forEach { entry ->
            require(SyncCodec.isPlausibleId(entry.proposalId)) { "invalid proposal source id" }
            require(proposalIds.add(entry.proposalId)) { "duplicate proposal source id" }
            require(entry.weeklyGoalLocalIds.size <= MAX_LOCAL_IDS_PER_ENTRY) {
                "weekly goal source id limit exceeded"
            }
            require(entry.taskLocalIds.size <= MAX_LOCAL_IDS_PER_ENTRY) {
                "task source id limit exceeded"
            }
            require(entry.weeklyGoalLocalIds.all { it > 0 }) { "invalid weekly goal local id" }
            require(entry.taskLocalIds.all { it > 0 }) { "invalid task local id" }
            require(entry.weeklyGoalLocalIds.size == entry.weeklyGoalLocalIds.toSet().size) {
                "duplicate weekly goal source id within entry"
            }
            require(entry.taskLocalIds.size == entry.taskLocalIds.toSet().size) {
                "duplicate task source id within entry"
            }
            entry.weeklyGoalLocalIds.forEach { id ->
                require(weeklyIds.add(id)) { "duplicate weekly goal source id across entries" }
            }
            entry.taskLocalIds.forEach { id ->
                require(taskIds.add(id)) { "duplicate task source id across entries" }
            }
        }
    }
}
