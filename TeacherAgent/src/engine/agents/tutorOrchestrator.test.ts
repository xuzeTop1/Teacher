import { describe, expect, it, vi, beforeEach } from "vitest"

import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider, LlmStreamChunk } from "../../services/llm/types"
import { TutorOrchestrator } from "./tutorOrchestrator"

// Mock toolAgent module for tool debug tests
const mockRunToolAgent = vi.fn()
vi.mock("./toolAgent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./toolAgent")>()
  return {
    ...actual,
    runToolAgent: (...args: unknown[]) => mockRunToolAgent(...args)
  }
})

// Default tool agent result for non-debug tests
const DEFAULT_TOOL_RESULT = {
  knowledgeSearch: undefined,
  questionBankSearch: undefined,
  mathCompute: undefined,
  privateDocSearch: undefined,
  knowledgeContext: undefined,
  toolContextNotes: [] as string[]
}

beforeEach(() => {
  mockRunToolAgent.mockReset()
  mockRunToolAgent.mockResolvedValue(DEFAULT_TOOL_RESULT)
})

// ── Stream test helpers ─────────────────────────────────────────────────

function makeStreamProvider(content: string, opts?: { providerName?: string; model?: string }): LlmProvider {
  const name = opts?.providerName ?? "Fake Stream Provider"
  const model = opts?.model ?? "fake-stream-model"
  return {
    providerName: name,
    async complete(): Promise<LlmCompletionResult> {
      return { content, model, providerName: name }
    },
    async *stream(): AsyncIterable<LlmStreamChunk> {
      const sentences = content.match(/[^。！？.!?\n]+[。！？.!?\n]?/g) ?? [content]
      for (const sentence of sentences) {
        yield { content: sentence, done: false }
      }
      yield { content: "", done: true }
    }
  }
}

const STREAM_PROVIDER_CONFIG = {
  providerName: "Fake Stream Provider",
  baseUrl: "https://example.test/v1",
  model: "fake-stream-model",
  apiKeyRef: "keychain://fake"
} as const

