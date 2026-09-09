export type CacheScope = "llm" | "knowledge_search" | "rag" | "rendering" | "tool"

export interface CacheKeyInput {
  scope: CacheScope
  version: string
  parts: Record<string, unknown>
}

export interface CacheEntry<TValue> {
  key: string
  value: TValue
  createdAt: number
  expiresAt: number
}

export interface CacheStats {
  hits: number
  misses: number
  writes: number
  evictions: number
  deletes: number
}

export interface CacheStore<TValue = unknown> {
  get(key: string): TValue | undefined
  set(key: string, value: TValue, ttlMs: number): void
  delete(key: string): void
  clear(): void
  stats(): CacheStats
}
