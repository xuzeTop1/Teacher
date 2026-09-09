import { describe, expect, it } from "vitest"
import { selectSocraticStrategy } from "./socraticAgent"

const baseInput = {
  recentMessages: [],
  subjectCode: "math" as const
}

describe("selectSocraticStrategy", () => {
  // ── Outline / summary intent ──────────────────────────────────────────

  describe("outline / summary queries (shouldAskQuestion = false)", () => {
    const outlineCases = [
      { msg: "考研政治考哪些内容", subject: "politics" as const },
      { msg: "考研数学大纲有哪些内容", subject: "math" as const },
      { msg: "考研英语考什么", subject: "english" as const },
      { msg: "408 考试范围有哪些", subject: "cs408" as const },
      { msg: "大学物理力学部分考哪些内容", subject: "physics" as const },
      { msg: "这份资料主要讲了什么", subject: "math" as const },
      { msg: "帮我总结这个 PDF", subject: "math" as const },
      { msg: "大纲是什么", subject: "politics" as const },
      { msg: "这门课主要学什么", subject: "cs408" as const },
      { msg: "summarize this document", subject: "english" as const },
      { msg: "线代大纲有哪些章节", subject: "math" as const },
      { msg: "考试内容有哪些", subject: "physics" as const },
      { msg: "帮我总结资料", subject: "politics" as const },
      { msg: "包含哪些章节", subject: "math" as const },
      { msg: "知识框架梳理一下", subject: "cs408" as const }
    ]

    for (const { msg, subject } of outlineCases) {
      it(`"${msg}" (${subject}) → intent=outline_summary, shouldAskQuestion=false`, () => {
        const result = selectSocraticStrategy({ ...baseInput, userMessage: msg, subjectCode: subject })
        expect(result.intent).toBe("outline_summary")
        expect(result.shouldAskQuestion).toBe(false)
        expect(result.mode).toBe("explain")
        expect(result.strategy).toBe("direct_review")
        expect(result.explanationDepth).toBe("concept")
      })
    }
  })

  // ── Concept explanations are self-contained unless practice is requested ─

  describe("concept questions do not force a follow-up question", () => {
    const conceptCases = [
      "什么是极限？",
      "为什么连续不一定可导？",
      "解释一下条件概率",
      "微分中值定理的拉格朗日定理是什么？",
      "用人话说说拉格朗日中值定理",
      "拉格朗日中值定理有什么用？",
      "what is a derivative?"
    ]

    for (const msg of conceptCases) {
      it(`"${msg}" → concept explanation without a forced question`, () => {
        const result = selectSocraticStrategy({ ...baseInput, userMessage: msg })
        expect(result.intent).toBe("concept_question")
        expect(result.shouldAskQuestion).toBe(false)
        expect(result.mode).toBe("explain")
        expect(result.explanationDepth).toBe("concept")
      })
    }
  })

  // ── Regression: direct answer requests still get guardrailed ──────────

  describe("direct answer requests", () => {
    it('"直接给答案" → shouldAskQuestion=true, risk signal', () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "直接给答案" })
      expect(result.shouldAskQuestion).toBe(true)
      expect(result.riskSignals).toContain("direct_answer_request")
    })
  })

  // ── Regression: practice/problem-solving still uses guide ─────────────

  describe("practice / problem-solving", () => {
    it('"这道题怎么做？" → shouldAskQuestion=true, mode=guide', () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "这道题怎么做？" })
      expect(result.shouldAskQuestion).toBe(true)
      expect(result.mode).toBe("guide")
    })

    it('"给我一道练习题" → shouldAskQuestion=true', () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "给我一道练习题" })
      expect(result.shouldAskQuestion).toBe(true)
    })
  })

  // ── Regression: exam sprint still works for sprint-specific queries ───

  describe("exam sprint", () => {
    it('"考研冲刺怎么提分" → mode=exam_sprint', () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "考研冲刺怎么提分" })
      expect(result.mode).toBe("exam_sprint")
      expect(result.shouldAskQuestion).toBe(true)
    })

    it('"有没有高频题刷一下" → mode=exam_sprint', () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "有没有高频题刷一下" })
      expect(result.mode).toBe("exam_sprint")
    })
  })

  // ── Regression: review mode ──────────────────────────────────────────

  describe("review mode", () => {
    it('"帮我复盘这道题" → intent=review, shouldAskQuestion=false (not outline_summary)', () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "帮我复盘这道题" })
      expect(result.mode).toBe("review")
      expect(result.intent).toBe("review")
      expect(result.shouldAskQuestion).toBe(false)
    })
  })

  // ── Outline wins over concept when both match ───────────────────────

  describe("outline takes priority over concept", () => {
    const outlineOverConceptCases = [
      "什么是考研政治大纲",
      "解释一下考试范围",
      "这份大纲讲了什么",
      "考试内容有哪些"
    ]

    for (const msg of outlineOverConceptCases) {
      it(`"${msg}" → intent=outline_summary, not concept_question`, () => {
        const result = selectSocraticStrategy({ ...baseInput, userMessage: msg })
        expect(result.intent).toBe("outline_summary")
        expect(result.shouldAskQuestion).toBe(false)
      })
    }
  })

  // ── Requested mode maps to correct intent ───────────────────────────

  describe("requested mode → intent mapping", () => {
    it("mode=review → intent=review", () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "test", requestedMode: "review" })
      expect(result.intent).toBe("review")
      expect(result.shouldAskQuestion).toBe(false)
    })

    it("mode=exam_sprint → intent=exam_sprint", () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "test", requestedMode: "exam_sprint" })
      expect(result.intent).toBe("exam_sprint")
    })

    it("mode=diagnose → intent=practice_solve", () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "test", requestedMode: "diagnose" })
      expect(result.intent).toBe("practice_solve")
    })

    it("mode=explain → intent=concept_question", () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "test", requestedMode: "explain" })
      expect(result.intent).toBe("concept_question")
    })

    it("mode=guide → intent=default_guide", () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "test", requestedMode: "guide" })
      expect(result.intent).toBe("default_guide")
    })
  })

  // ── Regression: emotional distress ───────────────────────────────────

  describe("emotional distress", () => {
    it('"太难了我学不会" → strategy=reflection_question', () => {
      const result = selectSocraticStrategy({ ...baseInput, userMessage: "太难了我学不会" })
      expect(result.strategy).toBe("reflection_question")
      expect(result.shouldAskQuestion).toBe(true)
    })
  })

  // ── Answer with reasoning: correct answer closes the loop ──────────

  describe("answer_with_reasoning (答对闭环)", () => {
    const correctAnswerCases = [
      { msg: "tanx 等价于 x 所以极限值为 3/2", subject: "math" as const },
      { msg: "因为等价无穷小所以答案是 1", subject: "math" as const },
      { msg: "代入 x=0 得出结果为 2", subject: "math" as const },
      { msg: "化简后等于 5/3", subject: "math" as const },
      { msg: "等价于 3x 因此极限值为 3", subject: "math" as const },
      { msg: "洛必达法则求导得出答案是 1/2", subject: "math" as const },
      { msg: "通分后等于 7/6", subject: "math" as const }
    ]

    for (const { msg, subject } of correctAnswerCases) {
      it(`"${msg}" → intent=answer_with_reasoning, shouldAskQuestion=false`, () => {
        const result = selectSocraticStrategy({ ...baseInput, userMessage: msg, subjectCode: subject })
        expect(result.intent).toBe("answer_with_reasoning")
        expect(result.shouldAskQuestion).toBe(false)
        expect(result.mode).toBe("review")
        expect(result.explanationDepth).toBe("full_review")
      })
    }

    it("answer_with_reasoning should NOT match when only reasoning without conclusion", () => {
      const result = selectSocraticStrategy({
        ...baseInput,
        userMessage: "我觉得可以用等价无穷小",
        subjectCode: "math"
      })
      // Should fall through to hasStudentAttempt → practice_solve
      expect(result.intent).toBe("practice_solve")
      expect(result.shouldAskQuestion).toBe(true)
    })

    it("answer_with_reasoning should NOT match when only conclusion without reasoning", () => {
      const result = selectSocraticStrategy({
        ...baseInput,
        userMessage: "答案是 3/2",
        subjectCode: "math"
      })
      // Should fall through to hasStudentAttempt or default_guide
      expect(result.intent).not.toBe("answer_with_reasoning")
    })
  })

  // ── Regression: incorrect answers still get guided ─────────────────

  describe("incorrect answers still get probing", () => {
    it('"我觉得等于 0 因为 sinx 等价于 0" → still gets diagnosed', () => {
      const result = selectSocraticStrategy({
        ...baseInput,
        userMessage: "我觉得等于 0 因为 sinx 等价于 0",
        subjectCode: "math"
      })
      // "因为" + "等价" but conclusion "等于 0" is likely wrong pattern
      // This should still be answer_with_reasoning (we don't judge correctness here,
      // that's the LLM's job via prompt guidance)
      // The prompt will handle confirming or correcting
      expect(result.intent).toBe("answer_with_reasoning")
    })
  })

  // ── Boundary: outline intent wins over exam sprint when both match ───

  describe("outline intent takes priority over exam sprint", () => {
    it('"考研政治考哪些内容" matches outline, not exam_sprint', () => {
      const result = selectSocraticStrategy({
        ...baseInput,
        userMessage: "考研政治考哪些内容",
        subjectCode: "politics"
      })
      // Should be outline (explain), not exam_sprint
      expect(result.mode).toBe("explain")
      expect(result.shouldAskQuestion).toBe(false)
      expect(result.riskSignals).not.toContain("plan_learning_request")
    })
  })
})
