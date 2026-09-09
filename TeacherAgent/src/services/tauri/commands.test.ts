import { describe, expect, it, vi, beforeEach } from "vitest"
import { isTurnAborted } from "../llm/turnAbort"

// ── Mock @tauri-apps/api/core ──────────────────────────────────────────

const { mockInvoke, FakeChannel } = vi.hoisted(() => {
  /** Fake Channel that captures onmessage so tests can push chunks manually. */
  class FakeChannelImpl<T> {
    onmessage: ((msg: T) => void) | null = null
  }
  return {
    mockInvoke: vi.fn(),
    FakeChannel: FakeChannelImpl
  }
})

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  Channel: FakeChannel
}))

import { completeLlmChat, completeLlmChatStream, loadStudentKnowledge } from "./commands"
import type { LlmCompletionRequest, LlmProviderConfig, LlmStreamChunk } from "../llm/types"

const TEST_CONFIG: LlmProviderConfig = {
  providerName: "Test",
  baseUrl: "https://test.local/v1",
  model: "test-model",
  apiKeyRef: "keychain://test"
}

function makeRequest(overrides?: Partial<LlmCompletionRequest>): LlmCompletionRequest {
  return {
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.5,
    maxTokens: 100,
    ...overrides
  }
}

/** Helper: get the FakeChannel instance passed to invoke. */
function lastChannel(): FakeChannel<LlmStreamChunk> {
  const lastCall = mockInvoke.mock.calls[mockInvoke.mock.calls.length - 1]
  return lastCall![1].channel as FakeChannel<LlmStreamChunk>
}

beforeEach(() => {
  mockInvoke.mockReset()
})

// ── completeLlmChat ─────────────────────────────────────────────────────

describe("completeLlmChat", () => {
  it("returns the invoke result on success", async () => {
    const result = { content: "hi", model: "m", providerName: "Test" }
    mockInvoke.mockResolvedValue(result)

    const out = await completeLlmChat(TEST_CONFIG, makeRequest())
    expect(out).toEqual(result)
  })

  it("rejects immediately when signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      completeLlmChat(TEST_CONFIG, makeRequest({ signal: controller.signal }))
    ).rejects.toSatisfy((e: unknown) => isTurnAborted(e))

    // invoke must not be called for a pre-aborted request
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("rejects with TurnAbortedError when signal aborts while invoke is pending", async () => {
    const controller = new AbortController()
    // invoke never resolves on its own
    mockInvoke.mockReturnValue(new Promise(() => undefined))

    const pending = completeLlmChat(TEST_CONFIG, makeRequest({ signal: controller.signal }))
    controller.abort()

    await expect(pending).rejects.toSatisfy((e: unknown) => isTurnAborted(e))
  })
})

describe("loadStudentKnowledge", () => {
  it("keeps the legacy invoke payload when no whitelist is provided", async () => {
    mockInvoke.mockResolvedValue([])

    await loadStudentKnowledge("student-1", "cs408", 20)

    expect(mockInvoke).toHaveBeenCalledWith("load_student_knowledge", {
      studentId: "student-1",
      subjectCode: "cs408",
      limit: 20
    })
  })

  it("passes the optional node whitelist, including an explicit empty list", async () => {
    mockInvoke.mockResolvedValue([])

    await loadStudentKnowledge("student-1", "cs408", 10, ["cs408-cn-ip"])
    expect(mockInvoke).toHaveBeenCalledWith("load_student_knowledge", {
      studentId: "student-1",
      subjectCode: "cs408",
      limit: 10,
      knowledgeNodeIds: ["cs408-cn-ip"]
    })

    mockInvoke.mockClear()
    await loadStudentKnowledge("student-1", "cs408", 10, [])
    expect(mockInvoke).toHaveBeenCalledWith("load_student_knowledge", {
      studentId: "student-1",
      subjectCode: "cs408",
      limit: 10,
      knowledgeNodeIds: []
    })
  })
})

// ── completeLlmChatStream ───────────────────────────────────────────────

