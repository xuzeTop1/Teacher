import type { LlmMessage, LlmMessageContent, LlmRole } from "../../services/llm/types"

function contentNotEmpty(content: LlmMessageContent): boolean {
  if (typeof content === "string") return content.trim().length > 0
  return content.length > 0
}

export type PromptLayerKind =
  | "core_system"
  | "tool_schema"
  | "static_context"
  | "session_memory"
  | "history"
  | "runtime"

export interface PromptLayer {
  kind: PromptLayerKind
  role: LlmRole
  content: LlmMessageContent
  version?: string
  stable?: boolean
}

const PROMPT_LAYER_ORDER: PromptLayerKind[] = [
  "core_system",
  "tool_schema",
  "static_context",
  "session_memory",
  "history",
  "runtime"
]

export function buildCacheAwareMessages(layers: PromptLayer[]): LlmMessage[] {
  return [...layers]
    .filter((layer) => {
      if (typeof layer.content === "string") return layer.content.trim().length > 0
      return layer.content.length > 0
    })
    .sort((left, right) => PROMPT_LAYER_ORDER.indexOf(left.kind) - PROMPT_LAYER_ORDER.indexOf(right.kind))
    .map((layer) => ({
      role: layer.role,
      content: layer.content
    }))
}

export function buildStablePrefixMessages(layers: PromptLayer[]): LlmMessage[] {
  return sortPromptLayers(layers)
    .filter((layer) => layer.stable ?? isStablePromptLayer(layer.kind))
    .filter((layer) => contentNotEmpty(layer.content))
    .map((layer) => ({
      role: layer.role,
      content: layer.content
    }))
}

export function createPromptLayerCacheParts(layers: PromptLayer[]): Record<string, unknown> {
  return {
    layers: sortPromptLayers(layers)
      .filter((layer) => contentNotEmpty(layer.content))
      .map((layer) => ({
        kind: layer.kind,
        role: layer.role,
        version: layer.version,
        stable: layer.stable ?? isStablePromptLayer(layer.kind),
        content: layer.content
      }))
  }
}

export function isStablePromptLayer(kind: PromptLayerKind): boolean {
  return kind === "core_system" || kind === "tool_schema" || kind === "static_context"
}

function sortPromptLayers(layers: PromptLayer[]): PromptLayer[] {
  return [...layers].sort((left, right) => PROMPT_LAYER_ORDER.indexOf(left.kind) - PROMPT_LAYER_ORDER.indexOf(right.kind))
}
