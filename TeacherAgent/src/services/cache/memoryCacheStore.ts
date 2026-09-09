import type { CacheEntry, CacheStats, CacheStore } from "./types"

export interface MemoryCacheStoreOptions {
  maxEntries?: number
}

export class MemoryCacheStore<TValue = unknown> implements CacheStore<TValue> {
  private readonly entries = new Map<string, CacheEntry<TValue>>()
  private readonly counters: CacheStats = {
    hits: 0,
    misses: 0,
    writes: 0,
    evictions: 0,
    deletes: 0
  }

  constructor(private readonly options: MemoryCacheStoreOptions = {}) {}

  get(key: string): TValue | undefined {
    const entry = this.entries.get(key)

    if (!entry) {
      this.counters.misses += 1
      return undefined
    }

    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key)
      this.counters.evictions += 1
      this.counters.misses += 1
      return undefined
    }

    this.entries.delete(key)
    this.entries.set(key, entry)
    this.counters.hits += 1

    return entry.value
  }

  set(key: string, value: TValue, ttlMs: number): void {
    const now = Date.now()
    this.entries.set(key, {
      key,
      value,
      createdAt: now,
      expiresAt: now + ttlMs
    })
    this.counters.writes += 1
    this.enforceMaxEntries()
  }

  delete(key: string): void {
    if (this.entries.delete(key)) {
      this.counters.deletes += 1
    }
  }

  clear(): void {
    this.entries.clear()
  }

  stats(): CacheStats {
    return { ...this.counters }
  }

  private enforceMaxEntries(): void {
    const maxEntries = this.options.maxEntries

    if (!maxEntries || this.entries.size <= maxEntries) {
      return
    }

    while (this.entries.size > maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined
      if (!oldestKey) return
      this.entries.delete(oldestKey)
      this.counters.evictions += 1
    }
  }
}
