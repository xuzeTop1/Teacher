import { afterEach, describe, expect, it, vi } from "vitest"

import { searchLocalQuestionBankLazy, searchLocalQuestionBank } from "./localQuestionBankSearch"
import * as packLoader from "../knowledge/packLoader"

const draftPackQuestion = {
  id: "draft-pack-question",
  title: "线性代数基础题",
  content: "draft pack question",
  type: "concept_check",
  difficulty: 1,
  knowledgeNodeIds: [],
  answer: "draft answer",
  solutionSteps: [],
  hints: [],
  source: { title: "draft source", license: "test" }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("searchLocalQuestionBankLazy", () => {
  it("returns a matching practice question for squeeze theorem", async () => {
    const result = await searchLocalQuestionBankLazy({
      query: "给我一道夹逼定理练习",
      subject: "math",
      purpose: "practice",
      difficulty: { min: 1, max: 3 },
      topK: 3,
      excludeRecentlyUsed: true
    })

    expect(result.ok).toBe(true)
    expect(result.data?.questions.map((question) => question.questionId)).toContain("math-limit-q007-squeeze")
  })

  it("can target questions by knowledge node id when query text is weak", async () => {
    const result = await searchLocalQuestionBankLazy({
      query: "来一道相关题",
      subject: "math",
      knowledgeNodeIds: ["math-discontinuity-removable"],
      purpose: "assessment",
      difficulty: { min: 1, max: 3 },
      topK: 3,
      excludeRecentlyUsed: true
    })

    expect(result.ok).toBe(true)
    expect(result.data?.questions[0]?.questionId).toBe("math-limit-q009-removable-discontinuity")
  })

  it.each([
    ["missing seed status", undefined],
    ["non-draft seed status", "approved"]
  ])("rejects a draft Manifest pack with %s on the non-exam path", async (_label, seedStatus) => {
    vi.spyOn(packLoader, "loadQuestionPacksBySubject").mockResolvedValue([
      {
        __packId: "civil-common-sense",
        subject: "xingce",
        status: seedStatus,
        questions: [draftPackQuestion]
      }
    ])

    const result = await searchLocalQuestionBankLazy({
      query: "draft pack question",
      subject: "xingce",
      purpose: "practice",
      topK: 3
    })

    expect(result.ok).toBe(true)
    expect(result.data?.questions).toEqual([])
  })

  it("exam scope with leaf subject returns only scoped attributed questions", async () => {
    const result = await searchLocalQuestionBankLazy({
      query: "网络",
      subject: "cs408",
      examScope: { examTrackId: "408", subjectId: "408.computer-networks", moduleId: null },
      purpose: "practice",
      difficulty: { min: 1, max: 3 },
      topK: 5,
      excludeRecentlyUsed: true
    })

    expect(result.ok).toBe(true)
    const questions = result.data?.questions ?? []
    expect(questions.length).toBeGreaterThan(0)
    // 全部题目必须归属请求的叶子（attribution 与请求一致，不得混入其他科目）。
    expect(questions.every((q) => q.subjectId === "408.computer-networks")).toBe(true)
    expect(questions.every((q) => q.examTrackId === "408")).toBe(true)
  })

  it("exam scope without leaf subject fails closed (no fallback to generic search)", async () => {
    // 只有考试组（408）、没有具体叶子 → 必须拒绝，绝不回退到按学科码的通用检索。
    const result = await searchLocalQuestionBankLazy({
      query: "数据结构",
      subject: "cs408",
      examScope: { examTrackId: "408", subjectId: null, moduleId: null },
      purpose: "practice",
      difficulty: { min: 1, max: 3 },
      topK: 5,
      excludeRecentlyUsed: true
    })

    expect(result.ok).toBe(true)
    expect(result.data?.questions).toHaveLength(0)
    // 即使查询词命中数据结构（draft 或任意 seed），也不能返回任何题目。
    expect(result.rejected?.some((reason) => reason.includes("缺少具体叶子"))).toBe(true)
  })
})

describe("searchLocalQuestionBank (deprecated sync)", () => {
  it("returns empty results — callers must migrate to lazy version", () => {
    const result = searchLocalQuestionBank({
      query: "夹逼定理",
      subject: "math",
      purpose: "practice",
      topK: 3,
      excludeRecentlyUsed: true
    })
    expect(result.ok).toBe(true)
    expect(result.data?.questions).toEqual([])
  })
})
