import { createOpenAICompatibleProvider } from "./openAiCompatibleProvider"
import { LlmProviderError, type LlmProviderConfig } from "./types"
import { deleteProviderApiKey, saveProviderApiKey } from "../tauri/commands"

export interface ProviderDiagnosticResult {
  ok: boolean
  providerName: string
  model?: string
  message: string
  latencyMs: number
}

/**
 * Test a provider from the settings form without persisting an unsaved API key.
 * The regular completion path only accepts a keychain reference, so a newly
 * typed key is stored under a unique temporary reference and removed in finally.
 */
export async function testProviderConnectionFromForm(
  config: LlmProviderConfig,
  apiKey = ""
): Promise<ProviderDiagnosticResult> {
  const trimmedApiKey = apiKey.trim()

  if (config.isLocal || !trimmedApiKey) {
    return testProviderConnection(config)
  }

  const temporaryProviderId = `provider-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const storedKey = await saveProviderApiKey(temporaryProviderId, trimmedApiKey, config.baseUrl)

  try {
    return await testProviderConnection({
      ...config,
      apiKeyRef: storedKey.apiKeyRef
    })
  } finally {
    await deleteProviderApiKey(storedKey.apiKeyRef)
  }
}

export async function testProviderConnection(config: LlmProviderConfig): Promise<ProviderDiagnosticResult> {
  const startedAt = performance.now()
  const provider = createOpenAICompatibleProvider(config)
  const isMimo = isMimoProvider(config)
  const isKimiFixedSampling = isKimiFixedSamplingProvider(config)

  try {
    const result = await provider.complete({
      messages: [
        {
          role: "system",
          content: "You are a concise health-check endpoint. Reply with exactly: OK"
        },
        {
          role: "user",
          content: "Health check."
        }
      ],
      temperature: isMimo ? 1 : 0,
      maxTokens: isMimo ? 1024 : isKimiFixedSampling ? 32768 : 256
    })

    return {
      ok: true,
      providerName: result.providerName,
      model: result.model,
      message: result.content.trim(),
      latencyMs: Math.round(performance.now() - startedAt)
    }
  } catch (error) {
    const message =
      error instanceof LlmProviderError
        ? formatProviderError(error)
        : error instanceof Error
          ? error.message
          : String(error)

    return {
      ok: false,
      providerName: config.providerName,
      message,
      latencyMs: Math.round(performance.now() - startedAt)
    }
  }
}

function isMimoProvider(config: LlmProviderConfig): boolean {
  const identity = `${config.providerName} ${config.baseUrl} ${config.model}`.toLowerCase()
  return identity.includes("xiaomimimo.com") || identity.includes("mimo")
}

function isKimiFixedSamplingProvider(config: LlmProviderConfig): boolean {
  const identity = `${config.providerName} ${config.baseUrl}`.toLowerCase()
  const model = config.model.toLowerCase()
  const isKimi = identity.includes("api.moonshot.cn")
    || identity.includes("moonshot")
    || identity.includes("kimi")
    || model.startsWith("kimi-")
  return isKimi && (model.startsWith("kimi-k2.5") || model.startsWith("kimi-k2.6"))
}

function formatProviderError(error: LlmProviderError): string {
  const parts = [error.message]

  if (error.code && error.code !== "unknown") {
    parts.push(`错误类型：${error.code}`)
  }
  if (typeof error.status === "number") {
    parts.push(`HTTP ${error.status}`)
  }
  if (error.retryable) {
    parts.push("可稍后重试")
  }

  return parts.join("；")
}
