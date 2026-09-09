/**
 * Conversation management logic tests.
 * Tests the title generation service and conversation status flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { generateConversationTitle, isDefaultTitle } from "../../services/conversation/conversationTitleService"

// Mock the LLM provider
vi.mock("../../services/llm/openAiCompatibleProvider", () => ({
  createOpenAICompatibleProvider: vi.fn(() => ({
    providerName: "test",
    complete: vi.fn()
  }))
}))

import { createOpenAICompatibleProvider } from "../../services/llm/openAiCompatibleProvider"

const mockComplete = vi.fn()

describe("isDefaultTitle", () => {
  it("returns true for default titles", () => {
    expect(isDefaultTitle("数学默认对话")).toBe(true)
    expect(isDefaultTitle("新对话")).toBe(true)
    expect(isDefaultTitle("临时对话")).toBe(true)
  })

  it("returns false for custom titles", () => {
    expect(isDefaultTitle("导数定义练习")).toBe(false)
    expect(isDefaultTitle("夹逼定理训练")).toBe(false)
  })
})

describe("generateConversationTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createOpenAICompatibleProvider).mockReturnValue({
      providerName: "test",
      complete: mockComplete
    } as any)
  })

  it("generates title via LLM when provider is configured", async () => {
    mockComplete.mockResolvedValue({ content: "导数定义练习", model: "test", providerName: "test" })

    const title = await generateConversationTitle({
      messages: [
        { role: "student", content: "什么是导数？" },
        { role: "tutor", content: "导数描述的是函数在某一点的瞬时变化率..." }
      ],
      subjectCode: "math",
      providerConfig: { providerName: "test", baseUrl: "https://api.test.com/v1", model: "test", apiKeyRef: "ref-1" }
    })

    expect(title).toBe("导数定义练习")
    expect(mockComplete).toHaveBeenCalledOnce()
  })

  it("cleans LLM output by removing quotes and prefix", async () => {
    mockComplete.mockResolvedValue({ content: "「夹逼定理训练」", model: "test", providerName: "test" })

    const title = await generateConversationTitle({
      messages: [
        { role: "student", content: "给我一道夹逼定理练习" },
        { role: "tutor", content: "好的，我们来练习夹逼定理..." }
      ],
      subjectCode: "math",
      providerConfig: { providerName: "test", baseUrl: "https://api.test.com/v1", model: "test", apiKeyRef: "ref-1" }
    })

    expect(title).toBe("夹逼定理训练")
  })

  it("falls back to student message truncation when LLM fails", async () => {
    mockComplete.mockRejectedValue(new Error("API error"))

    const title = await generateConversationTitle({
      messages: [
        { role: "student", content: "请帮我复习线性代数中矩阵求逆的内容" },
        { role: "tutor", content: "好的，我们来复习矩阵求逆..." }
      ],
      subjectCode: "math",
      providerConfig: { providerName: "test", baseUrl: "https://api.test.com/v1", model: "test", apiKeyRef: "ref-1" }
    })

    expect(title).toBeTruthy()
    expect(title!.length).toBeLessThanOrEqual(28)
    expect(title).toContain("请帮我复习线性代数中矩阵求逆的内容".slice(0, 28))
  })

  it("falls back to student message when no provider configured", async () => {
    const title = await generateConversationTitle({
      messages: [
        { role: "student", content: "什么是极限？" },
        { role: "tutor", content: "极限描述的是..." }
      ],
      subjectCode: "math"
    })

    expect(title).toBe("什么是极限？")
  })

  it("returns null when no messages and no provider", async () => {
    const title = await generateConversationTitle({
      messages: [],
      subjectCode: "math"
    })

    expect(title).toBeNull()
  })

  it("rejects too short or too long LLM titles and falls back", async () => {
    mockComplete.mockResolvedValue({ content: "短", model: "test", providerName: "test" })

    const title = await generateConversationTitle({
      messages: [
        { role: "student", content: "什么是导数？" }
      ],
      subjectCode: "math",
      providerConfig: { providerName: "test", baseUrl: "https://api.test.com/v1", model: "test", apiKeyRef: "ref-1" }
    })

    // Should fall back because "短" is too short
    expect(title).toBeTruthy()
    expect(title).toBe("什么是导数？")
  })
})
