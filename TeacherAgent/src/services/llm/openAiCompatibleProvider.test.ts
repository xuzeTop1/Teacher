import { beforeEach, describe, expect, it, vi } from "vitest"

import { completeLlmChat } from "../tauri/commands"
import { createOpenAICompatibleProvider } from "./openAiCompatibleProvider"

vi.mock("../tauri/commands", () => ({
  completeLlmChat: vi.fn()
}))

const completeLlmChatMock = vi.mocked(completeLlmChat)

describe("OpenAICompatibleProvider", () => {
  beforeEach(() => {
    completeLlmChatMock.mockReset()
    vi.restoreAllMocks()
  })

  it("delegates apiKeyRef requests to the Rust command instead of browser fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    completeLlmChatMock.mockResolvedValue({
      content: "OK",
      model: "secure-model",
      providerName: "Secure Provider"
    })

    const config = {
      providerName: "Secure Provider",
      baseUrl: "https://provider.example/v1",
      model: "secure-model",
      apiKeyRef: "teacher-agent-provider-default"
    }
    const provider = createOpenAICompatibleProvider(config)

    const result = await provider.complete({
      messages: [{ role: "user", content: "Health check." }],
      temperature: 0,
      maxTokens: 8
    })

    expect(result.content).toBe("OK")
    expect(completeLlmChatMock).toHaveBeenCalledWith(config, {
      messages: [{ role: "user", content: "Health check." }],
      temperature: 0,
      maxTokens: 8
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects non-local providers without a keychain reference", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const provider = createOpenAICompatibleProvider({
      providerName: "Missing Auth Provider",
      baseUrl: "https://provider.example/v1",
      model: "secure-model"
    })

    await expect(
      provider.complete({
        messages: [{ role: "user", content: "Health check." }]
      })
    ).rejects.toThrow("Provider apiKeyRef is required for non-local providers")

    expect(completeLlmChatMock).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
