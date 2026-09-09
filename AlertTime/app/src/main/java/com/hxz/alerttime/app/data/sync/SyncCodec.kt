package com.hxz.alerttime.app.data.sync

import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * 同步协议编解码与校验。规则与 TeacherAgent Rust 端（sync/protocol.rs）一致：
 * 未知字段忽略（前向兼容）；缺必需字段、类型错误、结构非法整批拒绝；
 * `format`/`schemaVersion` 不匹配整批拒绝；数据非法时不写任何行。
 */
object SyncCodec {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = false
        explicitNulls = true
        encodeDefaults = true
        coerceInputValues = false
    }
    // ── 编码 ────────────────────────────────────────────────────────

    /** 配对请求：envelope.deviceId 必须等于 payload.deviceId，messageType 必须为 pair。 */
    fun encodePair(payload: SyncPairPayload): String {
        return json.encodeToString(
            SyncEnvelopeDto.serializer(SyncPairPayload.serializer()),
            SyncEnvelopeDto(
                format = SyncProtocol.FORMAT,
                schemaVersion = SyncProtocol.SCHEMA_VERSION,
                messageType = SyncProtocol.MESSAGE_TYPE_PAIR,
                deviceId = payload.deviceId,
                generatedAt = System.currentTimeMillis(),
                protocolCapabilities = mapOf("fullSnapshotV1" to true, "proposalsV1" to true),
                payload = payload
            )
        )
    }

    fun encodeSnapshot(deviceId: String, snapshotId: String, payload: SyncSnapshotPayload): String {
        // Production snapshots must pass the same fail-closed payload gate as
        // decoded snapshots; in particular provenance is never emitted if its
        // optional ID is malformed.
        validateSnapshot(payload)
        // 隐私最小化（协议 v1）：studySession.note 是自由文本，永不上传；字段仅为
        // 向后兼容保留。出站编码在此 fail-closed，构建器误填也不会离开设备。
        if (payload.studySessions.any { it.note != null }) {
            throw SyncValidationException("studySession.note 禁止上传：v1 客户端永不发送会话笔记")
        }
        return json.encodeToString(
            SyncEnvelopeDto.serializer(SyncSnapshotPayload.serializer()),
            SyncEnvelopeDto(
                format = SyncProtocol.FORMAT,
                schemaVersion = SyncProtocol.SCHEMA_VERSION,
                messageType = SyncProtocol.MESSAGE_TYPE_SNAPSHOT,
                deviceId = deviceId,
                snapshotId = snapshotId,
                generatedAt = System.currentTimeMillis(),
                appVersion = null,
                protocolCapabilities = mapOf("fullSnapshotV1" to true, "proposalsV1" to true),
                payload = payload
            )
        )
    }

    /**
     * 解码并完整校验手机上报的快照 envelope。
     *
     * 这里必须复用本对象的 Json 配置，确保未知字段、缺失字段和类型错误的处理
     * 与其他同步协议入口一致；解析或校验失败直接向调用方抛出异常，不返回部分数据。
     */
    fun decodeSnapshotEnvelope(text: String): SyncEnvelopeDto<SyncSnapshotPayload> {
        // Inspect the raw tree before ignoreUnknownKeys can discard forbidden
        // assessment answer fields. Unrelated future fields remain compatible.
        val rawRoot = json.parseToJsonElement(text)
        val rawPayload = (rawRoot as? kotlinx.serialization.json.JsonObject)?.get("payload")
            as? kotlinx.serialization.json.JsonObject
        val rawAnalysis = rawPayload?.get("learningAnalysis")
        AssessmentAnswerLeakGuard.findForbiddenQuestionKey(rawAnalysis ?: kotlinx.serialization.json.JsonNull)
            ?.let { key ->
                throw SyncValidationException(
                    "learningAnalysis.assessmentDraft.questions 禁止答案字段：$key"
                )
            }
        val envelope = json.decodeFromJsonElement(
            SyncEnvelopeDto.serializer(SyncSnapshotPayload.serializer()),
            rawRoot
        )
        validateEnvelopeHead(
            format = envelope.format,
            schemaVersion = envelope.schemaVersion,
            messageType = envelope.messageType,
            deviceId = envelope.deviceId,
            generatedAt = envelope.generatedAt,
            appVersion = envelope.appVersion
        )
        if (envelope.messageType != SyncProtocol.MESSAGE_TYPE_SNAPSHOT) {
            throw SyncValidationException("快照 messageType 不匹配：期望 ${SyncProtocol.MESSAGE_TYPE_SNAPSHOT}")
        }
        val snapshotId = envelope.snapshotId
            ?: throw SyncValidationException("快照 snapshotId 缺失")
        if (!isPlausibleId(snapshotId)) {
            throw SyncValidationException("快照 snapshotId 非法")
        }
        validateSnapshotForId(envelope.payload, snapshotId)
        return envelope
    }

    fun encodeDecision(deviceId: String, payload: SyncProposalDecisionPayload): String {
        return json.encodeToString(
            SyncEnvelopeDto.serializer(SyncProposalDecisionPayload.serializer()),
            SyncEnvelopeDto(
                format = SyncProtocol.FORMAT,
                schemaVersion = SyncProtocol.SCHEMA_VERSION,
                messageType = SyncProtocol.MESSAGE_TYPE_PROPOSAL_DECISION,
                deviceId = deviceId,
                generatedAt = System.currentTimeMillis(),
                protocolCapabilities = mapOf("fullSnapshotV1" to true, "proposalsV1" to true),
                payload = payload
            )
        )
    }

    // ── 解码（服务端响应；校验期望 messageType 与 deviceId 关联） ──

    /** @throws SerializationException 结构非法时。 */
    fun decodePairAck(text: String, expectedDeviceId: String): SyncPairAckPayload {
        val envelope = decodeEnvelope(
            text,
            SyncPairAckPayload.serializer(),
            SyncProtocol.MESSAGE_TYPE_PAIR_ACK,
            expectedDeviceId
        )
        val payload = envelope.payload
        if (payload.deviceId != expectedDeviceId) {
            throw SyncValidationException("配对确认 payload.deviceId 与当前配对设备不匹配")
        }
        if (payload.credential.isBlank()) {
            throw SyncValidationException("配对确认 credential 不能为空")
        }
        return payload
    }

    fun decodeUnpairAck(text: String, expectedDeviceId: String): SyncUnpairAckPayload {
        val envelope = decodeEnvelope(
            text,
            SyncUnpairAckPayload.serializer(),
            SyncProtocol.MESSAGE_TYPE_UNPAIR_ACK,
            expectedDeviceId
        )
        if (!envelope.payload.revoked) {
            throw SyncValidationException("服务端未确认撤销")
        }
        return envelope.payload
    }

    fun decodeSnapshotAck(
        text: String,
        expectedDeviceId: String,
        expectedSnapshotId: String,
        expectedEntityCounts: SyncEntityCounts? = null
    ): SyncSnapshotAckPayload {
        val envelope = decodeEnvelope(
            text,
            SyncSnapshotAckPayload.serializer(),
            SyncProtocol.MESSAGE_TYPE_SNAPSHOT_ACK,
            expectedDeviceId
        )
        if (envelope.snapshotId != expectedSnapshotId) {
            throw SyncValidationException("快照确认与本次请求不匹配")
        }
        val payload = envelope.payload
        if (!payload.accepted) {
            throw SyncValidationException("服务端未接受快照")
        }
        val counts = payload.entityCounts
        if (counts.subjects < 0 || counts.weeklyGoals < 0 || counts.tasks < 0 || counts.studySessions < 0) {
            throw SyncValidationException("快照确认 entityCounts 非法")
        }
        if (expectedEntityCounts != null && counts != expectedEntityCounts) {
            throw SyncValidationException("快照确认 entityCounts 与本次请求不匹配")
        }
        return payload
    }

    fun decodeDecisionAck(
        text: String,
        expectedDeviceId: String,
        expectedProposalId: String,
        expectedDecision: String
    ): SyncDecisionAckPayload {
        val envelope = decodeEnvelope(
            text,
            SyncDecisionAckPayload.serializer(),
            SyncProtocol.MESSAGE_TYPE_DECISION_ACK,
            expectedDeviceId
        )
        if (envelope.payload.proposalId != expectedProposalId) {
            throw SyncValidationException("决策确认与本次请求不匹配")
        }
        if (envelope.payload.decision != expectedDecision) {
            throw SyncValidationException("决策确认 decision 与本次请求不匹配")
        }
        if (!envelope.payload.recorded) {
            throw SyncValidationException("服务端未确认记录决策")
        }
        return envelope.payload
    }

    fun decodeProposalsResponse(text: String, expectedDeviceId: String): SyncProposalsListPayload {
        val payload = decodeEnvelope(
            text,
            SyncProposalsListPayload.serializer(),
            SyncProtocol.MESSAGE_TYPE_PROPOSAL,
            expectedDeviceId
        ).payload
        validateProposalsResponse(payload, expectedDeviceId)
        return payload
    }

    /**
     * 校验单页 proposal 响应。分页编排也调用同一校验，避免测试注入或未来调用方
     * 绕过协议边界；所有页面通过后才允许交给本地 store 合并。
     */
    internal fun validateProposalsResponse(payload: SyncProposalsListPayload, expectedDeviceId: String) {
        val errors = mutableListOf<String>()
        if (payload.proposals.size > SyncProtocol.MAX_PROPOSALS) {
            errors += "proposals 数量超过上限"
        }
        val proposalIds = mutableSetOf<String>()
        payload.proposals.forEach { proposal ->
            if (!isPlausibleId(proposal.proposalId)) errors += "proposalId 非法"
            if (!proposalIds.add(proposal.proposalId)) errors += "proposalId 重复"
            if (proposal.deviceId != expectedDeviceId) errors += "proposal.deviceId 与当前配对设备不匹配"
            if (proposal.version < 1) errors += "proposal.version 非法"
            if (proposal.status !in setOf("pending", "accepted", "rejected", "superseded")) {
                errors += "proposal.status 不支持"
            }
            checkRequiredText(proposal.rationale, SyncProtocol.MAX_STRING_LENGTH, "proposal.rationale", errors)
            if (proposal.proposedWeeklyGoals.size > SyncProtocol.MAX_PROPOSED_WEEKLY_GOALS) {
                errors += "proposedWeeklyGoals 数量超过上限"
            }
            proposal.proposedWeeklyGoals.forEach { goal ->
                if (goal.weekStart < 0) errors += "proposedWeeklyGoal.weekStart 非法"
                checkRequiredText(goal.title, SyncProtocol.MAX_TITLE_LENGTH, "proposedWeeklyGoal.title", errors)
                goal.successCriteria?.let {
                    if (it.length > SyncProtocol.MAX_PROPOSED_SUCCESS_CRITERIA_LENGTH) {
                        errors += "proposedWeeklyGoal.successCriteria 超过长度上限"
                    }
                }
            }
            if (proposal.proposedTasks.size > SyncProtocol.MAX_PROPOSED_TASKS) {
                errors += "proposedTasks 数量超过上限"
            }
            proposal.proposedTasks.forEach { task ->
                checkRequiredText(task.title, SyncProtocol.MAX_TITLE_LENGTH, "proposedTask.title", errors)
                task.subjectRemoteId?.let { if (!isPlausibleId(it)) errors += "proposedTask.subjectRemoteId 非法" }
                task.targetDurationSeconds?.let { if (it < 0) errors += "proposedTask.targetDurationSeconds 非法" }
                task.dueAt?.let { if (it < 0) errors += "proposedTask.dueAt 非法" }
            }
            if (proposal.sourceAssessmentIds.size > SyncProtocol.MAX_SOURCE_ASSESSMENT_IDS) {
                errors += "sourceAssessmentIds 数量超过上限"
            }
            val sourceIds = mutableSetOf<String>()
            proposal.sourceAssessmentIds.forEach { id ->
                if (!isPlausibleId(id)) errors += "sourceAssessmentId 非法"
                if (!sourceIds.add(id)) errors += "sourceAssessmentId 重复"
            }
            if (proposal.createdAt < 0) errors += "proposal.createdAt 非法"
            proposal.expiresAt?.let {
                if (it < 0 || it < proposal.createdAt) errors += "proposal.expiresAt 与 createdAt 关系非法"
            }
        }
        val nextCursor = payload.nextCursor
        if (payload.proposals.isEmpty()) {
            if (nextCursor != null) errors += "proposals 为空时 nextCursor 必须为 null"
        } else if (nextCursor != null) {
            if (!isPlausibleId(nextCursor)) errors += "nextCursor 非法"
            if (nextCursor != payload.proposals.last().proposalId) {
                errors += "nextCursor 必须等于最后一个 proposalId"
            }
        }
        if (errors.isNotEmpty()) throw SyncValidationException(errors.joinToString("；"))
    }

    private fun <T> decodeEnvelope(
        text: String,
        payloadSerializer: kotlinx.serialization.KSerializer<T>,
        expectedMessageType: String,
        expectedDeviceId: String
    ): SyncEnvelopeDto<T> {
        val envelope = json.decodeFromString(SyncEnvelopeDto.serializer(payloadSerializer), text)
        validateEnvelopeHead(
            format = envelope.format,
            schemaVersion = envelope.schemaVersion,
            messageType = envelope.messageType,
            deviceId = envelope.deviceId,
            generatedAt = envelope.generatedAt,
            appVersion = envelope.appVersion
        )
        // 每种响应只接受自己的 messageType；错误类型不得混入。
        if (envelope.messageType != expectedMessageType) {
            throw SyncValidationException("响应 messageType 不匹配：期望 $expectedMessageType")
        }
        // 响应 deviceId 必须等于当前配对设备。
        if (envelope.deviceId != expectedDeviceId) {
            throw SyncValidationException("响应 deviceId 与当前配对设备不匹配")
        }
        return envelope
    }

    // ── 校验 ────────────────────────────────────────────────────────

    fun isPlausibleId(value: String): Boolean {
        return value.isNotEmpty() &&
            value.length in SyncProtocol.MIN_ID_LENGTH..SyncProtocol.MAX_ID_LENGTH &&
            value.all { it.isLetterOrDigit() || it == '-' || it == '_' }
    }

    /** @throws SyncValidationException 校验失败（错误信息已汇总）。 */
    fun validateEnvelopeHead(
        format: String,
        schemaVersion: Int,
        messageType: String,
        deviceId: String,
        generatedAt: Long,
        appVersion: String?
    ) {
        val errors = mutableListOf<String>()
        if (format != SyncProtocol.FORMAT) errors += "不支持的协议 format: $format"
        if (schemaVersion != SyncProtocol.SCHEMA_VERSION) errors += "不支持的协议版本: $schemaVersion"
        if (!isPlausibleId(deviceId)) errors += "deviceId 非法"
        if (generatedAt < 0) errors += "generatedAt 非法"
        appVersion?.let {
            if (it.isBlank() || it.length > SyncProtocol.MAX_APP_VERSION_LENGTH) {
                errors += "appVersion 非法"
            }
        }
        if (errors.isNotEmpty()) throw SyncValidationException(errors.joinToString("；"))
    }

    /** 完整快照校验；任何错误都导致整批拒绝。 */
    fun validateSnapshot(payload: SyncSnapshotPayload) {
        val errors = mutableListOf<String>()
        if (payload.subjects.size > SyncProtocol.MAX_COLLECTION_SIZE_SUBJECTS) {
            errors += "subjects 数量超过上限"
        }
        if (payload.weeklyGoals.size > SyncProtocol.MAX_COLLECTION_SIZE_WEEKLY_GOALS) {
            errors += "weeklyGoals 数量超过上限"
        }
        if (payload.tasks.size > SyncProtocol.MAX_COLLECTION_SIZE_TASKS) {
            errors += "tasks 数量超过上限"
        }
        if (payload.studySessions.size > SyncProtocol.MAX_COLLECTION_SIZE_SESSIONS) {
            errors += "studySessions 数量超过上限"
        }

        fun checkDuplicateRemoteIds(name: String, values: List<String>) {
            if (values.size != values.toSet().size) errors += "$name 存在重复 remoteId"
        }
        checkDuplicateRemoteIds("subjects", payload.subjects.map { it.remoteId })
        checkDuplicateRemoteIds("weeklyGoals", payload.weeklyGoals.map { it.remoteId })
        checkDuplicateRemoteIds("tasks", payload.tasks.map { it.remoteId })
        checkDuplicateRemoteIds("studySessions", payload.studySessions.map { it.remoteId })

        fun checkLen(value: String, max: Int, what: String) {
            if (value.length > max) errors += "$what 超过长度上限"
        }

        for (subject in payload.subjects) {
            if (!isPlausibleId(subject.remoteId)) errors += "subject.remoteId 非法"
            checkLen(subject.name, SyncProtocol.MAX_NAME_LENGTH, "subject.name")
            subject.color?.let { checkLen(it, 32, "subject.color") }
            subject.icon?.let { checkLen(it, 64, "subject.icon") }
            if (subject.createdAt < 0) errors += "subject.createdAt 非法"
            if (subject.updatedAt < 0) errors += "subject.updatedAt 非法"
            subject.deletedAt?.let { if (it < 0) errors += "subject.deletedAt 非法" }
            // 考试体系声明（可选）：非空且长度 ≤ 200，否则整批拒绝（与协议 schema 一致）。
            subject.examTrackId?.let {
                if (it.isBlank()) errors += "subject.examTrackId 不能为空字符串"
                else checkLen(it, 200, "subject.examTrackId")
            }
            subject.examSubjectId?.let {
                if (it.isBlank()) errors += "subject.examSubjectId 不能为空字符串"
                else checkLen(it, 200, "subject.examSubjectId")
            }
            subject.examModuleId?.let {
                if (it.isBlank()) errors += "subject.examModuleId 不能为空字符串"
                else checkLen(it, 200, "subject.examModuleId")
            }
        }
        for (goal in payload.weeklyGoals) {
            if (!isPlausibleId(goal.remoteId)) errors += "weeklyGoal.remoteId 非法"
            if (goal.weekStart < 0) errors += "weeklyGoal.weekStart 非法"
            checkLen(goal.title, SyncProtocol.MAX_TITLE_LENGTH, "weeklyGoal.title")
            if (goal.status !in 0..3) errors += "weeklyGoal.status 不支持: ${goal.status}"
            goal.successCriteria?.let { checkLen(it, SyncProtocol.MAX_STRING_LENGTH, "weeklyGoal.successCriteria") }
            goal.exceptionReason?.let { checkLen(it, SyncProtocol.MAX_STRING_LENGTH, "weeklyGoal.exceptionReason") }
            if (goal.createdAt < 0) errors += "weeklyGoal.createdAt 非法"
            if (goal.updatedAt < 0) errors += "weeklyGoal.updatedAt 非法"
            goal.completedAt?.let { if (it < 0) errors += "weeklyGoal.completedAt 非法" }
            goal.deferredToWeekStart?.let { if (it < 0) errors += "weeklyGoal.deferredToWeekStart 非法" }
            goal.deletedAt?.let { if (it < 0) errors += "weeklyGoal.deletedAt 非法" }
            goal.sourceProposalId?.let {
                if (!isPlausibleId(it)) errors += "weeklyGoal.sourceProposalId 非法"
            }
        }
        for (task in payload.tasks) {
            if (!isPlausibleId(task.remoteId)) errors += "task.remoteId 非法"
            task.subjectRemoteId?.let { if (!isPlausibleId(it)) errors += "task.subjectRemoteId 非法" }
            checkLen(task.title, SyncProtocol.MAX_TITLE_LENGTH, "task.title")
            task.content?.let { checkLen(it, SyncProtocol.MAX_STRING_LENGTH, "task.content") }
            if (task.type !in 0..2) errors += "task.type 不支持: ${task.type}"
            if (task.priority !in 0..2) errors += "task.priority 不支持: ${task.priority}"
            if (task.status !in 0..2) errors += "task.status 不支持: ${task.status}"
            if (task.sortOrder < 0) errors += "task.sortOrder 非法"
            task.targetDurationSeconds?.let { if (it < 0) errors += "task.targetDurationSeconds 非法" }
            task.dueAt?.let { if (it < 0) errors += "task.dueAt 非法" }
            task.completedAt?.let { if (it < 0) errors += "task.completedAt 非法" }
            if (task.createdAt < 0) errors += "task.createdAt 非法"
            if (task.updatedAt < 0) errors += "task.updatedAt 非法"
            task.deletedAt?.let { if (it < 0) errors += "task.deletedAt 非法" }
            task.sourceProposalId?.let {
                if (!isPlausibleId(it)) errors += "task.sourceProposalId 非法"
            }
        }
        for (session in payload.studySessions) {
            if (!isPlausibleId(session.remoteId)) errors += "studySession.remoteId 非法"
            session.subjectRemoteId?.let { if (!isPlausibleId(it)) errors += "studySession.subjectRemoteId 非法" }
            session.taskRemoteId?.let { if (!isPlausibleId(it)) errors += "studySession.taskRemoteId 非法" }
            session.title?.let { checkLen(it, SyncProtocol.MAX_TITLE_LENGTH, "studySession.title") }
            if (session.startTime < 0) errors += "studySession.startTime 非法"
            session.endTime?.let { if (it < session.startTime) errors += "studySession.endTime 早于 startTime" }
            if (session.durationSeconds < 0) errors += "studySession.durationSeconds 非法"
            // AI 使用时间（可选扩展）：非负；来源枚举白名单；缺失时默认值合法。
            if (session.aiHelpSeconds < 0) errors += "studySession.aiHelpSeconds 非法"
            if (session.aiHelpCount < 0) errors += "studySession.aiHelpCount 非法"
            session.externalAiAppSeconds?.let { if (it < 0) errors += "studySession.externalAiAppSeconds 非法" }
            session.aiUsageSource?.let { source ->
                if (source !in AI_USAGE_SOURCES) errors += "studySession.aiUsageSource 不支持: $source"
            }
            if (session.pauseSeconds < 0) errors += "studySession.pauseSeconds 非法"
            session.focusScore?.let { if (it !in 0..100) errors += "studySession.focusScore 超出范围" }
            session.note?.let { checkLen(it, SyncProtocol.MAX_STRING_LENGTH, "studySession.note") }
            if (session.status !in 0..3) errors += "studySession.status 不支持: ${session.status}"
            if (session.createdAt < 0) errors += "studySession.createdAt 非法"
            if (session.updatedAt < 0) errors += "studySession.updatedAt 非法"
            session.deletedAt?.let { if (it < 0) errors += "studySession.deletedAt 非法" }
        }

        payload.learningAnalysis?.let { analysis ->
            if (!isPlausibleId(analysis.analysisId)) errors += "learningAnalysis.analysisId 非法"
            if (!isPlausibleId(analysis.sourceSnapshotId)) errors += "learningAnalysis.sourceSnapshotId 非法"
            if (analysis.generatedAt < 0) errors += "learningAnalysis.generatedAt 非法"
            checkRequiredText(analysis.promptVersion, 100, "learningAnalysis.promptVersion", errors)
            if (analysis.generator !in setOf("android_llm", "deterministic_fallback")) {
                errors += "learningAnalysis.generator 不支持: ${analysis.generator}"
            }
            analysis.inputSummary?.let { summary ->
                if (summary.source != SyncLearningInputSummaryDto.SOURCE_SAME_ANALYSIS_INPUT_V1) {
                    errors += "learningAnalysis.inputSummary.source 不支持"
                }
                if (summary.subjectCount < 0 || summary.weeklyGoalCount < 0 ||
                    summary.taskCount < 0 || summary.completedSessionCount < 0
                ) {
                    errors += "learningAnalysis.inputSummary 计数不能为负"
                }
                val expected = SyncLearningInputSummaryDto.fromSnapshot(payload)
                if (summary != expected) {
                    errors += "learningAnalysis.inputSummary 必须匹配同一 snapshot 的完整未删除输入范围"
                }
            }
            if (analysis.profile.facts.size > 100) {
                errors += "learningAnalysis.profile.facts 数量超过上限"
            }
            if (analysis.profile.inferences.size > 100) {
                errors += "learningAnalysis.profile.inferences 数量超过上限"
            }
            val factCodes = mutableSetOf<String>()
            analysis.profile.facts.forEach { fact ->
                checkRequiredText(fact.code, 100, "learningAnalysis.profile.fact.code", errors)
                if (!factCodes.add(fact.code)) errors += "learningAnalysis.profile.fact.code 重复"
                checkRequiredText(
                    fact.label,
                    SyncProtocol.MAX_TITLE_LENGTH,
                    "learningAnalysis.profile.fact.label",
                    errors
                )
                checkEvidenceRefs(
                    fact.evidenceRefs,
                    "learningAnalysis.profile.fact.evidenceRefs",
                    errors
                )
                if (fact.value.toString().length > SyncProtocol.MAX_STRING_LENGTH) {
                    errors += "learningAnalysis.profile.fact.value 超过长度上限"
                }
            }
            analysis.profile.inferences.forEach { inference ->
                checkRequiredText(
                    inference.statement,
                    SyncProtocol.MAX_STRING_LENGTH,
                    "learningAnalysis.profile.inference.statement",
                    errors
                )
                if (!inference.confidence.isFinite() || inference.confidence !in 0.0..1.0) {
                    errors += "learningAnalysis.profile.inference.confidence 超出范围"
                }
                checkEvidenceRefs(
                    inference.evidenceRefs,
                    "learningAnalysis.profile.inference.evidenceRefs",
                    errors
                )
            }
            if (analysis.planEvaluation.verdict !in setOf("reasonable", "needs_adjustment", "insufficient_data")) {
                errors += "learningAnalysis.planEvaluation.verdict 不支持: ${analysis.planEvaluation.verdict}"
            }
            analysis.planEvaluation.score?.let {
                if (!it.isFinite() || it !in 0.0..100.0) {
                    errors += "learningAnalysis.planEvaluation.score 超出范围"
                }
            }
            if (analysis.planEvaluation.dimensions.size > 20) {
                errors += "learningAnalysis.planEvaluation.dimensions 数量超过上限"
            }
            if (analysis.planEvaluation.risks.size > 20) {
                errors += "learningAnalysis.planEvaluation.risks 数量超过上限"
            }
            if (analysis.planEvaluation.suggestions.size > 20) {
                errors += "learningAnalysis.planEvaluation.suggestions 数量超过上限"
            }
            analysis.planEvaluation.dimensions.forEach { dimension ->
                checkRequiredText(
                    dimension.code,
                    100,
                    "learningAnalysis.planEvaluation.dimension.code",
                    errors
                )
                dimension.score?.let {
                    if (!it.isFinite() || it !in 0.0..100.0) {
                        errors += "learningAnalysis.planEvaluation.dimension.score 超出范围"
                    }
                }
                checkRequiredText(
                    dimension.summary,
                    SyncProtocol.MAX_STRING_LENGTH,
                    "learningAnalysis.planEvaluation.dimension.summary",
                    errors
                )
            }
            analysis.planEvaluation.risks.forEach {
                checkRequiredText(it, SyncProtocol.MAX_STRING_LENGTH, "learningAnalysis.planEvaluation.risk", errors)
            }
            analysis.planEvaluation.suggestions.forEach {
                checkRequiredText(it, SyncProtocol.MAX_STRING_LENGTH, "learningAnalysis.planEvaluation.suggestion", errors)
            }
            if (analysis.assessmentDraft.status != "draft") errors += "learningAnalysis.assessmentDraft.status 必须为 draft"
            checkRequiredText(
                analysis.assessmentDraft.scopeSummary,
                SyncProtocol.MAX_STRING_LENGTH,
                "learningAnalysis.assessmentDraft.scopeSummary",
                errors
            )
            if (analysis.assessmentDraft.questions.size > SyncProtocol.MAX_ANALYSIS_QUESTIONS) errors += "learningAnalysis.assessmentDraft.questions 数量超过上限"
            val questionIds = mutableSetOf<String>()
            analysis.assessmentDraft.questions.forEach { question ->
                if (!isPlausibleId(question.questionId)) errors += "learningAnalysis.assessmentDraft.questionId 非法"
                if (!questionIds.add(question.questionId)) errors += "learningAnalysis.assessmentDraft.questionId 重复"
                question.subjectRemoteId?.let {
                    if (!isPlausibleId(it)) errors += "learningAnalysis.assessmentDraft.question.subjectRemoteId 非法"
                }
                question.taskRemoteId?.let {
                    if (!isPlausibleId(it)) errors += "learningAnalysis.assessmentDraft.question.taskRemoteId 非法"
                }
                if (question.type !in setOf("concept_check", "diagnostic", "reflection")) errors += "learningAnalysis.assessmentDraft.question.type 不支持"
                checkRequiredText(
                    question.prompt,
                    SyncProtocol.MAX_STRING_LENGTH,
                    "learningAnalysis.assessmentDraft.question.prompt",
                    errors
                )
                checkRequiredText(
                    question.rationale,
                    SyncProtocol.MAX_STRING_LENGTH,
                    "learningAnalysis.assessmentDraft.question.rationale",
                    errors
                )
                if (question.rubric.size > 20) errors += "learningAnalysis.assessmentDraft.question.rubric 数量超过上限"
                question.rubric.forEach {
                    checkRequiredText(it, SyncProtocol.MAX_STRING_LENGTH, "learningAnalysis.assessmentDraft.question.rubric", errors)
                }
            }
            if (analysis.warnings.size > SyncProtocol.MAX_ANALYSIS_WARNINGS) errors += "learningAnalysis.warnings 数量超过上限"
            analysis.warnings.forEach {
                checkRequiredText(it, SyncProtocol.MAX_STRING_LENGTH, "learningAnalysis.warning", errors)
            }
        }

        // 跨集合外键（remoteId 引用）。
        val subjectIds = payload.subjects.map { it.remoteId }.toSet()
        val weeklyGoalIds = payload.weeklyGoals.map { it.remoteId }.toSet()
        val taskIds = payload.tasks.map { it.remoteId }.toSet()
        val sessionIds = payload.studySessions.map { it.remoteId }.toSet()
        for (task in payload.tasks) {
            task.subjectRemoteId?.let { if (it !in subjectIds) errors += "task.subjectRemoteId 引用了不存在的科目" }
        }
        for (session in payload.studySessions) {
            session.subjectRemoteId?.let { if (it !in subjectIds) errors += "studySession.subjectRemoteId 引用了不存在的科目" }
            session.taskRemoteId?.let { if (it !in taskIds) errors += "studySession.taskRemoteId 引用了不存在的任务" }
        }
        payload.learningAnalysis?.assessmentDraft?.questions?.forEach { question ->
            question.subjectRemoteId?.let {
                if (it !in subjectIds) errors += "learningAnalysis.assessmentDraft.question.subjectRemoteId 引用了不存在的科目"
            }
            question.taskRemoteId?.let {
                if (it !in taskIds) errors += "learningAnalysis.assessmentDraft.question.taskRemoteId 引用了不存在的任务"
            }
        }
        fun isBoundEvidenceRef(value: String): Boolean {
            if (value in LEARNING_ANALYSIS_AGGREGATE_EVIDENCE_REFS ||
                value in LEARNING_ANALYSIS_USER_SETTING_EVIDENCE_REFS
            ) {
                return true
            }
            value.removePrefix("task:").takeIf { value.startsWith("task:") }?.let { taskId ->
                return taskId in taskIds
            }
            return value in subjectIds || value in weeklyGoalIds || value in taskIds || value in sessionIds
        }
        payload.learningAnalysis?.let { analysis ->
            val evidenceRefs = analysis.profile.facts.flatMap { it.evidenceRefs } +
                analysis.profile.inferences.flatMap { it.evidenceRefs }
            evidenceRefs.filterNot(::isBoundEvidenceRef).forEach {
                errors += "learningAnalysis.evidenceRef 未绑定本快照证据"
            }
        }

        if (errors.isNotEmpty()) throw SyncValidationException(errors.joinToString("；"))
    }

    fun validateSnapshotForId(payload: SyncSnapshotPayload, snapshotId: String) {
        validateSnapshot(payload)
        payload.learningAnalysis?.let {
            if (it.sourceSnapshotId != snapshotId) throw SyncValidationException("learningAnalysis.sourceSnapshotId 必须等于 snapshotId")
        }
    }

    private fun checkRequiredText(
        value: String,
        max: Int,
        what: String,
        errors: MutableList<String>
    ) {
        if (value.isBlank()) errors += "$what 不能为空"
        if (value.length > max) errors += "$what 超过长度上限"
    }

    private fun checkEvidenceRefs(
        values: List<String>,
        what: String,
        errors: MutableList<String>
    ) {
        if (values.size > 20) errors += "$what 数量超过上限"
        values.forEach {
            if (it.isBlank()) errors += "$what 项不能为空"
            if (it.length > SyncProtocol.MAX_TITLE_LENGTH) errors += "$what 项超过长度上限"
        }
    }

    // ── 本地持久化编解码（AppSetting 中的非敏感状态） ───────────────

    fun encodeStoredProposalList(proposals: List<SyncProposalDto>): String {
        return json.encodeToString(ListSerializer(SyncProposalDto.serializer()), proposals)
    }

    fun decodeStoredProposalList(text: String?): List<SyncProposalDto> {
        if (text.isNullOrBlank()) return emptyList()
        return runCatching {
            json.decodeFromString(ListSerializer(SyncProposalDto.serializer()), text)
        }.getOrDefault(emptyList())
    }

    fun encodeStringList(values: List<String>): String {
        return json.encodeToString(values)
    }

    fun decodeStringList(text: String?): List<String> {
        if (text.isNullOrBlank()) return emptyList()
        return runCatching { json.decodeFromString<List<String>>(text) }.getOrDefault(emptyList())
    }
}

/** 校验失败异常；message 已汇总全部错误，且不包含配对 token。 */
class SyncValidationException(message: String) : Exception(message)

/** 服务端返回的结构化错误（HTTP 4xx/5xx）。 */
data class SyncApiError(val code: String, override val message: String) : Exception("[$code] $message")
