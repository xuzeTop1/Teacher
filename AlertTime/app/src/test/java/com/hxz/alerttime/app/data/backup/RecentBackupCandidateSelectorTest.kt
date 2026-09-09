package com.hxz.alerttime.app.data.backup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RecentBackupCandidateSelectorTest {

    private val directory = "Download/AlertTime/"

    @Test
    fun ordersEligibleCandidates_byModifiedTime_withDeterministicTieBreak() {
        val candidates = listOf(
            candidate("content://older", "AlertTime-backup-20260810-120000.json", 10),
            candidate("content://newer", "AlertTime-backup-20260811-120000.json", 20),
            candidate("content://tie-a", "AlertTime-backup-20260811-120001.json", 30),
            candidate("content://tie-b", "AlertTime-backup-20260811-120002.json", 30)
        )

        val ordered = RecentBackupCandidateSelector.orderedEligible(candidates, directory)

        assertEquals(
            listOf("content://tie-b", "content://tie-a", "content://newer", "content://older"),
            ordered.map { it.uriString }
        )
    }

    @Test
    fun rejectsCandidatesOutsideScopedAppNamingAndSafetyRules() {
        val rejected = listOf(
            candidate("content://wrong-dir", "AlertTime-backup-20260811-120000.json", 1, relativePath = "Download/Other/"),
            candidate("content://wrong-name", "backup-20260811-120000.json", 1),
            candidate("content://wrong-extension", "AlertTime-backup-20260811-120000.txt", 1),
            candidate("content://pending", "AlertTime-backup-20260811-120000.json", 1, isPending = true),
            candidate("content://wrong-mime", "AlertTime-backup-20260811-120000.json", 1, mimeType = "text/plain"),
            candidate("content://too-large", "AlertTime-backup-20260811-120000.json", 1, sizeBytes = BackupProtocol.MAX_BACKUP_BYTES + 1)
        )

        assertTrue(RecentBackupCandidateSelector.orderedEligible(rejected, directory).isEmpty())
    }

    @Test
    fun unknownMimeAndSizeAreAllowed_forContentValidationToDecide() {
        val candidate = candidate(
            uri = "content://provider",
            name = "AlertTime-backup-20260811-120000.json",
            modified = 1,
            mimeType = null,
            sizeBytes = -1
        )

        val ordered = RecentBackupCandidateSelector.orderedEligible(listOf(candidate), directory)

        assertEquals(listOf("content://provider"), ordered.map { it.uriString })
    }

    @Test
    fun candidateEnumerationIsBounded() {
        val candidates = (0 until RecentBackupCandidateSelector.MAX_CANDIDATES + 4).map { index ->
            candidate("content://$index", "AlertTime-backup-20260811-120000.json", index.toLong())
        }

        val ordered = RecentBackupCandidateSelector.orderedEligible(candidates, directory)

        assertEquals(RecentBackupCandidateSelector.MAX_CANDIDATES, ordered.size)
    }

    private fun candidate(
        uri: String,
        name: String,
        modified: Long,
        relativePath: String = directory,
        mimeType: String? = "application/json",
        sizeBytes: Long = 1,
        isPending: Boolean = false
    ) = RecentBackupCandidate(
        uriString = uri,
        displayName = name,
        mimeType = mimeType,
        relativePath = relativePath,
        sizeBytes = sizeBytes,
        dateModifiedSeconds = modified,
        isPending = isPending
    )
}
