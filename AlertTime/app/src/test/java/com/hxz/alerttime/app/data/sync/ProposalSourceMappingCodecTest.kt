package com.hxz.alerttime.app.data.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ProposalSourceMappingCodecTest {

    private val proposalId = "9c2d6e5f-4a7b-4c8d-9e0f-1a2b3c4d5e6f"

    @Test
    fun roundTripUsesVersionedExplicitDto() {
        val entries = listOf(
            ProposalSourceMappingDto(
                proposalId = proposalId,
                weeklyGoalLocalIds = listOf(11),
                taskLocalIds = listOf(22, 23)
            )
        )

        val decoded = ProposalSourceMappingCodec.decodeOrEmpty(
            ProposalSourceMappingCodec.encode(entries)
        )

        assertEquals(entries, decoded)
    }

    @Test
    fun missingOrCorruptSettingsFailClosedToNoAttribution() {
        val malformed = listOf(
            "{}",
            "{\"version\":1,\"entries\":[{\"proposalId\":\"bad id\",\"weeklyGoalLocalIds\":[1],\"taskLocalIds\":[]}]}",
            "{\"version\":1,\"entries\":[{\"proposalId\":\"$proposalId\",\"weeklyGoalLocalIds\":[1,1],\"taskLocalIds\":[]}]}",
            "{\"version\":1,\"entries\":[{\"proposalId\":\"$proposalId\",\"weeklyGoalLocalIds\":[0],\"taskLocalIds\":[]}]}",
            "{\"version\":2,\"entries\":[]}",
            "not-json"
        )

        malformed.forEach { raw ->
            assertTrue("malformed source mapping must be empty: $raw", ProposalSourceMappingCodec.decodeOrEmpty(raw).isEmpty())
        }
    }

    @Test
    fun overLimitAndDuplicateEntriesFailClosed() {
        val overLimit = (0..ProposalSourceMappingCodec.MAX_ENTRIES).joinToString(",") { index ->
            "{\"proposalId\":\"$proposalId-$index\",\"weeklyGoalLocalIds\":[],\"taskLocalIds\":[]}"
        }
        val duplicateProposal = """
            {"version":1,"entries":[
              {"proposalId":"$proposalId","weeklyGoalLocalIds":[1],"taskLocalIds":[]},
              {"proposalId":"$proposalId","weeklyGoalLocalIds":[2],"taskLocalIds":[]}
            ]}
        """.trimIndent()

        assertTrue(
            ProposalSourceMappingCodec.decodeOrEmpty(
                "{\"version\":1,\"entries\":[$overLimit]}"
            ).isEmpty()
        )
        assertTrue(ProposalSourceMappingCodec.decodeOrEmpty(duplicateProposal).isEmpty())
    }

    @Test
    fun duplicateLocalIdsWithinEntryFailClosedForWeeklyGoalsAndTasks() {
        val cases = listOf(
            listOf(ProposalSourceMappingDto(proposalId, listOf(1, 2, 2), emptyList())),
            listOf(ProposalSourceMappingDto(proposalId, emptyList(), listOf(1, 2, 2)))
        )

        cases.forEach { entries ->
            val raw = rawDocument(entries)
            assertTrue(ProposalSourceMappingCodec.decodeOrEmpty(raw).isEmpty())
            assertThrows(IllegalArgumentException::class.java) {
                ProposalSourceMappingCodec.encode(entries)
            }
        }
    }

    @Test
    fun duplicateLocalIdsAcrossEntriesFailClosedForWeeklyGoalsAndTasks() {
        val otherProposalId = "7e8a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b"
        val cases = listOf(
            listOf(
                ProposalSourceMappingDto(proposalId, listOf(1, 2), emptyList()),
                ProposalSourceMappingDto(otherProposalId, listOf(2, 3), emptyList())
            ),
            listOf(
                ProposalSourceMappingDto(proposalId, emptyList(), listOf(1, 2)),
                ProposalSourceMappingDto(otherProposalId, emptyList(), listOf(2, 3))
            )
        )

        cases.forEach { entries ->
            val raw = rawDocument(entries)
            assertTrue(ProposalSourceMappingCodec.decodeOrEmpty(raw).isEmpty())
            assertThrows(IllegalArgumentException::class.java) {
                ProposalSourceMappingCodec.encode(entries)
            }
        }
    }

    @Test
    fun indexesIgnoreRowsThatNoLongerExist() {
        val raw = ProposalSourceMappingCodec.encode(
            listOf(ProposalSourceMappingDto(proposalId, listOf(11), listOf(22)))
        )

        val indexes = ProposalSourceMappingCodec.indexesOrEmpty(
            raw = raw,
            existingWeeklyGoalIds = setOf(11),
            existingTaskIds = emptySet()
        )

        assertEquals(proposalId, indexes.weeklyGoalByLocalId[11])
        assertTrue(22L !in indexes.taskByLocalId)
    }

    private fun rawDocument(entries: List<ProposalSourceMappingDto>): String {
        val entryJson = entries.joinToString(",") { entry ->
            val weekly = entry.weeklyGoalLocalIds.joinToString(",")
            val tasks = entry.taskLocalIds.joinToString(",")
            """{"proposalId":"${entry.proposalId}","weeklyGoalLocalIds":[$weekly],"taskLocalIds":[$tasks]}"""
        }
        return """{"version":1,"entries":[$entryJson]}"""
    }
}
