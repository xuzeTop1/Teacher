export interface LlmCacheUsageMetrics {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cachedPromptTokens?: number
  promptCacheHitTokens?: number
  promptCacheMissTokens?: number
  cacheHitRatio?: number
  estimatedCostSaved?: number
  providerFamily: "openai" | "deepseek" | "claude" | "unknown"
}

export interface LlmCachePricingPreset {
  inputCostPer1M: number
  cachedInputCostPer1M: number
}

export const LLM_CACHE_PRICING_PRESETS: Record<string, LlmCachePricingPreset> = {
  "deepseek-chat": { inputCostPer1M: 1.0, cachedInputCostPer1M: 0.1 },
  "gpt-4o-mini": { inputCostPer1M: 0.15, cachedInputCostPer1M: 0.075 },
  "gpt-4o": { inputCostPer1M: 2.5, cachedInputCostPer1M: 1.25 },
  "claude-sonnet-4-20250514": { inputCostPer1M: 3.0, cachedInputCostPer1M: 0.3 }
}

export function extractLlmCacheUsageMetrics(raw: unknown, model?: string): LlmCacheUsageMetrics {
  const usage = getUsageObject(raw)

  if (!usage) {
    return { providerFamily: "unknown" }
  }

  const promptTokens = readNumber(usage, "prompt_tokens")
  const completionTokens = readNumber(usage, "completion_tokens")
  const totalTokens = readNumber(usage, "total_tokens")
  const openAiCachedTokens = readNestedNumber(usage, ["prompt_tokens_details", "cached_tokens"])
  const deepSeekHitTokens = readNumber(usage, "prompt_cache_hit_tokens")
  const deepSeekMissTokens = readNumber(usage, "prompt_cache_miss_tokens")
  const claudeCachedTokens = readNumber(usage, "cache_read_input_tokens")

  if (deepSeekHitTokens !== undefined || deepSeekMissTokens !== undefined) {
    const hitTokens = deepSeekHitTokens ?? 0
    const missTokens = deepSeekMissTokens ?? 0

    return {
      promptTokens,
      completionTokens,
      totalTokens,
      promptCacheHitTokens: deepSeekHitTokens,
      promptCacheMissTokens: deepSeekMissTokens,
      cachedPromptTokens: deepSeekHitTokens,
      cacheHitRatio: calculateRatio(hitTokens, hitTokens + missTokens),
      estimatedCostSaved: estimateCostSaved(deepSeekHitTokens, model),
      providerFamily: "deepseek"
    }
  }

  if (openAiCachedTokens !== undefined) {
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedPromptTokens: openAiCachedTokens,
      cacheHitRatio: calculateRatio(openAiCachedTokens, promptTokens),
      estimatedCostSaved: estimateCostSaved(openAiCachedTokens, model),
      providerFamily: "openai"
    }
  }

  if (claudeCachedTokens !== undefined) {
    const inputTokens = promptTokens ?? readNumber(usage, "input_tokens")
    const outputTokens = completionTokens ?? readNumber(usage, "output_tokens")

    return {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens,
      cachedPromptTokens: claudeCachedTokens,
      cacheHitRatio: calculateRatio(claudeCachedTokens, inputTokens),
      estimatedCostSaved: estimateCostSaved(claudeCachedTokens, model),
      providerFamily: "claude"
    }
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    providerFamily: "unknown"
  }
}

function getUsageObject(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined
  }

  const value = raw as Record<string, unknown>
  const usage = value.usage

  if (!usage || typeof usage !== "object") {
    return undefined
  }

  return usage as Record<string, unknown>
}

function readNestedNumber(value: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = value

  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined
    }

    current = (current as Record<string, unknown>)[key]
  }

  return typeof current === "number" ? current : undefined
}

function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  const current = value[key]

  return typeof current === "number" ? current : undefined
}

function calculateRatio(numerator: number, denominator: number | undefined): number | undefined {
  if (!denominator || denominator <= 0) {
    return undefined
  }

  return numerator / denominator
}

function estimateCostSaved(cachedTokens: number | undefined, model: string | undefined): number | undefined {
  if (!cachedTokens || !model) {
    return undefined
  }

  const preset = LLM_CACHE_PRICING_PRESETS[model]
  if (!preset) {
    return undefined
  }

  const uncachedCost = (cachedTokens * preset.inputCostPer1M) / 1_000_000
  const cachedCost = (cachedTokens * preset.cachedInputCostPer1M) / 1_000_000

  return Math.max(0, uncachedCost - cachedCost)
}
