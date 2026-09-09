package com.hxz.alerttime.app.data.sync

import kotlinx.serialization.SerializationException
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

/**
 * 协议 golden fixture 测试：读取与 TeacherAgent 仓库逐字一致的 fixtures，
 * 并校验 SHA-256 与清单一致（防止协议漂移）。
 */
class SyncCodecTest {

    private fun readFixture(name: String): String {
        val stream = javaClass.getResourceAsStream("/sync/fixtures/$name")
            ?: throw AssertionError("fixture 不存在: $name")
        return stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    }

    private fun sha256Hex(text: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun <T> assertMissingRequiredFieldFails(
        name: String,
        validJson: String,
        field: String,
        serializer: KSerializer<T>
    ) {
        val fieldPattern = Regex(
            """(?s)"$field"\s*:\s*(?:"(?:\\.|[^"\\])*"|null|\[[^]]*]|\{[^}]*}|-?\d+(?:\.\d+)?|true|false)\s*,?"""
        )
        val missingFieldJson = validJson.replaceFirst(fieldPattern, "")
        assertTrue("$name test fixture did not contain $field", missingFieldJson != validJson)
        assertThrows("$name must reject missing $field", SerializationException::class.java) {
            Json { ignoreUnknownKeys = true }.decodeFromString(serializer, missingFieldJson)
        }
    }

    @Test
    fun `schema required fields are decode required`() {
        val cases = listOf<() -> Unit>(
            { assertMissingRequiredFieldFails("analysis", analysisJson, "warnings", SyncLearningAnalysisDto.serializer()) },
            { assertMissingRequiredFieldFails("profile", profileJson, "facts", SyncLearningProfileDto.serializer()) },
            { assertMissingRequiredFieldFails("profile", profileJson, "inferences", SyncLearningProfileDto.serializer()) },
            { assertMissingRequiredFieldFails("fact", factJson, "evidenceRefs", SyncLearningFactDto.serializer()) },
            { assertMissingRequiredFieldFails("inference", inferenceJson, "evidenceRefs", SyncLearningInferenceDto.serializer()) },
            { assertMissingRequiredFieldFails("plan evaluation", planEvaluationJson, "score", SyncPlanEvaluationDto.serializer()) },
            { assertMissingRequiredFieldFails("plan evaluation", planEvaluationJson, "dimensions", SyncPlanEvaluationDto.serializer()) },
            { assertMissingRequiredFieldFails("plan evaluation", planEvaluationJson, "risks", SyncPlanEvaluationDto.serializer()) },
            { assertMissingRequiredFieldFails("plan evaluation", planEvaluationJson, "suggestions", SyncPlanEvaluationDto.serializer()) },
            { assertMissingRequiredFieldFails("assessment", assessmentJson, "status", SyncAssessmentDraftDto.serializer()) },
            { assertMissingRequiredFieldFails("assessment", assessmentJson, "questions", SyncAssessmentDraftDto.serializer()) },
            { assertMissingRequiredFieldFails("assessment question", questionJson, "rubric", SyncAssessmentDraftQuestionDto.serializer()) },
            { assertMissingRequiredFieldFails("weekly goal", weeklyGoalJson, "status", SyncWeeklyGoalDto.serializer()) },
            { assertMissingRequiredFieldFails("task", taskJson, "type", SyncTaskDto.serializer()) },
            { assertMissingRequiredFieldFails("task", taskJson, "priority", SyncTaskDto.serializer()) },
            { assertMissingRequiredFieldFails("task", taskJson, "status", SyncTaskDto.serializer()) },
            { assertMissingRequiredFieldFails("task", taskJson, "sortOrder", SyncTaskDto.serializer()) },
            { assertMissingRequiredFieldFails("study session", sessionJson, "durationSeconds", SyncStudySessionDto.serializer()) },
            { assertMissingRequiredFieldFails("study session", sessionJson, "pauseSeconds", SyncStudySessionDto.serializer()) },
            { assertMissingRequiredFieldFails("study session", sessionJson, "status", SyncStudySessionDto.serializer()) },
            { assertMissingRequiredFieldFails("proposal", proposalJson, "version", SyncProposalDto.serializer()) },
            { assertMissingRequiredFieldFails("proposal", proposalJson, "status", SyncProposalDto.serializer()) },
            { assertMissingRequiredFieldFails("proposal", proposalJson, "sourceAssessmentIds", SyncProposalDto.serializer()) },
            { assertMissingRequiredFieldFails("proposal list", proposalsJson, "proposals", SyncProposalsListPayload.serializer()) }
        )
        cases.forEach { it() }
    }

    @Test
    fun `legacy snapshot without learning analysis and AI usage fields remains readable`() {
        val legacy = readFixture("snapshot-valid.json")
            .replace(Regex("(?s),?\\s*\"learningAnalysis\"\\s*:\\s*\\{.*?\\n    \\}"), "")
            .replace(Regex("(?m)^\\s*\"(aiHelpSeconds|aiHelpCount|externalAiAppSeconds|aiUsageSource)\"\\s*:\\s*.*?,?\\r?\\n"), "")
            .replace(Regex(",\\s*([}\\]])"), "$1")
        // Canonical v1 now carries provenance; remove it from weeklyGoals/tasks
        // before decoding so this test exercises the actual legacy wire shape.
        val legacyWithoutProvenance = legacy.replace(
            Regex("""(?m)^\s*"sourceProposalId"\s*:\s*"[^"]+",?\r?\n"""),
            ""
        )
        val snapshot = SyncCodec.decodeSnapshotEnvelope(legacyWithoutProvenance)
        assertEquals(null, snapshot.payload.learningAnalysis)
        assertTrue(snapshot.payload.studySessions.all { it.aiHelpSeconds == 0L && it.aiHelpCount == 0 })
        assertTrue(snapshot.payload.weeklyGoals.all { it.sourceProposalId == null })
        assertTrue(snapshot.payload.tasks.all { it.sourceProposalId == null })
    }

    // ── 协议漂移防线 ────────────────────────────────────────────────

    @Test
    fun `fixtures match SHA256 manifest`() {
        val manifest = readFixture("SHA256SUMS")
        var checked = 0
        for (line in manifest.lineSequence().filter { it.isNotBlank() }) {
            val parts = line.trim().split(Regex("\\s+"))
            assertEquals("manifest 行格式错误: $line", 2, parts.size)
            val expected = parts[0]
            val file = parts[1]
            assertEquals("fixture $file 的 SHA-256 与清单不一致，可能协议漂移", expected, sha256Hex(readFixture(file)))
            checked++
        }
        assertTrue("manifest 至少包含一个 fixture", checked >= 6)
    }

    // ── 快照 ────────────────────────────────────────────────────────

    @Test
    fun `snapshot valid fixture decodes with chinese and special characters`() {
        val text = readFixture("snapshot-valid.json")
        val envelope = SyncCodec.decodeSnapshotEnvelope(text)
        assertEquals(SyncProtocol.FORMAT, envelope.format)
        assertEquals(SyncProtocol.SCHEMA_VERSION, envelope.schemaVersion)
        assertEquals(SyncProtocol.MESSAGE_TYPE_SNAPSHOT, envelope.messageType)
        assertEquals("f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6", envelope.deviceId)
        assertFalse(envelope.snapshotId.isNullOrBlank())

        // 中文与特殊字符保留。
        assertTrue(envelope.payload.subjects.any { it.name.contains("π ≥ 1/2") && it.name.contains("🎓") })
        // 软删除行存在。
        assertTrue(envelope.payload.subjects.any { it.deletedAt != null })
        assertTrue(envelope.payload.tasks.any { it.deletedAt != null })
        // 进行中会话存在但不被校验拒绝。
        assertTrue(envelope.payload.studySessions.any { it.status == 1 })
        // 未知字段（futureUnknownField / unknownFutureField）被忽略。
        assertEquals(3, envelope.payload.subjects.size)
    }

    @Test
    fun `snapshot envelope with wrong messageType is rejected`() {
        val text = readFixture("snapshot-valid.json")
            .replace("\"messageType\": \"snapshot\"", "\"messageType\": \"pair\"")

        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeSnapshotEnvelope(text)
        }
        assertTrue(error.message!!.contains("messageType"))
    }

