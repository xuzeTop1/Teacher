/**
 * 今日计划驱动出题规则测试（验收组 B：今日计划驱动）。
 *
 * 覆盖：
 * - 今日计划=计算机网络 → 只返回网络范围；
 * - 今日计划=操作系统 → 不出现网络/数据结构/组成原理范围；
 * - 今日计划=408 但无子科目 → 必须要求选择或进入明确的综合策略；
 * - 没有今日计划 → 不得伪称基于今日计划出题；
 * - 同步数据中的日期、完成状态与时长正确影响推荐上下文。
 */

import { describe, expect, it } from "vitest"
import {
  decideQuestionScope,
  isTodayPlan,
  resolveSubject,
  type PlanScopeInput,
  type UserSelection
} from "./planScope"
import type { SyncReadModel, SyncTask } from "../../types/sync"

const NOW_MS = new Date(2026, 7, 7, 10, 0, 0).getTime() // 2026-08-07 10:00 本地时间

function makeTask(overrides: Partial<SyncTask> & { remoteId: string }): SyncTask {
  return {
    subjectRemoteId: null,
    title: "计划",
    content: null,
    type: 1,
    priority: 1,
    status: 0,
    targetDurationSeconds: null,
    dueAt: NOW_MS,
    completedAt: null,
    sortOrder: 0,
    createdAt: NOW_MS - 1000,
    updatedAt: NOW_MS - 1000,
    deletedAt: null,
    ...overrides
  }
}

function makeSubject(remoteId: string, name: string) {
  return {
    remoteId,
    name,
    isArchived: false,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null
  }
}

const SUBJECTS: SyncReadModel["subjects"] = [
  makeSubject("sub-net", "计算机网络"),
  makeSubject("sub-os", "操作系统"),
  makeSubject("sub-408", "408"),
  makeSubject("sub-custom", "我的自定义科目")
]

function emptyInput(): PlanScopeInput {
  return {
    todayTasks: [],
    subjects: SUBJECTS,
    mappings: [],
    selection: { examTrackId: null, subjectId: null, moduleId: null },
    nowMs: NOW_MS
  }
}

describe("今日计划驱动：规则 2（映射到具体叶子科目）", () => {
  it("今日计划=计算机网络，只返回网络范围", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [makeTask({ remoteId: "t1", subjectRemoteId: "sub-net", title: "复习网络协议" })]
    })
    expect(decision.mode).toBe("today-plan")
    expect(decision.subjectId).toBe("408.computer-networks")
    expect(decision.examTrackId).toBe("408")
    expect(decision.needsUserChoice).toBe(false)
    expect(decision.evidenceText).toContain("计算机网络")
    expect(decision.evidenceText).toContain("今天")
    expect(decision.evidence[0].taskTitle).toBe("复习网络协议")
  })

  it("今日计划=操作系统，范围是操作系统，不出现网络/数据结构/组成原理", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [makeTask({ remoteId: "t1", subjectRemoteId: "sub-os", title: "复习进程调度" })]
    })
    expect(decision.mode).toBe("today-plan")
    expect(decision.subjectId).toBe("408.operating-systems")
    // 不允许跨科目：网络/数据结构/组成原理的叶子都不允许进入。
    expect(decision.subjectId).not.toBe("408.computer-networks")
    expect(decision.subjectId).not.toBe("408.data-structures")
    expect(decision.subjectId).not.toBe("408.computer-organization")
  })

  it("今日计划经用户映射表解析（不是靠科目名）", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [makeTask({ remoteId: "t1", subjectRemoteId: "sub-custom", title: "考研复习" })],
      mappings: [
        {
          alertSubjectRemoteId: "sub-custom",
          teacherSubjectId: "custom-xxx",
          examSubjectId: "408.data-structures"
        }
      ]
    })
    expect(decision.mode).toBe("today-plan")
    expect(decision.subjectId).toBe("408.data-structures")
  })

  it("今日计划包含已完成与未完成计划，均为今日真实计划证据", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [
        makeTask({
          remoteId: "t1",
          subjectRemoteId: "sub-net",
          title: "已完成网络题",
          status: 1,
          completedAt: NOW_MS - 3600_000,
          targetDurationSeconds: 1800
        }),
        makeTask({
          remoteId: "t2",
          subjectRemoteId: "sub-net",
          title: "待做网络题",
          status: 0
        })
      ]
    })
    expect(decision.mode).toBe("today-plan")
    expect(decision.subjectId).toBe("408.computer-networks")
    expect(decision.evidence).toHaveLength(2)
    expect(decision.evidence[0].status).toBe("completed")
    expect(decision.evidence[0].durationSeconds).toBe(1800)
    expect(decision.evidence[1].status).toBe("pending")
  })
})

