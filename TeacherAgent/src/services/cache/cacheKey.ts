import type { CacheKeyInput } from "./types"
import { stableStringify } from "./canonicalSerializer"

export async function createCacheKey(input: CacheKeyInput): Promise<string> {
  const stable = stableStringify({
    scope: input.scope,
    version: input.version,
    parts: input.parts
  })

  return `${input.scope}:${input.version}:${await sha256(stable)}`
}

async function sha256(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(value)
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)

    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }

  return fallbackHash(value)
}

function fallbackHash(value: string): string {
  let hash = 5381

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }

  return (hash >>> 0).toString(16)
}
