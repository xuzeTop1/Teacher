import { describe, expect, it } from "vitest"
import type { SyncProposal, SyncReadModel } from "../../types/sync"
import { proposalOutcome } from "./proposalOutcome"

const task = {
  title: "复习操作系统",
  subjectRemoteId: "subject-os",
  targetDurationSeconds: 1800,
  dueAt: 1786000000000
}

const goal = {
  weekStart: 1785888000000,
  title: "完成操作系统巩固",
  successCriteria: "正确率 ≥ 80%"
}

function proposal(overrides: Partial<SyncProposal> = {}): SyncProposal {
  return {
    proposalId: "proposal-a",
    deviceId: "device-a",
    version: 1,
    status: "accepted",
    rationale: "测试",
    proposedWeeklyGoals: [goal],
    proposedTasks: [task],
    sourceAssessmentIds: [],
    createdAt: 1785900000000,
    expiresAt: null,
    ...overrides
  }
}

function model(overrides: Partial<SyncReadModel> = {}): SyncReadModel {
  return { subjects: [], weeklyGoals: [], tasks: [], studySessions: [], ...overrides }
}

describe("proposalOutcome", () => {
  it("只统计来源和字段都一致的完整执行结果", () => {
    const result = proposalOutcome(
      proposal(),
      model({
        weeklyGoals: [{ ...goal, remoteId: "goal-1", status: 1, completedAt: goal.weekStart, deferredToWeekStart: null, exceptionReason: null, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" }],
        tasks: [{ ...task, remoteId: "task-1", content: null, type: 1, priority: 0, status: 1, completedAt: task.dueAt, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" }]
      })
    )

    expect(result.traceable).toBe(true)
    expect(result.totalSummary).toMatchObject({ expected: 2, materialized: 2, completed: 2, pending: 0, deleted: 0, missing: 0, completionRate: 1 })
    expect(result.warnings).toEqual([])
  })

  it("部分完成、删除和缺失都进入分母，不能夸大完成率", () => {
    const result = proposalOutcome(
      proposal({
        proposedTasks: [task, { ...task, title: "补做计网" }],
        proposedWeeklyGoals: [goal, { ...goal, title: "完成第二个目标" }]
      }),
      model({
        weeklyGoals: [{ ...goal, remoteId: "goal-deleted", status: 0, completedAt: null, deferredToWeekStart: null, exceptionReason: null, createdAt: 1, updatedAt: 2, deletedAt: 3, sourceProposalId: "proposal-a" }],
        tasks: [{ ...task, remoteId: "task-pending", content: null, type: 1, priority: 0, status: 0, completedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" }]
      })
    )

    expect(result.totalSummary).toMatchObject({ expected: 4, materialized: 2, completed: 0, pending: 1, deleted: 1, missing: 2, completionRate: 0 })
    expect(result.warnings).toEqual([
      { code: "NO_EXACT_MATERIALIZATION", count: 2 }
    ])
  })

  it("字段漂移、跨 proposal 和旧客户端无来源都 fail-closed", () => {
    const result = proposalOutcome(
      proposal({ proposedTasks: [{ ...task, title: "字段漂移" }, { ...task, title: "跨 proposal" }, { ...task, title: "无来源标题" }] }),
      model({
        tasks: [
          { ...task, remoteId: "drift", title: "字段漂移已被篡改", content: null, type: 1, priority: 0, status: 1, completedAt: 1, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" },
          { ...task, remoteId: "other", title: "跨 proposal", content: null, type: 1, priority: 0, status: 1, completedAt: 1, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-other" },
          { ...task, remoteId: "legacy", title: "无来源标题", content: null, type: 1, priority: 0, status: 1, completedAt: 1, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null }
        ]
      })
    )

    expect(result.tasksSummary).toMatchObject({ expected: 3, materialized: 0, missing: 3, completionRate: 0 })
    expect(result.warnings).toEqual([
      { code: "NO_EXACT_MATERIALIZATION", count: 1 },
      { code: "SOURCE_PROPOSAL_CROSS_MATCH", count: 1 },
      { code: "SOURCE_PROPOSAL_FIELD_DRIFT", count: 1 },
      { code: "SOURCE_PROPOSAL_ID_MISSING", count: 1 },
      { code: "UNEXPECTED_SOURCE_ENTITY", count: 1 }
    ])
  })

  it("重复实体和重复 proposal item 都不重复计数", () => {
    const result = proposalOutcome(
      proposal({ proposedWeeklyGoals: [], proposedTasks: [task, task] }),
      model({
        tasks: [
          { ...task, remoteId: "same-task", content: null, type: 1, priority: 0, status: 0, completedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" },
          { ...task, remoteId: "duplicate-task", content: null, type: 1, priority: 0, status: 0, completedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" }
        ]
      })
    )

    expect(result.tasksSummary).toMatchObject({ expected: 2, materialized: 0, missing: 2 })
    expect(result.warnings).toEqual([{ code: "DUPLICATE_MATERIALIZATION", count: 2 }])
  })

  it("没有 sourceProposalId 的旧快照保持可读但不伪装为已执行", () => {
    const result = proposalOutcome(
      proposal({ proposedWeeklyGoals: [], proposedTasks: [task] }),
      model({ tasks: [{ ...task, remoteId: "legacy", content: null, type: 1, priority: 0, status: 1, completedAt: 1, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null }] })
    )

    expect(result.traceable).toBe(false)
    expect(result.tasksSummary).toMatchObject({ expected: 1, materialized: 0, completed: 0, missing: 1, completionRate: 0 })
    expect(result.warnings).toEqual([{ code: "SOURCE_PROPOSAL_ID_MISSING", count: 1 }])
  })

  it.each([0, 2])("同源任务 type=%s 时按字段漂移 fail-closed，不计入完成", (taskType) => {
    const result = proposalOutcome(
      proposal({ proposedWeeklyGoals: [], proposedTasks: [task] }),
      model({
        tasks: [{ ...task, remoteId: `task-type-${taskType}`, content: null, type: taskType, priority: 0, status: 1, completedAt: 1, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" }]
      })
    )

    expect(result.traceable).toBe(false)
    expect(result.tasksSummary).toMatchObject({ expected: 1, materialized: 0, completed: 0, missing: 1, completionRate: 0 })
    expect(result.warnings).toContainEqual({ code: "SOURCE_PROPOSAL_FIELD_DRIFT", count: 1 })
    expect(result.warnings).toContainEqual({ code: "UNEXPECTED_SOURCE_ENTITY", count: 1 })
  })

  it("pending/rejected proposal 不产生执行反馈，也不参加统计", () => {
    const result = proposalOutcome(proposal({ status: "pending" }), model())
    expect(result.totalSummary).toEqual({ expected: 0, materialized: 0, completed: 0, pending: 0, closed: 0, deleted: 0, missing: 0, completionRate: null })
    expect(result.warnings).toEqual([{ code: "PROPOSAL_NOT_ACCEPTED", count: 1 }])
  })

  it("status 2/3 计为 closed，pending 只统计 status 0", () => {
    const result = proposalOutcome(
      proposal(),
      model({
        weeklyGoals: [{ ...goal, remoteId: "goal-closed", status: 3, completedAt: null, deferredToWeekStart: null, exceptionReason: "取消", createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" }],
        tasks: [{ ...task, remoteId: "task-closed", content: null, type: 1, priority: 0, status: 2, completedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" }]
      })
    )

    expect(result.totalSummary).toMatchObject({ expected: 2, materialized: 2, completed: 0, pending: 0, closed: 2, deleted: 0, missing: 0, completionRate: 0 })
    expect(result.tasks[0]?.state).toBe("closed")
    expect(result.weeklyGoals[0]?.state).toBe("closed")
  })

  it("同源但不匹配任何 expected item 的实体只告警，不抬高统计", () => {
    const result = proposalOutcome(
      proposal(),
      model({
        weeklyGoals: [
          { ...goal, remoteId: "goal-1", status: 0, completedAt: null, deferredToWeekStart: null, exceptionReason: null, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" },
          { ...goal, remoteId: "goal-extra", title: "额外目标", status: 1, completedAt: 2, deferredToWeekStart: null, exceptionReason: null, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" }
        ],
        tasks: [
          { ...task, remoteId: "task-1", content: null, type: 1, priority: 0, status: 0, completedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" },
          { ...task, remoteId: "task-extra", title: "额外任务", content: null, type: 1, priority: 0, status: 1, completedAt: 2, sortOrder: 0, createdAt: 1, updatedAt: 2, deletedAt: null, sourceProposalId: "proposal-a" }
        ]
      })
    )

    expect(result.totalSummary).toMatchObject({ expected: 2, materialized: 2, completed: 0, pending: 2, closed: 0, missing: 0, completionRate: 0 })
    expect(result.warnings).toContainEqual({ code: "UNEXPECTED_SOURCE_ENTITY", count: 2 })
  })
})
