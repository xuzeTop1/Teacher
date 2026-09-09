/**
 * Provider Guide Registry
 *
 * Loads and validates Provider Guide JSON files at runtime.
 * Fail-closed: missing required fields, duplicate IDs, or invalid status
 * cause the guide to be rejected (not silently loaded).
 *
 * Provider Guides are completely isolated from:
 * - data/knowledge (teaching knowledge base)
 * - packManifest / packLoader
 * - Embedding generation
 * - ToolAgent knowledge_search
 * - Student conversation RAG
 */
import type { ProviderGuide, PresetApplication } from "./providerGuideTypes"

import kimiGuide from "../../../data/provider-guides/kimi.guide.json"
import ollamaGuide from "../../../data/provider-guides/ollama.guide.json"
import openaiCompatibleGuide from "../../../data/provider-guides/openai-compatible.guide.json"

const REQUIRED_GUIDE_FIELDS = [
  "id",
  "providerName",
  "displayName",
  "description",
  "status",
  "guideVersion",
  "verifiedAt",
  "officialSources",
  "capabilities",
  "securityNotices",
] as const

const VALID_STATUSES = ["approved", "draft"] as const

export class GuideValidationError extends Error {
  constructor(
    public readonly guideId: string,
    message: string
  ) {
    super(`[ProviderGuide:${guideId}] ${message}`)
    this.name = "GuideValidationError"
  }
}

