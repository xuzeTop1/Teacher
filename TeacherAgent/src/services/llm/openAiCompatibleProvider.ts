import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  LlmProviderConfig,
  LlmProviderErrorDetails,
  LlmStreamChunk
} from "./types"
import { LlmProviderError } from "./types"
import { completeLlmChat, completeLlmChatStream } from "../tauri/commands"

export class OpenAICompatibleProvider implements LlmProvider {
  readonly providerName: string

  constructor(private readonly config: LlmProviderConfig) {
    this.providerName = config.providerName
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    assertProviderConfig(this.config)

    try {
      return await completeLlmChat(this.config, request)
    } catch (error) {
      const normalized = normalizeProviderError(error)
      throw new LlmProviderError(
        normalized.message ?? "LLM Provider request failed",
        this.providerName,
        normalized.status,
        error,
        normalized.code ?? "unknown",
        Boolean(normalized.retryable)
      )
    }
  }

  async *stream(request: LlmCompletionRequest): AsyncIterable<LlmStreamChunk> {
    assertProviderConfig(this.config)

    try {
      yield* completeLlmChatStream(this.config, request)
    } catch (error) {
      const normalized = normalizeProviderError(error)
      throw new LlmProviderError(
        normalized.message ?? "LLM stream request failed",
        this.providerName,
        normalized.status,
        error,
        normalized.code ?? "unknown",
        Boolean(normalized.retryable)
      )
    }
  }
}

export function createOpenAICompatibleProvider(config: LlmProviderConfig): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(config)
}

function assertProviderConfig(config: LlmProviderConfig): void {
  if (!config.baseUrl.trim()) {
    throw new LlmProviderError("Provider baseUrl is required", config.providerName)
  }

  if (!config.model.trim()) {
    throw new LlmProviderError("Provider model is required", config.providerName)
  }

  if (!config.isLocal && !config.apiKeyRef?.trim()) {
    throw new LlmProviderError("Provider apiKeyRef is required for non-local providers", config.providerName)
  }
}

function normalizeProviderError(error: unknown): LlmProviderErrorDetails {
  if (isProviderErrorDetails(error)) {
    return {
      code: error.code,
      message: error.message || "LLM Provider request failed",
      providerName: error.providerName,
      status: error.status,
      retryable: error.retryable
    }
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      code: "unknown",
      retryable: false
    }
  }

  return {
    message: String(error),
    code: "unknown",
    retryable: false
  }
}

function isProviderErrorDetails(value: unknown): value is LlmProviderErrorDetails {
  return typeof value === "object" && value !== null && "message" in value
}