describe("TutorOrchestrator planner path", () => {
  it("returns a rule-based planning turn without requiring an LLM provider", async () => {
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => {
        throw new Error("Planner turns must not create an LLM provider.")
      }
    })

    const result = await orchestrator.handleTurn({
      userMessage: "今天我该怎么复习极限与连续？",
      recentMessages: [],
      subjectCode: "math"
    })

    expect(result.promptVersion).toBe("planner-agent-v1")
    expect(result.providerName).toBe("TeacherAgent PlannerAgent")
    expect(result.model).toBe("rules-v1")
    expect(result.guardrailReview.allowed).toBe(true)
    expect(result.socraticDecision.riskSignals).toContain("plan_learning_request")
    expect(result.plannerResult?.subjectCode).toBe("math")
    expect(result.plannerResult?.planningHorizon).toBe("today")
    expect(result.plannerResult?.nextTasks.length).toBeGreaterThan(0)
    expect(result.content).toContain("今天")
    expect(result.content).toContain("你先选第 1 项开始")
  })

  it("requires an LLM provider for ordinary non-planning tutor turns", async () => {
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => {
        throw new Error("Provider creation should not be reached without provider config.")
      }
    })

    await expect(
      orchestrator.handleTurn({
        userMessage: "什么是极限？",
        recentMessages: [],
        subjectCode: "math"
      })
    ).rejects.toThrow("还没有可用的 LLM Provider 配置")
  })

  it("returns tutor replies when assessment and learning memory persistence are unavailable", async () => {
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return {
          content: "极限可以先理解成函数值逐渐靠近某个数。你能举一个 x 越来越接近 0 的例子吗？",
          model: "fake-model",
          providerName: "Fake Provider"
        }
      }
    }
    const orchestrator = new TutorOrchestrator({
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurn({
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: {
        providerName: "Fake Provider",
        baseUrl: "https://example.test/v1",
        model: "fake-model",
        apiKeyRef: "keychain://fake"
      }
    })

    expect(result.content).toContain("极限")
    expect(result.assessmentResult?.assessmentMode).toBe("turn_assessment")
    expect(result.guardrailReview.allowed).toBe(true)
  })

  it("keeps internal question answers out of practice prompts sent to the provider", async () => {
    const calls: LlmCompletionRequest[] = []
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(request): Promise<LlmCompletionResult> {
        calls.push(request)
        return {
          content: "先给你一道夹逼定理练习。你先观察目标式里哪一部分是有界的？",
          model: "fake-model",
          providerName: "Fake Provider"
        }
      }
    }
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurn({
      userMessage: "给我一道夹逼定理练习",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: {
        providerName: "Fake Provider",
        baseUrl: "https://example.test/v1",
        model: "fake-model",
        apiKeyRef: "keychain://fake"
      }
    })

    const promptText = calls.flatMap((call) => call.messages.map((message) => message.content)).join("\n")

    expect(calls).toHaveLength(1)
    // Question bank search is now mocked; verify prompt was built correctly
    expect(promptText).toContain("夹逼定理练习")
    expect(result.guardrailReview.allowed).toBe(true)
  })

  it("allows internal question answers in review prompts while keeping the student reply clean", async () => {
    const calls: LlmCompletionRequest[] = []
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(request): Promise<LlmCompletionResult> {
        calls.push(request)
        return {
          content: "你这题可以先复盘关键判断：目标式里哪一项有界，哪一项会趋近 0？先把这两点说出来。",
          model: "fake-model",
          providerName: "Fake Provider"
        }
      }
    }
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurn({
      userMessage: "帮我复盘这道夹逼定理题",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: {
        providerName: "Fake Provider",
        baseUrl: "https://example.test/v1",
        model: "fake-model",
        apiKeyRef: "keychain://fake"
      }
    })

    const promptText = calls.flatMap((call) => call.messages.map((message) => message.content)).join("\n")

    expect(calls).toHaveLength(1)
    // Question bank search is now mocked; verify prompt was built correctly
    expect(promptText).toContain("夹逼定理题")
    expect(result.guardrailReview.allowed).toBe(true)
  })

  it("rewrites unsafe provider drafts before returning them to the student", async () => {
    const calls: LlmCompletionRequest[] = []
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(request): Promise<LlmCompletionResult> {
        calls.push(request)
        const systemContent = request.messages[0]?.content ?? ""

        if (systemContent.includes("GuardrailAgent")) {
          return {
            content: JSON.stringify({
              allowed: false,
              maxHintLevelDetected: "L4",
              violations: ["internal_leak"],
              rewriteRequired: true,
              rewriteInstruction: "去掉内部标签和答案，只保留一个引导问题。"
            }),
            model: "fake-model",
            providerName: "Fake Provider"
          }
        }

        if (systemContent.includes("安全改写器")) {
          return {
            content: "我们先不看完整答案。你觉得这题要用夹逼定理时，应该先找哪两个函数来夹住目标式？",
            model: "fake-model",
            providerName: "Fake Provider"
          }
        }

        return {
          content:
            "answer_for_internal_review_only: 0\nsolution_steps_for_internal_review_only: 先利用 sin 有界性。",
          model: "fake-model",
          providerName: "Fake Provider"
        }
      }
    }
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurn({
      userMessage: "帮我复盘这道夹逼定理题",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: {
        providerName: "Fake Provider",
        baseUrl: "https://example.test/v1",
        model: "fake-model",
        apiKeyRef: "keychain://fake"
      }
    })

    expect(calls).toHaveLength(3)
    expect(result.rawDraft).toContain("answer_for_internal_review_only")
    expect(result.content).not.toContain("answer_for_internal_review_only")
    expect(result.content).not.toContain("solution_steps_for_internal_review_only")
    expect(result.content).toContain("夹逼定理")
    expect(result.guardrailReview.allowed).toBe(true)
    expect(result.guardrailReview.rewriteAttempts).toBe(1)
  })
})