export function validateGuide(raw: unknown): ProviderGuide {
  const guide = raw as Record<string, unknown>
  const id = (guide.id as string) || "unknown"

  // Required fields
  for (const field of REQUIRED_GUIDE_FIELDS) {
    if (guide[field] === undefined || guide[field] === null || guide[field] === "") {
      throw new GuideValidationError(id, `missing required field: ${field}`)
    }
  }

  // String type checks for key fields
  for (const field of ["id", "providerName", "displayName", "description", "guideVersion", "verifiedAt"] as const) {
    if (typeof guide[field] !== "string") {
      throw new GuideValidationError(id, `field ${field} must be a string`)
    }
  }

  // Status validation
  if (!VALID_STATUSES.includes(guide.status as (typeof VALID_STATUSES)[number])) {
    throw new GuideValidationError(id, `invalid status: ${guide.status}`)
  }

  // officialSources must be non-empty array with valid entries
  const sources = guide.officialSources as unknown[]
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new GuideValidationError(id, "officialSources must be a non-empty array")
  }
  for (const src of sources) {
    const s = src as Record<string, unknown>
    if (typeof s.title !== "string" || typeof s.url !== "string") {
      throw new GuideValidationError(id, "officialSources entries must have string title and url")
    }
    if (!s.url.startsWith("https://") && !s.url.startsWith("http://")) {
      throw new GuideValidationError(id, `officialSources url must be a valid URL: ${s.url}`)
    }
    if (typeof s.verifiedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.verifiedAt as string)) {
      throw new GuideValidationError(id, `officialSources verifiedAt must be YYYY-MM-DD format: ${s.verifiedAt}`)
    }
  }

  // baseUrlPresets validation
  const baseUrlPresets = guide.baseUrlPresets
  if (!Array.isArray(baseUrlPresets)) {
    throw new GuideValidationError(id, "baseUrlPresets must be an array")
  }
  const baseUrlIds = new Set<string>()
  for (const preset of baseUrlPresets) {
    const p = preset as Record<string, unknown>
    if (typeof p.id !== "string" || typeof p.label !== "string" || typeof p.url !== "string") {
      throw new GuideValidationError(id, "baseUrlPresets entries must have string id, label, url")
    }
    if (!p.url.startsWith("https://") && !p.url.startsWith("http://")) {
      throw new GuideValidationError(id, `baseUrlPresets url must be a valid URL: ${p.url}`)
    }
    if (baseUrlIds.has(p.id as string)) {
      throw new GuideValidationError(id, `duplicate baseUrl preset ID: ${p.id}`)
    }
    baseUrlIds.add(p.id as string)
  }

  // modelPresets validation
  const presets = guide.modelPresets
  if (!Array.isArray(presets)) {
    throw new GuideValidationError(id, "modelPresets must be an array")
  }
  const presetIds = new Set<string>()
  for (const preset of presets) {
    const p = preset as Record<string, unknown>
    if (typeof p.id !== "string" || typeof p.label !== "string") {
      throw new GuideValidationError(id, "modelPresets entries must have string id and label")
    }
    if (presetIds.has(p.id as string)) {
      throw new GuideValidationError(id, `duplicate model preset ID: ${p.id}`)
    }
    presetIds.add(p.id as string)
    // Boolean fields must actually be boolean
    for (const boolField of ["supportsVision", "supportsEmbedding", "fixedSampling", "omitTemperature", "recommended"] as const) {
      if (p[boolField] !== undefined && typeof p[boolField] !== "boolean") {
        throw new GuideValidationError(id, `modelPreset ${p.id}: ${boolField} must be boolean`)
      }
    }
  }

  // capabilities validation
  const caps = guide.capabilities as Record<string, unknown> | undefined
  if (caps !== undefined) {
    if (typeof caps !== "object" || caps === null || Array.isArray(caps)) {
      throw new GuideValidationError(id, "capabilities must be an object")
    }
    for (const [key, val] of Object.entries(caps)) {
      if (typeof val !== "boolean") {
        throw new GuideValidationError(id, `capabilities.${key} must be boolean`)
      }
    }
  }

  // commonErrors validation
  const errors = guide.commonErrors
  if (!Array.isArray(errors)) {
    throw new GuideValidationError(id, "commonErrors must be an array")
  }
  const errorIds = new Set<string>()
  for (const err of errors) {
    const e = err as Record<string, unknown>
    if (typeof e.id !== "string" || typeof e.title !== "string" || typeof e.explanation !== "string") {
      throw new GuideValidationError(id, "commonErrors entries must have string id, title, explanation")
    }
    if (errorIds.has(e.id as string)) {
      throw new GuideValidationError(id, `duplicate commonError ID: ${e.id}`)
    }
    errorIds.add(e.id as string)
    if (!Array.isArray(e.matchPatterns) || (e.matchPatterns as unknown[]).length === 0) {
      throw new GuideValidationError(id, `commonError ${e.id}: matchPatterns must be a non-empty array`)
    }
    for (const pat of e.matchPatterns as unknown[]) {
      if (typeof pat !== "string") {
        throw new GuideValidationError(id, `commonError ${e.id}: matchPatterns entries must be strings`)
      }
    }
    if (!Array.isArray(e.resolutionSteps)) {
      throw new GuideValidationError(id, `commonError ${e.id}: resolutionSteps must be an array`)
    }
    for (const step of e.resolutionSteps as unknown[]) {
      if (typeof step !== "string") {
        throw new GuideValidationError(id, `commonError ${e.id}: resolutionSteps entries must be strings`)
      }
    }
  }

  // fieldHelp validation
  const fieldHelp = guide.fieldHelp
  if (!Array.isArray(fieldHelp)) {
    throw new GuideValidationError(id, "fieldHelp must be an array")
  }
  for (const fh of fieldHelp) {
    const f = fh as Record<string, unknown>
    if (typeof f.field !== "string" || typeof f.label !== "string" || typeof f.help !== "string") {
      throw new GuideValidationError(id, "fieldHelp entries must have string field, label, help")
    }
  }

  // setupSteps validation
  const setupSteps = guide.setupSteps
  if (!Array.isArray(setupSteps)) {
    throw new GuideValidationError(id, "setupSteps must be an array")
  }
  for (const step of setupSteps) {
    const s = step as Record<string, unknown>
    if (typeof s.id !== "string" || typeof s.title !== "string" || typeof s.description !== "string") {
      throw new GuideValidationError(id, "setupSteps entries must have string id, title, description")
    }
  }

  // securityNotices validation
  const notices = guide.securityNotices
  if (notices !== undefined) {
    if (!Array.isArray(notices)) {
      throw new GuideValidationError(id, "securityNotices must be an array")
    }
    for (const notice of notices) {
      const n = notice as Record<string, unknown>
      if (typeof n.id !== "string" || typeof n.title !== "string" || typeof n.description !== "string") {
        throw new GuideValidationError(id, "securityNotices entries must have string id, title, description")
      }
    }
  }

  return guide as unknown as ProviderGuide
}

