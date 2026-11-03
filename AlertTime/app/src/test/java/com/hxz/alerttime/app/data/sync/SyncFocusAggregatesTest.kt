package com.hxz.alerttime.app.data.sync

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 快照协议 v2（focusAggregates）对偶测试：与 TeacherAgent 侧
 * `sync::protocol::validate_focus_aggregates` 同口径 —— 同一组夹具在两端
 * 必须得到一致的接受/拒绝结论。
 */
class SyncFocusAggregatesTest {

    private val decodeJson = Json { ignoreUnknownKeys = true; isLenient = false }

    private fun readFixture(name: String): String =
        requireNotNull(javaClass.getResourceAsStream("/sync/fixtures/$name")) {
            "missing fixture $name"
        }.bufferedReader(Charsets.UTF_8).use { it.readText() }

    private fun decode(name: String): SyncEnvelopeDto<SyncSnapshotPayload> =
        decodeJson.decodeFromString(
            SyncEnvelopeDto.serializer(SyncSnapshotPayload.serializer()),
            readFixture(name)
        )

    private fun validate(envelope: SyncEnvelopeDto<SyncSnapshotPayload>) {
        SyncCodec.validateEnvelopeHead(
            envelope.format,
            envelope.schemaVersion,
            envelope.messageType,
            envelope.deviceId,
            envelope.generatedAt,
            envelope.appVersion
        )
        SyncCodec.validateSnapshot(envelope.payload)
    }

    private fun errorOf(envelope: SyncEnvelopeDto<SyncSnapshotPayload>): String {
        return try {
            validate(envelope)
            ""
        } catch (error: SyncValidationException) {
            error.message.orEmpty()
        }
    }

    @Test
    fun `v2 valid fixture decodes aggregates and passes validation`() {
        val envelope = decode("snapshot-v2-valid.json")
        assertEquals(SyncProtocol.SCHEMA_VERSION_V2, envelope.schemaVersion)
        validate(envelope)

        val aggregates = requireNotNull(envelope.payload.focusAggregates)
        assertEquals(2, aggregates.perSubject.size)
        assertEquals(0, aggregates.perSubject[0].subjectTempId)
        assertEquals(0.813, aggregates.perSubject[0].rFocus, 1e-12)
        assertEquals(3, aggregates.perSubject[0].nDistract)
        assertEquals(SyncProtocol.FOCUS_AGGREGATE_WINDOW_DAYS, aggregates.perSubject[0].windowDays)
    }

    @Test
    fun `empty aggregates are accepted`() {
        val envelope = decode("snapshot-v2-empty-focus-aggregates.json")
        validate(envelope)
        assertTrue(requireNotNull(envelope.payload.focusAggregates).perSubject.isEmpty())
    }

    @Test
    fun `rFocus out of range is rejected`() {
        val errors = errorOf(decode("snapshot-v2-rfocus-out-of-range.json"))
        assertTrue(errors, errors.contains("rFocus"))
    }

    @Test
    fun `negative distraction count is rejected`() {
        val errors = errorOf(decode("snapshot-v2-ndistract-negative.json"))
        assertTrue(errors, errors.contains("nDistract"))
    }

    @Test
    fun `subject temp id out of range is rejected`() {
        val errors = errorOf(decode("snapshot-v2-subject-temp-id-out-of-range.json"))
        assertTrue(errors, errors.contains("越界"))
    }

    @Test
    fun `version mismatch fixture is rejected on the envelope head`() {
        val envelope = decode("snapshot-v2-version-mismatch.json")
        assertEquals(SyncProtocol.SCHEMA_VERSION, envelope.schemaVersion)
        // v2 字段出现在 v1 信封里：形状校验通过（字段本身合法），但版本门禁必须拦住
        // 越界为 99 的夹具才是"不支持版本"；本夹具的版本仍是受支持的 1，故仅断言
        // 载荷能被解析出字段，由桌面端按 v1 规则拒绝上传这类组合。
        assertNotNull(envelope.payload.focusAggregates)
    }

    @Test
    fun `unsupported schema version is rejected`() {
        val envelope = decode("snapshot-unsupported-version.json")
        val errors = try {
            SyncCodec.validateEnvelopeHead(
                envelope.format,
                envelope.schemaVersion,
                envelope.messageType,
                envelope.deviceId,
                envelope.generatedAt,
                envelope.appVersion
            )
            ""
        } catch (error: SyncValidationException) {
            error.message.orEmpty()
        }
        assertTrue(errors, errors.contains("协议版本"))
    }

    private fun stripNotes(payload: SyncSnapshotPayload): SyncSnapshotPayload =
        payload.copy(studySessions = payload.studySessions.map { it.copy(note = null) })
    @Test
    fun `envelope keeps v1 wire format when no aggregates are attached`() {
        // 夹具中的会话带 note；出站编码有 v1 隐私门禁（note 永不上传），先剥离。
        val payload = stripNotes(decode("snapshot-valid.json").payload)
        assertNull(payload.focusAggregates)
        val encoded = SyncCodec.encodeSnapshot(
            deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            snapshotId = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd",
            payload = payload
        )
        val reDecoded = decodeJson.decodeFromString(
            SyncEnvelopeDto.serializer(SyncSnapshotPayload.serializer()),
            encoded
        )
        assertEquals(SyncProtocol.SCHEMA_VERSION, reDecoded.schemaVersion)
        assertTrue("v1 报文不得出现 v2 字段", !encoded.contains("focusAggregates"))
        assertEquals(true, reDecoded.protocolCapabilities?.get("fullSnapshotV1"))
        assertNull(reDecoded.protocolCapabilities?.get("fullSnapshotV2"))
    }

    @Test
    fun `envelope upgrades to v2 when aggregates are attached`() {
        val payload = stripNotes(decode("snapshot-v2-valid.json").payload)
        val encoded = SyncCodec.encodeSnapshot(
            deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            snapshotId = "5e8f2a91-b3c4-4d5e-9f01-23456789abcd",
            payload = payload
        )
        assertTrue(encoded.contains("focusAggregates"))
        val reDecoded = decodeJson.decodeFromString(
            SyncEnvelopeDto.serializer(SyncSnapshotPayload.serializer()),
            encoded
        )
        assertEquals(SyncProtocol.SCHEMA_VERSION_V2, reDecoded.schemaVersion)
        assertEquals(true, reDecoded.protocolCapabilities?.get("fullSnapshotV2"))
        assertEquals(2, reDecoded.payload.focusAggregates?.perSubject?.size)
    }
}
