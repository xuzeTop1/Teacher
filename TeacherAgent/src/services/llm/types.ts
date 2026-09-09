export type LlmRole = "system" | "user" | "assistant" | "tool"

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

export type LlmMessageContent = string | LlmContentPart[]

export interface LlmMessage {
  role: LlmRole
  content: LlmMessageContent
}

export interface LlmProviderConfig {
  providerName: string
  baseUrl: string
  model: string
  apiKeyRef?: string
  isLocal?: boolean
  textModel?: string
  visionModel?: string
  capabilities?: {
    text?: boolean
    vision?: boolean
  }
}

export interface LlmCompletionRequest {
  messages: LlmMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface LlmCompletionResult {
  content: string
  model: string
  providerName: string
  cache?: {
    source: "hit" | "miss"
    key: string
  }
}

export interface LlmStreamChunk {
  content: string
  done: boolean
}

export interface LlmProvider {
  readonly providerName: string
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>
  stream?(request: LlmCompletionRequest): AsyncIterable<LlmStreamChunk>
}

export type LlmProviderErrorCode =
  | "invalid_config"
  | "invalid_request"
  | "auth_missing"
  | "auth_failed"
  | "keychain_error"
  | "network_error"
  | "timeout"
  | "rate_limited"
  | "model_or_endpoint_not_found"
  | "provider_rejected_request"
  | "provider_unavailable"
  | "invalid_response"
  | "http_status"
  | "unknown"

export interface LlmProviderErrorDetails {
  code?: LlmProviderErrorCode | string
  message?: string
  providerName?: string
  status?: number
  retryable?: boolean
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly providerName: string,
    readonly status?: number,
    readonly details?: unknown,
    readonly code: LlmProviderErrorCode | string = "unknown",
    readonly retryable = false
  ) {
    super(message)
    this.name = "LlmProviderError"
  }
}
