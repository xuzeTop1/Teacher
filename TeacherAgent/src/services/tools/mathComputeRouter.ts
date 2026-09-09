/**
 * mathComputeRouter — Unified math computation orchestration layer.
 *
 * Priority: SymPy worker → Rust builtin → unavailable.
 * No silent fallbacks — every path produces a deterministic engine + confidence.
 */
import type { MathComputeInput, MathComputeOutput, MathComputeOperation, ToolResult } from "../../types/tool"
import { computeMathExpression, computeMathWithWorker } from "../tauri/commands"

/** Operations that SymPy worker supports. */
const SYMPY_OPERATIONS = new Set<MathComputeOperation>([
  "simplify",
  "differentiate",
  "integrate",
  "solve",
  "evaluate",
  "limit",
  "expand",
  "factor"
])

/** Operations that Rust builtin supports. */
const BUILTIN_OPERATIONS = new Set<MathComputeOperation>([
  "simplify",
  "differentiate",
  "integrate",
  "solve",
  "evaluate",
  "limit"
])

/** Operations with no real engine support — only LLM fallback. */
const UNSUPPORTED_OPERATIONS = new Set<MathComputeOperation>([
  "matrix",
  "series",
  "probability"
])

/** Confidence levels for each engine. */
const CONFIDENCE = {
  sympy: 0.95,
  builtin: 0.6,
  unavailable: 0
} as const

/**
 * Run math computation with automatic fallback: SymPy → builtin → unavailable.
 */
export async function runMathComputeWithFallback(
  input: MathComputeInput
): Promise<ToolResult<MathComputeOutput>> {
  const op = input.operation as MathComputeOperation

  // Fast-reject operations with no engine support
  if (UNSUPPORTED_OPERATIONS.has(op)) {
    return {
      ok: false,
      errorCode: "UNSUPPORTED_INPUT",
      error: `Operation "${op}" has no computation engine support. Use LLM-only explanation.`,
      data: makeOutput(input, "unavailable", false, [
        `Operation "${op}" is not supported by any computation engine.`
      ])
    }
  }

  // Validate input
  const validationError = validateInput(input)
  if (validationError) {
    return {
      ok: false,
      errorCode: "UNSUPPORTED_INPUT",
      error: validationError,
      data: makeOutput(input, "unavailable", false, [validationError])
    }
  }

  // Try SymPy worker first (if operation is supported)
  if (SYMPY_OPERATIONS.has(op)) {
    // Map internal operation names to Python-side names
    const OP_NAME_MAP: Record<string, string> = {
      differentiate: "diff",
      evaluate: "eval"
    }
    const pythonOp = OP_NAME_MAP[op] ?? op

    try {
      const workerResult = await computeMathWithWorker(
        input.expression,
        pythonOp,
        input.variable ?? "x"
      )

      if (workerResult.ok && workerResult.result) {
        return {
          ok: true,
          data: {
            result: workerResult.result,
            latex: workerResult.latex,
            normalizedExpression: normalizeExpression(input.expression),
            operation: input.operation,
            stepsHint: workerResult.steps,
            warnings: workerResult.warnings,
            confidence: CONFIDENCE.sympy,
            engine: "sympy",
            isFallback: false
          }
        }
      }
      // Worker returned ok=false or empty result — fall through to builtin
    } catch {
      // Worker crashed / timed out — fall through to builtin
    }
  }

  // Fallback: Rust builtin (if operation is supported)
  if (BUILTIN_OPERATIONS.has(op)) {
    try {
      const builtinResult = await computeMathExpression({
        operation: input.operation as "simplify" | "limit" | "differentiate" | "integrate" | "solve" | "evaluate",
        expression: input.expression,
        variable: input.variable,
        point: input.point
      })

      return {
        ok: true,
        data: {
          result: builtinResult.result,
          latex: builtinResult.latex,
          normalizedExpression: builtinResult.normalizedExpression || normalizeExpression(input.expression),
          operation: input.operation,
          stepsHint: builtinResult.steps,
          warnings: [
            ...builtinResult.warnings,
            "Result from basic verifier — verify key steps independently."
          ],
          confidence: CONFIDENCE.builtin,
          engine: "builtin",
          isFallback: SYMPY_OPERATIONS.has(op) // was a fallback from SymPy
        }
      }
    } catch {
      // Builtin also failed
    }
  }

  // All engines failed
  return {
    ok: false,
    errorCode: "ENGINE_UNAVAILABLE",
    error: "No computation engine could handle this expression.",
    data: makeOutput(input, "unavailable", false, [
      "No computation engine could handle this expression.",
      "Use LLM-only explanation with uncertainty noted."
    ])
  }
}

/** Build a baseline MathComputeOutput for fallback/error paths. */
function makeOutput(
  input: MathComputeInput,
  engine: "sympy" | "builtin" | "unavailable",
  isFallback: boolean,
  warnings: string[]
): MathComputeOutput {
  return {
    result: "",
    normalizedExpression: normalizeExpression(input.expression),
    operation: input.operation,
    warnings,
    confidence: CONFIDENCE[engine],
    engine,
    isFallback
  }
}

function validateInput(input: MathComputeInput): string | undefined {
  if (!input.expression.trim()) {
    return "Expression is required."
  }
  if (input.expression.length > 2000) {
    return "Expression is too long."
  }
  if (/[;{}]|\b(?:import|exec|eval|open|subprocess|os\.|sys\.)\b/i.test(input.expression)) {
    return "Expression contains unsupported code-like tokens."
  }
  if (["limit", "differentiate", "integrate"].includes(input.operation) && !input.variable?.trim()) {
    return `Variable is required for ${input.operation}.`
  }
  return undefined
}

function normalizeExpression(expression: string): string {
  return expression.replace(/\s+/g, " ").trim()
}
