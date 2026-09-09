import { describe, expect, it } from "vitest"
import {
  canGenerateProposal,
  planProposal,
  WEEK_MS,
  type ProposalPlannerInput
} from "./proposalPlanner"
import { computeWeeklyReport, mondayOfWeek } from "./weeklyReport"
import type { SyncProposal, SyncReadModel } from "../../types/sync"
import type { ProposalOutcome } from "./proposalOutcome"

const weekStart = mondayOfWeek(new Date(2026, 7, 3, 12).getTime())
const fixtureNowMs = new Date(2026, 7, 3, 12).getTime()

function baseModel(): SyncReadModel {
  return {
    subjects: [
      { remoteId: "s-english", name: "英语", isArchived: false, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "s-math", name: "数学", isArchived: false, createdAt: 1, updatedAt: 1, deletedAt: null }
    ],
    weeklyGoals: [],
    tasks: [],
    studySessions: []
  }
}

function baseInput(overrides: Partial<ProposalPlannerInput> = {}): ProposalPlannerInput {
  return {
    report: computeWeeklyReport({
      model: baseModel(),
      dataUpdatedAt: "2026-08-03T10:00:00Z",
      nowMs: fixtureNowMs
    }),
    mappings: [{ alertSubjectRemoteId: "s-english", teacherSubjectId: "english" }],
    weakNodesByMapping: {},
    diagnosticEvidence: [],
    nowMs: fixtureNowMs,
    ...overrides
  }
}

describe("canGenerateProposal", () => {
  it("无映射时禁止生成", () => {
    const gate = canGenerateProposal(baseInput({ mappings: [] }))
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toContain("映射")
  })
  it("有映射但无持久化诊断证据时禁止生成（fail-closed）", () => {
    const gate = canGenerateProposal(baseInput({ diagnosticEvidence: [] }))
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toContain("持久化诊断证据")
  })
  it("有映射且有持久化证据时允许生成", () => {
    const gate = canGenerateProposal(
      baseInput({
        diagnosticEvidence: [
          { assessmentId: "a1", assessmentIds: ["a1"], teacherSubjectId: "english", questionCount: 5, correctCount: 3, atMs: weekStart }
        ]
      })
    )
    expect(gate.allowed).toBe(true)
  })
})