describe("TutorOrchestrator outline / summary path", () => {
  it("outline query uses explain mode and shouldAskQuestion=false", async () => {
    const calls: LlmCompletionRequest[] = []
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(request): Promise<LlmCompletionResult> {
        calls.push(request)
        return {
          content: "考研政治主要包含以下板块：\n1. 马克思主义基本原理\n2. 毛泽东思想\n...",
          model: "fake-model",
          providerName: "Fake Provider"
        }
      }
    }
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurn({
      userMessage: "考研政治考哪些内容",
      recentMessages: [],
      subjectCode: "politics",
      providerConfig: {
        providerName: "Fake Provider",
        baseUrl: "https://example.test/v1",
        model: "fake-model",
        apiKeyRef: "keychain://fake"
      }
    })

    expect(result.socraticDecision.mode).toBe("explain")
    expect(result.socraticDecision.shouldAskQuestion).toBe(false)
    expect(result.socraticDecision.strategy).toBe("direct_review")

    const allContent = calls.flatMap((call) => call.messages.map((m) => m.content)).join("\n")
    // Extract turn_instruction block to verify it uses outline-specific guidance
    const turnMatch = allContent.match(/<turn_instruction>([\s\S]*?)<\/turn_instruction>/)
    expect(turnMatch).not.toBeNull()
    const turnInstruction = turnMatch![1]
    expect(turnInstruction).toContain("先用结构化列表概括要点")
    expect(turnInstruction).not.toContain("若学生还没有尝试，优先追问一个小问题")
  })

  it("outline query across subjects: math", async () => {
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return {
          content: "考研数学大纲主要包含高等数学、线性代数和概率论三大部分。",
          model: "fake-model",
          providerName: "Fake Provider"
        }
      }
    }
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurn({
      userMessage: "考研数学大纲有哪些内容",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: {
        providerName: "Fake Provider",
        baseUrl: "https://example.test/v1",
        model: "fake-model",
        apiKeyRef: "keychain://fake"
      }
    })

    expect(result.socraticDecision.mode).toBe("explain")
    expect(result.socraticDecision.shouldAskQuestion).toBe(false)
  })

  it("concept question explains without a forced follow-up question", async () => {
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return {
          content: "极限描述函数值在自变量趋近某点时所趋近的数；关键是区分趋近过程与该点的实际函数值。",
          model: "fake-model",
          providerName: "Fake Provider"
        }
      }
    }
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurn({
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: {
        providerName: "Fake Provider",
        baseUrl: "https://example.test/v1",
        model: "fake-model",
        apiKeyRef: "keychain://fake"
      }
    })

    expect(result.socraticDecision.mode).toBe("explain")
    expect(result.socraticDecision.shouldAskQuestion).toBe(false)
  })

  it("review mode does not get outline guidance in prompt", async () => {
    const calls: LlmCompletionRequest[] = []
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(request): Promise<LlmCompletionResult> {
        calls.push(request)
        return {
          content: "我们来复盘这道题的关键步骤。",
          model: "fake-model",
          providerName: "Fake Provider"
        }
      }
    }
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurn({
      userMessage: "帮我复盘这道极限题",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: {
        providerName: "Fake Provider",
        baseUrl: "https://example.test/v1",
        model: "fake-model",
        apiKeyRef: "keychain://fake"
      }
    })

    expect(result.socraticDecision.mode).toBe("review")
    expect(result.socraticDecision.intent).toBe("review")

    const allContent = calls.flatMap((call) => call.messages.map((m) => m.content)).join("\n")
    const turnMatch = allContent.match(/<turn_instruction>([\s\S]*?)<\/turn_instruction>/)
    expect(turnMatch).not.toBeNull()
    const turnInstruction = turnMatch![1]
    expect(turnInstruction).toContain("若学生还没有尝试，优先追问一个小问题")
    expect(turnInstruction).not.toContain("先用结构化列表概括要点")
  })
})

// ── Stream mode tests ────────────────────────────────────────────────────