describe("今日计划驱动：规则 3（只映射到父级考试组）", () => {
  it("今日计划=408 但无子科目时，必须要求选择或进入明确的综合策略", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [makeTask({ remoteId: "t1", subjectRemoteId: "sub-408", title: "408 综合复习" })]
    })
    expect(decision.mode).toBe("requires-choice")
    expect(decision.needsUserChoice).toBe(true)
    expect(decision.subjectId).toBeNull()
    expect(decision.examTrackId).toBe("408")
    expect(decision.reason).toContain("408")
  })

  it("用户明确进入综合复习模式后给出可解释策略与当前子科目", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [makeTask({ remoteId: "t1", subjectRemoteId: "sub-408", title: "408 综合复习" })],
      selection: { examTrackId: "408", subjectId: null, moduleId: null, comprehensive: true }
    })
    expect(decision.mode).toBe("comprehensive")
    expect(decision.needsUserChoice).toBe(false)
    expect(decision.strategy).not.toBeNull()
    expect(decision.strategy!.kind).toBe("rotation")
    // 408 包含 4 门 approved 子科目，综合模式轮换全部 4 门。
    expect(decision.strategy!.leaves.map((l) => l.stableId)).toEqual([
      "408.data-structures",
      "408.computer-organization",
      "408.operating-systems",
      "408.computer-networks"
    ])
    expect(decision.subjectId).toBe("408.computer-networks")
    expect(decision.evidenceText).toContain("综合复习")
    expect(decision.evidenceText).toContain("计算机网络")
  })

  it("综合复习弱项优先：掌握度最低的叶子优先", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [],
      selection: { examTrackId: "kaoyan-english", subjectId: null, moduleId: null, comprehensive: true },
      weakMastery: { "kaoyan-english.grammar": 0.2 }
    })
    expect(decision.mode).toBe("comprehensive")
    expect(decision.strategy!.kind).toBe("weakness-first")
    expect(decision.subjectId).toBe("kaoyan-english.grammar")
    expect(decision.evidenceText).toContain("掌握度最低优先")
  })
})

describe("今日计划驱动：规则 1（用户明确选择）", () => {
  it("用户明确选择叶子范围时严格按所选范围出题", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [makeTask({ remoteId: "t1", subjectRemoteId: "sub-net", title: "今天网络" })],
      selection: { examTrackId: "408", subjectId: "408.operating-systems", moduleId: null }
    })
    expect(decision.mode).toBe("explicit")
    expect(decision.subjectId).toBe("408.operating-systems")
  })

  it("用户选择父级考试组但未进入综合模式 → 要求选择", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      selection: { examTrackId: "408", subjectId: null, moduleId: null }
    })
    expect(decision.mode).toBe("requires-choice")
    expect(decision.needsUserChoice).toBe(true)
  })
})

describe("今日计划驱动：规则 4（没有今日计划）", () => {
  it("没有今日计划时不得伪称基于今日计划出题", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [],
      selection: { examTrackId: null, subjectId: null, moduleId: null }
    })
    expect(decision.mode).toBe("no-plan")
    expect(decision.needsUserChoice).toBe(true)
    expect(decision.subjectId).toBeNull()
    expect(decision.evidenceText).not.toContain("根据你今天的")
  })

  it("没有今日计划但有用户显式选择 → 按显式选择出题（非伪造计划）", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [],
      selection: { examTrackId: "408", subjectId: "408.computer-networks", moduleId: null }
    })
    expect(decision.mode).toBe("explicit")
    expect(decision.evidenceText).toContain("用户明确选择")
  })
})

