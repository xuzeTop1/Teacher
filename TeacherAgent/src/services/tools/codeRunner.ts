import { invoke } from "@tauri-apps/api/core"
import type { CodeRunnerInput, CodeRunnerOutput, ToolResult } from "../../types/tool"

/**
 * Run Python code via the code-worker sidecar.
 * This is the single entry point for ToolAgent.
 */
export async function runCodeRunner(input: CodeRunnerInput): Promise<ToolResult<CodeRunnerOutput>> {
  try {
    const result = await invoke<{
      ok: boolean
      exitCode: number
      stdout: string
      stderr: string
      testResults: Array<{
        name: string
        passed: boolean
        actualOutput: string
        expectedOutput?: string
      }>
      runtimeMs: number
      error?: string
      warnings: string[]
    }>("run_code", {
      code: input.code,
      stdin: input.stdin ?? "",
      testCases: input.testCases ?? [],
      timeoutMs: input.timeoutMs,
    })

    if (!result.ok && result.exitCode === -1) {
      return {
        ok: false,
        error: result.error ?? "Code execution failed",
        errorCode: "TIMEOUT",
      }
    }

    return {
      ok: true,
      data: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        testResults: result.testResults,
        runtimeMs: result.runtimeMs,
      },
    }
  } catch (e) {
    const msg = String(e)
    if (msg.includes("超时") || msg.includes("timeout")) {
      return { ok: false, error: msg, errorCode: "TIMEOUT" }
    }
    if (msg.includes("未找到") || msg.includes("无法启动")) {
      return { ok: false, error: msg, errorCode: "ENGINE_UNAVAILABLE" }
    }
    if (msg.includes("未启用安全隔离") || msg.includes("不受信代码")) {
      return { ok: false, error: msg, errorCode: "PRIVACY_BLOCKED" }
    }
    return { ok: false, error: msg, errorCode: "EXECUTION_ERROR" }
  }
}

/**
 * Extract structured error info from stderr for pedagogical use.
 */
function analyzeStderr(stderr: string): {
  errorType: string
  errorLine: string | null
  errorHint: string
} {
  const trimmed = stderr.trim()
  if (!trimmed) return { errorType: "", errorLine: null, errorHint: "" }

  // Extract error type: "NameError:", "TypeError:", etc.
  const typeMatch = trimmed.match(/^(\w+Error(?:\w*))/m)
  const errorType = typeMatch?.[1] ?? ""

  // Extract line number: "File <student>, line 3" or "line 3,"
  const lineMatch = trimmed.match(/line (\d+)/i)
  const errorLine = lineMatch?.[1] ?? null

  // Map common errors to teaching hints
  const hints: Record<string, string> = {
    NameError: "变量名未定义——可能是拼写错误、忘记赋值、或变量在错误的作用域中。",
    TypeError: "类型不匹配——可能是字符串和数字混用、函数参数数量错误、或对不可变类型尝试修改。",
    IndexError: "索引越界——可能是列表为空、索引从 0 开始被忽略、或循环边界有 off-by-one。",
    KeyError: "字典键不存在——可能是键名拼写错误、或未检查键是否存在。",
    ValueError: "值不合法——可能是类型转换失败（如 int('abc')）、或传入了意外的值。",
    AttributeError: "属性不存在——可能是对象类型错误、或方法名拼写错误。",
    ZeroDivisionError: "除以零——需要检查分母在什么条件下为 0。",
    SyntaxError: "语法错误——检查括号匹配、冒号、缩进和逗号。",
    IndentationError: "缩进错误——Python 用缩进表示代码块，检查空格/Tab 是否一致。",
    ImportError: "导入失败——模块名拼写错误或模块未安装。",
    RecursionError: "递归溢出——递归函数缺少终止条件，或终止条件永远不满足。",
    TimeoutError: "代码执行超时——可能存在无限循环或算法复杂度过高。",
  }

  const errorHint = hints[errorType] ?? "检查报错行附近的变量类型和逻辑。"
  return { errorType, errorLine, errorHint }
}

/**
 * Build the tool context note injected into the LLM prompt.
 * Designed to give the LLM enough structured info to generate
 * Socratic teaching feedback instead of direct answers.
 */
