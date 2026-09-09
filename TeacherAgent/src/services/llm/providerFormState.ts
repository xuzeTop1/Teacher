export interface ProviderFormStateInput {
  providerName: string
  baseUrl: string
  model: string
  apiKey?: string
  apiKeyRef?: string
  isLocal?: boolean
}

export const MIMO_MODEL_PRESETS = [
  { value: "mimo-v2.5-pro", label: "mimo-v2.5-pro（推荐文本/推理）" },
  { value: "mimo-v2.5", label: "mimo-v2.5（多模态基础模型）" }
] as const

export const KIMI_MODEL_PRESETS = [
  { value: "kimi-k2.6", label: "kimi-k2.6（推荐，多模态与推理）" },
  { value: "kimi-k2.5", label: "kimi-k2.5（稳定版）" }
] as const

export interface ProviderModelPreset {
  value: string
  label: string
}

export function isMimoProviderInput(input: Pick<ProviderFormStateInput, "providerName" | "baseUrl" | "model">): boolean {
  const identity = `${input.providerName} ${input.baseUrl} ${input.model}`.toLowerCase()
  return identity.includes("xiaomimimo.com") || identity.includes("mimo")
}

export function isKimiProviderInput(input: Pick<ProviderFormStateInput, "providerName" | "baseUrl" | "model">): boolean {
  const identity = `${input.providerName} ${input.baseUrl} ${input.model}`.toLowerCase()
  return identity.includes("api.moonshot.cn")
    || identity.includes("moonshot")
    || identity.includes("kimi")
}

export function normalizeProviderModel(
  input: Pick<ProviderFormStateInput, "providerName" | "baseUrl" | "model">
): string {
  const model = input.model.trim()
  if (!isMimoProviderInput(input)) return model

  const normalized = model.toLowerCase()
  const aliases: Record<string, string> = {
    mimo: "mimo-v2.5-pro",
    "2.5": "mimo-v2.5",
    "v2.5": "mimo-v2.5",
    "2.5pro": "mimo-v2.5-pro",
    "2.5-pro": "mimo-v2.5-pro",
    "v2.5pro": "mimo-v2.5-pro",
    "v2.5-pro": "mimo-v2.5-pro"
  }
  if (aliases[normalized]) return aliases[normalized]

  const displayLabelMatch = normalized.match(/^(mimo-v2\.5(?:-pro)?)(?:\s*[（(])/)
  return displayLabelMatch?.[1] ?? normalized
}

export function getProviderModelPresets(
  input: Pick<ProviderFormStateInput, "providerName" | "baseUrl" | "model">
): readonly ProviderModelPreset[] {
  if (isMimoProviderInput(input)) return MIMO_MODEL_PRESETS
  if (isKimiProviderInput(input)) return KIMI_MODEL_PRESETS
  return []
}

export function getProviderModelValidationMessage(
  input: Pick<ProviderFormStateInput, "providerName" | "baseUrl" | "model">
): string {
  const model = normalizeProviderModel(input)
  if (!model) return ""

  const providerAlias = input.providerName.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const modelAlias = model.toLowerCase().replace(/[^a-z0-9]+/g, "")
  if (providerAlias && providerAlias === modelAlias) {
    return `“${input.model.trim()}”只是厂商名，请填写该厂商完整的 API 模型 ID。`
  }

  return ""
}

export function hasProviderBasics(input: ProviderFormStateInput): boolean {
  return Boolean(
    input.providerName.trim()
      && input.baseUrl.trim()
      && normalizeProviderModel(input)
      && !getProviderModelValidationMessage(input)
  )
}

export function canSaveProviderConfig(input: ProviderFormStateInput): boolean {
  return Boolean(hasProviderBasics(input) && (input.isLocal || input.apiKey?.trim() || input.apiKeyRef))
}

export function canTestProviderConnection(input: ProviderFormStateInput): boolean {
  return Boolean(hasProviderBasics(input) && (input.isLocal || input.apiKey?.trim() || input.apiKeyRef))
}
