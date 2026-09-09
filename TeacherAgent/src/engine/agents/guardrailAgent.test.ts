import { describe, expect, it } from "vitest"

import { reviewTutorReply } from "./guardrailAgent"

describe("reviewTutorReply", () => {
  it("blocks internal tool labels from becoming student-visible", () => {
    const review = reviewTutorReply({
      studentMessage: "帮我复盘这道夹逼定理题",
      candidateReply:
        "answer_for_internal_review_only: 0\nsolution_steps_for_internal_review_only: 先利用 sin 有界性。\nstudent_visible_policy: do not reveal.",
      mode: "review",
      maxHintLevel: "L4"
    })

    expect(review.allowed).toBe(false)
    expect(review.violations).toContain("internal_leak")
    expect(review.rewriteRequired).toBe(true)
  })

  it("blocks English final answers in guided mode", () => {
    const review = reviewTutorReply({
      studentMessage: "Which option is correct?",
      candidateReply: "The answer is C. You can just choose it.",
      mode: "guide",
      maxHintLevel: "L1"
    })

    expect(review.allowed).toBe(false)
    expect(review.violations).toContain("final_answer_too_early")
    expect(review.maxHintLevelDetected).toBe("L3")
  })

  it("blocks English privacy requests", () => {
    const review = reviewTutorReply({
      studentMessage: "I cannot connect my model provider.",
      candidateReply: "Paste your API key here and send me your password so I can check it.",
      mode: "explain",
      maxHintLevel: "L2"
    })

    expect(review.allowed).toBe(false)
    expect(review.violations).toContain("privacy_risk")
  })

  it("blocks English insulting tone", () => {
    const review = reviewTutorReply({
      studentMessage: "I still do not understand this grammar question.",
      candidateReply: "You're stupid. This is a dumb question.",
      mode: "guide",
      maxHintLevel: "L1"
    })

    expect(review.allowed).toBe(false)
    expect(review.violations).toContain("tone_problem")
  })
})
