import { createCacheKey } from "../cache/cacheKey"
import { MemoryCacheStore } from "../cache/memoryCacheStore"
import type { CacheStore } from "../cache/types"
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from "./types"

export interface CachedLlmProviderOptions {
  ttlMs: number
  version: string
  store?: CacheStore<LlmCompletionResult>
}

export class CachedLlmProvider implements LlmProvider {
  readonly providerName: string
  private readonly store: CacheStore<LlmCompletionResult>
  private readonly inFlight = new Map<string, Promise<LlmCompletionResult>>()

  constructor(
    private readonly inner: LlmProvider,
    private readonly options: CachedLlmProviderOptions
  ) {
    this.providerName = inner.providerName
    this.store = options.store ?? new MemoryCacheStore<LlmCompletionResult>({ maxEntries: 100 })
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const key = await createCacheKey({
      scope: "llm",
      version: this.options.version,
      parts: {
        providerName: this.providerName,
        messages: request.messages,
        temperature: request.temperature ?? 0.4,
        maxTokens: request.maxTokens
      }
    })

    const cached = this.store.get(key)
    if (cached) {
      return {
        ...cached,
        cache: {
          source: "hit",
          key
        }
      }
    }

    const existing = this.inFlight.get(key)
    if (existing) {
      return existing
    }

    const next = this.inner.complete(request).then((result) => {
      const value = {
        ...result,
        cache: {
          source: "miss" as const,
          key
        }
      }

      this.store.set(key, value, this.options.ttlMs)
      return value
    })

    this.inFlight.set(key, next)

    try {
      return await next
    } finally {
      this.inFlight.delete(key)
    }
  }
}

export function withLlmCache(inner: LlmProvider, options: CachedLlmProviderOptions): CachedLlmProvider {
  return new CachedLlmProvider(inner, options)
}
