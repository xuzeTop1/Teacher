package com.hxz.alerttime.app.data.backup

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/**
 * Encode/decode of the versioned backup JSON protocol.
 *
 * - Unknown fields from future versions are ignored (forward compatible).
 * - Wrong types, malformed JSON or missing required fields throw [SerializationException]
 *   and the input is rejected; nothing is silently defaulted into data.
 * - All timestamps are Unix epoch milliseconds. Text is UTF-8.
 *
 * The backup format is plain text and NOT encrypted.
 */
object BackupJsonCodec {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = false
        explicitNulls = true
        encodeDefaults = true
        // Never coerce wrong JSON types (e.g. "abc" into an Int) into defaults.
        coerceInputValues = false
    }

    fun encode(envelope: BackupEnvelopeDto): String {
        return json.encodeToString(BackupEnvelopeDto.serializer(), envelope)
    }

    /** @throws SerializationException when the text is not a structurally valid backup envelope. */
    fun decode(text: String): BackupEnvelopeDto {
        return json.decodeFromString(BackupEnvelopeDto.serializer(), text)
    }
}
