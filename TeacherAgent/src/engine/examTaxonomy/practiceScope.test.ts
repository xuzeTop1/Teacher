import { describe, expect, it } from "vitest"
import { createLatestRequestGuard, resolvePracticeScope } from "./practiceScope"
import type { QuestionScopeDecision } from "./planScope"
import type { ExamCatalogNode } from "./catalogTypes"
import type { LearnerGoalScope } from "./learnerGoalScope"

const selection = { trackId: null, subjectId: null, moduleId: null, comprehensive: false }
const networkLeaf: ExamCatalogNode = {
  stableId: "408.computer-networks",
  code: null,
  displayName: "计算机网络",
  shortName: "计网",
  aliases: [],
  parentId: "408",
  nodeType: "SUBJECT",
  status: "approved",
  questionScope: [],
  source: { title: "test", license: "test" }
}

const unmodeledMathGoal: LearnerGoalScope = {
  status: "unmodeled",
  examName: "考研",
  focusSubjects: ["数学二"],
  message: "考研数学尚未建模",
  evidenceRefs: ["user_setting:examName", "user_setting:focusSubjects"]
}

function decision(overrides: Partial<QuestionScopeDecision>): QuestionScopeDecision {
  return {
    mode: "no-plan",
    examTrackId: null,
    subjectId: null,
    moduleId: null,
    evidenceText: "证据",
    evidence: [],
    needsUserChoice: true,
    strategy: null,
    reason: "原因",
    ...overrides
  }
}

describe("resolvePracticeScope", () => {
  it("uses a unique today-plan leaf automatically", () => {
    expect(resolvePracticeScope(selection, decision({ mode: "today-plan", examTrackId: "408", subjectId: "408.computer-networks", needsUserChoice: false, reason: null })).examScope).toEqual({
      examTrackId: "408",
      subjectId: "408.computer-networks",
      moduleId: null
    })
  })

  it("blocks automatic today-plan scope when the learner goal is unmodeled", () => {
    const result = resolvePracticeScope(
      selection,
      decision({ mode: "today-plan", examTrackId: "408", subjectId: "408.computer-networks", needsUserChoice: false, reason: null }),
      unmodeledMathGoal
    )

    expect(result).toEqual({
      examScope: undefined,
      blocked: true,
      message: expect.stringContaining("考研数学尚未建模")
    })
    expect(result.message).toContain("今日范围")
  })

  it("fails closed for requires-choice and no-plan", () => {
    for (const mode of ["requires-choice", "no-plan"] as const) {
      const result = resolvePracticeScope(selection, decision({ mode, reason: "请选择具体课程", evidenceText: "证据文本" }))
      expect(result).toMatchObject({ examScope: undefined, blocked: true, message: "请选择具体课程" })
    }
  })

  it("keeps legacy flat subject behavior when decision is null", () => {
    expect(resolvePracticeScope(selection, null)).toEqual({ examScope: undefined, blocked: false, message: null })
  })

  it("gives manual leaf selection priority", () => {
    const result = resolvePracticeScope(
      { ...selection, trackId: "408", subjectId: "408.operating-systems" },
      decision({ mode: "today-plan", examTrackId: "408", subjectId: "408.computer-networks", needsUserChoice: false, reason: null })
    )
    expect(result.examScope?.subjectId).toBe("408.operating-systems")
  })

  it("allows an explicitly selected leaf and never rewrites it to math", () => {
    const result = resolvePracticeScope(
      { ...selection, trackId: "408", subjectId: "408.computer-networks" },
      decision({ mode: "today-plan", examTrackId: "408", subjectId: "408.computer-networks", needsUserChoice: false, reason: null }),
      unmodeledMathGoal
    )

    expect(result.blocked).toBe(false)
    expect(result.examScope?.subjectId).toBe("408.computer-networks")
  })

  it("gives a manual module priority over today-plan and returns a searchable module scope", () => {
    const moduleId = "408.computer-networks.transport-layer"
    const result = resolvePracticeScope(
      {
        ...selection,
        trackId: "408",
        subjectId: "408.computer-networks",
        moduleId
      },
      decision({
        mode: "today-plan",
        examTrackId: "408",
        subjectId: "408.computer-networks",
        needsUserChoice: false,
        reason: null
      })
    )

    expect(result).toEqual({
      blocked: false,
      message: null,
      examScope: {
        examTrackId: "408",
        subjectId: moduleId,
        moduleId
      }
    })
  })

  it("uses comprehensive strategy currentLeaf, not the parent track", () => {
    const result = resolvePracticeScope(
      { ...selection, trackId: "408", comprehensive: true },
      decision({
        mode: "comprehensive",
        examTrackId: "408",
        subjectId: "408.computer-networks",
        needsUserChoice: false,
        reason: null,
        strategy: {
          kind: "rotation",
          leaves: [networkLeaf],
          currentLeaf: networkLeaf
        }
      })
    )
    expect(result.examScope).toEqual({ examTrackId: "408", subjectId: "408.computer-networks", moduleId: null })
  })
})

describe("createLatestRequestGuard", () => {
  it("prevents a stale async request from overwriting the latest result", async () => {
    const guard = createLatestRequestGuard()
    const committed: string[] = []
    let releaseOld = () => {}
    const oldWait = new Promise<void>((resolve) => {
      releaseOld = resolve
    })

    async function run(label: string, wait: Promise<void>) {
      const token = guard.begin()
      await wait
      if (guard.isLatest(token)) committed.push(label)
    }

    const oldRequest = run("old", oldWait)
    await run("new", Promise.resolve())
    releaseOld()
    await oldRequest

    expect(committed).toEqual(["new"])
  })
})