describe("TutorOrchestrator stream mode", () => {
  it("returns tutor replies via stream with correct content", async () => {
    const provider = makeStreamProvider("极限可以理解为函数值逐渐靠近某个数。你能举一个例子吗？")
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurnStream({
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: STREAM_PROVIDER_CONFIG
    })

    expect(result.content).toContain("极限")
    expect(result.guardrailReview.allowed).toBe(true)
    expect(result.assessmentResult?.assessmentMode).toBe("turn_assessment")
  })

  it("falls back to non-stream when provider does not support streaming", async () => {
    const calls: LlmCompletionRequest[] = []
    const provider: LlmProvider = {
      providerName: "No-Stream Provider",
      async complete(request): Promise<LlmCompletionResult> {
        calls.push(request)
        return {
          content: "极限是函数值趋近的数。",
          model: "fake-model",
          providerName: "No-Stream Provider"
        }
      }
    }
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurnStream({
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: STREAM_PROVIDER_CONFIG
    })

    expect(result.content).toContain("极限")
    expect(calls).toHaveLength(1)
  })

  it("stream and non-stream produce same prompt structure for same input", async () => {
    const streamCalls: LlmCompletionRequest[] = []
    const nonStreamCalls: LlmCompletionRequest[] = []

    const streamProvider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(request): Promise<LlmCompletionResult> {
        nonStreamCalls.push(request)
        return { content: "回答", model: "m", providerName: "Fake Provider" }
      },
      async *stream(request): AsyncIterable<LlmStreamChunk> {
        streamCalls.push(request)
        yield { content: "回答", done: false }
        yield { content: "", done: true }
      }
    }
    const nonStreamProvider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(request): Promise<LlmCompletionResult> {
        nonStreamCalls.push(request)
        return { content: "回答", model: "m", providerName: "Fake Provider" }
      }
    }

    const streamOrchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => streamProvider
    })
    const nonStreamOrchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => nonStreamProvider
    })

    const input = {
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math" as const,
      providerConfig: STREAM_PROVIDER_CONFIG
    }

    await streamOrchestrator.handleTurnStream(input)
    await nonStreamOrchestrator.handleTurn(input)

    const streamPrompt = streamCalls.flatMap((c) => c.messages.map((m) => m.content)).join("\n")
    const nonStreamPrompt = nonStreamCalls.flatMap((c) => c.messages.map((m) => m.content)).join("\n")

    expect(streamPrompt).toContain("TeacherAgent")
    expect(nonStreamPrompt).toContain("TeacherAgent")
    expect(streamPrompt).toContain("<teaching_strategy>")
    expect(nonStreamPrompt).toContain("<teaching_strategy>")
  })

  it("fires onTiming callbacks during stream execution", async () => {
    const timingSteps: string[] = []
    const provider = makeStreamProvider("极限是趋近的值。")
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    await orchestrator.handleTurnStream({
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: STREAM_PROVIDER_CONFIG,
      onTiming: (step) => timingSteps.push(step)
    })

    expect(timingSteps).toContain("start")
    expect(timingSteps).toContain("socratic")
    expect(timingSteps).toContain("prompt-build")
    expect(timingSteps).toContain("llm-start")
    expect(timingSteps).toContain("llm-complete")
    expect(timingSteps).toContain("guardrail")
    expect(timingSteps).toContain("done")
  })

  it("fires onTiming callbacks during non-stream execution", async () => {
    const timingSteps: string[] = []
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "回答", model: "m", providerName: "Fake Provider" }
      }
    }
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    await orchestrator.handleTurn({
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: STREAM_PROVIDER_CONFIG,
      onTiming: (step) => timingSteps.push(step)
    })

    expect(timingSteps).toContain("start")
    expect(timingSteps).toContain("socratic")
    expect(timingSteps).toContain("prompt-build")
    expect(timingSteps).toContain("llm-start")
    expect(timingSteps).toContain("llm-complete")
    expect(timingSteps).toContain("guardrail")
    expect(timingSteps).toContain("done")
  })

  it("stream outline query uses explain mode and shouldAskQuestion=false", async () => {
    const provider = makeStreamProvider("考研政治主要包含以下板块：\n1. 马克思主义基本原理\n2. 毛泽东思想\n...")
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurnStream({
      userMessage: "考研政治考哪些内容",
      recentMessages: [],
      subjectCode: "politics",
      providerConfig: STREAM_PROVIDER_CONFIG
    })

    expect(result.socraticDecision.mode).toBe("explain")
    expect(result.socraticDecision.shouldAskQuestion).toBe(false)
    expect(result.socraticDecision.strategy).toBe("direct_review")
  })

  it("stream guardrail violation aborts streaming and returns fallback", async () => {
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "fallback", model: "m", providerName: "Fake Provider" }
      },
      async *stream(): AsyncIterable<LlmStreamChunk> {
        yield { content: "answer_for_internal_review_only: 42。", done: false }
        yield { content: "", done: true }
      }
    }
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurnStream({
      userMessage: "这道极限题怎么做？",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: STREAM_PROVIDER_CONFIG
    })

    expect(result.guardrailReview.allowed).toBe(false)
    expect(result.guardrailReview.violations).toContain("internal_leak")
    expect(result.content).not.toContain("answer_for_internal_review_only")
  })

  it("stream guardrail catches internal_leak per-sentence and falls back", async () => {
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "fallback", model: "m", providerName: "Fake Provider" }
      },
      async *stream(): AsyncIterable<LlmStreamChunk> {
        yield { content: "answer_for_internal_review_only: 42。", done: false }
        yield { content: "", done: true }
      }
    }
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurnStream({
      userMessage: "帮我复盘这道题",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: STREAM_PROVIDER_CONFIG
    })

    expect(result.guardrailReview.allowed).toBe(false)
    expect(result.guardrailReview.violations).toContain("internal_leak")
    expect(result.content).not.toContain("answer_for_internal_review_only")
  })

  it("stream planner short-circuit returns without LLM call", async () => {
    const provider = makeStreamProvider("should not be called")
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurnStream({
      userMessage: "今天我该怎么复习极限与连续？",
      recentMessages: [],
      subjectCode: "math"
    })

    expect(result.promptVersion).toBe("planner-agent-v1")
    expect(result.providerName).toBe("TeacherAgent PlannerAgent")
    expect(result.model).toBe("rules-v1")
  })

  it("stream and non-stream produce consistent socraticDecision for same input", async () => {
    const streamProvider = makeStreamProvider("极限是趋近的值。你能举例子吗？")
    const nonStreamProvider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "极限是趋近的值。你能举例子吗？", model: "m", providerName: "Fake Provider" }
      }
    }

    const streamOrchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => streamProvider
    })
    const nonStreamOrchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => nonStreamProvider
    })

    const input = {
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math" as const,
      providerConfig: STREAM_PROVIDER_CONFIG
    }

    const streamResult = await streamOrchestrator.handleTurnStream(input)
    const nonStreamResult = await nonStreamOrchestrator.handleTurn(input)

    expect(streamResult.socraticDecision.mode).toBe(nonStreamResult.socraticDecision.mode)
    expect(streamResult.socraticDecision.strategy).toBe(nonStreamResult.socraticDecision.strategy)
    expect(streamResult.socraticDecision.intent).toBe(nonStreamResult.socraticDecision.intent)
    expect(streamResult.socraticDecision.shouldAskQuestion).toBe(nonStreamResult.socraticDecision.shouldAskQuestion)
  })
})

