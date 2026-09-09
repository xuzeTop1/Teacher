import { describe, expect, it } from "vitest"
import {
  computeWeeklyReport,
  engagementLevel,
  formatEffectiveSeconds,
  mondayOfWeek,
  WEEK_MS,
  type WeeklyReportInput
} from "./weeklyReport"
import type { SyncReadModel } from "../../types/sync"

// 2026-08-03 是周一；weekStart = 2026-08-03T00:00:00 本地时间。
function weekStartLocal(): number {
  return mondayOfWeek(new Date(2026, 7, 3, 12).getTime())
}

const fixtureNowMs = new Date(2026, 7, 5, 9).getTime()

function computeFixtureReport(overrides: Omit<WeeklyReportInput, "model" | "nowMs"> = {}) {
  return computeWeeklyReport({ model: buildModel(), nowMs: fixtureNowMs, ...overrides })
}

function buildModel(overrides: Partial<SyncReadModel> = {}): SyncReadModel {
  const weekStart = weekStartLocal()
  return {
    subjects: [
      { remoteId: "s-english", name: "英语", isArchived: false, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "s-math", name: "数学", isArchived: false, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "s-archived", name: "旧科目", isArchived: true, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "s-deleted", name: "已删除", isArchived: false, createdAt: 1, updatedAt: 1, deletedAt: 2 }
    ],
    weeklyGoals: [
      { remoteId: "g1", weekStart, title: "英语打卡", successCriteria: null, status: 1, completedAt: null, deferredToWeekStart: null, exceptionReason: null, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "g2", weekStart, title: "数学复习", successCriteria: null, status: 0, completedAt: null, deferredToWeekStart: null, exceptionReason: null, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "g3", weekStart, title: "延期目标", successCriteria: null, status: 2, completedAt: null, deferredToWeekStart: weekStart, exceptionReason: "有事", createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "g4", weekStart, title: "取消目标", successCriteria: null, status: 3, completedAt: null, deferredToWeekStart: null, exceptionReason: null, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "g5", weekStart, title: "软删除目标", successCriteria: null, status: 0, completedAt: null, deferredToWeekStart: null, exceptionReason: null, createdAt: 1, updatedAt: 1, deletedAt: 5 },
      { remoteId: "g-other-week", weekStart: weekStart - WEEK_MS, title: "上周目标", successCriteria: null, status: 1, completedAt: null, deferredToWeekStart: null, exceptionReason: null, createdAt: 1, updatedAt: 1, deletedAt: null }
    ],
    tasks: [
      { remoteId: "t1", subjectRemoteId: "s-math", title: "复习极限", content: null, type: 1, priority: 0, status: 1, targetDurationSeconds: 3600, dueAt: weekStart + 2 * 86400000, completedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "t2", subjectRemoteId: "s-math", title: "做习题", content: null, type: 1, priority: 0, status: 0, targetDurationSeconds: 1800, dueAt: weekStart + 3 * 86400000, completedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "t3", subjectRemoteId: null, title: "无期限计划", content: null, type: 1, priority: 0, status: 0, targetDurationSeconds: null, dueAt: null, completedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "t4", subjectRemoteId: null, title: "待办事项", content: null, type: 0, priority: 0, status: 0, targetDurationSeconds: null, dueAt: weekStart + 1 * 86400000, completedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "t5", subjectRemoteId: null, title: "上周计划", content: null, type: 1, priority: 0, status: 1, targetDurationSeconds: null, dueAt: weekStart - 1, completedAt: null, sortOrder: 0, createdAt: 1, updatedAt: 1, deletedAt: null }
    ],
    studySessions: [
      // 已完成：英语 1 小时（周一）、数学 2 小时（周三）
      { remoteId: "s1", subjectRemoteId: "s-english", taskRemoteId: null, title: null, startTime: weekStart + 1 * 3600000, endTime: null, durationSeconds: 3600, pauseSeconds: 0, focusScore: null, note: null, status: 0, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "s2", subjectRemoteId: "s-math", taskRemoteId: null, title: null, startTime: weekStart + 2 * 86400000 + 3600000, endTime: null, durationSeconds: 7200, pauseSeconds: 0, focusScore: null, note: null, status: 0, createdAt: 1, updatedAt: 1, deletedAt: null },
      // 进行中：不参与统计
      { remoteId: "s3", subjectRemoteId: "s-math", taskRemoteId: null, title: "进行中会话", startTime: weekStart + 3 * 86400000, endTime: null, durationSeconds: 1200, pauseSeconds: 0, focusScore: null, note: null, status: 1, createdAt: 1, updatedAt: weekStart + 3 * 86400000 + 1200000, deletedAt: null },
      // 取消/异常：不参与统计
      { remoteId: "s4", subjectRemoteId: "s-english", taskRemoteId: null, title: null, startTime: weekStart + 1 * 86400000, endTime: null, durationSeconds: 600, pauseSeconds: 0, focusScore: null, note: null, status: 2, createdAt: 1, updatedAt: 1, deletedAt: null },
      { remoteId: "s5", subjectRemoteId: null, taskRemoteId: null, title: null, startTime: weekStart + 1 * 86400000, endTime: null, durationSeconds: 300, pauseSeconds: 0, focusScore: null, note: null, status: 3, createdAt: 1, updatedAt: 1, deletedAt: null },
      // 上周会话不计入本周
      { remoteId: "s6", subjectRemoteId: "s-math", taskRemoteId: null, title: null, startTime: weekStart - 1, endTime: null, durationSeconds: 9999, pauseSeconds: 0, focusScore: null, note: null, status: 0, createdAt: 1, updatedAt: 1, deletedAt: null }
    ],
    ...overrides
  }
}

