package com.hxz.alerttime.app.data.backup

import java.util.Locale

/**
 * Metadata for one candidate returned by the scoped MediaStore query.
 *
 * This type deliberately contains only query metadata. File contents are read and
 * validated by [BackupRepository] after selection; a candidate is never trusted
 * merely because its name or MIME type looks correct.
 */
internal data class RecentBackupCandidate(
    val uriString: String,
    val displayName: String?,
    val mimeType: String?,
    val relativePath: String?,
    val sizeBytes: Long,
    val dateModifiedSeconds: Long,
    val isPending: Boolean
)

/** Pure, deterministic selection rules for reinstall-safe recent-backup discovery. */
internal object RecentBackupCandidateSelector {
    const val MAX_CANDIDATES = 16

    private val appBackupName = Regex("""^AlertTime-backup-\d{8}-\d{6}\.json$""")
    private val jsonMimeTypes = setOf("application/json", "text/json")

    fun orderedEligible(
        candidates: List<RecentBackupCandidate>,
        expectedRelativePath: String
    ): List<RecentBackupCandidate> {
        return candidates
            .asSequence()
            // The ContentResolver query also requests a provider-side limit. This
            // second bound protects us if a provider ignores that query argument.
            .take(MAX_CANDIDATES)
            .filter { isEligible(it, expectedRelativePath) }
            .sortedWith(
                compareByDescending<RecentBackupCandidate> { it.dateModifiedSeconds }
                    .thenByDescending { it.uriString }
            )
            .toList()
    }

    fun isEligible(candidate: RecentBackupCandidate, expectedRelativePath: String): Boolean {
        if (candidate.isPending) return false
        if (candidate.relativePath != expectedRelativePath) return false
        if (candidate.sizeBytes > BackupProtocol.MAX_BACKUP_BYTES) return false
        if (!appBackupName.matches(candidate.displayName.orEmpty())) return false
        val mimeType = candidate.mimeType?.trim()?.lowercase(Locale.ROOT)
        return mimeType.isNullOrEmpty() || mimeType in jsonMimeTypes
    }
}