// ── Tool debug mode tests ──────────────────────────────────────────────

describe("TutorOrchestrator tool debug mode", () => {
  it("returns direct tool result when tool debug mode detected and math compute succeeds", async () => {
    mockRunToolAgent.mockResolvedValue({
      knowledgeSearch: undefined,
      questionBankSearch: undefined,
      mathCompute: {
        ok: true,
        data: {
          result: "x**5 + 5*x**4 + 10*x**3 + 10*x**2 + 5*x + 1",
          latex: "x^{5} + 5 x^{4} + 10 x^{3} + 10 x^{2} + 5 x + 1",
          normalizedExpression: "(x + 1)**5",
          operation: "expand",
          stepsHint: [],
          warnings: [],
          confidence: 0.95,
          engine: "sympy",
          isFallback: false
        }
      },
      privateDocSearch: undefined,
      knowledgeContext: undefined,
      toolContextNotes: []
    })

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => {
        throw new Error("Tool debug mode must not create an LLM provider.")
      }
    })

    const result = await orchestrator.handleTurn({
      userMessage: "当前是工具联调，不按教学模式回答。请调用本地 math_compute 工具计算，并直接返回结果。任务：展开 (x+1)^5",
      recentMessages: [],
      subjectCode: "math"
    })

    expect(result.promptVersion).toBe("tool-debug-v1")
    expect(result.providerName).toBe("TeacherAgent ToolDebug")
    expect(result.model).toBe("tool-direct-result")
    expect(result.content).toContain("[tool_debug]")
    expect(result.content).toContain("- engine: `sympy`")
    expect(result.content).toContain("- confidence: `0.95`")
    expect(result.content).toContain("- operation: `expand`")
    expect(result.content).toContain("- raw result: `x**5 + 5*x**4 + 10*x**3 + 10*x**2 + 5*x + 1`")
    expect(result.content).toContain("$$")
    expect(result.content).toContain("x^{5} + 5 x^{4} + 10 x^{3} + 10 x^{2} + 5 x + 1")
    expect(result.guardrailReview.allowed).toBe(true)
  })

  it("returns structured error when tool debug mode detected and math compute fails", async () => {
    mockRunToolAgent.mockResolvedValue({
      knowledgeSearch: undefined,
      questionBankSearch: undefined,
      mathCompute: {
        ok: false,
        errorCode: "ENGINE_UNAVAILABLE",
        error: "No computation engine could handle this expression.",
        data: {
          result: "",
          normalizedExpression: "(x+1)**5",
          operation: "expand",
          warnings: ["No computation engine could handle this expression."],
          confidence: 0,
          engine: "unavailable",
          isFallback: false
        }
      },
      privateDocSearch: undefined,
      knowledgeContext: undefined,
      toolContextNotes: []
    })

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => {
        throw new Error("Tool debug mode must not create an LLM provider.")
      }
    })

    const result = await orchestrator.handleTurn({
      userMessage: "当前是工具联调，展开 (x+1)^5",
      recentMessages: [],
      subjectCode: "math"
    })

    expect(result.promptVersion).toBe("tool-debug-v1")
    expect(result.content).toContain("[tool_debug]")
    expect(result.content).toContain("- status: `failed`")
    expect(result.content).toContain("- error_code: `ENGINE_UNAVAILABLE`")
    expect(result.guardrailReview.allowed).toBe(true)
  })

  it("falls through to normal LLM path when no math compute result in tool debug mode", async () => {
    mockRunToolAgent.mockResolvedValue({
      knowledgeSearch: undefined,
      questionBankSearch: undefined,
      mathCompute: undefined,
      privateDocSearch: undefined,
      knowledgeContext: undefined,
      toolContextNotes: []
    })

    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "这是正常回复", model: "m", providerName: "Fake Provider" }
      }
    }

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurn({
      userMessage: "当前是工具联调，不按教学模式回答",
      recentMessages: [],
      subjectCode: "english",
      providerConfig: STREAM_PROVIDER_CONFIG
    })

    // Should fall through to normal LLM path since no math compute result
    expect(result.promptVersion).not.toBe("tool-debug-v1")
    expect(result.content).toContain("正常回复")
  })

  it("normal student mode is not affected by tool debug detection", async () => {
    mockRunToolAgent.mockResolvedValue({
      knowledgeSearch: { ok: true, data: { results: [] } },
      questionBankSearch: undefined,
      mathCompute: undefined,
      privateDocSearch: undefined,
      knowledgeContext: undefined,
      toolContextNotes: []
    })

    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "极限是微积分的基础概念。你先想想，直接代入 x=0 会得到什么？", model: "m", providerName: "Fake Provider" }
      }
    }

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const result = await orchestrator.handleTurn({
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: STREAM_PROVIDER_CONFIG
    })

    // Should NOT be tool debug mode - went through normal LLM path
    expect(result.promptVersion).not.toBe("tool-debug-v1")
    expect(result.providerName).toBe("Fake Provider")
    // Guardrail may replace content, but it should NOT be a tool debug response
    expect(result.content).not.toContain("[tool_debug]")
    expect(result.content).not.toBe("tool-debug-v1")
  })
})

