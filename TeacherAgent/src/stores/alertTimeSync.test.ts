import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  createSyncProposal,
  getSyncDeviceState,
  getSyncReadModel,
  lastSyncSnapshot,
  listSyncMappings,
  listSyncProposals,
  loadStudentKnowledge,
  loadPersistedSyncDiagnosticAssessments,
  searchLocalQuestionBankLazy
} = vi.hoisted(() => ({
  createSyncProposal: vi.fn(),
  getSyncDeviceState: vi.fn(),
  getSyncReadModel: vi.fn(),
  lastSyncSnapshot: vi.fn(),
  listSyncMappings: vi.fn(),
  listSyncProposals: vi.fn(),
  loadStudentKnowledge: vi.fn(),
  loadPersistedSyncDiagnosticAssessments: vi.fn(),
  searchLocalQuestionBankLazy: vi.fn()
}))

vi.mock("../services/sync/commands", () => ({
  createSyncProposal,
  firewallDiagnose: vi.fn(),
  getSyncDeviceState,
  getSyncReadModel,
  lastSyncSnapshot,
  listSyncDevices: vi.fn(),
  listSyncInterfaces: vi.fn(),
  listSyncMappings,
  listSyncProposals,
  newSyncPairing: vi.fn(),
  removeSyncMapping: vi.fn(),
  revokeSyncDevice: vi.fn(),
  setSyncMapping: vi.fn(),
  startSyncServer: vi.fn(),
  stopSyncServer: vi.fn(),
  loadPersistedSyncDiagnosticAssessments,
  syncServerStatus: vi.fn()
}))

vi.mock("../services/tauri/commands", () => ({
  bktUpdateMastery: vi.fn(),
  loadStudentKnowledge,
  saveAssessmentResult: vi.fn()
}))

vi.mock("../services/questions/localQuestionBankSearch", () => ({
  searchLocalQuestionBankLazy
}))

import { useAlertTimeSyncStore } from "./alertTimeSync"
import { mondayOfWeek } from "../engine/sync/weeklyReport"

const DEVICE_ID = "device-regression-20260811"
const SNAPSHOT_ID = "snapshot-regression-20260811"
const RECEIVED_AT = "2026-08-11T10:20:30.000Z"