    @Test
    fun `snapshot envelope with missing snapshotId is rejected`() {
        val text = readFixture("snapshot-valid.json")
            .replace(
                Regex("(?m)^[ \\t]*\"snapshotId\"[ \\t]*:[ \\t]*\"[^\"]+\",[ \\t]*\\r?\\n"),
                ""
            )

        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeSnapshotEnvelope(text)
        }
        assertTrue(error.message!!.contains("snapshotId"))
    }

    @Test
    fun `snapshot envelope with invalid snapshotId is rejected`() {
        val text = readFixture("snapshot-valid.json")
            .replace(
                Regex("(?m)^([ \\t]*\"snapshotId\"[ \\t]*:[ \\t]*)\"[^\"]+\""),
                "\$1\"invalid snapshot id\""
            )

        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeSnapshotEnvelope(text)
        }
        assertTrue(error.message!!.contains("snapshotId"))
    }

    @Test
    fun `snapshot envelope with learning analysis source mismatch is rejected`() {
        val text = readFixture("snapshot-valid.json")
            .replace(
                Regex("(\"sourceSnapshotId\"[ \\t]*:[ \\t]*)\"[^\"]+\""),
                "\$1\"99999999-9999-4999-8999-999999999999\""
            )

        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeSnapshotEnvelope(text)
        }
        assertTrue(error.message!!.contains("sourceSnapshotId"))
    }

    @Test
    fun `snapshot rejects every forbidden assessment answer field variant`() {
        listOf("answer", "ANSWER", "recommendedAnswer", "solutionSteps", "SoLuTiOn", "explanation")
            .forEach { field ->
                val error = assertThrows(SyncValidationException::class.java) {
                    SyncCodec.decodeSnapshotEnvelope(snapshotWithQuestionField(field))
                }
                assertTrue("expected field in message: $field", error.message!!.contains(field))
            }
    }

    @Test
    fun `snapshot keeps prompt text and unrelated future fields compatible`() {
        val text = readFixture("snapshot-valid.json")
            .replace(
                "请用自己的话解释今天背诵词汇中最容易混淆的一组词。",
                "请在回答中比较 answer、solution 与 explanation 这些术语的含义。"
            )
            .replace(
                "\"prompt\": \"请在回答中比较 answer、solution 与 explanation 这些术语的含义。\",",
                "\"prompt\": \"请在回答中比较 answer、solution 与 explanation 这些术语的含义。\",\n            \"futureQuestionMetadata\": {\"solution\": \"nested unknown data\"},"
            )
        val envelope = SyncCodec.decodeSnapshotEnvelope(text)
        assertTrue(envelope.payload.learningAnalysis!!.assessmentDraft.questions.single().prompt.contains("answer"))
    }

    private fun snapshotWithQuestionField(field: String): String =
        readFixture("snapshot-valid.json").replaceFirst(
            Regex("(\\\"prompt\\\"\\s*:\\s*\\\"[^\\\"]*\\\")"),
            "\$1, \\\"$field\\\": \\\"leaked answer\\\""
        )

    @Test
    fun `nullable fields accepted`() {
        val text = readFixture("snapshot-valid.json")
        val envelope = Json { ignoreUnknownKeys = true }.decodeFromString(
            SyncEnvelopeDto.serializer(SyncSnapshotPayload.serializer()),
            text
        )
        assertTrue(envelope.payload.subjects.any { it.color == null && it.icon == null })
        assertTrue(envelope.payload.tasks.any { it.subjectRemoteId == null })
        assertTrue(envelope.payload.studySessions.any { it.title == null && it.note == null })
        assertTrue(envelope.payload.studySessions.any { it.endTime == null })
    }

    @Test
    fun `snapshot fixture carries optional exam declared fields`() {
        val text = readFixture("snapshot-valid.json")
        val envelope = Json { ignoreUnknownKeys = true }.decodeFromString(
            SyncEnvelopeDto.serializer(SyncSnapshotPayload.serializer()),
            text
        )
        val english = envelope.payload.subjects.first { it.name == "英语" }
        assertEquals("kaoyan-english", english.examTrackId)
        assertEquals("kaoyan-english.grammar", english.examSubjectId)
        assertEquals(null, english.examModuleId)
        // 其他科目无声明 → null（旧版行为）。
        assertTrue(envelope.payload.subjects.drop(1).all { it.examSubjectId == null })
    }

    @Test
    fun `exam declared fields roundtrip encode decode`() {
        val dto = SyncSubjectDto(
            remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            name = "计算机网络",
            createdAt = 1,
            updatedAt = 1,
            examTrackId = "408",
            examSubjectId = "408.computer-networks",
            examModuleId = null
        )
        val json = Json { ignoreUnknownKeys = true }
        val encoded = json.encodeToString(SyncSubjectDto.serializer(), dto)
        assertTrue(encoded.contains("\"examTrackId\":\"408\""))
        assertTrue(encoded.contains("\"examSubjectId\":\"408.computer-networks\""))
        val decoded = json.decodeFromString(SyncSubjectDto.serializer(), encoded)
        assertEquals("408", decoded.examTrackId)
        assertEquals("408.computer-networks", decoded.examSubjectId)
    }

    @Test
    fun `old snapshot without exam fields is still valid`() {
        // 旧版手机端不上报 exam 字段：解析为 null 且校验通过。
        val payload = SyncSnapshotPayload(
            subjects = listOf(
                SyncSubjectDto(
                    remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    name = "英语",
                    createdAt = 1,
                    updatedAt = 1
                )
            ),
            weeklyGoals = emptyList(),
            tasks = emptyList(),
            studySessions = emptyList()
        )
        SyncCodec.validateSnapshot(payload)
        assertEquals(null, payload.subjects[0].examSubjectId)
    }

    @Test
    fun `blank exam declared fields are rejected`() {
        val payload = SyncSnapshotPayload(
            subjects = listOf(
                SyncSubjectDto(
                    remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    name = "计算机网络",
                    createdAt = 1,
                    updatedAt = 1,
                    examTrackId = "  "
                )
            ),
            weeklyGoals = emptyList(),
            tasks = emptyList(),
            studySessions = emptyList()
        )
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateSnapshot(payload)
        }
        assertTrue(error.message!!.contains("examTrackId"))
    }

    @Test
    fun `snapshot fixture carries ai usage fields`() {
        val text = readFixture("snapshot-valid.json")
        val envelope = Json { ignoreUnknownKeys = true }.decodeFromString(
            SyncEnvelopeDto.serializer(SyncSnapshotPayload.serializer()),
            text
        )
        val highMath = envelope.payload.studySessions.first { it.title == "高数复习" }
        assertEquals(420L, highMath.aiHelpSeconds)
        assertEquals(2, highMath.aiHelpCount)
        assertEquals(0L, highMath.externalAiAppSeconds)
        assertEquals("alerttime_ai_help", highMath.aiUsageSource)
    }

    @Test
    fun `ai usage fields roundtrip encode decode`() {
        val dto = SyncStudySessionDto(
            remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            startTime = 100,
            endTime = 200,
            durationSeconds = 50,
            pauseSeconds = 10,
            status = 0,
            createdAt = 1,
            updatedAt = 1,
            aiHelpSeconds = 30,
            aiHelpCount = 2,
            externalAiAppSeconds = 120,
            aiUsageSource = "usage_stats"
        )
        val json = Json { ignoreUnknownKeys = true }
        val encoded = json.encodeToString(SyncStudySessionDto.serializer(), dto)
        assertTrue(encoded.contains("\"aiHelpSeconds\":30"))
        assertTrue(encoded.contains("\"aiUsageSource\":\"usage_stats\""))
        val decoded = json.decodeFromString(SyncStudySessionDto.serializer(), encoded)
        assertEquals(30L, decoded.aiHelpSeconds)
        assertEquals(2, decoded.aiHelpCount)
        assertEquals(120L, decoded.externalAiAppSeconds)
        assertEquals("usage_stats", decoded.aiUsageSource)
    }

    @Test
    fun `old session without ai fields defaults to zero and null`() {
        val payload = SyncSnapshotPayload(
            subjects = emptyList(),
            weeklyGoals = emptyList(),
            tasks = emptyList(),
            studySessions = listOf(
                SyncStudySessionDto(
                    remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    startTime = 100,
                    endTime = 200,
                    durationSeconds = 50,
                    pauseSeconds = 10,
                    status = 0,
                    createdAt = 1,
                    updatedAt = 1
                )
            )
        )
        SyncCodec.validateSnapshot(payload)
        val session = payload.studySessions[0]
        assertEquals(0L, session.aiHelpSeconds)
        assertEquals(0, session.aiHelpCount)
        assertEquals(null, session.externalAiAppSeconds)
        assertEquals(null, session.aiUsageSource)
    }

    @Test
    fun `negative ai fields are rejected`() {
        val payload = SyncSnapshotPayload(
            subjects = emptyList(),
            weeklyGoals = emptyList(),
            tasks = emptyList(),
            studySessions = listOf(
                SyncStudySessionDto(
                    remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    startTime = 100,
                    endTime = 200,
                    durationSeconds = 50,
                    pauseSeconds = 10,
                    status = 0,
                    createdAt = 1,
                    updatedAt = 1,
                    aiHelpSeconds = -1
                )
            )
        )
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateSnapshot(payload)
        }
        assertTrue(error.message!!.contains("aiHelpSeconds"))
    }

    @Test
    fun `unsupported ai usage source is rejected`() {
        val payload = SyncSnapshotPayload(
            subjects = emptyList(),
            weeklyGoals = emptyList(),
            tasks = emptyList(),
            studySessions = listOf(
                SyncStudySessionDto(
                    remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    startTime = 100,
                    endTime = 200,
                    durationSeconds = 50,
                    pauseSeconds = 10,
                    status = 0,
                    createdAt = 1,
                    updatedAt = 1,
                    aiUsageSource = "unknown_source_x"
                )
            )
        )
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateSnapshot(payload)
        }
        assertTrue(error.message!!.contains("aiUsageSource"))
    }

    @Test
    fun `missing required field is rejected`() {
        val text = readFixture("snapshot-missing-field.json")
        assertThrows(SerializationException::class.java) {
            Json { ignoreUnknownKeys = true }.decodeFromString(
                SyncEnvelopeDto.serializer(SyncSnapshotPayload.serializer()),
                text
            )
        }
    }

    @Test
    fun `unsupported version is rejected`() {
        val text = readFixture("snapshot-unsupported-version.json")
        val envelope = Json { ignoreUnknownKeys = true }.decodeFromString(
            SyncEnvelopeDto.serializer(SyncSnapshotPayload.serializer()),
            text
        )
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateEnvelopeHead(
                envelope.format,
                envelope.schemaVersion,
                envelope.messageType,
                envelope.deviceId,
                envelope.generatedAt,
                envelope.appVersion
            )
        }
        assertTrue(error.message!!.contains("协议版本"))
    }

    @Test
    fun `envelope rejects negative generatedAt and invalid appVersion`() {
        val negativeTime = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateEnvelopeHead(
                SyncProtocol.FORMAT,
                SyncProtocol.SCHEMA_VERSION,
                SyncProtocol.MESSAGE_TYPE_SNAPSHOT,
                "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
                -1,
                "0.1.0"
            )
        }
        assertTrue(negativeTime.message!!.contains("generatedAt"))

        listOf("", "x".repeat(SyncProtocol.MAX_APP_VERSION_LENGTH + 1)).forEach { appVersion ->
            val invalidVersion = assertThrows(SyncValidationException::class.java) {
                SyncCodec.validateEnvelopeHead(
                    SyncProtocol.FORMAT,
                    SyncProtocol.SCHEMA_VERSION,
                    SyncProtocol.MESSAGE_TYPE_SNAPSHOT,
                    "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
                    0,
                    appVersion
                )
            }
            assertTrue(invalidVersion.message!!.contains("appVersion"))
        }
    }

    @Test
    fun `foreign key mismatch is rejected`() {
        val text = readFixture("snapshot-foreign-key-mismatch.json")
        val envelope = Json { ignoreUnknownKeys = true }.decodeFromString(
            SyncEnvelopeDto.serializer(SyncSnapshotPayload.serializer()),
            text
        )
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateSnapshot(envelope.payload)
        }
        assertTrue(error.message!!.contains("引用了不存在的科目"))
        assertTrue(error.message!!.contains("引用了不存在的任务"))
    }

    @Test
    fun `oversized collection is rejected`() {
        val tooMany = List(SyncProtocol.MAX_COLLECTION_SIZE_SUBJECTS + 1) {
            SyncSubjectDto(
                remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                name = "科目",
                createdAt = 1,
                updatedAt = 1
            )
        }
        val payload = SyncSnapshotPayload(
            subjects = tooMany,
            weeklyGoals = emptyList(),
            tasks = emptyList(),
            studySessions = emptyList()
        )
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateSnapshot(payload)
        }
        assertTrue(error.message!!.contains("数量超过上限"))
    }

    @Test
    fun `invalid enum and negative duration rejected`() {
        val payload = SyncSnapshotPayload(
            subjects = emptyList(),
            weeklyGoals = emptyList(),
            tasks = listOf(
                SyncTaskDto(
                    remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    title = "任务",
                    type = 9,
                    priority = 0,
                    status = 0,
                    sortOrder = 0,
                    createdAt = 1,
                    updatedAt = 1
                )
            ),
            studySessions = listOf(
                SyncStudySessionDto(
                    remoteId = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    startTime = 100,
                    durationSeconds = -5,
                    pauseSeconds = 0,
                    status = 0,
                    createdAt = 1,
                    updatedAt = 1
                )
            )
        )
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateSnapshot(payload)
        }
        assertTrue(error.message!!.contains("task.type 不支持"))
        assertTrue(error.message!!.contains("durationSeconds 非法"))
    }

    // ── LearningAnalysis 与 Teacher schema 同步校验 ───────────────

    @Test
    fun `valid learning analysis with snapshot references is accepted`() {
        SyncCodec.validateSnapshotForId(validLearningSnapshot(), ANALYSIS_SNAPSHOT_ID)
    }

    @Test
    fun `historical aggregate evidence aliases are accepted by protocol`() {
        val base = validLearningAnalysis()
        val analysis = base.copy(
            profile = base.profile.copy(
                inferences = listOf(
                    base.profile.inferences.single().copy(
                        evidenceRefs = listOf("scope:historical", "session_summary:all")
                    )
                )
            )
        )

        SyncCodec.validateSnapshotForId(validLearningSnapshot(analysis), ANALYSIS_SNAPSHOT_ID)
    }

    @Test
    fun `learning analysis collection limits are rejected`() {
        val base = validLearningAnalysis()
        val fact = base.profile.facts.single()
        val inference = base.profile.inferences.single()
        val dimension = base.planEvaluation.dimensions.single()
        val question = base.assessmentDraft.questions.single()
        val oversized = base.copy(
            profile = base.profile.copy(
                facts = List(101) { fact.copy(code = "fact-$it") },
                inferences = List(101) { inference }
            ),
            planEvaluation = base.planEvaluation.copy(
                dimensions = List(21) { dimension.copy(code = "dimension-$it") },
                risks = List(21) { "风险 $it" },
                suggestions = List(21) { "建议 $it" }
            ),
            assessmentDraft = base.assessmentDraft.copy(
                questions = listOf(question.copy(rubric = List(21) { "标准 $it" }))
            ),
            warnings = List(51) { "warning-$it" }
        )

        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateSnapshotForId(validLearningSnapshot(oversized), ANALYSIS_SNAPSHOT_ID)
        }
        assertTrue(error.message!!.contains("profile.facts 数量超过上限"))
        assertTrue(error.message!!.contains("profile.inferences 数量超过上限"))
        assertTrue(error.message!!.contains("dimensions 数量超过上限"))
        assertTrue(error.message!!.contains("risks 数量超过上限"))
        assertTrue(error.message!!.contains("suggestions 数量超过上限"))
        assertTrue(error.message!!.contains("rubric 数量超过上限"))
        assertTrue(error.message!!.contains("warnings 数量超过上限"))
    }

    @Test
    fun `learning analysis required strings and nested evidence limits are rejected`() {
        val base = validLearningAnalysis()
        val invalid = base.copy(
            promptVersion = " ",
            profile = SyncLearningProfileDto(
                facts = listOf(
                    base.profile.facts.single().copy(
                        code = " ",
                        label = "",
                        evidenceRefs = listOf(" ", "x".repeat(201)) + List(19) { "ref-$it" }
                    )
                ),
                inferences = listOf(
                    base.profile.inferences.single().copy(
                        statement = "",
                        evidenceRefs = listOf("", "y".repeat(201)) + List(19) { "ref-$it" }
                    )
                )
            ),
            planEvaluation = base.planEvaluation.copy(
                dimensions = listOf(base.planEvaluation.dimensions.single().copy(code = "", summary = " ")),
                risks = listOf(" "),
                suggestions = listOf("")
            ),
            assessmentDraft = base.assessmentDraft.copy(
                scopeSummary = "",
                questions = listOf(
                    base.assessmentDraft.questions.single().copy(prompt = " ", rationale = "", rubric = listOf(" "))
                )
            ),
            warnings = listOf(" ")
        )

        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateSnapshotForId(validLearningSnapshot(invalid), ANALYSIS_SNAPSHOT_ID)
        }
        assertTrue(error.message!!.contains("promptVersion 不能为空"))
        assertTrue(error.message!!.contains("fact.code 不能为空"))
        assertTrue(error.message!!.contains("fact.label 不能为空"))
        assertTrue(error.message!!.contains("inference.statement 不能为空"))
        assertTrue(error.message!!.contains("evidenceRefs 数量超过上限"))
        assertTrue(error.message!!.contains("evidenceRefs 项不能为空"))
        assertTrue(error.message!!.contains("evidenceRefs 项超过长度上限"))
        assertTrue(error.message!!.contains("dimension.code 不能为空"))
        assertTrue(error.message!!.contains("dimension.summary 不能为空"))
        assertTrue(error.message!!.contains("planEvaluation.risk 不能为空"))
        assertTrue(error.message!!.contains("planEvaluation.suggestion 不能为空"))
        assertTrue(error.message!!.contains("scopeSummary 不能为空"))
        assertTrue(error.message!!.contains("question.prompt 不能为空"))
        assertTrue(error.message!!.contains("question.rationale 不能为空"))
        assertTrue(error.message!!.contains("question.rubric 不能为空"))
        assertTrue(error.message!!.contains("warning 不能为空"))
    }

    @Test
    fun `learning analysis duplicate question ids and foreign references are rejected`() {
        val base = validLearningAnalysis()
        val question = base.assessmentDraft.questions.single()
        val invalid = base.copy(
            assessmentDraft = base.assessmentDraft.copy(
                questions = listOf(
                    question,
                    question.copy(
                        subjectRemoteId = "ffffffff-ffff-4fff-8fff-ffffffffffff",
                        taskRemoteId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
                    )
                )
            )
        )

        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateSnapshotForId(validLearningSnapshot(invalid), ANALYSIS_SNAPSHOT_ID)
        }
        assertTrue(error.message!!.contains("questionId 重复"))
        assertTrue(error.message!!.contains("引用了不存在的科目"))
        assertTrue(error.message!!.contains("引用了不存在的任务"))
    }

    @Test
    fun `learning analysis rejects unbound evidence and oversized fact value`() {
        val base = validLearningAnalysis()
        val invalid = base.copy(
            profile = base.profile.copy(
                facts = listOf(
                    base.profile.facts.single().copy(
                        value = JsonPrimitive("x".repeat(SyncProtocol.MAX_STRING_LENGTH + 1)),
                        evidenceRefs = listOf("invented-evidence")
                    )
                ),
                inferences = listOf(
                    base.profile.inferences.single().copy(
                        evidenceRefs = listOf("task:ffffffff-ffff-4fff-8fff-ffffffffffff")
                    )
                )
            )
        )

        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateSnapshotForId(validLearningSnapshot(invalid), ANALYSIS_SNAPSHOT_ID)
        }
        assertTrue(error.message!!.contains("fact.value 超过长度上限"))
        assertTrue(error.message!!.contains("evidenceRef 未绑定本快照证据"))
    }

    @Test
    fun `learning analysis non finite numbers are rejected`() {
        val base = validLearningAnalysis()
        val invalid = base.copy(
            profile = base.profile.copy(
                inferences = listOf(base.profile.inferences.single().copy(confidence = Double.NaN))
            ),
            planEvaluation = base.planEvaluation.copy(
                score = Double.POSITIVE_INFINITY,
                dimensions = listOf(
                    base.planEvaluation.dimensions.single().copy(score = Double.NEGATIVE_INFINITY)
                )
            )
        )

        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.validateSnapshotForId(validLearningSnapshot(invalid), ANALYSIS_SNAPSHOT_ID)
        }
        assertTrue(error.message!!.contains("inference.confidence 超出范围"))
        assertTrue(error.message!!.contains("planEvaluation.score 超出范围"))
        assertTrue(error.message!!.contains("dimension.score 超出范围"))
    }

    private fun validLearningSnapshot(
        analysis: SyncLearningAnalysisDto = validLearningAnalysis()
    ) = SyncSnapshotPayload(
        subjects = listOf(
            SyncSubjectDto(
                remoteId = ANALYSIS_SUBJECT_ID,
                name = "高等数学",
                createdAt = 1,
                updatedAt = 1
            )
        ),
        weeklyGoals = emptyList(),
        tasks = listOf(
            SyncTaskDto(
                remoteId = ANALYSIS_TASK_ID,
                subjectRemoteId = ANALYSIS_SUBJECT_ID,
                title = "极限复习",
                type = 0,
                priority = 0,
                status = 0,
                sortOrder = 0,
                createdAt = 1,
                updatedAt = 1
            )
        ),
        studySessions = emptyList(),
        learningAnalysis = analysis
    )

    private fun validLearningAnalysis() = SyncLearningAnalysisDto(
        analysisId = "11111111-1111-4111-8111-111111111111",
        sourceSnapshotId = ANALYSIS_SNAPSHOT_ID,
        generatedAt = 1,
        promptVersion = "test-v1",
        generator = "deterministic_fallback",
        profile = SyncLearningProfileDto(
            facts = listOf(
                SyncLearningFactDto("today_plan_count", "今日计划数", JsonPrimitive(1), listOf(ANALYSIS_TASK_ID))
            ),
            inferences = listOf(
                SyncLearningInferenceDto("当前计划具备可核对依据。", 0.8, listOf(ANALYSIS_TASK_ID))
            )
        ),
        planEvaluation = SyncPlanEvaluationDto(
            verdict = "reasonable",
            score = 80.0,
            dimensions = listOf(SyncPlanEvaluationDimensionDto("clarity", 80.0, "目标清晰。")),
            risks = listOf("仍需通过作答确认理解"),
            suggestions = listOf("完成后进行概念自检")
        ),
        assessmentDraft = SyncAssessmentDraftDto(
            status = "draft",
            scopeSummary = "覆盖今日高等数学计划。",
            questions = listOf(
                SyncAssessmentDraftQuestionDto(
                    questionId = "33333333-3333-4333-8333-333333333333",
                    subjectRemoteId = ANALYSIS_SUBJECT_ID,
                    taskRemoteId = ANALYSIS_TASK_ID,
                    type = "concept_check",
                    prompt = "请解释极限的核心定义。",
                    rationale = "根据今日计划生成的诊断草稿。",
                    rubric = listOf("说明逼近关系")
                )
            )
        ),
        warnings = listOf("learning_time_is_not_mastery_evidence")
    )

    // ── proposal / decision / pair ─────────────────────────────────

    @Test
    fun `proposal fixture decodes`() {
        val text = readFixture("proposal-valid.json")
        val proposals = SyncCodec.decodeProposalsResponse(
            text,
            expectedDeviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"
        )
        assertEquals(2, proposals.proposals.size)
        assertEquals(
            "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f",
            proposals.proposals[0].proposalId
        )
        assertEquals(
            "7e8f9a0b-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
            proposals.proposals[1].proposalId
        )
        assertEquals(1785603600000L, proposals.proposals[0].createdAt)
        assertEquals(1785369000000L, proposals.proposals[1].createdAt)
        assertTrue(proposals.proposals[0].createdAt > proposals.proposals[1].createdAt)
        assertEquals(
            proposals.proposals.last().proposalId,
            proposals.nextCursor
        )
        assertTrue(proposals.proposals[1].proposedWeeklyGoals.isNotEmpty())
        assertTrue(proposals.proposals[1].proposedTasks.isNotEmpty())
        assertTrue(proposals.proposals[1].sourceAssessmentIds.isNotEmpty())
    }

    @Test
    fun `canonical snapshot provenance matches one accepted proposal exactly`() {
        val snapshot = SyncCodec.decodeSnapshotEnvelope(readFixture("snapshot-valid.json"))
        val proposalText = readFixture("proposal-valid.json")
        val proposalPayload = SyncCodec.decodeProposalsResponse(
            proposalText,
            expectedDeviceId = snapshot.deviceId
        )
        val proposalEnvelope = Json { ignoreUnknownKeys = true }.decodeFromString(
            SyncEnvelopeDto.serializer(SyncProposalsListPayload.serializer()),
            proposalText
        )
        assertEquals(proposalPayload, proposalEnvelope.payload)

        val attributedGoal = snapshot.payload.weeklyGoals.single { it.sourceProposalId != null }
        val attributedTask = snapshot.payload.tasks.single { it.sourceProposalId != null }
        assertEquals("7e8f9a0b-1c2d-4e5f-8a9b-0c1d2e3f4a5b", attributedGoal.sourceProposalId)
        assertEquals(attributedGoal.sourceProposalId, attributedTask.sourceProposalId)

        assertCanonicalProvenance(snapshot, proposalEnvelope)
    }

    @Test
    fun `canonical provenance rejects attributed task type drift`() {
        val snapshot = SyncCodec.decodeSnapshotEnvelope(readFixture("snapshot-valid.json"))
        val proposalEnvelope = Json { ignoreUnknownKeys = true }.decodeFromString(
            SyncEnvelopeDto.serializer(SyncProposalsListPayload.serializer()),
            readFixture("proposal-valid.json")
        )
        val drifted = snapshot.copy(
            payload = snapshot.payload.copy(
                tasks = snapshot.payload.tasks.map { task ->
                    if (task.sourceProposalId != null) task.copy(type = 0) else task
                }
            )
        )

        assertThrows(AssertionError::class.java) {
            assertCanonicalProvenance(drifted, proposalEnvelope)
        }
    }

    @Test
    fun `decision fixture decodes and validates`() {
        val text = readFixture("decision-valid.json")
        val envelope = Json { ignoreUnknownKeys = true }.decodeFromString(
            SyncEnvelopeDto.serializer(SyncProposalDecisionPayload.serializer()),
            text
        )
        assertEquals("proposalDecision", envelope.messageType)
        assertEquals("accepted", envelope.payload.decision)
        SyncCodec.validateEnvelopeHead(
            envelope.format,
            envelope.schemaVersion,
            envelope.messageType,
            envelope.deviceId,
            envelope.generatedAt,
            envelope.appVersion
        )
    }

    @Test
    fun `pair fixture decodes`() {
        val text = readFixture("pair-valid.json")
        val envelope = Json { ignoreUnknownKeys = true }.decodeFromString(
            SyncEnvelopeDto.serializer(SyncPairPayload.serializer()),
            text
        )
        assertEquals("pair", envelope.messageType)
        assertFalse(envelope.payload.token.isBlank())
    }

    // ── P0 回归：配对编码与响应关联 ────────────────────────────────

    @Test
    fun `encodePair carries the payload deviceId and pair messageType`() {
        val payload = SyncPairPayload(
            token = "p8Kj2mQx9vLz4nWb6tFh1sDg5rYc7uEa",
            deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"
        )
        val encoded = SyncCodec.encodePair(payload)
        // envelope.deviceId 必须等于 payload.deviceId（Rust validate_envelope_head 会拒绝空 deviceId）。
        assertTrue(encoded.contains("\"deviceId\":\"f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6\""))
        assertTrue(encoded.contains("\"messageType\":\"pair\""))
        assertFalse(encoded.contains("\"deviceId\":\"\""))

        // 编码结果必须能被本端协议层重新解析（结构与 fixture 约定一致）。
        val envelope = Json { ignoreUnknownKeys = true }.decodeFromString(
            SyncEnvelopeDto.serializer(SyncPairPayload.serializer()),
            encoded
        )
        assertEquals("pair", envelope.messageType)
        assertEquals(payload.deviceId, envelope.deviceId)
        assertEquals(payload.token, envelope.payload.token)
    }

    @Test
    fun `response with wrong messageType is rejected`() {
        // payload 结构合法（pairAck），但 messageType 错误（snapshotAck）→ 必须被 messageType 检查拒绝。
        val wrongTypeJson = """
            {
              "format": "alerttime-teacher-sync",
              "schemaVersion": 1,
              "messageType": "snapshotAck",
              "deviceId": "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
              "generatedAt": 1785600000000,
              "appVersion": "0.1.0",
              "protocolCapabilities": { "fullSnapshotV1": true, "proposalsV1": true },
              "cursor": null,
              "payload": {
                "credential": "abc",
                "deviceId": "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
                "displayName": "AlertTime 手机"
              }
            }
        """.trimIndent()
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodePairAck(wrongTypeJson, expectedDeviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6")
        }
        assertTrue(error.message!!.contains("messageType"))
    }

    @Test
    fun `response with mismatched deviceId is rejected`() {
        val ackJson = """
            {
              "format": "alerttime-teacher-sync",
              "schemaVersion": 1,
              "messageType": "snapshotAck",
              "deviceId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
              "snapshotId": "5e8f2a91-b3c4-4d5e-9f01-23456789abcd",
              "generatedAt": 1785600000000,
              "appVersion": "0.1.0",
              "protocolCapabilities": { "fullSnapshotV1": true, "proposalsV1": true },
              "cursor": null,
              "payload": {
                "accepted": true,
                "receivedAt": 1785600000000,
                "entityCounts": { "subjects": 1, "weeklyGoals": 0, "tasks": 0, "studySessions": 0 }
              }
            }
        """.trimIndent()
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeSnapshotAck(
                ackJson,
                expectedDeviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
                expectedSnapshotId = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd"
            )
        }
        assertTrue(error.message!!.contains("deviceId"))
    }

    @Test
    fun `snapshot ack with mismatched snapshotId is rejected`() {
        val ackJson = """
            {
              "format": "alerttime-teacher-sync",
              "schemaVersion": 1,
              "messageType": "snapshotAck",
              "deviceId": "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
              "snapshotId": "99999999-9999-4999-8999-999999999999",
              "generatedAt": 1785600000000,
              "appVersion": "0.1.0",
              "protocolCapabilities": { "fullSnapshotV1": true, "proposalsV1": true },
              "cursor": null,
              "payload": {
                "accepted": true,
                "receivedAt": 1785600000000,
                "entityCounts": { "subjects": 1, "weeklyGoals": 0, "tasks": 0, "studySessions": 0 }
              }
            }
        """.trimIndent()
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeSnapshotAck(
                ackJson,
                expectedDeviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
                expectedSnapshotId = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd"
            )
        }
        assertTrue(error.message!!.contains("不匹配"))
    }

    @Test
    fun `snapshot ack with matching ids is accepted`() {
        val ackJson = """
            {
              "format": "alerttime-teacher-sync",
              "schemaVersion": 1,
              "messageType": "snapshotAck",
              "deviceId": "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
              "snapshotId": "5e8f2a91-b3c4-4d5e-9f01-23456789abcd",
              "generatedAt": 1785600000000,
              "appVersion": "0.1.0",
              "protocolCapabilities": { "fullSnapshotV1": true, "proposalsV1": true },
              "cursor": null,
              "payload": {
                "accepted": true,
                "receivedAt": 1785600000000,
                "entityCounts": { "subjects": 3, "weeklyGoals": 5, "tasks": 4, "studySessions": 5 }
              }
            }
        """.trimIndent()
        val ack = SyncCodec.decodeSnapshotAck(
            ackJson,
            expectedDeviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            expectedSnapshotId = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd"
        )
        assertTrue(ack.accepted)
        assertEquals(3, ack.entityCounts.subjects)
    }

    @Test
    fun `snapshot ack requires accepted and non-negative entity counts`() {
        val deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"
        val snapshotId = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd"

        assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeSnapshotAck(
                snapshotAckJson(deviceId, snapshotId, accepted = false),
                deviceId,
                snapshotId
            )
        }
        assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeSnapshotAck(
                snapshotAckJson(deviceId, snapshotId, subjects = -1),
                deviceId,
                snapshotId
            )
        }
    }

    @Test
    fun `snapshot ack entity counts bind to uploaded snapshot`() {
        val deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"
        val snapshotId = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd"
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeSnapshotAck(
                text = snapshotAckJson(deviceId, snapshotId, subjects = 2),
                expectedDeviceId = deviceId,
                expectedSnapshotId = snapshotId,
                expectedEntityCounts = SyncEntityCounts(1, 0, 0, 0)
            )
        }
        assertTrue(error.message!!.contains("entityCounts"))
    }

    @Test
    fun `pair ack requires envelope and payload device binding and credential`() {
        val deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"
        val base = pairAckJson(deviceId, deviceId, "credential-value")
        assertEquals(deviceId, SyncCodec.decodePairAck(base, deviceId).deviceId)

        assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodePairAck(pairAckJson(deviceId, "ffffffff-ffff-4fff-8fff-ffffffffffff", "credential-value"), deviceId)
        }
        assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodePairAck(pairAckJson(deviceId, deviceId, " "), deviceId)
        }
    }

    @Test
    fun `decision ack must be recorded before caller may remove pending decision`() {
        val text = decisionAckJson(recorded = false)
        assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeDecisionAck(
                text,
                expectedDeviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
                expectedProposalId = "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f",
                expectedDecision = "accepted"
            )
        }
    }

    @Test
    fun `decision ack must match the pending decision`() {
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeDecisionAck(
                text = decisionAckJson(recorded = true, decision = "rejected"),
                expectedDeviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
                expectedProposalId = "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f",
                expectedDecision = "accepted"
            )
        }
        assertTrue(error.message!!.contains("decision"))
    }

    @Test
    fun `proposals response validates binding fields limits and cursor`() {
        val deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"
        val valid = proposalResponseJson(deviceId, nextCursor = "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f")
        assertEquals(1, SyncCodec.decodeProposalsResponse(valid, deviceId).proposals.size)

        val invalid = proposalResponseJson(
            deviceId = deviceId,
            proposalDeviceId = "ffffffff-ffff-4fff-8fff-ffffffffffff",
            expiresAt = 0,
            createdAt = 1,
            nextCursor = "not a cursor"
        )
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeProposalsResponse(invalid, deviceId)
        }
        assertTrue(error.message!!.contains("deviceId"))
        assertTrue(error.message!!.contains("expiresAt"))
        assertTrue(error.message!!.contains("nextCursor"))
    }

    @Test
    fun `proposal cursor is null for empty page and otherwise matches last proposal`() {
        val deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"
        val emptyError = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeProposalsResponse(
                emptyProposalResponseJson(deviceId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
                deviceId
            )
        }
        assertTrue(emptyError.message!!.contains("必须为 null"))

        val pageError = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeProposalsResponse(
                proposalResponseJson(deviceId, nextCursor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
                deviceId
            )
        }
        assertTrue(pageError.message!!.contains("最后一个 proposalId"))
    }

    @Test
    fun `proposals response rejects duplicate proposal ids and invalid nested values`() {
        val deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"
        val invalid = proposalResponseJson(
            deviceId = deviceId,
            duplicateProposal = true,
            rationale = " ",
            proposalId = "bad id",
            taskTitle = " ",
            subjectRemoteId = "bad subject",
            targetDurationSeconds = -1,
            sourceAssessmentIds = listOf("bad source", "bad source")
        )
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.decodeProposalsResponse(invalid, deviceId)
        }
        assertTrue(error.message!!.contains("proposalId"))
        assertTrue(error.message!!.contains("rationale"))
        assertTrue(error.message!!.contains("proposedTask"))
        assertTrue(error.message!!.contains("sourceAssessment"))
    }

    // ── 编码往返 ───────────────────────────────────────────────────

    @Test
    fun `snapshot encode then self validate`() {
        val payload = SyncSnapshotPayload(
            subjects = listOf(
                SyncSubjectDto(
                    remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    name = "英语",
                    createdAt = 1,
                    updatedAt = 1
                )
            ),
            weeklyGoals = emptyList(),
            tasks = emptyList(),
            studySessions = emptyList()
        )
        val encoded = SyncCodec.encodeSnapshot("f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6", "5e8f2a91-b3c4-4d5e-9f01-23456789abcd", payload)
        assertTrue(encoded.contains("\"format\":\"alerttime-teacher-sync\""))
        assertTrue(encoded.contains("\"snapshotId\":\"5e8f2a91-b3c4-4d5e-9f01-23456789abcd\""))
        SyncCodec.validateSnapshot(payload)
    }

    @Test
    fun `snapshot payload carrying session note is rejected at encode time`() {
        val subjectId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        val session = SyncStudySessionDto(
            remoteId = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb",
            subjectRemoteId = subjectId,
            startTime = 100,
            endTime = 200,
            durationSeconds = 100,
            pauseSeconds = 0,
            status = 2,
            createdAt = 1,
            updatedAt = 1
        )
        val payload = SyncSnapshotPayload(
            subjects = listOf(
                SyncSubjectDto(remoteId = subjectId, name = "英语", createdAt = 1, updatedAt = 1)
            ),
            weeklyGoals = emptyList(),
            tasks = emptyList(),
            studySessions = listOf(session)
        )
        // note 为 null（v1 唯一合法出站形态）正常编码并显式输出 null。
        val encoded = SyncCodec.encodeSnapshot(
            deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            snapshotId = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd",
            payload = payload
        )
        assertTrue(encoded.contains("\"note\":null"))

        // 非 null note 出站 fail-closed：即使构建器未来误填也不得离开设备。
        val error = assertThrows(SyncValidationException::class.java) {
            SyncCodec.encodeSnapshot(
                deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
                snapshotId = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd",
                payload = payload.copy(
                    studySessions = listOf(session.copy(note = "包含隐私内容的笔记"))
                )
            )
        }
        assertTrue(error.message!!.contains("studySession.note"))
    }

    @Test
    fun `snapshot source proposal ids are optional but production validated`() {
        val proposalId = "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f"
        val payload = SyncSnapshotPayload(
            subjects = listOf(
                SyncSubjectDto(
                    remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    name = "英语",
                    createdAt = 1,
                    updatedAt = 1
                )
            ),
            weeklyGoals = listOf(
                SyncWeeklyGoalDto(
                    remoteId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
                    weekStart = 1,
                    title = "目标",
                    status = 0,
                    createdAt = 1,
                    updatedAt = 1,
                    sourceProposalId = proposalId
                )
            ),
            tasks = listOf(
                SyncTaskDto(
                    remoteId = "cccccccc-dddd-4eee-8fff-000000000000",
                    title = "任务",
                    type = 1,
                    priority = 0,
                    status = 0,
                    sortOrder = 0,
                    createdAt = 1,
                    updatedAt = 1,
                    sourceProposalId = proposalId
                )
            ),
            studySessions = emptyList()
        )

        val encoded = SyncCodec.encodeSnapshot(
            deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            snapshotId = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd",
            payload = payload
        )
        val decoded = SyncCodec.decodeSnapshotEnvelope(encoded).payload
        assertEquals(proposalId, decoded.weeklyGoals.single().sourceProposalId)
        assertEquals(proposalId, decoded.tasks.single().sourceProposalId)

        listOf("", "bad id", "x".repeat(SyncProtocol.MAX_ID_LENGTH + 1)).forEach { invalid ->
            assertThrows(SyncValidationException::class.java) {
                SyncCodec.encodeSnapshot(
                    deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
                    snapshotId = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd",
                    payload = payload.copy(
                        weeklyGoals = payload.weeklyGoals.map { it.copy(sourceProposalId = invalid) }
                    )
                )
            }
        }

        // Missing fields and explicit null remain the legacy-compatible path.
        val legacy = payload.copy(
            weeklyGoals = payload.weeklyGoals.map { it.copy(sourceProposalId = null) },
            tasks = payload.tasks.map { it.copy(sourceProposalId = null) }
        )
        SyncCodec.validateSnapshot(legacy)
    }

    @Test
    fun `local proposal list roundtrip`() {
        val proposals = listOf(
            SyncProposalDto(
                proposalId = "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f",
                deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
                version = 1,
                status = "pending",
                rationale = "测试建议",
                proposedWeeklyGoals = emptyList(),
                proposedTasks = emptyList(),
                sourceAssessmentIds = emptyList(),
                createdAt = 1
            )
        )
        val encoded = SyncCodec.encodeStoredProposalList(proposals)
        val decoded = SyncCodec.decodeStoredProposalList(encoded)
        assertEquals(1, decoded.size)
        assertEquals("9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f", decoded[0].proposalId)
        assertEquals(emptyList<SyncProposalDto>(), SyncCodec.decodeStoredProposalList(null))
    }

    private fun assertCanonicalProvenance(
        snapshot: SyncEnvelopeDto<SyncSnapshotPayload>,
        proposalEnvelope: SyncEnvelopeDto<SyncProposalsListPayload>
    ) {
        assertEquals(snapshot.deviceId, proposalEnvelope.deviceId)
        val acceptedProposals = proposalEnvelope.payload.proposals.filter { it.status == "accepted" }
        val goalClaims = mutableSetOf<Pair<String, Int>>()
        val taskClaims = mutableSetOf<Pair<String, Int>>()

        fun acceptedProposalFor(sourceProposalId: String, entityCreatedAt: Long): SyncProposalDto {
            val matches = acceptedProposals.filter { it.proposalId == sourceProposalId }
            assertEquals(
                "sourceProposalId must resolve to exactly one accepted proposal",
                1,
                matches.size
            )
            val proposal = matches.single()
            assertEquals(snapshot.deviceId, proposal.deviceId)
            assertTrue(proposal.createdAt <= entityCreatedAt)
            assertTrue(entityCreatedAt <= snapshot.generatedAt)
            return proposal
        }

        for (goal in snapshot.payload.weeklyGoals) {
            val sourceProposalId = goal.sourceProposalId ?: continue
            assertTrue("sourceProposalId must not be blank", sourceProposalId.isNotBlank())
            val proposal = acceptedProposalFor(sourceProposalId, goal.createdAt)
            val matches = proposal.proposedWeeklyGoals.mapIndexedNotNull { index, proposed ->
                if (
                    proposed.weekStart == goal.weekStart &&
                    proposed.title == goal.title &&
                    proposed.successCriteria == goal.successCriteria
                ) {
                    index
                } else {
                    null
                }
            }
            assertEquals("goal provenance must match exactly one proposal item", 1, matches.size)
            assertTrue("proposal goal item must not be claimed twice", goalClaims.add(sourceProposalId to matches.single()))
        }

        for (task in snapshot.payload.tasks) {
            val sourceProposalId = task.sourceProposalId ?: continue
            assertTrue("sourceProposalId must not be blank", sourceProposalId.isNotBlank())
            assertEquals("attributed proposal tasks must be executable plans", 1, task.type)
            val proposal = acceptedProposalFor(sourceProposalId, task.createdAt)
            val matches = proposal.proposedTasks.mapIndexedNotNull { index, proposed ->
                if (
                    proposed.title == task.title &&
                    proposed.subjectRemoteId == task.subjectRemoteId &&
                    proposed.targetDurationSeconds == task.targetDurationSeconds &&
                    proposed.dueAt == task.dueAt
                ) {
                    index
                } else {
                    null
                }
            }
            assertEquals("task provenance must match exactly one proposal item", 1, matches.size)
            assertTrue("proposal task item must not be claimed twice", taskClaims.add(sourceProposalId to matches.single()))
        }
    }

    companion object {
        private val analysisJson = """
            {"analysisId":"11111111-1111-4111-8111-111111111111","sourceSnapshotId":"22222222-2222-4222-8222-222222222222","generatedAt":1,"promptVersion":"v1","generator":"deterministic_fallback","profile":{"facts":[],"inferences":[]},"planEvaluation":{"verdict":"insufficient_data","score":null,"dimensions":[],"risks":[],"suggestions":[]},"assessmentDraft":{"status":"draft","scopeSummary":"x","questions":[]},"warnings":[]}
        """.trimIndent()
        private const val profileJson = """{"facts":[],"inferences":[]}"""
        private const val factJson = """{"code":"fact","label":"Fact","value":1,"evidenceRefs":[]}"""
        private const val inferenceJson = """{"statement":"Inference","confidence":0.5,"evidenceRefs":[]}"""
        private const val planEvaluationJson = """{"verdict":"insufficient_data","score":null,"dimensions":[],"risks":[],"suggestions":[]}"""
        private const val assessmentJson = """{"status":"draft","scopeSummary":"x","questions":[]}"""
        private const val questionJson = """{"questionId":"33333333-3333-4333-8333-333333333333","type":"reflection","prompt":"p","rationale":"r","rubric":[]}"""
        private const val weeklyGoalJson = """{"remoteId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","weekStart":1,"title":"Goal","status":0,"createdAt":1,"updatedAt":1}"""
        private const val taskJson = """{"remoteId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","title":"Task","type":0,"priority":0,"status":0,"sortOrder":0,"createdAt":1,"updatedAt":1}"""
        private const val sessionJson = """{"remoteId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","startTime":1,"durationSeconds":1,"pauseSeconds":0,"status":0,"createdAt":1,"updatedAt":1}"""
        private const val proposalJson = """{"proposalId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","deviceId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","version":1,"status":"pending","rationale":"r","proposedWeeklyGoals":[],"proposedTasks":[],"sourceAssessmentIds":[],"createdAt":1}"""
        private const val proposalsJson = """{"proposals":[],"nextCursor":null}"""
        private const val ANALYSIS_SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222"
        private const val ANALYSIS_SUBJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        private const val ANALYSIS_TASK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    }

    private fun pairAckJson(envelopeDeviceId: String, payloadDeviceId: String, credential: String) = """
        {"format":"alerttime-teacher-sync","schemaVersion":1,"messageType":"pairAck","deviceId":"$envelopeDeviceId","generatedAt":1,"payload":{"credential":"$credential","deviceId":"$payloadDeviceId","displayName":"Teacher"}}
    """.trimIndent()

    private fun snapshotAckJson(
        deviceId: String,
        snapshotId: String,
        accepted: Boolean = true,
        subjects: Int = 1
    ) = """
        {"format":"alerttime-teacher-sync","schemaVersion":1,"messageType":"snapshotAck","deviceId":"$deviceId","snapshotId":"$snapshotId","generatedAt":1,"payload":{"accepted":$accepted,"receivedAt":1,"entityCounts":{"subjects":$subjects,"weeklyGoals":0,"tasks":0,"studySessions":0}}}
    """.trimIndent()

    private fun decisionAckJson(recorded: Boolean, decision: String = "accepted") = """
        {"format":"alerttime-teacher-sync","schemaVersion":1,"messageType":"decisionAck","deviceId":"f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6","generatedAt":1,"payload":{"proposalId":"9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f","decision":"$decision","recorded":$recorded}}
    """.trimIndent()

    private fun emptyProposalResponseJson(deviceId: String, nextCursor: String?) = """
        {"format":"alerttime-teacher-sync","schemaVersion":1,"messageType":"proposal","deviceId":"$deviceId","generatedAt":1,"payload":{"proposals":[],"nextCursor":${nextCursor?.let { "\"$it\"" } ?: "null"}}}
    """.trimIndent()

    private fun proposalResponseJson(
        deviceId: String,
        proposalDeviceId: String = deviceId,
        proposalId: String = "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f",
        rationale: String = "合理的建议",
        createdAt: Long = 1,
        expiresAt: Long? = null,
        nextCursor: String? = null,
        duplicateProposal: Boolean = false,
        taskTitle: String = "完成专项练习",
        subjectRemoteId: String? = null,
        targetDurationSeconds: Long? = 1800,
        sourceAssessmentIds: List<String> = listOf("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    ): String {
        val expiry = expiresAt?.toString() ?: "null"
        val cursor = nextCursor?.let { "\"$it\"" } ?: "null"
        val subject = subjectRemoteId?.let { "\"$it\"" } ?: "null"
        val duration = targetDurationSeconds?.toString() ?: "null"
        val sources = sourceAssessmentIds.joinToString(",") { "\"$it\"" }
        val proposal = "{\"proposalId\":\"$proposalId\",\"deviceId\":\"$proposalDeviceId\",\"version\":1,\"status\":\"pending\",\"rationale\":\"$rationale\",\"proposedWeeklyGoals\":[],\"proposedTasks\":[{\"title\":\"$taskTitle\",\"subjectRemoteId\":$subject,\"targetDurationSeconds\":$duration,\"dueAt\":null}],\"sourceAssessmentIds\":[$sources],\"createdAt\":$createdAt,\"expiresAt\":$expiry}"
        val proposals = if (duplicateProposal) "[$proposal,$proposal]" else "[$proposal]"
        return """
            {"format":"alerttime-teacher-sync","schemaVersion":1,"messageType":"proposal","deviceId":"$deviceId","generatedAt":1,"payload":{"proposals":$proposals,"nextCursor":$cursor}}
        """.trimIndent()
    }
}
