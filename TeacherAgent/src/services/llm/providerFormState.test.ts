import { describe, expect, it } from "vitest"

import {
  canSaveProviderConfig,
  canTestProviderConnection,
  getProviderModelPresets,
  getProviderModelValidationMessage,
  hasProviderBasics,
  isKimiProviderInput,
  isMimoProviderInput,
  normalizeProviderModel
} from "./providerFormState"

const providerBasics = {
  providerName: "Custom Provider",
  baseUrl: "https://provider.example/v1",
  model: "teacher-model"
}

describe("provider form state", () => {
  it("requires provider name, base URL, and model as basic configuration", () => {
    expect(hasProviderBasics(providerBasics)).toBe(true)
    expect(hasProviderBasics({ ...providerBasics, baseUrl: " " })).toBe(false)
    expect(hasProviderBasics({ ...providerBasics, model: "" })).toBe(false)
  })

  it("allows saving a remote provider with a newly typed key or an existing key reference", () => {
    expect(canSaveProviderConfig({ ...providerBasics, apiKey: "sk-runtime" })).toBe(true)
    expect(canSaveProviderConfig({ ...providerBasics, apiKeyRef: "teacher-agent-provider-default" })).toBe(true)
    expect(canSaveProviderConfig(providerBasics)).toBe(false)
  })

  it("allows testing remote providers with a newly typed key or a keychain reference", () => {
    expect(canTestProviderConnection({ ...providerBasics, apiKeyRef: "teacher-agent-provider-default" })).toBe(true)
    expect(canTestProviderConnection({ ...providerBasics, apiKey: "sk-unsaved" })).toBe(true)
    expect(canTestProviderConnection({ ...providerBasics, apiKey: "   " })).toBe(false)
    expect(canTestProviderConnection(providerBasics)).toBe(false)
  })

  it("allows local providers without any key material", () => {
    expect(canSaveProviderConfig({ ...providerBasics, isLocal: true })).toBe(true)
    expect(canTestProviderConnection({ ...providerBasics, isLocal: true })).toBe(true)
  })

  it("normalizes common MiMo aliases and display labels to API model IDs", () => {
    const mimoBasics = {
      providerName: "MiMo",
      baseUrl: "https://api.xiaomimimo.com/v1"
    }

    expect(normalizeProviderModel({ ...mimoBasics, model: "mimo" })).toBe("mimo-v2.5-pro")
    expect(normalizeProviderModel({ ...mimoBasics, model: "v2.5" })).toBe("mimo-v2.5")
    expect(normalizeProviderModel({ ...mimoBasics, model: "v2.5Pro" })).toBe("mimo-v2.5-pro")
    expect(normalizeProviderModel({ ...mimoBasics, model: "MiMo-V2.5-Pro" })).toBe("mimo-v2.5-pro")
    expect(normalizeProviderModel({ ...mimoBasics, model: "mimo-v2.5-pro（多模态）" })).toBe("mimo-v2.5-pro")
    expect(normalizeProviderModel({ ...mimoBasics, model: "mimo-v2.5 (多模态)" })).toBe("mimo-v2.5")
  })

  it("does not rewrite model IDs for unrelated providers", () => {
    expect(normalizeProviderModel(providerBasics)).toBe("teacher-model")
    expect(isMimoProviderInput(providerBasics)).toBe(false)
    expect(isMimoProviderInput({ ...providerBasics, providerName: "MiMo" })).toBe(true)
  })

  it("rejects a bare vendor name as the model for every provider", () => {
    const deepSeek = {
      providerName: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek"
    }

    expect(getProviderModelValidationMessage(deepSeek)).toContain("完整的 API 模型 ID")
    expect(canSaveProviderConfig({ ...deepSeek, apiKey: "sk-runtime" })).toBe(false)
    expect(canTestProviderConnection({ ...deepSeek, apiKey: "sk-runtime" })).toBe(false)
  })

  it("exposes model presets through an extensible provider profile lookup", () => {
    expect(getProviderModelPresets({ ...providerBasics, providerName: "MiMo" })).toHaveLength(2)
    expect(getProviderModelPresets({
      providerName: "Kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2.6"
    })).toEqual([
      { value: "kimi-k2.6", label: "kimi-k2.6（推荐，多模态与推理）" },
      { value: "kimi-k2.5", label: "kimi-k2.5（稳定版）" }
    ])
    expect(getProviderModelPresets(providerBasics)).toEqual([])
  })

  it("detects Kimi through the official endpoint, provider name, or model ID", () => {
    expect(isKimiProviderInput({
      providerName: "Custom",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2.6"
    })).toBe(true)
    expect(isKimiProviderInput({ ...providerBasics, providerName: "Moonshot" })).toBe(true)
    expect(isKimiProviderInput({ ...providerBasics, model: "kimi-k2.6" })).toBe(true)
    expect(isKimiProviderInput(providerBasics)).toBe(false)
  })
})
