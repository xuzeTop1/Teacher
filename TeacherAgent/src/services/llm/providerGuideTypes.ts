/**
 * Provider Guide type definitions.
 *
 * Provider Guides are local, structured configuration tutorials for LLM providers.
 * They are NOT part of the teaching knowledge base, Pack manifest, or RAG pipeline.
 * They exist solely to help users configure their API providers correctly.
 */

export interface ProviderGuideModelPreset {
  id: string
  label: string
  description: string
  textModel: string
  visionModel?: string
  embeddingModel?: string
  supportsVision: boolean
  supportsEmbedding: boolean
  /** If true, the provider requires fixed sampling params (e.g. temperature=1 for MiMo) */
  fixedSampling: boolean
  /** If true, temperature should be omitted from requests (e.g. Kimi K2.5/K2.6) */
  omitTemperature: boolean
  recommended: boolean
}

export interface ProviderGuideBaseUrlPreset {
  id: string
  label: string
  url: string
  description: string
}

export interface ProviderGuideCommonError {
  id: string
  /** Patterns to match against error messages (case-insensitive substring match) */
  matchPatterns: string[]
  title: string
  explanation: string
  resolutionSteps: string[]
  /** Which form fields are related to this error */
  relatedFields: string[]
}

export interface ProviderGuideSetupStep {
  id: string
  title: string
  description: string
  /** Optional code/command example */
  example?: string
}

export interface ProviderGuideFieldHelp {
  field: string
  label: string
  help: string
  placeholder?: string
}

export interface ProviderGuideOfficialSource {
  title: string
  url: string
  verifiedAt: string
}

export interface ProviderGuideSecurityNotice {
  id: string
  title: string
  description: string
}

export interface ProviderGuide {
  id: string
  providerName: string
  displayName: string
  description: string
  status: "approved" | "draft"
  guideVersion: string
  verifiedAt: string
  baseUrlPresets: ProviderGuideBaseUrlPreset[]
  modelPresets: ProviderGuideModelPreset[]
  capabilities: {
    supportsStreaming: boolean
    supportsVision: boolean
    supportsEmbedding: boolean
    supportsThinking: boolean
  }
  fieldHelp: ProviderGuideFieldHelp[]
  setupSteps: ProviderGuideSetupStep[]
  commonErrors: ProviderGuideCommonError[]
  officialSources: ProviderGuideOfficialSource[]
  securityNotices: ProviderGuideSecurityNotice[]
}

/** Result of applying a model preset to the provider form (never touches API key) */
export interface PresetApplication {
  providerName?: string
  baseUrl?: string
  model?: string
  textModel?: string
  visionModel?: string
  embeddingModel?: string
  supportsVision?: boolean
  isLocal?: boolean
}