// ── Multimodal model routing tests ────────────────────────────────────

describe("TutorOrchestrator multimodal model routing", () => {
  it("uses textModel when no attachments", async () => {
    let capturedConfig: { model: string } | undefined
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "回复", model: "text-model", providerName: "Fake Provider" }
      }
    }

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: (config) => { capturedConfig = config; return provider }
    })

    await orchestrator.handleTurn({
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: { ...STREAM_PROVIDER_CONFIG, textModel: "v2.5Pro", visionModel: "v2.5" }
    })

    expect(capturedConfig?.model).toBe("v2.5Pro")
  })

  it("uses visionModel when attachments present", async () => {
    let capturedConfig: { model: string } | undefined
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "回复", model: "vision-model", providerName: "Fake Provider" }
      }
    }

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: (config) => { capturedConfig = config; return provider }
    })

    await orchestrator.handleTurn({
      userMessage: "看图",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: { ...STREAM_PROVIDER_CONFIG, textModel: "v2.5Pro", visionModel: "v2.5" },
      attachments: [{ id: "a1", type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,abc" }]
    })

    expect(capturedConfig?.model).toBe("v2.5")
  })

  it("normalizes a legacy MiMo text model alias before creating the provider", async () => {
    let capturedConfig: { model: string } | undefined
    const provider: LlmProvider = {
      providerName: "MiMo",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "回复", model: "mimo-v2.5-pro", providerName: "MiMo" }
      }
    }

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: (config) => { capturedConfig = config; return provider }
    })

    await orchestrator.handleTurn({
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: {
        ...STREAM_PROVIDER_CONFIG,
        providerName: "MiMo",
        baseUrl: "https://api.xiaomimimo.com",
        textModel: "v2.5Pro"
      }
    })

    expect(capturedConfig?.model).toBe("mimo-v2.5-pro")
  })

  it("normalizes a legacy MiMo vision model alias before an image request", async () => {
    let capturedConfig: { model: string } | undefined
    const provider: LlmProvider = {
      providerName: "MiMo",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "回复", model: "mimo-v2.5", providerName: "MiMo" }
      }
    }

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: (config) => { capturedConfig = config; return provider }
    })

    await orchestrator.handleTurn({
      userMessage: "识别图片内容",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: {
        ...STREAM_PROVIDER_CONFIG,
        providerName: "MiMo",
        baseUrl: "https://api.xiaomimimo.com",
        visionModel: "v2.5"
      },
      attachments: [{ id: "a1", type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,abc" }]
    })

    expect(capturedConfig?.model).toBe("mimo-v2.5")
  })

  it("throws when vision model not configured and attachments present", async () => {
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "回复", model: "m", providerName: "Fake Provider" }
      }
    }

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    await expect(
      orchestrator.handleTurn({
        userMessage: "看图",
        recentMessages: [],
        subjectCode: "math",
        providerConfig: { ...STREAM_PROVIDER_CONFIG },
        attachments: [{ id: "a1", type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,abc" }]
      })
    ).rejects.toThrow("视觉模型")
  })

  it("falls back to model when textModel not set", async () => {
    let capturedConfig: { model: string } | undefined
    const provider: LlmProvider = {
      providerName: "Fake Provider",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "回复", model: "m", providerName: "Fake Provider" }
      }
    }

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: (config) => { capturedConfig = config; return provider }
    })

    await orchestrator.handleTurn({
      userMessage: "什么是极限？",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: { ...STREAM_PROVIDER_CONFIG }
    })

    // No textModel set, should use model
    expect(capturedConfig?.model).toBe(STREAM_PROVIDER_CONFIG.model)
  })
})