describe("planProposal", () => {
  it("没有任何持久化证据时拒绝生成", () => {
    expect(() => planProposal(baseInput())).toThrow(/持久化诊断证据/)
  })

  it("无证据科目在有证据的其他科目下建议先诊断", () => {
    // 英语有真实证据；数学无证据 → 数学建议先诊断，英语进入掌握度分析。
    const input = baseInput({
      mappings: [
        { alertSubjectRemoteId: "s-english", teacherSubjectId: "english" },
        { alertSubjectRemoteId: "s-math", teacherSubjectId: "math" }
      ],
      diagnosticEvidence: [
        { assessmentId: "a1", assessmentIds: ["a1"], teacherSubjectId: "english", questionCount: 5, correctCount: 5, atMs: weekStart }
      ]
    })
    const draft = planProposal(input)
    expect(draft.proposedTasks.some((task) => task.title.includes("数学") && task.title.includes("诊断练习"))).toBe(true)
    expect(draft.rationale).toContain("数学：尚未完成诊断")
    expect(draft.sourceAssessmentIds).toEqual(["a1"])
  })

  it("诊断证据进入 rationale 与 sourceAssessmentIds", () => {
    const draft = planProposal(
      baseInput({
        diagnosticEvidence: [
          { assessmentId: "a1", assessmentIds: ["a1"], teacherSubjectId: "english", questionCount: 5, correctCount: 2, atMs: weekStart }
        ]
      })
    )
    expect(draft.sourceAssessmentIds).toEqual(["a1"])
    expect(draft.rationale).toContain("40%")
    expect(draft.rationale).toContain("巩固薄弱点")
  })

  it("薄弱节点生成复习任务并引用 AlertTime 科目 remoteId", () => {
    const draft = planProposal(
      baseInput({
        weakNodesByMapping: {
          "s-english": [
            { nodeId: "n1", title: "一般现在时", mastery: 0.4 },
            { nodeId: "n2", title: "现在完成时", mastery: 0.5 }
          ]
        },
        diagnosticEvidence: [
          { assessmentId: "a1", assessmentIds: ["a1"], teacherSubjectId: "english", questionCount: 5, correctCount: 2, atMs: weekStart }
        ]
      })
    )
    const reviewTasks = draft.proposedTasks.filter((task) => task.title.startsWith("复习"))
    expect(reviewTasks).toHaveLength(2)
    expect(reviewTasks[0].subjectRemoteId).toBe("s-english")
    expect(reviewTasks[0].targetDurationSeconds).toBe(1800)
    expect(reviewTasks[0].dueAt).toBe(weekStart + WEEK_MS + 2 * 86400000)
    // 周目标引用最薄弱节点。
    expect(draft.proposedWeeklyGoals[0].title).toContain("一般现在时")
  })

  it("sourceAssessmentIds 展开证据批内的全部真实持久化 id", () => {
    const draft = planProposal(
      baseInput({
        diagnosticEvidence: [
          {
            assessmentId: "a2",
            assessmentIds: ["a1", "a2"],
            teacherSubjectId: "english",
            questionCount: 2,
            correctCount: 1,
            atMs: weekStart
          }
        ]
      })
    )
    expect(draft.sourceAssessmentIds).toEqual(["a1", "a2"])
  })

  it("多映射生成多个周目标但不超过上限", () => {
    const input = baseInput({
      mappings: [
        { alertSubjectRemoteId: "s-english", teacherSubjectId: "english" },
        { alertSubjectRemoteId: "s-math", teacherSubjectId: "math" }
      ],
      diagnosticEvidence: [
        { assessmentId: "a1", assessmentIds: ["a1"], teacherSubjectId: "english", questionCount: 5, correctCount: 5, atMs: weekStart },
        { assessmentId: "a2", assessmentIds: ["a2"], teacherSubjectId: "math", questionCount: 5, correctCount: 3, atMs: weekStart }
      ]
    })
    const draft = planProposal(input)
    expect(draft.proposedWeeklyGoals).toHaveLength(2)
    expect(draft.sourceAssessmentIds).toEqual(["a1", "a2"])
    expect(draft.rationale).toContain("100%")
    expect(draft.rationale).toContain("60%")
  })

  it("投入度不足时追加保持节奏任务", () => {
    const model = baseModel()
    model.studySessions = [
      {
        remoteId: "s1", subjectRemoteId: "s-english", taskRemoteId: null, title: null,
        startTime: weekStart + 3600000, endTime: null, durationSeconds: 1800, pauseSeconds: 0,
        focusScore: null, note: null, status: 0, createdAt: 1, updatedAt: 1, deletedAt: null
      }
    ]
    const draft = planProposal(
      baseInput({
        report: computeWeeklyReport({ model, nowMs: fixtureNowMs }),
        diagnosticEvidence: [
          { assessmentId: "a1", assessmentIds: ["a1"], teacherSubjectId: "english", questionCount: 5, correctCount: 3, atMs: weekStart }
        ]
      })
    )
    expect(draft.proposedTasks.some((task) => task.title.includes("保持本周学习节奏"))).toBe(true)
    expect(draft.rationale).toContain("30 分钟")
  })

  it("任务数量受上限约束", () => {
    const weakNodesByMapping: Record<string, Array<{ nodeId: string; title: string; mastery: number }>> = {
      "s-english": [
        { nodeId: "n1", title: "节点1", mastery: 0.1 },
        { nodeId: "n2", title: "节点2", mastery: 0.2 },
        { nodeId: "n3", title: "节点3", mastery: 0.3 },
        { nodeId: "n4", title: "节点4", mastery: 0.4 },
        { nodeId: "n5", title: "节点5", mastery: 0.5 }
      ]
    }
    const input = baseInput({
      weakNodesByMapping,
      diagnosticEvidence: [{ assessmentId: "a1", assessmentIds: ["a1"], teacherSubjectId: "english", questionCount: 5, correctCount: 1, atMs: weekStart }]
    })
    // 3 复习 + 0 诊断（有证据） ≤ 6
    expect(planProposal(input).proposedTasks.length).toBeLessThanOrEqual(6)
  })

  it("同一 teacherSubjectId 的多个 mapping 不互吃 evidence/weak nodes", () => {
    const input = baseInput({
      mappings: [
        { alertSubjectRemoteId: "s-cn", teacherSubjectId: "cs408", examTrackId: "408", examSubjectId: "408.computer-networks" },
        { alertSubjectRemoteId: "s-os", teacherSubjectId: "cs408", examTrackId: "408", examSubjectId: "408.operating-systems" }
      ],
      weakNodesByMapping: {
        "s-cn": [{ nodeId: "cn-node", title: "计网协议", mastery: 0.2 }],
        "s-os": [{ nodeId: "os-node", title: "进程调度", mastery: 0.3 }]
      },
      diagnosticEvidence: [
        {
          assessmentId: "cn-a1",
          assessmentIds: ["cn-a1"],
          alertSubjectRemoteId: "s-cn",
          teacherSubjectId: "cs408",
          examTrackId: "408",
          examSubjectId: "408.computer-networks",
          examModuleId: null,
          questionCount: 5,
          correctCount: 2,
          atMs: weekStart
        },
        {
          assessmentId: "os-a1",
          assessmentIds: ["os-a1"],
          alertSubjectRemoteId: "s-os",
          teacherSubjectId: "cs408",
          examTrackId: "408",
          examSubjectId: "408.operating-systems",
          examModuleId: null,
          questionCount: 5,
          correctCount: 4,
          atMs: weekStart
        }
      ]
    })
    const draft = planProposal(input)
    expect(draft.rationale).toContain("s-cn")
    expect(draft.rationale).toContain("80%")
    expect(draft.rationale).toContain("40%")
    expect(draft.proposedTasks.filter((task) => task.title.includes("计网协议"))[0]?.subjectRemoteId).toBe("s-cn")
    expect(draft.proposedTasks.filter((task) => task.title.includes("进程调度"))[0]?.subjectRemoteId).toBe("s-os")
    expect(draft.sourceAssessmentIds).toEqual(["cn-a1", "os-a1"])
  })

  it("旧 evidence 在 teacherSubjectId 歧义时 fail-closed，唯一 mapping 仍兼容", () => {
    const ambiguous = baseInput({
      mappings: [
        { alertSubjectRemoteId: "s-cn", teacherSubjectId: "cs408" },
        { alertSubjectRemoteId: "s-os", teacherSubjectId: "cs408" }
      ],
      diagnosticEvidence: [
        { assessmentId: "legacy", assessmentIds: ["legacy"], teacherSubjectId: "cs408", questionCount: 5, correctCount: 1, atMs: weekStart }
      ]
    })
    expect(canGenerateProposal(ambiguous)).toMatchObject({ allowed: false })
    expect(canGenerateProposal(ambiguous).reason).toContain("无法绑定")
    expect(() => planProposal(ambiguous)).toThrow(/无法绑定到当前学科映射/)

    const uniqueDraft = planProposal(baseInput({
      diagnosticEvidence: [
        { assessmentId: "legacy", assessmentIds: ["legacy"], teacherSubjectId: "english", questionCount: 5, correctCount: 1, atMs: weekStart }
      ]
    }))
    expect(uniqueDraft.sourceAssessmentIds).toEqual(["legacy"])
    expect(uniqueDraft.rationale).toContain("20%")
  })

  it("重复 mapping 只生成一份计划", () => {
    const draft = planProposal(baseInput({
      mappings: [
        { alertSubjectRemoteId: "s-english", teacherSubjectId: "english" },
        { alertSubjectRemoteId: "s-english", teacherSubjectId: "english" }
      ],
      diagnosticEvidence: [
        { assessmentId: "a1", assessmentIds: ["a1"], alertSubjectRemoteId: "s-english", teacherSubjectId: "english", questionCount: 5, correctCount: 3, atMs: weekStart }
      ]
    }))
    expect(draft.proposedWeeklyGoals).toHaveLength(1)
    expect(draft.rationale.match(/英语：/g)).toHaveLength(1)
  })

  it("把最近可追踪的 accepted outcome 写入 rationale，并过滤 pending 重复建议", () => {
    const summary = (overrides: Partial<ProposalOutcome["tasksSummary"]> = {}): ProposalOutcome["tasksSummary"] => ({
      expected: 2,
      materialized: 2,
      completed: 1,
      pending: 1,
      closed: 0,
      deleted: 0,
      missing: 0,
      completionRate: 0.5,
      ...overrides
    })
    const outcome: ProposalOutcome = {
      proposalId: "accepted-old",
      status: "accepted",
      createdAt: fixtureNowMs - 1000,
      traceable: true,
      weeklyGoals: [],
      tasks: [],
      weeklyGoalsSummary: summary(),
      tasksSummary: summary(),
      totalSummary: summary({ expected: 4, materialized: 4, completed: 2, pending: 2, completionRate: 0.5 }),
      warnings: []
    }
    const pending = {
      proposalId: "pending-1",
      deviceId: "device-a",
      version: 1,
      status: "pending" as const,
      rationale: "待采纳",
      proposedWeeklyGoals: [{ weekStart: weekStart + WEEK_MS, title: "完成「英语」巩固计划，重点：一般现在时", successCriteria: "诊断正确率 ≥ 80%" }],
      proposedTasks: [{ title: "复习「一般现在时」", subjectRemoteId: "s-english", targetDurationSeconds: 1800, dueAt: weekStart + WEEK_MS + 2 * 86400000 }],
      sourceAssessmentIds: [],
      createdAt: fixtureNowMs,
      expiresAt: null
    }
    const draft = planProposal(baseInput({
      weakNodesByMapping: { "s-english": [{ nodeId: "n1", title: "一般现在时", mastery: 0.3 }] },
      diagnosticEvidence: [{ assessmentId: "a1", assessmentIds: ["a1"], teacherSubjectId: "english", questionCount: 5, correctCount: 3, atMs: weekStart }],
      latestAcceptedOutcome: outcome,
      pendingProposals: [pending]
    }))

    expect(draft.rationale).toContain("最近一次可追踪的采纳建议执行情况")
    expect(draft.rationale).not.toContain("上次采纳建议执行情况")
    expect(draft.rationale).toContain("任务已完成 1/2")
    expect(draft.rationale).toContain("已关闭 0")
    expect(draft.proposedTasks.some((item) => item.title === "复习「一般现在时」" && item.subjectRemoteId === "s-english")).toBe(false)
    expect(draft.proposedWeeklyGoals.some((item) => item.title === "完成「英语」巩固计划，重点：一般现在时")).toBe(false)
    expect(draft.proposedTasks.length).toBeLessThanOrEqual(6)
    expect(draft.proposedWeeklyGoals.length).toBeLessThanOrEqual(3)
  })

  it("accepted outcome 中仍 pending 的同源实体也阻止重复建议，旧不可追踪 outcome 不影响旧行为", () => {
    const pendingTaskTitle = "复习「一般现在时」"
    const pendingGoalTitle = "完成「英语」巩固计划，重点：一般现在时"
    const summary: ProposalOutcome["tasksSummary"] = {
      expected: 1,
      materialized: 1,
      completed: 0,
      pending: 1,
      closed: 0,
      deleted: 0,
      missing: 0,
      completionRate: 0
    }
    const traceableOutcome: ProposalOutcome = {
      proposalId: "accepted-traceable",
      status: "accepted",
      createdAt: fixtureNowMs - 1000,
      traceable: true,
      tasks: [{ expectedIndex: 0, title: pendingTaskTitle, subjectRemoteId: "s-english", state: "pending", remoteId: "task-from-accepted" }],
      weeklyGoals: [{ expectedIndex: 0, title: pendingGoalTitle, weekStart: weekStart + WEEK_MS, state: "pending", remoteId: "goal-from-accepted" }],
      tasksSummary: summary,
      weeklyGoalsSummary: summary,
      totalSummary: { ...summary, expected: 2, materialized: 2, pending: 2 },
      warnings: []
    }
    const acceptedProposal: SyncProposal = {
      proposalId: traceableOutcome.proposalId,
      deviceId: "device-a",
      version: 1,
      status: "accepted",
      rationale: "已采纳",
      proposedTasks: [{ title: pendingTaskTitle, subjectRemoteId: "s-english", targetDurationSeconds: 1800, dueAt: weekStart + WEEK_MS + 2 * 86400000 }],
      proposedWeeklyGoals: [{ weekStart: weekStart + WEEK_MS, title: pendingGoalTitle, successCriteria: "诊断正确率 ≥ 80%" }],
      sourceAssessmentIds: [],
      createdAt: fixtureNowMs - 1000,
      expiresAt: null
    }
    const common = {
      weakNodesByMapping: { "s-english": [{ nodeId: "n1", title: "一般现在时", mastery: 0.3 }] },
      diagnosticEvidence: [{ assessmentId: "a1", assessmentIds: ["a1"], teacherSubjectId: "english", questionCount: 5, correctCount: 3, atMs: weekStart }]
    }

    const filtered = planProposal(baseInput({
      ...common,
      latestAcceptedOutcome: traceableOutcome,
      acceptedProposals: [acceptedProposal],
      acceptedProposalOutcomes: { [acceptedProposal.proposalId]: traceableOutcome }
    }))
    expect(filtered.proposedTasks.some((item) => item.title === pendingTaskTitle && item.subjectRemoteId === "s-english")).toBe(false)
    expect(filtered.proposedWeeklyGoals.some((item) => item.title === pendingGoalTitle && item.weekStart === weekStart + WEEK_MS)).toBe(false)

    const legacy = planProposal(baseInput({
      ...common,
      latestAcceptedOutcome: { ...traceableOutcome, traceable: false },
      acceptedProposals: [acceptedProposal],
      acceptedProposalOutcomes: { [acceptedProposal.proposalId]: { ...traceableOutcome, traceable: false } }
    }))
    expect(legacy.proposedTasks.some((item) => item.title === pendingTaskTitle && item.subjectRemoteId === "s-english")).toBe(false)
    expect(legacy.proposedWeeklyGoals.some((item) => item.title === pendingGoalTitle && item.weekStart === weekStart + WEEK_MS)).toBe(false)
    expect(legacy.rationale).toContain("已采纳，等待下一次手机同步确认")
    expect(legacy.proposedTasks.length).toBeLessThanOrEqual(6)
    expect(legacy.proposedWeeklyGoals.length).toBeLessThanOrEqual(3)
  })

  it("全部 accepted proposal 都参与同一周期去重，即使最新快照尚未 traceable", () => {
    const targetWeek = weekStart + WEEK_MS
    const accepted: SyncProposal = {
      proposalId: "accepted-unobserved",
      deviceId: "device-a",
      version: 1,
      status: "accepted",
      rationale: "已采纳但尚未同步",
      proposedWeeklyGoals: [{ weekStart: targetWeek, title: "完成「英语」本周巩固计划", successCriteria: "诊断正确率 ≥ 80%" }],
      proposedTasks: [{ title: "复习「一般现在时」", subjectRemoteId: "s-english", targetDurationSeconds: 1800, dueAt: targetWeek + 2 * 86400000 + 10 * 60 * 60 * 1000 }],
      sourceAssessmentIds: [],
      createdAt: fixtureNowMs,
      expiresAt: null
    }
    const draft = planProposal(baseInput({
      weakNodesByMapping: { "s-english": [{ nodeId: "n1", title: "一般现在时", mastery: 0.3 }] },
      diagnosticEvidence: [{ assessmentId: "a1", assessmentIds: ["a1"], teacherSubjectId: "english", questionCount: 5, correctCount: 3, atMs: weekStart }],
      acceptedProposals: [accepted],
      acceptedProposalOutcomes: {}
    }))

    expect(draft.proposedTasks.some((task) => task.title === "复习「一般现在时」")).toBe(false)
    expect(draft.proposedWeeklyGoals.some((goal) => goal.title === "完成「英语」本周巩固计划")).toBe(false)
    expect(draft.rationale).toContain("已采纳，等待下一次手机同步确认")
  })

  it("很久以前已完成建议不阻断新的计划周期", () => {
    const accepted: SyncProposal = {
      proposalId: "accepted-old-cycle",
      deviceId: "device-a",
      version: 1,
      status: "accepted",
      rationale: "历史建议",
      proposedWeeklyGoals: [{ weekStart, title: "完成「英语」巩固计划，重点：一般现在时", successCriteria: "诊断正确率 ≥ 80%" }],
      proposedTasks: [{ title: "复习「一般现在时」", subjectRemoteId: "s-english", targetDurationSeconds: 1800, dueAt: weekStart + 2 * 86400000 }],
      sourceAssessmentIds: [],
      createdAt: weekStart - 2 * WEEK_MS,
      expiresAt: null
    }
    const draft = planProposal(baseInput({
      weakNodesByMapping: { "s-english": [{ nodeId: "n1", title: "一般现在时", mastery: 0.3 }] },
      diagnosticEvidence: [{ assessmentId: "a1", assessmentIds: ["a1"], teacherSubjectId: "english", questionCount: 5, correctCount: 3, atMs: weekStart }],
      acceptedProposals: [accepted],
      acceptedProposalOutcomes: {
        [accepted.proposalId]: {
          proposalId: accepted.proposalId,
          status: "accepted",
          createdAt: accepted.createdAt,
          traceable: true,
          weeklyGoals: [],
          tasks: [],
          weeklyGoalsSummary: { expected: 1, materialized: 1, completed: 1, pending: 0, closed: 0, deleted: 0, missing: 0, completionRate: 1 },
          tasksSummary: { expected: 1, materialized: 1, completed: 1, pending: 0, closed: 0, deleted: 0, missing: 0, completionRate: 1 },
          totalSummary: { expected: 2, materialized: 2, completed: 2, pending: 0, closed: 0, deleted: 0, missing: 0, completionRate: 1 },
          warnings: []
        }
      }
    }))

    expect(draft.proposedTasks.some((task) => task.title === "复习「一般现在时」")).toBe(true)
    expect(draft.proposedWeeklyGoals.some((goal) => goal.title === "完成「英语」巩固计划，重点：一般现在时")).toBe(true)
  })
})
