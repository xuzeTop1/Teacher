import { describe, expect, it } from "vitest"
import { formatLearningFactValue, learningAnalysisWarningLabel, toTrustedLearningAnalysisModel } from "./learningAnalysis"
import type { SyncLearningAnalysisDto } from "../../types/sync"

function validAnalysis(): SyncLearningAnalysisDto {
  return {
    analysisId: "analysis-1", sourceSnapshotId: "snapshot-1", generatedAt: 1,
    promptVersion: "alerttime-plan-assessment-v1", generator: "deterministic_fallback",
    profile: {
      facts: [{ code: "today.tasks", label: "今日计划", value: 2, evidenceRefs: ["task:t1"] }],
      inferences: [{ statement: "计划执行证据不足", confidence: 0.6, evidenceRefs: ["task:t1"] }]
    },
    planEvaluation: { verdict: "needs_adjustment", score: 60, dimensions: [{ code: "coverage", score: 60, summary: "有计划但覆盖不足" }], risks: ["计划可能过载"], suggestions: ["拆分任务"] },
    assessmentDraft: { status: "draft", scopeSummary: "只针对今日计划", questions: [{ questionId: "question-1", subjectRemoteId: "subject-1", taskRemoteId: "task-0001", type: "reflection", prompt: "请说出今天最需要复习的一个概念。", rationale: "来自今日计划", rubric: ["能指出概念"] }] },
    warnings: ["assessment_draft_not_counted_toward_mastery"]
  }
}