// ── Cancellation & concurrency ─────────────────────────────────────────

describe("TutorOrchestrator cancellation", () => {
  function makeSlowProvider(content: string, model: string): LlmProvider {
    return {
      providerName: "Slow Provider",
      async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
        // Park until aborted or resolved externally
        await new Promise<void>((resolve, reject) => {
          if (req.signal?.aborted) { reject(new Error("aborted")); return }
          req.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
          setTimeout(resolve, 50)
        })
        return { content, model, providerName: "Slow Provider" }
      }
    }
  }

  it("pre-aborted signal rejects immediately without calling the provider", async () => {
    const provider = makeSlowProvider("不应出现", "m")
    const completeSpy = vi.spyOn(provider, "complete")
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const controller = new AbortController()
    controller.abort()

    await expect(
      orchestrator.handleTurn({
        userMessage: "你好",
        recentMessages: [],
        subjectCode: "math",
        providerConfig: { ...STREAM_PROVIDER_CONFIG },
        signal: controller.signal
      })
    ).rejects.toThrow()

    expect(completeSpy).not.toHaveBeenCalled()
  })

  it("cancel non-stream: rejects with abort error, no onStreamUpdate(done)", async () => {
    const controller = new AbortController()
    const provider = makeSlowProvider("不应出现", "m")
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const onStreamUpdate = vi.fn()
    const pending = orchestrator.handleTurn({
      userMessage: "你好",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: { ...STREAM_PROVIDER_CONFIG },
      signal: controller.signal,
      onStreamUpdate
    })

    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(onStreamUpdate).not.toHaveBeenCalled()
  })

  it("cancel stream: no onStreamUpdate(done) fired after abort", async () => {
    const controller = new AbortController()
    const provider = makeStreamProvider("这是一段正常的回复。", { model: "m" })
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const onStreamUpdate = vi.fn()
    // Abort before the turn starts processing
    controller.abort()

    await expect(
      orchestrator.handleTurnStream({
        userMessage: "你好",
        recentMessages: [],
        subjectCode: "math",
        providerConfig: { ...STREAM_PROVIDER_CONFIG },
        signal: controller.signal,
        onStreamUpdate
      })
    ).rejects.toThrow()

    expect(onStreamUpdate).not.toHaveBeenCalled()
  })

  it("no assessment/memory persistence after cancel", async () => {
    const { learningMemoryService } = await import("../../services/student/memoryService")
    const commands = await import("../../services/tauri/commands")
    const recordSpy = vi.spyOn(learningMemoryService, "recordTutorTurn").mockResolvedValue(undefined as never)
    const saveSpy = vi.spyOn(commands, "saveAssessmentResult").mockResolvedValue(undefined)

    const controller = new AbortController()
    const provider = makeSlowProvider("不应出现", "m")
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: true,
      createProvider: () => provider
    })

    const pending = orchestrator.handleTurn({
      userMessage: "你好",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: { ...STREAM_PROVIDER_CONFIG },
      signal: controller.signal
    })

    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(recordSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
    recordSpy.mockRestore()
    saveSpy.mockRestore()
  })
})

describe("TutorOrchestrator concurrent requests", () => {
  it("concurrent requests with different models do not cross-wire metadata", async () => {
    const capturedConfigs: Array<{ model: string }> = []
    const providerA: LlmProvider = {
      providerName: "Provider A",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "回复A", model: "model-A", providerName: "Provider A" }
      }
    }
    const providerB: LlmProvider = {
      providerName: "Provider B",
      async complete(): Promise<LlmCompletionResult> {
        return { content: "回复B", model: "model-B", providerName: "Provider B" }
      }
    }

    let callCount = 0
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: (config) => {
        capturedConfigs.push({ model: config.model })
        return callCount++ === 0 ? providerA : providerB
      }
    })

    const [resultA, resultB] = await Promise.all([
      orchestrator.handleTurn({
        userMessage: "问题A",
        recentMessages: [],
        subjectCode: "math",
        providerConfig: { ...STREAM_PROVIDER_CONFIG, model: "model-A" }
      }),
      orchestrator.handleTurn({
        userMessage: "问题B",
        recentMessages: [],
        subjectCode: "math",
        providerConfig: { ...STREAM_PROVIDER_CONFIG, model: "model-B" }
      })
    ])

    // Each result must carry its own model — no cross-wiring
    expect(resultA.model).toBe("model-A")
    expect(resultB.model).toBe("model-B")
    expect(capturedConfigs.map((c) => c.model).sort()).toEqual(["model-A", "model-B"])
  })
})