describe("computeWeeklyReport", () => {
  it("计算周目标完成情况（含软删除排除）", () => {
    const report = computeFixtureReport()
    expect(report.goals.total).toBe(4) // g1-g4（g5 软删除、g-other-week 不计）
    expect(report.goals.done).toBe(1)
    expect(report.goals.deferred).toBe(1)
    expect(report.goals.canceled).toBe(1)
    expect(report.goals.pending).toBe(1)
    expect(report.goals.completionRate).toBeCloseTo(0.25)
  })

  it("计算计划完成率（按 dueAt 归属本周）", () => {
    const report = computeFixtureReport()
    expect(report.plans.total).toBe(2) // t1, t2
    expect(report.plans.done).toBe(1)
    expect(report.plans.completionRate).toBeCloseTo(0.5)
    expect(report.plans.unfinished.map((task) => task.remoteId)).toEqual(["t2"])
    expect(report.missing.noPlans).toBe(false)
  })

  it("无计划周显示缺失提示", () => {
    const model = buildModel({ tasks: [] })
    const report = computeWeeklyReport({ model, nowMs: fixtureNowMs })
    expect(report.plans.total).toBe(0)
    expect(report.plans.completionRate).toBeNull()
    expect(report.missing.noPlans).toBe(true)
  })

  it("有效时长与学习天数（进行中/取消/异常不计入）", () => {
    const report = computeFixtureReport()
    expect(report.effectiveSeconds).toBe(3600 + 7200)
    expect(report.studyDays).toBe(2)
    expect(report.dailyAverageSeconds).toBe(5400)
  })

  it("科目分布", () => {
    const report = computeFixtureReport()
    expect(report.subjectDistribution).toHaveLength(2)
    expect(report.subjectDistribution[0].displayName).toBe("数学")
    expect(report.subjectDistribution[0].durationSeconds).toBe(7200)
    expect(report.subjectDistribution[1].displayName).toBe("英语")
    expect(report.subjectDistribution[1].ratio).toBeCloseTo(1 / 3)
  })

  it("进行中会话只展示不计入统计", () => {
    const report = computeFixtureReport()
    expect(report.runningSessions).toHaveLength(1)
    expect(report.runningSessions[0].title).toBe("进行中会话")
    expect(report.effectiveSeconds).not.toContain(1200)
  })

  it("activeSubjects 排除已删除与已归档", () => {
    const report = computeFixtureReport()
    expect(report.activeSubjects.map((subject) => subject.remoteId)).toEqual(["s-english", "s-math"])
  })

  it("无快照时 missing.noSnapshot 为 true", () => {
    const report = computeFixtureReport({ dataUpdatedAt: null })
    expect(report.missing.noSnapshot).toBe(true)
    const withData = computeFixtureReport({ dataUpdatedAt: "2026-08-03T10:00:00Z" })
    expect(withData.missing.noSnapshot).toBe(false)
    expect(withData.dataUpdatedAt).toBe("2026-08-03T10:00:00Z")
  })
})

describe("mondayOfWeek", () => {
  it("周三是周一窗口内", () => {
    const monday = weekStartLocal()
    const wednesday = new Date(2026, 7, 5, 15).getTime()
    expect(mondayOfWeek(wednesday)).toBe(monday)
  })
  it("周日晚仍属同一周", () => {
    const monday = weekStartLocal()
    const sunday = new Date(2026, 7, 9, 23).getTime()
    expect(mondayOfWeek(sunday)).toBe(monday)
  })
  it("下周一属于下一周", () => {
    const monday = weekStartLocal()
    const nextMonday = new Date(2026, 7, 10, 0).getTime()
    expect(mondayOfWeek(nextMonday)).toBe(monday + WEEK_MS)
  })
})

describe("engagementLevel", () => {
  it("高强度：≥4 天且 ≥240 分钟", () => {
    expect(engagementLevel(240 * 60, 4)).toBe("high")
  })
  it("中等：≥2 天且 ≥90 分钟", () => {
    expect(engagementLevel(90 * 60, 2)).toBe("medium")
  })
  it("低强度", () => {
    expect(engagementLevel(30 * 60, 1)).toBe("low")
    expect(engagementLevel(300 * 60, 1)).toBe("low") // 时长够但天数不足
  })
})

describe("formatEffectiveSeconds", () => {
  it("格式化时长", () => {
    expect(formatEffectiveSeconds(0)).toBe("0 分钟")
    expect(formatEffectiveSeconds(1800)).toBe("30 分钟")
    expect(formatEffectiveSeconds(3600)).toBe("1 小时")
    expect(formatEffectiveSeconds(12000)).toBe("3 小时 20 分")
  })
})

describe("report input", () => {
  it("nowMs 驱动默认周", () => {
    const input: WeeklyReportInput = { model: buildModel(), nowMs: fixtureNowMs }
    const report = computeWeeklyReport(input)
    expect(report.weekStartMs).toBe(weekStartLocal())
  })

  it("系统日期跨周时，显式测试时钟仍选择夹具周", () => {
    const nextWeek = new Date(2026, 7, 10, 12).getTime()
    const report = computeWeeklyReport({
      model: buildModel(),
      nowMs: nextWeek,
      weekStartMs: weekStartLocal()
    })
    expect(report.weekStartMs).toBe(weekStartLocal())
    expect(report.effectiveSeconds).toBe(3600 + 7200)
  })
})