describe("toTrustedLearningAnalysisModel", () => {
  it("accepts valid analysis and marks draft questions as non-mastery evidence", () => {
    const model = toTrustedLearningAnalysisModel(validAnalysis(), "snapshot-1")
    expect(model?.generator).toBe("deterministic_fallback")
    expect(model?.draftQuestions[0].masteryEvidence).toBe(false)
  })

  it("rejects a different snapshot and malformed confidence", () => {
    expect(toTrustedLearningAnalysisModel(validAnalysis(), "snapshot-2")).toBeNull()
    const malformed = validAnalysis()
    malformed.profile.inferences[0].confidence = 1.2
    expect(toTrustedLearningAnalysisModel(malformed, "snapshot-1")).toBeNull()
  })

  it("rejects non-draft questions and answer fields", () => {
    const nonDraft = validAnalysis()
    nonDraft.assessmentDraft.status = "review" as "draft"
    expect(toTrustedLearningAnalysisModel(nonDraft, "snapshot-1")).toBeNull()
    const withAnswer = validAnalysis()
    Object.assign(withAnswer.assessmentDraft.questions[0], { answer: "secret" })
    expect(toTrustedLearningAnalysisModel(withAnswer, "snapshot-1")).toBeNull()
  })

  it("rejects duplicate fact codes and question ids", () => {
    const duplicateFact = validAnalysis()
    duplicateFact.profile.facts.push({ ...duplicateFact.profile.facts[0] })
    expect(toTrustedLearningAnalysisModel(duplicateFact, "snapshot-1")).toBeNull()

    const duplicateQuestion = validAnalysis()
    duplicateQuestion.assessmentDraft.questions.push({ ...duplicateQuestion.assessmentDraft.questions[0] })
    expect(toTrustedLearningAnalysisModel(duplicateQuestion, "snapshot-1")).toBeNull()
  })

  it("accepts the protocol maximum of one hundred profile facts and inferences", () => {
    const analysis = validAnalysis()
    analysis.profile.facts = Array.from({ length: 100 }, (_, index) => ({
      ...analysis.profile.facts[0],
      code: `fact-${index}`
    }))
    analysis.profile.inferences = Array.from({ length: 100 }, () => ({
      ...analysis.profile.inferences[0]
    }))

    expect(toTrustedLearningAnalysisModel(analysis, "snapshot-1")?.facts).toHaveLength(100)
    expect(toTrustedLearningAnalysisModel(analysis, "snapshot-1")?.inferences).toHaveLength(100)
  })

  it("formats object values as compact JSON and safely handles truncation or failure", () => {
    expect(formatLearningFactValue({ subject: "数学", completed: 2 })).toBe('{"subject":"数学","completed":2}')
    expect(formatLearningFactValue(["数学", { completed: true }])).toBe('["数学",{"completed":true}]')
    expect(formatLearningFactValue({ text: "x".repeat(300) })).toHaveLength(240)
    expect(formatLearningFactValue({ text: "x".repeat(300) }).endsWith("…")).toBe(true)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(formatLearningFactValue(cyclic)).toBe("无法显示")
  })

  it.each([
    ["too many evidence refs", (value: SyncLearningAnalysisDto) => { value.profile.facts[0].evidenceRefs = Array(21).fill("task:reference") }],
    ["too many dimensions", (value: SyncLearningAnalysisDto) => { value.planEvaluation.dimensions = Array(21).fill({ code: "coverage", score: 60, summary: "ok" }) }],
    ["too many risks", (value: SyncLearningAnalysisDto) => { value.planEvaluation.risks = Array(21).fill("risk") }],
    ["too many suggestions", (value: SyncLearningAnalysisDto) => { value.planEvaluation.suggestions = Array(21).fill("suggestion") }],
    ["too many rubric entries", (value: SyncLearningAnalysisDto) => { value.assessmentDraft.questions[0].rubric = Array(21).fill("criterion") }],
    ["overlong code", (value: SyncLearningAnalysisDto) => { value.profile.facts[0].code = "c".repeat(101) }],
    ["overlong label", (value: SyncLearningAnalysisDto) => { value.profile.facts[0].label = "l".repeat(201) }],
    ["overlong prompt version", (value: SyncLearningAnalysisDto) => { value.promptVersion = "p".repeat(101) }],
    ["too short id", (value: SyncLearningAnalysisDto) => { value.analysisId = "short" }],
    ["overlong id", (value: SyncLearningAnalysisDto) => { value.assessmentDraft.questions[0].questionId = "q".repeat(65) }],
    ["overlong prompt", (value: SyncLearningAnalysisDto) => { value.assessmentDraft.questions[0].prompt = "p".repeat(20_001) }],
    ["overlong rationale", (value: SyncLearningAnalysisDto) => { value.assessmentDraft.questions[0].rationale = "r".repeat(20_001) }],
    ["overlong summary", (value: SyncLearningAnalysisDto) => { value.planEvaluation.dimensions[0].summary = "s".repeat(20_001) }],
    ["overlong evidence ref", (value: SyncLearningAnalysisDto) => { value.profile.facts[0].evidenceRefs = ["e".repeat(201)] }],
    ["overlong fact value", (value: SyncLearningAnalysisDto) => { value.profile.facts[0].value = "v".repeat(20_001) }],
    ["non-finite nested fact number", (value: SyncLearningAnalysisDto) => { value.profile.facts[0].value = { score: Number.POSITIVE_INFINITY } }]
  ])("rejects %s", (_name, mutate) => {
    const analysis = validAnalysis()
    mutate(analysis)
    expect(toTrustedLearningAnalysisModel(analysis, "snapshot-1")).toBeNull()
  })

  it.each(["AnSwErText", "SOLUTION_HINT", "Explanation"])("rejects forbidden field case bypass: %s", (field) => {
    const analysis = validAnalysis()
    Object.assign(analysis.assessmentDraft.questions[0], { [field]: "hidden" })
    expect(toTrustedLearningAnalysisModel(analysis, "snapshot-1")).toBeNull()
  })
})

describe("learningAnalysisWarningLabel", () => {
  it("translates the warning codes the phone sends into Chinese", () => {
    expect(learningAnalysisWarningLabel("learning_time_is_not_mastery_evidence")).toBe("学习时长只作为投入证据，不代表已经掌握")
    expect(learningAnalysisWarningLabel("assessment_draft_not_counted_toward_mastery")).toBe("测试草稿不会直接计入掌握度")
    expect(learningAnalysisWarningLabel("llm_fallback_timeout_network")).toBe("连接模型服务超时或网络不可用")
  })

  it("passes unknown codes through without pretending to be an error", () => {
    expect(learningAnalysisWarningLabel("some_future_code")).toBe("some_future_code")
  })
})