describe("alertTimeSync store device loading", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    getSyncDeviceState.mockResolvedValue({
      readModel: {
        subjects: [],
        weeklyGoals: [],
        tasks: [],
        studySessions: [],
        latestLearningAnalysis: {
          analysisId: "analysis-regression-20260811",
          sourceSnapshotId: SNAPSHOT_ID,
          generatedAt: 1_786_435_200_000,
          promptVersion: "learning-analysis-v1",
          generator: "deterministic_fallback",
          profile: {
            facts: [],
            inferences: []
          },
          planEvaluation: {
            verdict: "insufficient_data",
            score: null,
            dimensions: [],
            risks: [],
            suggestions: []
          },
          assessmentDraft: {
            status: "draft",
            scopeSummary: "暂无足够数据",
            questions: []
          },
          warnings: []
        }
      },
      lastSnapshot: {
        snapshotId: SNAPSHOT_ID,
        receivedAt: RECEIVED_AT,
        subjectCount: 0,
        goalCount: 0,
        taskCount: 0,
        sessionCount: 0
      }
    })
    listSyncMappings.mockResolvedValue([
      {
        alertSubjectRemoteId: "subject-1",
        teacherSubjectId: "math"
      }
    ])
    listSyncProposals.mockResolvedValue([
      {
        proposalId: "proposal-1",
        deviceId: DEVICE_ID,
        version: 1,
        status: "pending",
        rationale: "固定回归夹具",
        proposedWeeklyGoals: [],
        proposedTasks: [],
        sourceAssessmentIds: [],
        createdAt: 1_786_435_200_000,
        expiresAt: null
      }
    ])
  })

  it("loads atomic device state and binds its snapshot to the weekly report", async () => {
    const store = useAlertTimeSyncStore()
    store.selectedDeviceId = DEVICE_ID

    await store.loadDevice()

    expect(store.readModel).toEqual({
      subjects: [],
      weeklyGoals: [],
      tasks: [],
      studySessions: [],
      latestLearningAnalysis: expect.objectContaining({
        generator: "deterministic_fallback",
        sourceSnapshotId: SNAPSHOT_ID
      })
    })
    expect(store.latestLearningAnalysis?.sourceSnapshotId).toBe(SNAPSHOT_ID)
    expect(store.lastSnapshot).toMatchObject({
      snapshotId: SNAPSHOT_ID,
      receivedAt: RECEIVED_AT
    })
    expect(store.lastSnapshot?.snapshotId).toBe(store.latestLearningAnalysis?.sourceSnapshotId)
    expect(store.mappings).toEqual([
      {
        alertSubjectRemoteId: "subject-1",
        teacherSubjectId: "math"
      }
    ])
    expect(store.proposals).toEqual([
      expect.objectContaining({ proposalId: "proposal-1", deviceId: DEVICE_ID })
    ])
    expect(store.report).toEqual(
      expect.objectContaining({
        snapshotId: SNAPSHOT_ID,
        dataUpdatedAt: RECEIVED_AT
      })
    )
    expect(store.busy).toBe(false)

    expect(getSyncDeviceState).toHaveBeenCalledOnce()
    expect(getSyncDeviceState).toHaveBeenCalledWith(DEVICE_ID)
    expect(getSyncReadModel).not.toHaveBeenCalled()
    expect(lastSyncSnapshot).not.toHaveBeenCalled()
  })

  it("poll reuses unchanged snapshot without reload, and reloads when snapshot changes", async () => {
    const store = useAlertTimeSyncStore()
    store.selectedDeviceId = DEVICE_ID
    await store.loadDevice()

    getSyncDeviceState.mockResolvedValueOnce({
      readModel: { subjects: [], weeklyGoals: [], tasks: [], studySessions: [], latestLearningAnalysis: null },
      lastSnapshot: { snapshotId: SNAPSHOT_ID, receivedAt: RECEIVED_AT, subjectCount: 0, goalCount: 0, taskCount: 0, sessionCount: 0 }
    })
    await store.pollDeviceChanges()
    expect(store.lastSnapshot?.snapshotId).toBe(SNAPSHOT_ID)
    expect(getSyncDeviceState).toHaveBeenCalledTimes(2)

    const NEW_ID = "snapshot-new-20260811"
    const newState = {
      readModel: { subjects: [], weeklyGoals: [], tasks: [], studySessions: [], latestLearningAnalysis: null },
      lastSnapshot: { snapshotId: NEW_ID, receivedAt: RECEIVED_AT, subjectCount: 0, goalCount: 0, taskCount: 0, sessionCount: 0 }
    }
    getSyncDeviceState.mockResolvedValue(newState)
    await store.pollDeviceChanges()
    expect(store.lastSnapshot?.snapshotId).toBe(NEW_ID)
    expect(store.busy).toBe(false)
  })

  it("diagnostic mastery query only receives the deduplicated current-question whitelist", async () => {
    const store = useAlertTimeSyncStore()
    store.diagnostic = {
      alertSubjectRemoteId: "subject-cn",
      teacherSubjectId: "cs408",
      examTrackId: "408",
      examSubjectId: "408.computer-networks",
      examModuleId: null,
      questions: [{
        questionId: "q-cn",
        content: "题目",
        type: "diagnostic",
        difficulty: 2,
        knowledgeNodeIds: ["cn-b", "cn-a", "cn-b"],
        sourceTitle: ""
      }],
      currentIndex: 0,
      records: [],
      running: true,
      summary: null,
      answers: ["42"],
      savedRecords: [],
      masteryUpdatedCount: 0,
      persisted: null
    }
    searchLocalQuestionBankLazy.mockResolvedValue({ ok: false, error: "not needed" })
    loadStudentKnowledge.mockResolvedValue([])

    await store.answerDiagnostic("42")

    expect(loadStudentKnowledge).toHaveBeenCalledWith("local-default-student", "cs408", 50, ["cn-a", "cn-b"])
  })

  it("按 mapping 隔离薄弱节点，并为 exam scope 传 approved 白名单；重复 mapping 不覆盖", async () => {
    const store = useAlertTimeSyncStore()
    store.mappings = [
      { alertSubjectRemoteId: "subject-cn", teacherSubjectId: "cs408", examTrackId: "408", examSubjectId: "408.computer-networks" },
      { alertSubjectRemoteId: "subject-cn", teacherSubjectId: "cs408", examTrackId: "408", examSubjectId: "408.computer-networks" },
      { alertSubjectRemoteId: "subject-os", teacherSubjectId: "cs408", examTrackId: "408", examSubjectId: "408.operating-systems" }
    ]
    loadStudentKnowledge
      .mockResolvedValueOnce([{ knowledgeNodeId: "cn-node", title: "计网", attemptsCount: 1, masteryProbability: 0.2 }])

    expect(store.mappings).toHaveLength(3)
    const result = await store.loadWeakNodesByMapping()

    expect(loadStudentKnowledge).toHaveBeenCalledTimes(1)
    expect(loadStudentKnowledge.mock.calls[0]?.slice(0, 3)).toEqual(["local-default-student", "cs408", 100])
    expect(loadStudentKnowledge.mock.calls[0]?.[3]).toEqual(expect.arrayContaining([expect.any(String)]))
    expect(result).toEqual({
      "subject-cn": [{ nodeId: "cn-node", title: "计网", mastery: 0.2 }],
      "subject-os": []
    })
  })

  it("从 DB 记录重建计数和归属，localStorage 篡改 1/5 与 OS 不生效", async () => {
    const store = useAlertTimeSyncStore()
    store.mappings = [{
      alertSubjectRemoteId: "subject-cn",
      teacherSubjectId: "cs408",
      examTrackId: "408",
      examSubjectId: "408.computer-networks",
      examModuleId: null
    }]
    store.diagnosticEvidence = [{
      assessmentId: "diag-2",
      assessmentIds: ["diag-1", "diag-1", "diag-2", "diag-bad-time"],
      alertSubjectRemoteId: "wrong-subject",
      teacherSubjectId: "wrong-subject",
      examTrackId: "wrong",
      examSubjectId: "408.operating-systems",
      examModuleId: null,
      questionCount: 5,
      correctCount: 5,
      atMs: 1
    }]
    loadPersistedSyncDiagnosticAssessments.mockResolvedValue([
      {
        assessmentId: "diag-1",
        teacherSubjectId: "cs408",
        correct: true,
        questionId: "q-cn-1",
        alertSubjectRemoteId: "subject-cn",
        examTrackId: "408",
        examSubjectId: "408.computer-networks",
        examModuleId: null,
        createdAt: "2026-08-11T10:00:00.000Z"
      },
      {
        assessmentId: "diag-2",
        teacherSubjectId: "cs408",
        correct: false,
        questionId: "q-cn-2",
        alertSubjectRemoteId: "subject-cn",
        examTrackId: "408",
        examSubjectId: "408.computer-networks",
        examModuleId: null,
        createdAt: "2026-08-11T10:01:00.000Z"
      },
      {
        assessmentId: "diag-bad-time",
        teacherSubjectId: "cs408",
        correct: true,
        questionId: "q-cn-bad-time",
        alertSubjectRemoteId: "subject-cn",
        examTrackId: "408",
        examSubjectId: "408.computer-networks",
        examModuleId: null,
        createdAt: "not-a-date"
      }
    ])

    const result = await store.persistedDiagnosticEvidence()
    expect(result).toEqual([expect.objectContaining({
      assessmentIds: ["diag-1", "diag-2"],
      teacherSubjectId: "cs408",
      alertSubjectRemoteId: "subject-cn",
      examSubjectId: "408.computer-networks",
      questionCount: 2,
      correctCount: 1,
      createdAt: "2026-08-11T10:01:00.000Z"
    })])
  })

  it("legacy 无 remoteId 只在当前 teacherSubject 唯一映射时兼容", async () => {
    const store = useAlertTimeSyncStore()
    store.diagnosticEvidence = [{
      assessmentId: "diag-legacy",
      assessmentIds: ["diag-legacy"],
      teacherSubjectId: "cs408",
      questionCount: 1,
      correctCount: 1,
      atMs: 1
    }]
    loadPersistedSyncDiagnosticAssessments.mockResolvedValue([{
      assessmentId: "diag-legacy",
      teacherSubjectId: "cs408",
      correct: true,
      questionId: "q-old",
      alertSubjectRemoteId: null,
      examTrackId: null,
      examSubjectId: null,
      examModuleId: null,
      createdAt: "2026-08-11T10:00:00.000Z"
    }])
    store.mappings = [
      { alertSubjectRemoteId: "subject-cn", teacherSubjectId: "cs408", examTrackId: "408", examSubjectId: "408.computer-networks", examModuleId: null },
      { alertSubjectRemoteId: "subject-os", teacherSubjectId: "cs408", examTrackId: "408", examSubjectId: "408.operating-systems", examModuleId: null }
    ]
    expect(await store.persistedDiagnosticEvidence()).toEqual([])

    store.mappings = [{
      alertSubjectRemoteId: "subject-cn",
      teacherSubjectId: "cs408",
      examTrackId: "408",
      examSubjectId: "408.computer-networks",
      examModuleId: null
    }]
    expect(await store.persistedDiagnosticEvidence()).toEqual([expect.objectContaining({
      alertSubjectRemoteId: "subject-cn",
      examSubjectId: "408.computer-networks",
      questionCount: 1,
      correctCount: 1
    })])
  })

  it("legacy 带历史 scope 时 mapping 改指叶子会拒绝复用", async () => {
    const store = useAlertTimeSyncStore()
    store.diagnosticEvidence = [{
      assessmentId: "diag-legacy-scoped",
      assessmentIds: ["diag-legacy-scoped"],
      teacherSubjectId: "cs408",
      questionCount: 1,
      correctCount: 1,
      atMs: 1
    }]
    loadPersistedSyncDiagnosticAssessments.mockResolvedValue([{
      assessmentId: "diag-legacy-scoped",
      teacherSubjectId: "cs408",
      correct: true,
      questionId: "q-old-cn",
      alertSubjectRemoteId: null,
      examTrackId: "408",
      examSubjectId: "408.computer-networks",
      examModuleId: null,
      createdAt: "2026-08-11T10:00:00.000Z"
    }])
    store.mappings = [{
      alertSubjectRemoteId: "subject-os",
      teacherSubjectId: "cs408",
      examTrackId: "408",
      examSubjectId: "408.operating-systems",
      examModuleId: null
    }]
    expect(await store.persistedDiagnosticEvidence()).toEqual([])
  })

  it("生成建议时把全部 accepted proposals 作为保守去重证据", async () => {
    createSyncProposal.mockResolvedValue({
      proposalId: "new-proposal",
      deviceId: DEVICE_ID,
      version: 1,
      status: "pending",
      rationale: "新建议",
      proposedWeeklyGoals: [],
      proposedTasks: [],
      sourceAssessmentIds: ["diag-store"],
      createdAt: 1_786_435_200_000,
      expiresAt: null
    })
    getSyncDeviceState.mockResolvedValueOnce({
      readModel: {
        subjects: [{ remoteId: "subject-1", name: "英语", isArchived: false, createdAt: 1, updatedAt: 1, deletedAt: null }],
        weeklyGoals: [],
        tasks: [],
        studySessions: []
      },
      lastSnapshot: {
        snapshotId: SNAPSHOT_ID,
        receivedAt: RECEIVED_AT,
        subjectCount: 1,
        goalCount: 0,
        taskCount: 0,
        sessionCount: 0
      }
    })
    listSyncMappings.mockResolvedValueOnce([{ alertSubjectRemoteId: "subject-1", teacherSubjectId: "english" }])
    const targetWeekStart = mondayOfWeek(Date.now()) + 7 * 24 * 60 * 60 * 1000
    const accepted = {
      proposalId: "accepted-store",
      deviceId: DEVICE_ID,
      version: 1,
      status: "accepted" as const,
      rationale: "已采纳",
      proposedWeeklyGoals: [{ weekStart: targetWeekStart, title: "完成「英语」本周巩固计划", successCriteria: "诊断正确率 ≥ 80%" }],
      proposedTasks: [{ title: "保持本周学习节奏（每天至少 30 分钟有效学习）", subjectRemoteId: null, targetDurationSeconds: 1800, dueAt: null }],
      sourceAssessmentIds: [],
      createdAt: Date.now(),
      expiresAt: null
    }
    listSyncProposals.mockResolvedValueOnce([accepted])
    loadPersistedSyncDiagnosticAssessments.mockResolvedValue([
      {
        assessmentId: "diag-store",
        teacherSubjectId: "english",
        correct: true,
        questionId: "q-store",
        alertSubjectRemoteId: "subject-1",
        examTrackId: null,
        examSubjectId: null,
        examModuleId: null,
        createdAt: RECEIVED_AT
      }
    ])
    loadStudentKnowledge.mockResolvedValue([])

    const store = useAlertTimeSyncStore()
    store.selectedDeviceId = DEVICE_ID
    store.diagnosticEvidence = [{
      assessmentId: "diag-store",
      assessmentIds: ["diag-store"],
      alertSubjectRemoteId: "subject-1",
      teacherSubjectId: "english",
      questionCount: 1,
      correctCount: 1,
      atMs: targetWeekStart
    }]
    await store.loadDevice()
    await store.generateProposal()

    expect(createSyncProposal).toHaveBeenCalledOnce()
    const input = createSyncProposal.mock.calls[0]?.[0]
    expect(input.proposedTasks).not.toContainEqual(accepted.proposedTasks[0])
    expect(input.proposedWeeklyGoals).not.toContainEqual(accepted.proposedWeeklyGoals[0])
  })
})
