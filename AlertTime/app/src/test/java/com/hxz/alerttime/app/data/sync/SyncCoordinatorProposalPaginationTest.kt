package com.hxz.alerttime.app.data.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncCoordinatorProposalPaginationTest {

    private val deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6"

    @Test
    fun `fetches 50 plus one across two pages in server order`() = runBlockingTest {
        val first = (0 until 50).map { proposal("${it.toString().padStart(2, '0')}111111-1111-4111-8111-111111111111", 2000L - it) }
        val second = proposal("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1900L)
        val cursors = mutableListOf<String?>()

        val result = fetchAllProposalPages(deviceId) { cursor ->
            cursors += cursor
            when (cursor) {
                null -> page(first, first.last().proposalId)
                first.last().proposalId -> page(listOf(second), null)
                else -> error("unexpected cursor")
            }
        }

        assertEquals(51, result.size)
        assertEquals(first.map { it.proposalId } + second.proposalId, result.map { it.proposalId })
        assertEquals(listOf(null, first.last().proposalId), cursors)
    }

    @Test
    fun `empty tail terminates`() = runBlockingTest {
        val first = proposal("11111111-1111-4111-8111-111111111111", 2)
        val cursor = first.proposalId
        val calls = mutableListOf<String?>()

        val result = fetchAllProposalPages(deviceId) { requested ->
            calls += requested
            if (requested == null) page(listOf(first), cursor) else page(emptyList(), null)
        }

        assertEquals(listOf(first), result)
        assertEquals(listOf(null, cursor), calls)
    }

    @Test
    fun `null cursor on a nonempty page is a compatible terminal response`() = runBlockingTest {
        val only = proposal("22222222-2222-4222-8222-222222222222", 1)
        val result = fetchAllProposalPages(deviceId) { page(listOf(only), null) }
        assertEquals(listOf(only), result)
    }

    @Test
    fun `duplicate id across pages fails closed`() = runBlockingTest {
        val duplicate = proposal("33333333-3333-4333-8333-333333333333", 2)
        val error = assertThrows(SyncValidationException::class.java) {
            runBlockingTest {
                fetchAllProposalPages(deviceId) { cursor ->
                    if (cursor == null) page(listOf(duplicate), duplicate.proposalId)
                    else page(listOf(duplicate), null)
                }
            }
        }
        assertTrue(error.message!!.contains("重复"))
    }

    @Test
    fun `cursor loop or repeated cursor id fails closed under strict cursor contract`() = runBlockingTest {
        val first = proposal("44444444-4444-4444-8444-444444444444", 2)
        val second = proposal("55555555-5555-4555-8555-555555555555", 1)
        val error = assertThrows(SyncValidationException::class.java) {
            runBlockingTest {
                fetchAllProposalPages(deviceId) { cursor ->
                    when (cursor) {
                        null -> page(listOf(first), first.proposalId)
                        first.proposalId -> page(listOf(second), second.proposalId)
                        second.proposalId -> page(listOf(first), first.proposalId)
                        else -> error("unexpected cursor")
                    }
                }
            }
        }
        // 在严格的 nextCursor == page.last.proposalId 契约下，合法的 cursor 回环必然
        // 重新带回已经见过的 proposalId；重复 ID 门禁先 fail-closed，requestedCursors
        // 仍保留为防御性纵深保护。
        assertTrue(error.message!!.contains("重复") || error.message!!.contains("循环"))
    }

    @Test
    fun `middle page failure returns no partial aggregate`() = runBlockingTest {
        val first = proposal("66666666-6666-4666-8666-666666666666", 2)
        val calls = mutableListOf<String?>()
        val error = assertThrows(IllegalStateException::class.java) {
            runBlockingTest {
                fetchAllProposalPages(deviceId) { cursor ->
                    calls += cursor
                    if (cursor == null) page(listOf(first), first.proposalId)
                    else error("network failure")
                }
            }
        }
        assertEquals(listOf(null, first.proposalId), calls)
        // helper 只有成功返回才产生 List；异常路径没有任何可交给 mergeFromServer 的结果。
        assertTrue(error.message!!.contains("network failure"))
    }

    @Test
    fun `reaching local cap stops without requesting an unbounded tail`() = runBlockingTest {
        val first = proposal("77777777-7777-4777-8777-777777777777", 2)
        val second = proposal("88888888-8888-4888-8888-888888888888", 1)
        val calls = mutableListOf<String?>()
        val result = fetchAllProposalPages(deviceId, maxProposals = 2) { cursor ->
            calls += cursor
            if (cursor == null) page(listOf(first), first.proposalId)
            else page(listOf(second), null)
        }
        assertEquals(2, result.size)
        assertEquals(listOf(null, first.proposalId), calls)
    }

    @Test
    fun `page that crosses local cap fails closed`() = runBlockingTest {
        val first = proposal("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", 2)
        val second = proposal("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", 1)
        val error = assertThrows(SyncValidationException::class.java) {
            runBlockingTest {
                fetchAllProposalPages(deviceId, maxProposals = 1) { page(listOf(first, second), null) }
            }
        }
        assertTrue(error.message!!.contains("上限"))
    }

    @Test
    fun `proposal path encodes validated cursor`() {
        val cursor = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        assertEquals("/v1/proposals", proposalPath(null))
        assertEquals("/v1/proposals?cursor=$cursor", proposalPath(cursor))
        assertThrows(SyncValidationException::class.java) { proposalPath("not valid") }
    }

    private fun proposal(id: String, createdAt: Long): SyncProposalDto = SyncProposalDto(
        proposalId = id,
        deviceId = deviceId,
        version = 1,
        status = "pending",
        rationale = "按本次计划生成建议",
        proposedWeeklyGoals = emptyList(),
        proposedTasks = emptyList(),
        sourceAssessmentIds = emptyList(),
        createdAt = createdAt,
        expiresAt = null
    )

    private fun page(proposals: List<SyncProposalDto>, nextCursor: String?) =
        SyncProposalsListPayload(proposals = proposals, nextCursor = nextCursor)

    private fun <T> runBlockingTest(block: suspend () -> T): T =
        kotlinx.coroutines.runBlocking { block() }
}
