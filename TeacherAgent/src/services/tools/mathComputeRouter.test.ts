import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock tauri commands — must be before importing the module under test
const mockComputeMathWithWorker = vi.fn()
const mockComputeMathExpression = vi.fn()

vi.mock("../tauri/commands", () => ({
  computeMathWithWorker: (...args: unknown[]) => mockComputeMathWithWorker(...args),
  computeMathExpression: (...args: unknown[]) => mockComputeMathExpression(...args)
}))

import { runMathComputeWithFallback } from "./mathComputeRouter"
import type { MathComputeInput } from "../../types/tool"

function makeInput(overrides?: Partial<MathComputeInput>): MathComputeInput {
  return {
    operation: "simplify",
    expression: "x**2 + 2*x + 1",
    variable: "x",
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("runMathComputeWithFallback", () => {
  // ── Case 1: Worker succeeds → engine = "sympy" ───────────────
  it("returns engine=sympy when worker succeeds", async () => {
    mockComputeMathWithWorker.mockResolvedValue({
      ok: true,
      result: "(x + 1)**2",
      latex: "(x + 1)^{2}",
      steps: ["化简结果: (x + 1)**2"],
      warnings: []
    })

    const result = await runMathComputeWithFallback(makeInput())

    expect(result.ok).toBe(true)
    expect(result.data?.engine).toBe("sympy")
    expect(result.data?.confidence).toBe(0.95)
    expect(result.data?.isFallback).toBe(false)
    expect(result.data?.result).toBe("(x + 1)**2")
    expect(mockComputeMathWithWorker).toHaveBeenCalledWith("x**2 + 2*x + 1", "simplify", "x")
    expect(mockComputeMathExpression).not.toHaveBeenCalled()
  })

  // ── Case 2: Worker fails → fallback builtin → engine = "builtin" ──
  it("falls back to builtin when worker returns ok=false", async () => {
    mockComputeMathWithWorker.mockResolvedValue({
      ok: false,
      result: "",
      steps: [],
      warnings: ["worker failed"]
    })
    mockComputeMathExpression.mockResolvedValue({
      result: "2*x + 2",
      latex: "2x + 2",
      normalizedExpression: "x**2 + 2*x + 1",
      operation: "differentiate",
      steps: ["对 x 求导"],
      warnings: [],
      confidence: 0.6,
      engine: "builtin"
    })

    const result = await runMathComputeWithFallback(makeInput({ operation: "differentiate" }))

    expect(result.ok).toBe(true)
    expect(result.data?.engine).toBe("builtin")
    expect(result.data?.isFallback).toBe(true)
    expect(result.data?.confidence).toBe(0.6)
    expect(mockComputeMathWithWorker).toHaveBeenCalled()
    expect(mockComputeMathExpression).toHaveBeenCalled()
  })

  // ── Case 3: Worker throws → fallback builtin → engine = "builtin" ──
  it("falls back to builtin when worker throws", async () => {
    mockComputeMathWithWorker.mockRejectedValue(new Error("timeout"))
    mockComputeMathExpression.mockResolvedValue({
      result: "2*x + 2",
      latex: "2x + 2",
      normalizedExpression: "x**2",
      operation: "differentiate",
      steps: [],
      warnings: [],
      confidence: 0.6,
      engine: "builtin"
    })

    const result = await runMathComputeWithFallback(makeInput({ operation: "differentiate" }))

    expect(result.ok).toBe(true)
    expect(result.data?.engine).toBe("builtin")
    expect(result.data?.isFallback).toBe(true)
  })

  // ── Case 4: Both fail → engine = "unavailable" ────────────────
  it("returns engine=unavailable when both worker and builtin fail", async () => {
    mockComputeMathWithWorker.mockResolvedValue({
      ok: false,
      result: "",
      steps: [],
      warnings: []
    })
    mockComputeMathExpression.mockRejectedValue(new Error("builtin error"))

    const result = await runMathComputeWithFallback(makeInput({ operation: "differentiate" }))

    expect(result.ok).toBe(false)
    expect(result.data?.engine).toBe("unavailable")
    expect(result.data?.confidence).toBe(0)
  })

  // ── Case 5: Unsupported operation → UNSUPPORTED_INPUT ────────
  it("returns UNSUPPORTED_INPUT for matrix/series/probability", async () => {
    const result = await runMathComputeWithFallback(makeInput({ operation: "matrix" }))

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("UNSUPPORTED_INPUT")
    expect(result.data?.engine).toBe("unavailable")
    expect(mockComputeMathWithWorker).not.toHaveBeenCalled()
    expect(mockComputeMathExpression).not.toHaveBeenCalled()
  })

  // ── Case 6: Empty expression → validation error ──────────────
  it("rejects empty expression", async () => {
    const result = await runMathComputeWithFallback(makeInput({ expression: "   " }))

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("UNSUPPORTED_INPUT")
  })

  // ── Case 7: Operation name mapping ───────────────────────────
  it("maps differentiate to 'diff' and evaluate to 'eval' for worker", async () => {
    mockComputeMathWithWorker.mockResolvedValue({
      ok: true,
      result: "2*x",
      steps: [],
      warnings: []
    })

    await runMathComputeWithFallback(makeInput({ operation: "differentiate", expression: "x**2" }))
    expect(mockComputeMathWithWorker).toHaveBeenCalledWith("x**2", "diff", "x")

    await runMathComputeWithFallback(makeInput({ operation: "evaluate", expression: "x + 1" }))
    expect(mockComputeMathWithWorker).toHaveBeenCalledWith("x + 1", "eval", "x")
  })

  // ── Case 8: expand/factor → sympy only (no builtin fallback) ──
  it("tries sympy for expand, no builtin fallback", async () => {
    mockComputeMathWithWorker.mockResolvedValue({
      ok: true,
      result: "x**2 + 2*x + 1",
      steps: [],
      warnings: []
    })

    const result = await runMathComputeWithFallback(makeInput({ operation: "expand" }))

    expect(result.data?.engine).toBe("sympy")
    expect(mockComputeMathExpression).not.toHaveBeenCalled()
  })

  // ── Case 9: warnings and confidence consistency ──────────────
  it("includes worker warnings in result", async () => {
    mockComputeMathWithWorker.mockResolvedValue({
      ok: true,
      result: "x",
      steps: ["step1"],
      warnings: ["condition assumption needed"]
    })

    const result = await runMathComputeWithFallback(makeInput())

    expect(result.data?.warnings).toContain("condition assumption needed")
  })
})