describe("completeLlmChatStream", () => {
  it("yields chunks in order and completes on done chunk", async () => {
    mockInvoke.mockImplementation(() => {
      const ch = lastChannel()
      // Push chunks asynchronously after invoke is called
      queueMicrotask(() => {
        ch.onmessage?.({ content: "Hello", done: false })
        ch.onmessage?.({ content: " world", done: false })
        ch.onmessage?.({ content: "", done: true })
      })
      return Promise.resolve()
    })

    const chunks: LlmStreamChunk[] = []
    for await (const chunk of completeLlmChatStream(TEST_CONFIG, makeRequest())) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { content: "Hello", done: false },
      { content: " world", done: false }
    ])
  })

  it("propagates invoke rejection as a stream error", async () => {
    mockInvoke.mockRejectedValue(new Error("network failure"))

    const gen = completeLlmChatStream(TEST_CONFIG, makeRequest())
    await expect(gen.next()).rejects.toThrow("network failure")
  })

  it("rejects immediately when signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    const gen = completeLlmChatStream(TEST_CONFIG, makeRequest({ signal: controller.signal }))
    await expect(gen.next()).rejects.toSatisfy((e: unknown) => isTurnAborted(e))
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("rejects with TurnAbortedError when signal aborts mid-stream", async () => {
    const controller = new AbortController()

    mockInvoke.mockImplementation(() => {
      const ch = lastChannel()
      // Push first chunk synchronously so it is buffered before the consumer parks.
      ch.onmessage?.({ content: "partial", done: false })
      // Resolve when aborted so invokePromise settles cleanly (no dangling promise).
      return new Promise<void>((resolve) => {
        controller.signal.addEventListener("abort", () => resolve(), { once: true })
      })
    })

    const gen = completeLlmChatStream(TEST_CONFIG, makeRequest({ signal: controller.signal }))

    // First chunk is already buffered — consumed before abort.
    const first = await gen.next()
    expect(first.value).toEqual({ content: "partial", done: false })

    // Flush the microtask that removes raceAbort's onAbort listener, so the
    // abort does not reject the already-resolved raceAbort promise (which
    // nobody is awaiting while the generator is suspended at yield).
    await Promise.resolve()

    // Abort while the generator is parked waiting for the next chunk.
    controller.abort()

    // Next call must reject with TurnAbortedError.
    await expect(gen.next()).rejects.toSatisfy((e: unknown) => isTurnAborted(e))
  })

  it("discards late channel messages after abort", async () => {
    const controller = new AbortController()
    let capturedChannel: FakeChannel<LlmStreamChunk> | undefined

    mockInvoke.mockImplementation(() => {
      capturedChannel = lastChannel()
      // Push first chunk synchronously.
      capturedChannel!.onmessage?.({ content: "a", done: false })
      // Resolve when aborted so invokePromise settles cleanly.
      return new Promise<void>((resolve) => {
        controller.signal.addEventListener("abort", () => resolve(), { once: true })
      })
    })

    const gen = completeLlmChatStream(TEST_CONFIG, makeRequest({ signal: controller.signal }))
    const first = await gen.next()
    expect(first.value).toEqual({ content: "a", done: false })

    // Flush the microtask that removes raceAbort's onAbort listener.
    await Promise.resolve()

    // Abort; the onAbort listener detaches the channel (onmessage → no-op).
    controller.abort()

    // Late messages after abort — must be discarded by the no-op handler.
    capturedChannel!.onmessage?.({ content: "LATE", done: false })
    capturedChannel!.onmessage?.({ content: "", done: true })

    // Must reject (not yield "LATE" or complete normally).
    await expect(gen.next()).rejects.toSatisfy((e: unknown) => isTurnAborted(e))
  })

  it("invoke resolving (no done chunk) still completes the stream via queue.end()", async () => {
    mockInvoke.mockImplementation(() => {
      const ch = lastChannel()
      queueMicrotask(() => {
        ch.onmessage?.({ content: "data", done: false })
        // No done chunk; invoke resolves instead
      })
      return Promise.resolve() // invoke resolves → queue.end()
    })

    const chunks: LlmStreamChunk[] = []
    for await (const chunk of completeLlmChatStream(TEST_CONFIG, makeRequest())) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([{ content: "data", done: false }])
  })
})
