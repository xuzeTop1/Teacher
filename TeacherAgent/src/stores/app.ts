import { defineStore } from "pinia"
import type { LlmProviderConfig } from "../services/llm/types"
import type { DatabaseStatus, StoredProviderConfig } from "../services/tauri/commands"
import type { CloudPrivacyConfig } from "../types/cloudPrivacy"
import { DEFAULT_CLOUD_PRIVACY_CONFIG, isLocalProvider } from "../types/cloudPrivacy"
import type { SubjectCode, CustomSubjectDescriptor, SubjectDescriptor } from "../types/learning"
import { isBuiltInSubject } from "../types/learning"

type StoredLlmProviderConfig = Omit<LlmProviderConfig, "apiKey">

const CLOUD_PRIVACY_STORAGE_KEY = "teacher-agent-cloud-privacy-config"
const EMBEDDING_CONFIG_STORAGE_KEY = "teacher-agent-embedding-config"
export const SELECTED_SUBJECT_STORAGE_KEY = "teacher-agent-selected-subject"

/** Persisted embedding provider configuration — independent from chat provider. */
export interface EmbeddingProviderConfig {
  baseUrl: string
  apiKeyRef: string
  embeddingModel: string
}

const DEFAULT_EMBEDDING_MODEL = "bge-m3"

function loadEmbeddingConfig(): EmbeddingProviderConfig | null {
  try {
    const raw = localStorage.getItem(EMBEDDING_CONFIG_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.baseUrl && parsed.apiKeyRef && parsed.embeddingModel) {
        return parsed as EmbeddingProviderConfig
      }
    }
  } catch {
    // ignore
  }
  return null
}

function saveEmbeddingConfig(config: EmbeddingProviderConfig | null): void {
  try {
    if (config) {
      localStorage.setItem(EMBEDDING_CONFIG_STORAGE_KEY, JSON.stringify(config))
    } else {
      localStorage.removeItem(EMBEDDING_CONFIG_STORAGE_KEY)
    }
  } catch {
    // ignore
  }
}

function loadSelectedSubject(): SubjectCode {
  try {
    const stored = localStorage.getItem(SELECTED_SUBJECT_STORAGE_KEY)?.trim()
    if (stored) return stored as SubjectCode
  } catch {
    // ignore — the app can still use the default subject without storage
  }
  return "math"
}

function saveSelectedSubject(subject: SubjectCode): void {
  try {
    localStorage.setItem(SELECTED_SUBJECT_STORAGE_KEY, subject)
  } catch {
    // ignore — subject persistence is best-effort
  }
}

function loadCloudPrivacyConfig(): CloudPrivacyConfig {
  try {
    const raw = localStorage.getItem(CLOUD_PRIVACY_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_CLOUD_PRIVACY_CONFIG, ...parsed }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CLOUD_PRIVACY_CONFIG }
}

