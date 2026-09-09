import { beforeEach, describe, expect, it, vi } from "vitest"

import { createOpenAICompatibleProvider } from "./openAiCompatibleProvider"
import { testProviderConnectionFromForm } from "./providerDiagnostics"
import { deleteProviderApiKey, saveProviderApiKey } from "../tauri/commands"

vi.mock("./openAiCompatibleProvider", () => ({
  createOpenAICompatibleProvider: vi.fn()
}))

vi.mock("../tauri/commands", () => ({
  saveProviderApiKey: vi.fn(),
  deleteProviderApiKey: vi.fn()
}))

const remoteConfig = {
  providerName: "MiMo",
  baseUrl: "https://api.xiaomimimo.com/v1",
  model: "mimo-v2.5-pro",
  isLocal: false
}

describe("provider diagnostics form flow", () => {
  const complete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    complete.mockResolvedValue({
      content: "OK",
      providerName: "MiMo",
      model: "mimo-v2.5-pro"
    })
    vi.mocked(createOpenAICompatibleProvider).mockReturnValue({ complete } as never)
    vi.mocked(saveProviderApiKey).mockResolvedValue({
      apiKeyRef: "keychain:teacher-agent:provider-api-key:provider-test"
    })
    vi.mocked(deleteProviderApiKey).mockResolvedValue(true)
  })

  it("tests a newly typed remote key through a temporary keychain reference", async () => {
    const result = await testProviderConnectionFromForm(remoteConfig, "  sk-new-key  ")

    expect(result.ok).toBe(true)
    expect(saveProviderApiKey).toHaveBeenCalledWith(
      expect.stringMatching(/^provider-test-/),
      "sk-new-key",
      "https://api.xiaomimimo.com/v1"
    )
    expect(createOpenAICompatibleProvider).toHaveBeenCalledWith({
      ...remoteConfig,
      apiKeyRef: "keychain:teacher-agent:provider-api-key:provider-test"
    })
    expect(deleteProviderApiKey).toHaveBeenCalledWith(
      "keychain:teacher-agent:provider-api-key:provider-test"
    )
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      temperature: 1,
      maxTokens: 1024
    }))
  })

  it("removes the temporary key even when the provider request fails", async () => {
    complete.mockRejectedValue(new Error("network failed"))

    const result = await testProviderConnectionFromForm(remoteConfig, "sk-new-key")

    expect(result.ok).toBe(false)
    expect(deleteProviderApiKey).toHaveBeenCalledWith(
      "keychain:teacher-agent:provider-api-key:provider-test"
    )
  })

  it("uses an existing key reference without creating a temporary credential", async () => {
    const config = {
      ...remoteConfig,
      apiKeyRef: "keychain:teacher-agent:provider-api-key:saved-provider"
    }

    const result = await testProviderConnectionFromForm(config)

    expect(result.ok).toBe(true)
    expect(saveProviderApiKey).not.toHaveBeenCalled()
    expect(deleteProviderApiKey).not.toHaveBeenCalled()
    expect(createOpenAICompatibleProvider).toHaveBeenCalledWith(config)
  })

  it("tests local providers without keychain access", async () => {
    const config = {
      ...remoteConfig,
      baseUrl: "http://localhost:11434/v1",
      isLocal: true
    }

    const result = await testProviderConnectionFromForm(config)

    expect(result.ok).toBe(true)
    expect(saveProviderApiKey).not.toHaveBeenCalled()
    expect(deleteProviderApiKey).not.toHaveBeenCalled()
  })

  it("gives Kimi K2.6 enough room for a stable health-check response", async () => {
    const config = {
      providerName: "Kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2.6",
      apiKeyRef: "keychain:teacher-agent:provider-api-key:kimi",
      isLocal: false
    }
    complete.mockResolvedValue({
      content: "OK",
      providerName: "Kimi",
      model: "kimi-k2.6"
    })

    const result = await testProviderConnectionFromForm(config)

    expect(result.ok).toBe(true)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      temperature: 0,
      maxTokens: 32768
    }))
  })

  it("gives generic providers a non-truncating max_tokens for the health-check", async () => {
    const config = {
      providerName: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKeyRef: "keychain:teacher-agent:provider-api-key:deepseek",
      isLocal: false
    }
    complete.mockResolvedValue({
      content: "OK",
      providerName: "DeepSeek",
      model: "deepseek-chat"
    })

    const result = await testProviderConnectionFromForm(config)

    expect(result.ok).toBe(true)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      temperature: 0,
      maxTokens: 256
    }))
  })
})