describe("今日计划驱动：日期 / 时区 / 完成状态 / 时长", () => {
  it("非今日 dueAt 的任务不进入今日计划（本地自然日判定）", () => {
    const yesterday = new Date(2026, 7, 6, 23, 0, 0).getTime()
    expect(isTodayPlan(makeTask({ remoteId: "t1", subjectRemoteId: "sub-net", dueAt: yesterday }), NOW_MS)).toBe(false)
    const today = new Date(2026, 7, 7, 23, 30, 0).getTime()
    expect(isTodayPlan(makeTask({ remoteId: "t1", subjectRemoteId: "sub-net", dueAt: today }), NOW_MS)).toBe(true)
  })

  it("已删除 / 非计划类型 / 无 dueAt 的任务不进入今日计划", () => {
    expect(
      isTodayPlan(makeTask({ remoteId: "t1", dueAt: NOW_MS, deletedAt: NOW_MS }), NOW_MS)
    ).toBe(false)
    expect(isTodayPlan(makeTask({ remoteId: "t1", dueAt: NOW_MS, type: 0 }), NOW_MS)).toBe(false)
    expect(isTodayPlan(makeTask({ remoteId: "t1", dueAt: null }), NOW_MS)).toBe(false)
  })

  it("时长进入 evidence（推荐难度与节奏的依据，不是掌握度）", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [
        makeTask({
          remoteId: "t1",
          subjectRemoteId: "sub-net",
          title: "网络 2 小时",
          targetDurationSeconds: 7200
        })
      ]
    })
    expect(decision.evidence[0].durationSeconds).toBe(7200)
  })

  it("今日计划存在但未映射到考试体系 → no-plan 并说明原因，不猜测", () => {
    const decision = decideQuestionScope({
      ...emptyInput(),
      todayTasks: [makeTask({ remoteId: "t1", subjectRemoteId: "sub-custom", title: "自定义科目复习" })]
    })
    expect(decision.mode).toBe("no-plan")
    expect(decision.reason).toContain("没有可靠映射")
  })
})

describe("手机科目解析（resolveSubject）", () => {
  it("未映射科目 → unmapped，不猜测", () => {
    const result = resolveSubject("sub-custom", "我的自定义科目", [], undefined)
    expect(result.status).toBe("unmapped")
    expect(result.node).toBeNull()
    expect(result.reason).toContain("未映射")
  })

  it("精确别名匹配唯一命中 → mapped（可被用户确认/撤销）", () => {
    const result = resolveSubject("sub-net", "计算机网络", [], undefined)
    expect(result.status).toBe("mapped")
    expect(result.node?.stableId).toBe("408.computer-networks")
    expect(result.via).toBe("alias")
  })

  it("旧映射值指向考试组（cs408）→ pending-confirm，要求选择子科目", () => {
    const result = resolveSubject(
      "sub-408",
      "408",
      [{ alertSubjectRemoteId: "sub-408", teacherSubjectId: "cs408" }],
      undefined
    )
    expect(result.status).toBe("pending-confirm")
    expect(result.node?.nodeType).toBe("EXAM_TRACK")
  })

  it("用户映射到叶子 → mapped（映射表优先于名称）", () => {
    const result = resolveSubject(
      "sub-net",
      "网络",
      [{ alertSubjectRemoteId: "sub-net", teacherSubjectId: "cs408", examSubjectId: "408.computer-networks" }],
      undefined
    )
    expect(result.status).toBe("mapped")
    expect(result.node?.stableId).toBe("408.computer-networks")
    expect(result.via).toBe("user_mapping")
  })

  it("手机端声明字段只作补充依据 → pending-confirm，不能自动采用", () => {
    // 科目名不命中别名（用户自定义名），只能靠手机端声明字段 → 必须用户确认。
    const result = resolveSubject("sub-declared", "专业课1", [], {
      "sub-declared": { trackId: "408", subjectId: "408.computer-networks", moduleId: null }
    })
    expect(result.status).toBe("pending-confirm")
    expect(result.node?.stableId).toBe("408.computer-networks")
    expect(result.via).toBe("phone_declared")
  })

  it("「英语」别名命中考试组 → pending-confirm（不能当作具体课程）", () => {
    const result = resolveSubject("sub-english", "英语", [], undefined)
    expect(result.status).toBe("pending-confirm")
    expect(result.node?.nodeType).toBe("EXAM_TRACK")
  })
})

describe("选择器辅助", () => {
  it("选择器可组合 UserSelection", () => {
    const selection: UserSelection = { examTrackId: "408", subjectId: "408.computer-networks", moduleId: null }
    expect(selection.subjectId).toBe("408.computer-networks")
  })
})