function saveCloudPrivacyConfig(config: CloudPrivacyConfig): void {
  try {
    localStorage.setItem(CLOUD_PRIVACY_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // ignore — privacy config is best-effort persistence
  }
}

export const useAppStore = defineStore("app", {
  state: () => ({
    phase: "phase-0",
    selectedSubject: loadSelectedSubject(),
    providerConfigs: [] as StoredProviderConfig[],
    activeProviderId: null as string | null,
    databaseStatus: null as DatabaseStatus | null,
    cloudPrivacy: loadCloudPrivacyConfig(),
    customSubjects: [] as CustomSubjectDescriptor[],
    embeddingConfig: loadEmbeddingConfig() as EmbeddingProviderConfig | null
  }),
  getters: {
    activeProviderConfig(state): StoredProviderConfig | null {
      if (!state.activeProviderId) {
        return state.providerConfigs.find((p) => p.isDefault) ?? state.providerConfigs[0] ?? null
      }
      return state.providerConfigs.find((p) => p.id === state.activeProviderId) ?? null
    },
    activeLlmConfig(): StoredLlmProviderConfig | null {
      const config = this.activeProviderConfig
      if (!config) return null
      return {
        providerName: config.name,
        baseUrl: config.baseUrl,
        model: config.model,
        isLocal: config.isLocal,
        apiKeyRef: config.apiKeyRef,
        textModel: config.textModel,
        visionModel: config.visionModel,
        capabilities: config.supportsVision ? { vision: true } : undefined
      }
    },
    hasUsableProviderConfig(): boolean {
      const config = this.activeProviderConfig
      if (!config) return false
      return Boolean(
        config.name.trim() &&
          config.baseUrl.trim() &&
          config.model.trim() &&
          (config.isLocal || config.apiKeyRef?.trim())
      )
    },
    /** Whether the active provider is local (runs on user's machine) */
    isCurrentProviderLocal(): boolean {
      return isLocalProvider(this.activeProviderConfig?.isLocal)
    },
    /** All available subjects: built-in descriptors + custom subjects */
    allSubjects(): SubjectDescriptor[] {
      const builtIn: SubjectDescriptor[] = BUILT_IN_SUBJECTS.map((s) => ({
        code: s.code,
        name: s.name,
        isCustom: false
      }))
      const custom: SubjectDescriptor[] = this.customSubjects.map((s) => ({
        code: s.id as SubjectCode,
        name: s.name,
        isCustom: true,
        reviewStatus: s.reviewStatus
      }))
      return [...builtIn, ...custom]
    },
    /** Check if current selectedSubject is a custom subject */
    isCurrentSubjectCustom(): boolean {
      return !isBuiltInSubject(this.selectedSubject)
    },
    /**
     * Resolved embedding provider config. Uses the dedicated embedding config
     * if set; otherwise falls back to the active chat provider's baseUrl/apiKeyRef
     * with the default embedding model (bge-m3). Query and generation always
     * use the same model to ensure vector space consistency.
     */
    activeEmbeddingConfig(): EmbeddingProviderConfig | null {
      if (this.embeddingConfig) return this.embeddingConfig
      const chat = this.activeProviderConfig
      if (!chat?.baseUrl || !chat?.apiKeyRef) return null
      return {
        baseUrl: chat.baseUrl,
        apiKeyRef: chat.apiKeyRef,
        embeddingModel: DEFAULT_EMBEDDING_MODEL
      }
    }
  },
  actions: {
    setSelectedSubject(subject: SubjectCode) {
      this.selectedSubject = subject
      saveSelectedSubject(subject)
    },
    setProviderConfigs(configs: StoredProviderConfig[]) {
      this.providerConfigs = configs
    },
    setActiveProviderId(id: string | null) {
      this.activeProviderId = id
    },
    setDatabaseStatus(status: DatabaseStatus) {
      this.databaseStatus = { ...status }
    },
    updateCloudPrivacy(patch: Partial<CloudPrivacyConfig>) {
      this.cloudPrivacy = { ...this.cloudPrivacy, ...patch }
      saveCloudPrivacyConfig(this.cloudPrivacy)
    },
    setCustomSubjects(subjects: CustomSubjectDescriptor[]) {
      this.customSubjects = subjects
      if (!isBuiltInSubject(this.selectedSubject) && !subjects.some((subject) => subject.id === this.selectedSubject)) {
        this.setSelectedSubject("math")
      }
    },
    addCustomSubject(subject: CustomSubjectDescriptor) {
      this.customSubjects.unshift(subject)
    },
    removeCustomSubject(subjectId: string) {
      this.customSubjects = this.customSubjects.filter((s) => s.id !== subjectId)
      if (this.selectedSubject === subjectId) {
        this.setSelectedSubject("math")
      }
    },
    setEmbeddingConfig(config: EmbeddingProviderConfig | null) {
      this.embeddingConfig = config
      saveEmbeddingConfig(config)
    }
  }
})

/** Built-in subject labels for display */
const BUILT_IN_SUBJECTS: Array<{ code: SubjectCode; name: string }> = [
  { code: "math", name: "数学" },
  { code: "english", name: "英语" },
  { code: "law", name: "法学" },
  { code: "accounting", name: "会计" },
  { code: "programming", name: "编程" },
  { code: "cs408", name: "408考研" },
  { code: "physics", name: "物理" },
  { code: "politics", name: "政治" },
  { code: "management", name: "管理类联考" },
  { code: "education", name: "教育学311" },
  { code: "psychology", name: "心理学312" },
  { code: "lawmaster", name: "法律硕士" },
  { code: "xingce", name: "行测" },
  { code: "shenlun", name: "申论" }
]