export function createCodeRunnerToolContext(
  input: CodeRunnerInput,
  result: ToolResult<CodeRunnerOutput>
): string {
  // ── Timeout / engine failure ──
  if (!result.ok) {
    const isTimeout = result.errorCode === "TIMEOUT"
    const lines = [
      '<tool_result tool="code_runner">',
      `status: ${result.errorCode ?? "EXECUTION_ERROR"}`,
      `language: ${input.language}`,
    ]
    if (isTimeout) {
      lines.push("error: code execution timed out")
      lines.push(
        "teaching_guidance: the code likely has an infinite loop or extremely slow algorithm. Ask the student: (1) 'Can you trace through your loop — what condition makes it stop?' (2) 'What happens to your loop variable each iteration — does it actually change?' Do not suggest the fix directly."
      )
    } else {
      lines.push(`message: ${result.error ?? "unknown error"}`)
      lines.push(
        "teaching_guidance: the code could not be executed. Ask the student to simplify to the smallest possible snippet that reproduces the issue."
      )
    }
    lines.push("</tool_result>")
    return lines.join("\n")
  }

  const data = result.data!
  const hasTests = data.testResults && data.testResults.length > 0
  const allTestsPassed = hasTests && data.testResults!.every((t) => t.passed)
  const someTestsFailed = hasTests && !allTestsPassed
  const hasRuntimeError = data.exitCode !== 0

  const lines = [
    '<tool_result tool="code_runner">',
    `status: ${hasRuntimeError ? "runtime_error" : "completed"}`,
    `language: ${input.language}`,
    `exit_code: ${data.exitCode}`,
    `runtime_ms: ${data.runtimeMs}`,
  ]

  if (data.stdout.trim()) {
    lines.push(`stdout: ${data.stdout.trim().slice(0, 2000)}`)
  }

  if (data.stderr.trim()) {
    lines.push(`stderr: ${data.stderr.trim().slice(0, 1000)}`)
    // Structured error analysis for the LLM
    const analysis = analyzeStderr(data.stderr)
    if (analysis.errorType) {
      lines.push(`error_type: ${analysis.errorType}`)
    }
    if (analysis.errorLine) {
      lines.push(`error_line: ${analysis.errorLine}`)
    }
    if (analysis.errorHint) {
      lines.push(`error_hint: ${analysis.errorHint}`)
    }
  }

  if (hasTests) {
    const passed = data.testResults!.filter((t) => t.passed).length
    const total = data.testResults!.length
    lines.push(`test_summary: ${passed}/${total} passed`)
    for (const tr of data.testResults!) {
      if (!tr.passed) {
        lines.push(`  FAIL ${tr.name}: expected="${tr.expectedOutput ?? ""}" actual="${tr.actualOutput}"`)
      }
    }
  }

  // ── Teaching guidance per scenario ──
  if (someTestsFailed) {
    const failedTests = data.testResults!.filter((t) => !t.passed)
    const firstFail = failedTests[0]
    lines.push(
      `teaching_guidance: ${failedTests.length} test(s) failed. ` +
      `First failure: expected "${firstFail?.expectedOutput ?? ""}" but got "${firstFail?.actualOutput ?? ""}". ` +
      `Socratic approach: (1) Show the mismatch. (2) Ask 'What value does your code actually produce, and why?' ` +
      `(3) If the student is stuck, ask them to add a print() before the return to inspect intermediate values. ` +
      `Do not fix the code for them.`
    )
  } else if (hasRuntimeError) {
    const analysis = analyzeStderr(data.stderr)
    lines.push(
      `teaching_guidance: runtime error (${analysis.errorType}). ` +
      `${analysis.errorHint} ` +
      `Socratic approach: (1) Show the error type and line number. ` +
      `(2) Ask 'What is the value of the variable at that line?' or 'What type did you expect here?' ` +
      `(3) Guide them to add a print() before the error line. Do not fix the code.`
    )
  } else if (allTestsPassed) {
    lines.push(
      "teaching_guidance: all tests passed. " +
      "Confirm success in 1 sentence. Then suggest a next step: (1) a boundary case to test (empty input, negative numbers, large input), " +
      "(2) a refactoring opportunity (can you make it more readable?), or (3) a harder variation. " +
      "Do not dump the full output."
    )
  } else {
    // Code ran successfully, no tests
    lines.push(
      "teaching_guidance: code ran successfully with exit code 0. " +
      "If the output matches the student's expectation, confirm briefly and suggest a next step. " +
      "If the output seems unexpected, ask the student 'Is this what you expected? What did you think it would print?' " +
      "Do not dump raw stdout."
    )
  }

  lines.push("</tool_result>")
  return lines.join("\n")
}