function loadAllGuides(): ProviderGuide[] {
  const rawGuides = [kimiGuide, ollamaGuide, openaiCompatibleGuide]
  const guides: ProviderGuide[] = []
  const seenIds = new Set<string>()

  for (const raw of rawGuides) {
    const guide = validateGuide(raw)
    if (seenIds.has(guide.id)) {
      throw new GuideValidationError(guide.id, `duplicate guide ID: ${guide.id}`)
    }
    seenIds.add(guide.id)
    guides.push(guide)
  }

  return guides
}

let cachedGuides: ProviderGuide[] | null = null

/** Load all validated guides. Throws on validation failure (fail-closed). */
export function getProviderGuides(): ProviderGuide[] {
  if (!cachedGuides) {
    cachedGuides = loadAllGuides()
  }
  return cachedGuides
}

/** Get only approved guides (for user-facing display). */
export function getApprovedProviderGuides(): ProviderGuide[] {
  return getProviderGuides().filter((g) => g.status === "approved")
}

/** Get a guide by ID. Returns undefined if not found. */
export function getProviderGuideById(id: string): ProviderGuide | undefined {
  return getProviderGuides().find((g) => g.id === id)
}

/**
 * Apply a model preset to produce form field values.
 * NEVER touches API key — only returns non-sensitive fields.
 */
export function applyModelPreset(
  guide: ProviderGuide,
  presetId: string
): PresetApplication | null {
  const preset = guide.modelPresets.find((p) => p.id === presetId)
  if (!preset) return null

  const result: PresetApplication = {
    providerName: guide.displayName,
    isLocal: guide.providerName === "ollama",
  }

  // Include default Base URL so one click fills the complete config
  if (guide.baseUrlPresets.length > 0) {
    result.baseUrl = guide.baseUrlPresets[0].url
  }

  if (preset.textModel) {
    result.model = preset.textModel
    result.textModel = preset.textModel
  }
  if (preset.visionModel) {
    result.visionModel = preset.visionModel
    result.supportsVision = preset.supportsVision
  }
  if (preset.embeddingModel) {
    result.embeddingModel = preset.embeddingModel
  }

  return result
}

/**
 * Apply a Base URL preset to produce form field values.
 * NEVER touches API key.
 */
export function applyBaseUrlPreset(
  guide: ProviderGuide,
  presetId: string
): PresetApplication | null {
  const preset = guide.baseUrlPresets.find((p) => p.id === presetId)
  if (!preset) return null

  return {
    baseUrl: preset.url,
    providerName: guide.displayName,
    isLocal: guide.providerName === "ollama",
  }
}

/**
 * Match an error message against a guide's commonErrors.
 * Returns the first matching error entry, or null.
 */
export function matchGuideError(
  guide: ProviderGuide,
  errorMessage: string
): ProviderGuide["commonErrors"][number] | null {
  const lowerMessage = errorMessage.toLowerCase()
  for (const error of guide.commonErrors) {
    for (const pattern of error.matchPatterns) {
      if (lowerMessage.includes(pattern.toLowerCase())) {
        return error
      }
    }
  }
  return null
}

/** Reset cached guides (for testing). */
export function resetGuideCache(): void {
  cachedGuides = null
}
