import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { toTrustedLearningAnalysisModel } from "./learningAnalysis"
import type { SyncLearningAnalysisDto } from "../../types/sync"

interface CanonicalSnapshotFixture {
  snapshotId: string
  payload: {
    subjects: Array<{ remoteId: string }>
    tasks: Array<{ remoteId: string; subjectRemoteId: string | null }>
    learningAnalysis: SyncLearningAnalysisDto
  }
}

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../sync/protocol/fixtures/snapshot-valid.json"
)

function readCanonicalFixture(): CanonicalSnapshotFixture {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as CanonicalSnapshotFixture
}

function cloneAnalysis(analysis: SyncLearningAnalysisDto): SyncLearningAnalysisDto {
  return JSON.parse(JSON.stringify(analysis)) as SyncLearningAnalysisDto
}

describe("canonical snapshot learningAnalysis contract", () => {
  it("reads the canonical JSON fixture into the Sync DTO and projects all trusted sections", () => {
    const fixture = readCanonicalFixture()
    const analysis: SyncLearningAnalysisDto = fixture.payload.learningAnalysis

    const model = toTrustedLearningAnalysisModel(analysis, fixture.snapshotId)

    expect(model).not.toBeNull()
    expect(model).toMatchObject({
      sourceSnapshotId: fixture.snapshotId,
      generator: "deterministic_fallback",
      facts: [{ code: "today.completed_tasks", value: 1 }],
      inferences: [{ confidence: 0.72 }],
      planEvaluation: { verdict: "reasonable", score: 82 }
    })
    expect(model?.facts).toHaveLength(1)
    expect(model?.inferences).toHaveLength(1)
    expect(model?.planEvaluation.dimensions).toHaveLength(1)
    expect(model?.draftQuestions).toHaveLength(1)
    expect(model?.warnings).toContain("该评估测试仅为 draft，不进入 approved 题库或掌握度。")
  })

  it("fails closed when the analysis sourceSnapshotId differs from the envelope snapshotId", () => {
    const fixture = readCanonicalFixture()
    const analysis = cloneAnalysis(fixture.payload.learningAnalysis)
    analysis.sourceSnapshotId = "foreign-snapshot-00000000000000000000000000000000"

    expect(toTrustedLearningAnalysisModel(analysis, fixture.snapshotId)).toBeNull()
  })

  it.each([
    ["answer field", (analysis: SyncLearningAnalysisDto) => {
      Object.assign(analysis.assessmentDraft.questions[0], { answer: "hidden answer" })
    }],
    ["evidenceRef with invalid value type", (analysis: SyncLearningAnalysisDto) => {
      analysis.profile.facts[0].evidenceRefs = [123 as unknown as string]
    }],
    ["blank evidenceRef", (analysis: SyncLearningAnalysisDto) => {
      analysis.profile.facts[0].evidenceRefs = [" "]
    }],
    ["overlong evidenceRef", (analysis: SyncLearningAnalysisDto) => {
      analysis.profile.facts[0].evidenceRefs = ["e".repeat(201)]
    }],
    ["confidence above one", (analysis: SyncLearningAnalysisDto) => {
      analysis.profile.inferences[0].confidence = 1.01
    }],
    ["plan score below zero", (analysis: SyncLearningAnalysisDto) => {
      analysis.planEvaluation.score = -1
    }],
    ["dimension score above one hundred", (analysis: SyncLearningAnalysisDto) => {
      analysis.planEvaluation.dimensions[0].score = 100.01
    }]
  ])("rejects %s", (_variant, mutate) => {
    const fixture = readCanonicalFixture()
    const analysis = cloneAnalysis(fixture.payload.learningAnalysis)
    mutate(analysis)

    expect(toTrustedLearningAnalysisModel(analysis, fixture.snapshotId)).toBeNull()
  })

  it("projects the draft as non-mastery display data without answer fields", () => {
    const fixture = readCanonicalFixture()
    const analysis = fixture.payload.learningAnalysis
    const fact = analysis.profile.facts[0]
    const question = analysis.assessmentDraft.questions[0]
    const model = toTrustedLearningAnalysisModel(analysis, fixture.snapshotId)
    const taskIds = new Set(fixture.payload.tasks.map((task) => task.remoteId))
    const subjectIds = new Set(fixture.payload.subjects.map((subject) => subject.remoteId))

    expect(fact.code).toBe("today.completed_tasks")
    expect(fact.evidenceRefs).toEqual([`task:${question.taskRemoteId}`])
    expect(taskIds.has(question.taskRemoteId ?? "")).toBe(true)
    expect(subjectIds.has(question.subjectRemoteId ?? "")).toBe(true)
    expect(analysis.assessmentDraft.status).toBe("draft")
    expect(model?.draftQuestions[0]).toMatchObject({ masteryEvidence: false })
    expect(model?.draftQuestions[0]).not.toHaveProperty("mastery")
    expect(model?.draftQuestions[0]).not.toHaveProperty("answer")
    expect(model?.draftQuestions[0]).not.toHaveProperty("solution")
    expect(model?.facts[0]).not.toHaveProperty("mastery")
  })
})
