import { beforeEach, describe, it, expect, vi } from "vitest"
import { createCodeRunnerToolContext, runCodeRunner } from "./codeRunner"
import type { CodeRunnerInput, CodeRunnerOutput, ToolResult } from "../../types/tool"

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}))

beforeEach(() => {
  invokeMock.mockReset()
})

describe("runCodeRunner", () => {
  it("keeps runtime errors as successful tool results with stderr for teaching feedback", async () => {
    invokeMock.mockResolvedValue({
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: 'Traceback (most recent call last):\n  File "<student>", line 2, in <module>\nNameError: name \'x\' is not defined',
      testResults: [],
      runtimeMs: 8,
      error: null,
      warnings: [],
    })

    const result = await runCodeRunner({
      code: "print(x)",
      language: "python",
      timeoutMs: 5000,
    })

    expect(result.ok).toBe(true)
    expect(result.data?.exitCode).toBe(1)
    expect(result.data?.stderr).toContain("NameError")
  })

  it("keeps timeouts as tool errors", async () => {
    invokeMock.mockResolvedValue({
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: "",
      testResults: [],
      runtimeMs: 2000,
      error: "Code execution timed out",
      warnings: [],
    })

    const result = await runCodeRunner({
      code: "while True: pass",
      language: "python",
      timeoutMs: 2000,
    })

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("TIMEOUT")
  })
})

describe("createCodeRunnerToolContext", () => {
  const baseInput: CodeRunnerInput = {
    code: "print(1+1)",
    language: "python",
    timeoutMs: 5000,
  }

  it("returns timeout-specific teaching guidance", () => {
    const result: ToolResult<CodeRunnerOutput> = {
      ok: false,
      error: "Code execution timed out",
      errorCode: "TIMEOUT",
    }
    const ctx = createCodeRunnerToolContext(baseInput, result)
    expect(ctx).toContain("TIMEOUT")
    expect(ctx).toContain("infinite loop")
    expect(ctx).toContain("teaching_guidance")
    expect(ctx).toContain("loop variable")
  })

  it("returns engine unavailable guidance", () => {
    const result: ToolResult<CodeRunnerOutput> = {
      ok: false,
      error: "Python not found",
      errorCode: "ENGINE_UNAVAILABLE",
    }
    const ctx = createCodeRunnerToolContext(baseInput, result)
    expect(ctx).toContain("ENGINE_UNAVAILABLE")
    expect(ctx).toContain("teaching_guidance")
  })

  it("returns success context with stdout", () => {
    const result: ToolResult<CodeRunnerOutput> = {
      ok: true,
      data: { exitCode: 0, stdout: "2\n", stderr: "", runtimeMs: 42 },
    }
    const ctx = createCodeRunnerToolContext(baseInput, result)
    expect(ctx).toContain("completed")
    expect(ctx).toContain("stdout: 2")
    expect(ctx).toContain("runtime_ms: 42")
    expect(ctx).toContain("teaching_guidance")
  })

  it("reports test failures with structured mismatch and teaching guidance", () => {
    const result: ToolResult<CodeRunnerOutput> = {
      ok: true,
      data: {
        exitCode: 0,
        stdout: "3\n",
        stderr: "",
        runtimeMs: 10,
        testResults: [
          { name: "test_add", passed: false, actualOutput: "3", expectedOutput: "2" },
        ],
      },
    }
    const ctx = createCodeRunnerToolContext(baseInput, result)
    expect(ctx).toContain("FAIL test_add")
    expect(ctx).toContain('expected="2"')
    expect(ctx).toContain('actual="3"')
    expect(ctx).toContain("teaching_guidance")
    expect(ctx).toContain("What value does your code actually produce")
  })

  it("confirms all tests passed with next-step guidance", () => {
    const result: ToolResult<CodeRunnerOutput> = {
      ok: true,
      data: {
        exitCode: 0,
        stdout: "2\n",
        stderr: "",
        runtimeMs: 10,
        testResults: [
          { name: "test_add", passed: true, actualOutput: "2", expectedOutput: "2" },
        ],
      },
    }
    const ctx = createCodeRunnerToolContext(baseInput, result)
    expect(ctx).toContain("1/1 passed")
    expect(ctx).toContain("teaching_guidance")
    expect(ctx).toContain("boundary case")
  })

  it("extracts error type and line number from stderr", () => {
    const result: ToolResult<CodeRunnerOutput> = {
      ok: true,
      data: {
        exitCode: 1,
        stdout: "",
        stderr: 'Traceback (most recent call last):\n  File "<student>", line 3, in <module>\nNameError: name \'x\' is not defined',
        runtimeMs: 5,
      },
    }
    const ctx = createCodeRunnerToolContext(baseInput, result)
    expect(ctx).toContain("error_type: NameError")
    expect(ctx).toContain("error_line: 3")
    expect(ctx).toContain("error_hint")
    expect(ctx).toContain("teaching_guidance")
    expect(ctx).toContain("NameError")
  })

  it("provides ZeroDivisionError-specific hint", () => {
    const result: ToolResult<CodeRunnerOutput> = {
      ok: true,
      data: {
        exitCode: 1,
        stdout: "",
        stderr: "ZeroDivisionError: division by zero",
        runtimeMs: 5,
      },
    }
    const ctx = createCodeRunnerToolContext(baseInput, result)
    expect(ctx).toContain("error_type: ZeroDivisionError")
    expect(ctx).toContain("分母")
  })

  it("provides IndexError-specific hint", () => {
    const result: ToolResult<CodeRunnerOutput> = {
      ok: true,
      data: {
        exitCode: 1,
        stdout: "",
        stderr: "IndexError: list index out of range",
        runtimeMs: 5,
      },
    }
    const ctx = createCodeRunnerToolContext(baseInput, result)
    expect(ctx).toContain("error_type: IndexError")
    expect(ctx).toContain("索引")
  })
})
