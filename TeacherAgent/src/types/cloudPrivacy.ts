/**
 * Cloud privacy configuration.
 * All defaults are false — cloud providers receive only the minimum context
 * needed to answer the current question unless the user explicitly opts in.
 */
export interface CloudPrivacyConfig {
  /** Send session memory (conversation-level working memory) to cloud LLM */
  sendSessionMemoryToCloud: boolean
  /** Send student profile (learning goals, mastery summary, misconceptions) to cloud LLM */
  sendStudentProfileToCloud: boolean
  /** Enable LLM-based reflection for cloud providers (rule-based reflection is always available) */
  enableCloudReflection: boolean
  /** Send private document context (user-imported PDF/DOCX/XLSX chunks) to cloud LLM */
  sendPrivateDocumentContextToCloud: boolean
}

export const DEFAULT_CLOUD_PRIVACY_CONFIG: CloudPrivacyConfig = {
  sendSessionMemoryToCloud: false,
  sendStudentProfileToCloud: false,
  enableCloudReflection: false,
  sendPrivateDocumentContextToCloud: false
}

/**
 * Check if a provider is considered local (runs on user's machine).
 * Local providers can safely receive full memory context.
 */
export function isLocalProvider(isLocal: boolean | undefined): boolean {
  return isLocal === true
}
