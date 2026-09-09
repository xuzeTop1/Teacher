package com.hxz.alerttime.app.data.sync

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.util.Locale

/**
 * Shared cross-end guard for assessment draft question properties.
 * Only direct property names on each question object are inspected; prompt,
 * rationale, rubric text, and nested future fields are intentionally ignored.
 */
object AssessmentAnswerLeakGuard {
    /** Returns the first forbidden question property name, or null when safe. */
    fun findForbiddenQuestionKey(assessmentRoot: JsonElement): String? {
        val assessmentDraft = (assessmentRoot as? JsonObject)?.get("assessmentDraft") as? JsonObject
            ?: return null
        val questions = assessmentDraft["questions"] as? JsonArray ?: return null
        return questions.asSequence()
            .mapNotNull { it as? JsonObject }
            .flatMap { it.keys.asSequence() }
            .firstOrNull(::isForbiddenKey)
    }

    private fun isForbiddenKey(key: String): Boolean {
        val normalized = key.lowercase(Locale.ROOT)
        return "answer" in normalized || "solution" in normalized || normalized == "explanation"
    }
}
