import type { MathComputeInput, MathComputeOutput, ToolResult } from "../../types/tool"
import { runMathComputeWithFallback } from "./mathComputeRouter"

/**
 * Run math computation via the unified router (SymPy → builtin → unavailable).
 * This is the single entry point for ToolAgent.
 */
export async function runMathCompute(input: MathComputeInput): Promise<ToolResult<MathComputeOutput>> {
  return runMathComputeWithFallback(input)
}

/**
 * Build the tool context note injected into the LLM prompt.
 * Engine-aware: different policies for sympy / builtin / unavailable.
 */
export function createMathComputeToolContext(input: MathComputeInput, result: ToolResult<MathComputeOutput>): string {
  if (!result.ok) {
    return [
      "<tool_result tool=\"math_compute\">",
      `status: ${result.errorCode ?? "EXECUTION_ERROR"}`,
      `operation: ${input.operation}`,
      `expression: ${normalizeExpression(input.expression)}`,
      `message: ${result.error ?? "unknown error"}`,
      "student_visible_policy: do not claim a computed result; ask for a smaller step or solve manually with uncertainty noted.",
      "</tool_result>"
    ].join("\n")
  }

  if (!result.data) {
    return [
      "<tool_result tool=\"math_compute\">",
      "status: EXECUTION_ERROR",
      `operation: ${input.operation}`,
      `expression: ${normalizeExpression(input.expression)}`,
      "message: math_compute returned success without data.",
      "student_visible_policy: do not claim a computed result; ask for a smaller step or solve manually with uncertainty noted.",
      "</tool_result>"
    ].join("\n")
  }

  const data = result.data
  const engine = data.engine
  const isFallback = data.isFallback

  const policyMap: Record<string, string> = {
    sympy: "high_confidence: this result is verified by a CAS engine. You may use it as an internal correctness reference. Output should still prioritize guided explanation over dumping the raw result.",
    builtin: "moderate_confidence: this result is from a basic symbolic verifier. Do not present it as absolute truth. Verify key steps independently and note any uncertainty.",
    unavailable: "no_computation_support: there is no real computation engine for this problem. You may explain concepts, suggest approaches, and break down the problem, but do not claim to have computed a verified result."
  }

  return [
    "<tool_result tool=\"math_compute\">",
    "status: success",
    `engine: ${engine}`,
    isFallback ? "is_fallback: true (primary engine failed, used fallback)" : "",
    `operation: ${data.operation}`,
    `expression: ${data.normalizedExpression}`,
    `result: ${data.result}`,
    data.latex ? `latex: ${data.latex}` : "",
    `confidence: ${data.confidence}`,
    data.warnings.length > 0 ? `warnings: ${data.warnings.join("; ")}` : "",
    `student_visible_policy: ${policyMap[engine] ?? policyMap.unavailable}`,
    "</tool_result>"
  ]
    .filter(Boolean)
    .join("\n")
}

function normalizeExpression(expression: string): string {
  return expression.replace(/\s+/g, " ").trim()
}