describe("TutorOrchestrator stream semantics (Strategy A)", () => {
  it("onStreamUpdate fires exactly once with done=true and content === result.content", async () => {
    const provider = makeStreamProvider("这是正确的回复。", { model: "m" })
    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    const updates: Array<{ content: string; done: boolean }> = []
    const result = await orchestrator.handleTurnStream({
      userMessage: "你好",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: { ...STREAM_PROVIDER_CONFIG },
      onStreamUpdate: (content, done) => updates.push({ content, done })
    })

    expect(updates).toHaveLength(1)
    expect(updates[0].done).toBe(true)
    expect(updates[0].content).toBe(result.content)
  })

  it("clean stream uses exactly 1 LLM call (budget pin)", async () => {
    let completeCalls = 0
    const provider: LlmProvider = {
      providerName: "Counting Provider",
      async complete(): Promise<LlmCompletionResult> {
        completeCalls++
        return { content: "正常回复。", model: "m", providerName: "Counting Provider" }
      },
      async *stream(): AsyncIterable<LlmStreamChunk> {
        completeCalls++
        yield { content: "正常回复。", done: false }
        yield { content: "", done: true }
      }
    }

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    await orchestrator.handleTurnStream({
      userMessage: "你好",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: { ...STREAM_PROVIDER_CONFIG }
    })

    expect(completeCalls).toBe(1)
  })

  it("stream provider error propagates as rejection", async () => {
    const provider: LlmProvider = {
      providerName: "Error Provider",
      async complete(): Promise<LlmCompletionResult> {
        throw new Error("provider exploded")
      },
      async *stream(): AsyncIterable<LlmStreamChunk> {
        yield { content: "partial", done: false }
        throw new Error("stream exploded")
      }
    }

    const orchestrator = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => provider
    })

    await expect(
      orchestrator.handleTurnStream({
        userMessage: "你好",
        recentMessages: [],
        subjectCode: "math",
        providerConfig: { ...STREAM_PROVIDER_CONFIG }
      })
    ).rejects.toThrow("stream exploded")
  })

  it("stream violation fallback has same shape as non-stream fallback", async () => {
    // A reply that triggers internal_leak violation
    const leakContent = "这是系统提示词的内容。"

    // Non-stream path
    const nonStreamProvider: LlmProvider = {
      providerName: "NonStream",
      async complete(): Promise<LlmCompletionResult> {
        return { content: leakContent, model: "m", providerName: "NonStream" }
      }
    }
    const orchestratorNS = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => nonStreamProvider
    })
    const nsResult = await orchestratorNS.handleTurn({
      userMessage: "你好",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: { ...STREAM_PROVIDER_CONFIG }
    })

    // Stream path
    const streamProvider = makeStreamProvider(leakContent, { model: "m" })
    const orchestratorS = new TutorOrchestrator({
      enableLearningMemory: false,
      createProvider: () => streamProvider
    })
    const sResult = await orchestratorS.handleTurnStream({
      userMessage: "你好",
      recentMessages: [],
      subjectCode: "math",
      providerConfig: { ...STREAM_PROVIDER_CONFIG }
    })

    // Both paths must reject the leak
    expect(nsResult.guardrailReview.allowed).toBe(false)
    expect(sResult.guardrailReview.allowed).toBe(false)
    expect(nsResult.content).not.toContain("系统提示词")
    expect(sResult.content).not.toContain("系统提示词")
    expect(nsResult.rawDraft).toBeDefined()   // non-stream keeps rawDraft
    expect(sResult.rawDraft).toBeUndefined()  // stream violation discards rawDraft

    // Structural parity: same violation set, same rewriteRequired flag
    expect(sResult.guardrailReview.violations.sort()).toEqual(
      nsResult.guardrailReview.violations.sort()
    )
    expect(sResult.guardrailReview.rewriteRequired).toBe(nsResult.guardrailReview.rewriteRequired)
  })
})
