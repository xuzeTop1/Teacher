// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { router } from "../router"
import type { ChatMessage } from "../types/chat"

/**
 * Pure helper for sanitizing incoming route message query parameter
 */
export function extractRouteMessage(raw: unknown): string | null {
  if (!raw) return null
  const str = Array.isArray(raw) ? raw[0] : raw
  if (typeof str !== "string") return null
  const trimmed = str.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Pure helper for stripping 'message' from query object
 */
export function stripRouteMessageQuery(query: Record<string, any>): Record<string, any> {
  const next = { ...query }
  delete next.message
  return next
}

/**
 * Helper to build missing provider message
 */
export function createMissingProviderMessage(id: string, prompt: string): ChatMessage {
  return {
    id,
    role: "tutor",
    content: "还没有可用的 LLM Provider 配置。请先到“设置”里填写 Base URL、模型和 API Key，并点击“保存本次运行配置”。",
    isError: true,
    errorType: "missing_provider",
    retryPrompt: prompt
  }
}

/**
 * Helper to build LLM error message
 */
export function createLlmErrorMessage(id: string, prompt: string, errorDetail: string): ChatMessage {
  return {
    id,
    role: "tutor",
    content: `这次调用模型失败了：${errorDetail}\n\n你可以先检查设置页的 Base URL、模型名和 API Key。`,
    isError: true,
    errorType: "llm_error",
    retryPrompt: prompt
  }
}

describe("router configuration for /chat", () => {
  it("resolves /chat to the chat route via alias", () => {
    const resolved = router.resolve("/chat")
    expect(resolved.name).toBe("chat")
    expect(resolved.matched.length).toBeGreaterThan(0)
  })

  it("resolves / to the chat route", () => {
    const resolved = router.resolve("/")
    expect(resolved.name).toBe("chat")
    expect(resolved.matched.length).toBeGreaterThan(0)
  })

  it("resolves /chat with query message", () => {
    const resolved = router.resolve({
      path: "/chat",
      query: { message: "请帮我讲解微积分中的极值点" }
    })
    expect(resolved.name).toBe("chat")
    expect(resolved.query.message).toBe("请帮我讲解微积分中的极值点")
  })

  it("wildcard redirect routes unknown paths to /", () => {
    const resolved = router.resolve("/non-existent-page-path")
    expect(resolved.matched.length).toBeGreaterThan(0)
    expect(resolved.matched[resolved.matched.length - 1].redirect).toBe("/")
  })
})

describe("extractRouteMessage", () => {
  it("extracts valid string query", () => {
    expect(extractRouteMessage("请帮我讲解极限")).toBe("请帮我讲解极限")
  })

  it("trims whitespace", () => {
    expect(extractRouteMessage("  请帮我讲解极限   ")).toBe("请帮我讲解极限")
  })

  it("handles array query parameters by picking the first element", () => {
    expect(extractRouteMessage(["第一条消息", "第二条消息"])).toBe("第一条消息")
  })

  it("returns null for empty or whitespace-only inputs", () => {
    expect(extractRouteMessage("")).toBeNull()
    expect(extractRouteMessage("   ")).toBeNull()
    expect(extractRouteMessage(null)).toBeNull()
    expect(extractRouteMessage(undefined)).toBeNull()
    expect(extractRouteMessage([])).toBeNull()
  })
})

describe("stripRouteMessageQuery", () => {
  it("removes message key from query", () => {
    const query = { message: "test", subject: "math", filter: "all" }
    const cleaned = stripRouteMessageQuery(query)
    expect(cleaned).toEqual({ subject: "math", filter: "all" })
    expect(cleaned.message).toBeUndefined()
  })

  it("does not mutate original object", () => {
    const query = { message: "test" }
    const cleaned = stripRouteMessageQuery(query)
    expect(query.message).toBe("test")
    expect(cleaned.message).toBeUndefined()
  })
})

describe("error messages with retry prompt", () => {
  it("builds missing provider message with retryPrompt and isError flag", () => {
    const msg = createMissingProviderMessage("msg-1", "请帮我讲解导数")
    expect(msg.isError).toBe(true)
    expect(msg.errorType).toBe("missing_provider")
    expect(msg.retryPrompt).toBe("请帮我讲解导数")
    expect(msg.content).toContain("还没有可用的 LLM Provider 配置")
  })

  it("builds LLM error message with retryPrompt and isError flag", () => {
    const msg = createLlmErrorMessage("msg-2", "出一道练习题", "Network error: Connection refused")
    expect(msg.isError).toBe(true)
    expect(msg.errorType).toBe("llm_error")
    expect(msg.retryPrompt).toBe("出一道练习题")
    expect(msg.content).toContain("这次调用模型失败了：Network error: Connection refused")
  })
})
