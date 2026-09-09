package com.hxz.alerttime.app.data.sync

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hxz.alerttime.app.core.StatusCodes
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import com.hxz.alerttime.app.data.local.entity.SubjectEntity
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import com.hxz.alerttime.app.data.local.entity.WeeklyGoalEntity
import java.util.UUID
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Proposal 原子采纳与幂等 instrumentation 测试。
 */
@RunWith(AndroidJUnit4::class)
class SyncProposalStoreInstrumentedTest {

    private lateinit var database: AlertTimeDatabase
    private lateinit var store: SyncProposalStore

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, AlertTimeDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        store = SyncProposalStore(database, database.appSettingDao())
    }

    @After
    fun tearDown() {
        database.close()
    }

    private fun proposal(
        id: String = UUID.randomUUID().toString(),
        subjectRemoteId: String? = "subject-remote-1",
        expiresAt: Long? = null
    ): SyncProposalDto {
        return SyncProposalDto(
            proposalId = id,
            deviceId = "f0a24c19-0f8e-4b6d-9a3c-77e1b2d4c5a6",
            version = 1,
            status = "pending",
            rationale = "测试建议",
            proposedWeeklyGoals = listOf(
                SyncProposedWeeklyGoalDto(weekStart = 1, title = "完成本周计划", successCriteria = null)
            ),
            proposedTasks = listOf(
                SyncProposedTaskDto(
                    title = "复习测试",
                    subjectRemoteId = subjectRemoteId,
                    targetDurationSeconds = 1800,
                    dueAt = null
                )
            ),
            sourceAssessmentIds = listOf("a1"),
            createdAt = 1,
            expiresAt = expiresAt
        )
    }

    private suspend fun seedSubjectWithRemoteId(): Long {
        val userId = AlertTimeDatabase.ensureLocalUserId(database)
        return database.subjectDao().upsert(
            SubjectEntity(
                userId = userId,
                name = "英语",
                remoteId = "subject-remote-1",
                createdAt = 1,
                updatedAt = 1
            )
        )
    }

    @Test
    fun atomicAccept_createsGoalsAndTasksAndMarker() = runBlocking {
        seedSubjectWithRemoteId()
        val p = proposal()
        assertTrue(store.acceptProposal(p))

        val userId = AlertTimeDatabase.ensureLocalUserId(database)
        val goals = database.weeklyGoalDao().exportAll()
        val tasks = database.taskDao().exportAll()
        assertEquals(1, goals.size)
        assertEquals("完成本周计划", goals[0].title)
        assertEquals(StatusCodes.WEEKLY_GOAL_TODO, goals[0].status)
        assertEquals(1, tasks.size)
        assertEquals("复习测试", tasks[0].title)
        assertEquals(StatusCodes.TYPE_PLAN, tasks[0].type)
        assertEquals(StatusCodes.TASK_TODO, tasks[0].status)
        assertTrue(store.processedProposalIds().contains(p.proposalId))
        assertEquals(1, store.pendingDecisions().size)
        assertEquals("accepted", store.pendingDecisions()[0].decision)
        val source = store.sourceMappings().single()
        assertEquals(p.proposalId, source.proposalId)
        assertEquals(goals[0].id, source.weeklyGoalLocalIds.single())
        assertEquals(tasks[0].id, source.taskLocalIds.single())
    }

    @Test
    fun duplicateAccept_createsOnlyOnce() = runBlocking {
        seedSubjectWithRemoteId()
        val p = proposal()
        assertTrue(store.acceptProposal(p))
        // 重复采纳（崩溃/重启重试路径）：不重复创建。
        assertFalse(store.acceptProposal(p))

        val userId = AlertTimeDatabase.ensureLocalUserId(database)
        assertEquals(1, database.weeklyGoalDao().exportAll().size)
        assertEquals(1, database.taskDao().exportAll().size)
        assertEquals(1, store.processedProposalIds().size)
        assertEquals(1, store.sourceMappings().size)
    }

    @Test
    fun accept_whenProcessedMarkerEvictedButPendingDecisionRemains_doesNotCreateAgain() = runBlocking {
        seedSubjectWithRemoteId()
        val p = proposal()
        assertTrue(store.acceptProposal(p))
        store.clearProcessedProposalIds()

        assertFalse(store.acceptProposal(p))
        assertEquals(1, database.weeklyGoalDao().exportAll().size)
        assertEquals(1, database.taskDao().exportAll().size)
        assertEquals(1, store.pendingDecisions().count { it.proposalId == p.proposalId })
    }

    @Test
    fun nonPendingProposal_cannotBeAcceptedOrRejected() = runBlocking {
        seedSubjectWithRemoteId()

        for (status in listOf("accepted", "rejected", "superseded")) {
            val p = proposal(id = "status-$status").copy(status = status)
            assertFalse(store.acceptProposal(p))
            assertFalse(store.rejectProposal(p))
        }

        assertEquals(0, database.weeklyGoalDao().exportAll().size)
        assertEquals(0, database.taskDao().exportAll().size)
        assertTrue(store.pendingDecisions().isEmpty())
        assertTrue(store.processedProposalIds().isEmpty())
    }

    @Test
    fun concurrentAccept_createsOnlyOnce() = runBlocking {
        seedSubjectWithRemoteId()
        val p = proposal()
        coroutineScope {
            val first = async { store.acceptProposal(p) }
            val second = async { store.acceptProposal(p) }
            val results = listOf(first.await(), second.await())
            // 一个成功创建、一个幂等返回。
            assertEquals(1, results.count { it })
        }
        val userId = AlertTimeDatabase.ensureLocalUserId(database)
        assertEquals(1, database.weeklyGoalDao().exportAll().size)
        assertEquals(1, database.taskDao().exportAll().size)
    }

    @Test
    fun expiredProposal_cannotBeAccepted() = runBlocking {
        seedSubjectWithRemoteId()
        val p = proposal(expiresAt = System.currentTimeMillis() - 1000)
        val error = acceptExpectingFailure(p)
        assertTrue(error.message!!.contains("过期"))
        assertEquals(0, database.weeklyGoalDao().exportAll().size)
        assertEquals(0, database.taskDao().exportAll().size)
        assertFalse(store.processedProposalIds().contains(p.proposalId))
    }

    @Test
    fun invalidSubjectReference_rollsBackWholeBatch() = runBlocking {
        seedSubjectWithRemoteId()
        // 引用了不存在的科目 → 整批拒绝，周目标也不得创建（单事务回滚）。
        val p = proposal(subjectRemoteId = "subject-does-not-exist")
        val error = acceptExpectingFailure(p)
        assertTrue(error.message!!.contains("不存在"))
        assertEquals(0, database.weeklyGoalDao().exportAll().size)
        assertEquals(0, database.taskDao().exportAll().size)
        assertFalse(store.processedProposalIds().contains(p.proposalId))
    }

    @Test
    fun archivedOrSoftDeletedSubject_rejectsWithZeroWrites() = runBlocking {
        val userId = AlertTimeDatabase.ensureLocalUserId(database)
        database.subjectDao().upsert(
            SubjectEntity(
                userId = userId,
                name = "已归档",
                remoteId = "archived-subject-1",
                isArchived = true,
                createdAt = 1,
                updatedAt = 1
            )
        )
        val archivedError = acceptExpectingFailure(
            proposal(id = "archived-proposal-1", subjectRemoteId = "archived-subject-1")
        )
        assertTrue(archivedError.message!!.contains("未删除未归档"))
        assertEquals(0, database.weeklyGoalDao().exportAll().size)
        assertEquals(0, database.taskDao().exportAll().size)
        assertTrue(store.processedProposalIds().isEmpty())
        assertTrue(store.pendingDecisions().isEmpty())
        assertTrue(store.sourceMappings().isEmpty())

        database.subjectDao().upsert(
            SubjectEntity(
                userId = userId,
                name = "已删除",
                remoteId = "deleted-subject-1",
                deletedAt = 99,
                createdAt = 1,
                updatedAt = 99
            )
        )
        val deletedError = acceptExpectingFailure(
            proposal(id = "deleted-proposal-1", subjectRemoteId = "deleted-subject-1")
        )
        assertTrue(deletedError.message!!.contains("未删除未归档"))
        assertEquals(0, database.weeklyGoalDao().exportAll().size)
        assertEquals(0, database.taskDao().exportAll().size)
        assertTrue(store.processedProposalIds().isEmpty())
        assertTrue(store.pendingDecisions().isEmpty())
        assertTrue(store.sourceMappings().isEmpty())
    }

    @Test
    fun corruptSourceSetting_failsClosedAndDoesNotBlockOrdinaryAccept() = runBlocking {
        seedSubjectWithRemoteId()
        database.appSettingDao().upsert(
            AppSettingEntity(
                key = ProposalSourceMappingCodec.KEY,
                value = "{\"version\":1,\"entries\":[{\"proposalId\":\"bad id\",\"weeklyGoalLocalIds\":[1],\"taskLocalIds\":[]}]}",
                updatedAt = 1
            )
        )
        assertTrue(store.sourceMappings().isEmpty())

        val p = proposal()
        assertTrue(store.acceptProposal(p))
        assertEquals(1, store.sourceMappings().size)
        assertEquals(p.proposalId, store.sourceMappings().single().proposalId)
    }

    /** assertThrows 的 lambda 不是 suspend 上下文，用显式 try/catch 捕获预期失败。 */
    private suspend fun acceptExpectingFailure(p: SyncProposalDto): SyncValidationException {
        return try {
            store.acceptProposal(p)
            throw AssertionError("预期抛出 SyncValidationException")
        } catch (error: SyncValidationException) {
            error
        }
    }

    @Test
    fun reject_createsNoBusinessData() = runBlocking {
        seedSubjectWithRemoteId()
        val p = proposal()
        assertTrue(store.rejectProposal(p))
        assertEquals(0, database.weeklyGoalDao().exportAll().size)
        assertEquals(0, database.taskDao().exportAll().size)
        assertTrue(store.processedProposalIds().contains(p.proposalId))
        assertEquals("rejected", store.pendingDecisions()[0].decision)
        assertTrue(store.sourceMappings().isEmpty())
        // 重复拒绝幂等。
        assertFalse(store.rejectProposal(p))
    }

    @Test
    fun failedAccept_keepsPreviousDataIntact() = runBlocking {
        seedSubjectWithRemoteId()
        // 先成功采纳一个建议。
        assertTrue(store.acceptProposal(proposal(id = "aaaa-1111")))
        val goalsBefore = database.weeklyGoalDao().exportAll().size
        val tasksBefore = database.taskDao().exportAll().size

        // 第二个建议引用非法科目 → 事务失败，旧数据完整。
        val bad = proposal(id = "bbbb-2222", subjectRemoteId = "missing-subject")
        val error = acceptExpectingFailure(bad)
        assertTrue(error.message!!.contains("不存在"))

        assertEquals(goalsBefore, database.weeklyGoalDao().exportAll().size)
        assertEquals(tasksBefore, database.taskDao().exportAll().size)
        // 第一个建议的标记仍在。
        assertTrue(store.processedProposalIds().contains("aaaa-1111"))
    }

    @Test
    fun clearPairingRuntimeState_removesAllSyncCaches() = runBlocking {
        seedSubjectWithRemoteId()
        val p = proposal()
        store.acceptProposal(p)
        val proposalsBefore = store.proposals().size
        val decisionsBefore = store.pendingDecisions().size
        assertTrue(proposalsBefore > 0 || decisionsBefore > 0)

        store.clearPairingRuntimeState()
        val proposalsAfter = store.proposals().size
        val decisionsAfter = store.pendingDecisions().size
        val processedAfter = store.processedProposalIds().size
        assertEquals(0, proposalsAfter)
        assertEquals(0, decisionsAfter)
        assertEquals(0, processedAfter)
        assertEquals(0, store.sourceMappings().size)
        // 业务数据不受影响。
        assertEquals(1, database.taskDao().exportAll().size)
    }
}
