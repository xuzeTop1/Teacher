<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref } from "vue"
import {
  canSaveProviderConfig,
  canTestProviderConnection,
  getProviderModelPresets,
  getProviderModelValidationMessage,
  hasProviderBasics as hasProviderBasicsFromState,
  isKimiProviderInput,
  isMimoProviderInput,
  normalizeProviderModel
} from "../../services/llm/providerFormState"
import { testProviderConnectionFromForm } from "../../services/llm/providerDiagnostics"
import {
  deleteProviderApiKey,
  listProviderConfigs,
  saveProviderApiKey,
  saveProviderConfig as saveProviderConfigToDatabase,
  deleteProviderConfig as deleteProviderConfigFromDatabase
} from "../../services/tauri/commands"
import { useAppStore } from "../../stores/app"
import type { StoredProviderConfig } from "../../services/tauri/commands"
import ProviderGuideDrawer from "./ProviderGuideDrawer.vue"
import type { PresetApplication } from "../../services/llm/providerGuideTypes"
import { sanitizeErrorMessage } from "../../utils/errorMessage"

const appStore = useAppStore()

// Provider Guide drawer state
const guideVisible = ref(false)
const guideError = ref("")
const embeddingHint = ref("")

function handleGuideApply(fields: PresetApplication) {
  // Embedding-only preset (e.g. ollama-bge-m3): show hint, do NOT open/modify Provider form
  if (fields.embeddingModel && !fields.model) {
    embeddingHint.value = `已选择 Embedding 模型「${fields.embeddingModel}」，请前往知识库页面确认并生成向量。`
    setTimeout(() => { embeddingHint.value = "" }, 8000)
    return
  }
  // Auto-enter add form so the user can see applied values
  if (!isAddingNew.value && !editingProvider.value) {
    isAddingNew.value = true
  }
  if (fields.providerName) providerForm.providerName = fields.providerName
  if (fields.baseUrl) providerForm.baseUrl = fields.baseUrl
  if (fields.model) providerForm.model = fields.model
  if (fields.textModel) providerForm.textModel = fields.textModel
  if (fields.visionModel) providerForm.visionModel = fields.visionModel
  if (fields.supportsVision !== undefined) providerForm.supportsVision = fields.supportsVision
  if (fields.isLocal !== undefined) providerForm.isLocal = fields.isLocal
  // NEVER touches apiKey
}

// Provider 列表
const providers = ref<StoredProviderConfig[]>([])
const editingProvider = ref<StoredProviderConfig | null>(null)
const isAddingNew = ref(false)

// 编辑表单
const providerForm = reactive({
  providerName: "",
  baseUrl: "",
  model: "",
  apiKey: "",
  isLocal: false,
  textModel: "",
  visionModel: "",
  supportsVision: false
})

const providerStatus = ref<"idle" | "loading" | "success" | "error">("idle")
const providerMessage = ref("")
const saveMessage = ref("")
const providerApiKeyRef = ref<string | undefined>(undefined)

const normalizedProviderModel = computed(() => normalizeProviderModel(providerForm))
const isMimoProviderForm = computed(() => isMimoProviderInput(providerForm))
const isKimiProviderForm = computed(() => isKimiProviderInput(providerForm))
const providerModelPresets = computed(() => getProviderModelPresets(providerForm))
const providerModelValidationMessage = computed(() => getProviderModelValidationMessage(providerForm))
const providerModelNormalizationHint = computed(() => {
  const currentModel = providerForm.model.trim()
  if (!currentModel || currentModel === normalizedProviderModel.value) return ""
  return `将自动使用完整模型 ID：${normalizedProviderModel.value}`
})
const textModelPlaceholder = computed(() => isMimoProviderForm.value
  ? "例如 mimo-v2.5-pro，留空则使用上方模型"
  : isKimiProviderForm.value
    ? "例如 kimi-k2.6，留空则使用上方模型"
  : "填写完整文本模型 ID，留空则使用上方模型")
const visionModelPlaceholder = computed(() => isMimoProviderForm.value
  ? "例如 mimo-v2.5，图片输入时使用"
  : isKimiProviderForm.value
    ? "例如 kimi-k2.6，图片输入时使用"
  : "填写完整视觉模型 ID，图片输入时使用")

const hasProviderBasics = computed(() => {
  return hasProviderBasicsFromState({
    ...providerForm,
    model: normalizedProviderModel.value,
    apiKeyRef: providerApiKeyRef.value
  })
})

const canSaveProvider = computed(() => {
  return canSaveProviderConfig({
    ...providerForm,
    model: normalizedProviderModel.value,
    apiKeyRef: providerApiKeyRef.value
  })
})

const canTestProvider = computed(() => {
  return canTestProviderConnection({
    ...providerForm,
    model: normalizedProviderModel.value,
    apiKeyRef: providerApiKeyRef.value
  })
})

function normalizeModelValue(model: string): string {
  return normalizeProviderModel({
    providerName: providerForm.providerName,
    baseUrl: providerForm.baseUrl,
    model
  })
}

function normalizePrimaryModel() {
  providerForm.model = normalizeModelValue(providerForm.model)
}

function normalizeTextModel() {
  if (providerForm.textModel.trim()) {
    providerForm.textModel = normalizeModelValue(providerForm.textModel)
  }
}

function normalizeVisionModel() {
  if (providerForm.visionModel.trim()) {
    providerForm.visionModel = normalizeModelValue(providerForm.visionModel)
  }
}

function normalizeProviderModels() {
  normalizePrimaryModel()
  normalizeTextModel()
  normalizeVisionModel()
}

function selectProviderModel(model: string) {
  providerForm.model = model
}

async function loadProviders() {
  try {
    const configs = await listProviderConfigs()
    providers.value = configs
    appStore.setProviderConfigs(configs)
  } catch {
    providers.value = []
  }
}

function startAddNew() {
  isAddingNew.value = true
  editingProvider.value = null
  providerForm.providerName = ""
  providerForm.baseUrl = ""
  providerForm.model = ""
  providerForm.apiKey = ""
  providerForm.isLocal = false
  providerForm.textModel = ""
  providerForm.visionModel = ""
  providerForm.supportsVision = false
  providerApiKeyRef.value = undefined
  providerStatus.value = "idle"
  providerMessage.value = ""
  saveMessage.value = ""
}

function startEdit(provider: StoredProviderConfig) {
  isAddingNew.value = false
  editingProvider.value = provider
  providerForm.providerName = provider.name
  providerForm.baseUrl = provider.baseUrl
  providerForm.model = provider.model
  providerForm.apiKey = ""
  providerForm.isLocal = provider.isLocal
  providerForm.textModel = provider.textModel ?? ""
  providerForm.visionModel = provider.visionModel ?? ""
  providerForm.supportsVision = provider.supportsVision ?? false
  providerApiKeyRef.value = provider.apiKeyRef
  providerStatus.value = "idle"
  providerMessage.value = ""
  saveMessage.value = ""
}

function cancelEdit() {
  isAddingNew.value = false
  editingProvider.value = null
  providerForm.providerName = ""
  providerForm.baseUrl = ""
  providerForm.model = ""
  providerForm.apiKey = ""
  providerForm.isLocal = false
  providerForm.textModel = ""
  providerForm.visionModel = ""
  providerForm.supportsVision = false
  providerApiKeyRef.value = undefined
  providerStatus.value = "idle"
  providerMessage.value = ""
  saveMessage.value = ""
}

async function saveProviderConfig() {
  if (!canSaveProvider.value) return

  normalizeProviderModels()

  const providerId = editingProvider.value?.id ?? `provider-${Date.now()}`
  let nextApiKeyRef = providerApiKeyRef.value

  try {
    const endpointChanged =
      editingProvider.value &&
      editingProvider.value.baseUrl.replace(/\/+$/, "") !== providerForm.baseUrl.trim().replace(/\/+$/, "")
    if (endpointChanged && !providerForm.isLocal && !providerForm.apiKey.trim()) {
      throw new Error("Provider endpoint 已变化。为防止旧 API Key 被发送到新地址，请重新录入 API Key。")
    }
    if (providerForm.isLocal) {
      if (nextApiKeyRef) {
        await deleteProviderApiKey(nextApiKeyRef).catch(() => false)
      }
      nextApiKeyRef = undefined
      providerApiKeyRef.value = undefined
      providerForm.apiKey = ""
    } else if (providerForm.apiKey.trim()) {
      const savedKey = await saveProviderApiKey(
        providerId,
        providerForm.apiKey.trim(),
        providerForm.baseUrl
      )
      nextApiKeyRef = savedKey.apiKeyRef
      providerApiKeyRef.value = savedKey.apiKeyRef
      providerForm.apiKey = ""
    }

    await saveProviderConfigToDatabase({
      id: providerId,
      name: providerForm.providerName,
      providerType: "openai_compatible",
      baseUrl: providerForm.baseUrl,
      model: providerForm.model,
      apiKeyRef: nextApiKeyRef,
      isDefault: editingProvider.value?.isDefault ?? (providers.value.length === 0),
      isLocal: providerForm.isLocal,
      textModel: providerForm.textModel || undefined,
      visionModel: providerForm.visionModel || undefined,
      supportsVision: providerForm.supportsVision
    })

    saveMessage.value = providerForm.isLocal
      ? "已保存 Provider 配置。"
      : nextApiKeyRef
        ? "已保存 Provider 配置；API Key 已写入系统凭据存储。"
        : "已保存 Provider 配置；尚未保存 API Key。"

    await loadProviders()
    cancelEdit()
  } catch (error) {
    saveMessage.value = `保存失败：${sanitizeErrorMessage(error)}`
  }
}

async function deleteProvider(provider: StoredProviderConfig) {
  if (!confirm(`确定删除 Provider "${provider.name}" 吗？`)) return

  try {
    if (provider.apiKeyRef) {
      await deleteProviderApiKey(provider.apiKeyRef).catch(() => false)
    }
    await deleteProviderConfigFromDatabase(provider.id)
    await loadProviders()
    if (editingProvider.value?.id === provider.id) {
      cancelEdit()
    }
  } catch (error) {
    saveMessage.value = `删除失败：${sanitizeErrorMessage(error)}`
  }
}

async function setDefault(provider: StoredProviderConfig) {
  try {
    await saveProviderConfigToDatabase({
      id: provider.id,
      name: provider.name,
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKeyRef: provider.apiKeyRef,
      isDefault: true,
      isLocal: provider.isLocal,
      textModel: provider.textModel,
      visionModel: provider.visionModel,
      supportsVision: provider.supportsVision
    })
    await loadProviders()
  } catch (error) {
    saveMessage.value = `设置默认失败：${sanitizeErrorMessage(error)}`
  }
}

async function testProvider() {
  if (!canTestProvider.value || providerStatus.value === "loading") return

  normalizeProviderModels()

  providerStatus.value = "loading"
  providerMessage.value = "正在测试 Provider 连接..."

  const config = {
    providerName: providerForm.providerName,
    baseUrl: providerForm.baseUrl,
    model: providerForm.model,
    apiKeyRef: providerApiKeyRef.value,
    isLocal: providerForm.isLocal
  }
  try {
    const result = await testProviderConnectionFromForm(config, providerForm.apiKey)

    providerStatus.value = result.ok ? "success" : "error"
    providerMessage.value = result.ok
      ? `连接成功：${result.providerName} / ${result.model}，耗时 ${result.latencyMs}ms，返回：${result.message}`
      : `连接失败：${result.message}，耗时 ${result.latencyMs}ms`
  } catch (error) {
    providerStatus.value = "error"
    providerMessage.value = `连接测试失败：${sanitizeErrorMessage(error)}`
  }
}

onMounted(() => void loadProviders())
onActivated(() => void loadProviders())

defineExpose({ loadProviders })
</script>

<template>
  <section class="settings-panel">
    <h2>LLM Provider 管理</h2>
    <button class="guide-entry-btn" @click="guideVisible = true; guideError = providerStatus === 'error' ? providerMessage : ''">
      不知道怎么配置？查看教程
    </button>
    <p v-if="embeddingHint" class="embedding-hint">{{ embeddingHint }}</p>

    <!-- Provider 列表 -->
    <div class="provider-list">
      <div
        v-for="provider in providers"
        :key="provider.id"
        class="provider-item"
        :class="{ 
          active: editingProvider?.id === provider.id,
          'default-provider': provider.isDefault 
        }"
      >
        <div class="provider-info" @click="startEdit(provider)">
          <span class="provider-name">{{ provider.name }}</span>
          <span class="provider-model">{{ provider.model }}</span>
          <span v-if="provider.isDefault" class="provider-badge">默认</span>
        </div>
        <div class="provider-actions">
          <button
            v-if="!provider.isDefault"
            class="icon-action-button"
            title="设为默认"
            @click="setDefault(provider)"
          >
            <v-icon icon="mdi-star-outline" size="18" />
          </button>
          <button
            class="icon-action-button"
            title="编辑"
            @click="startEdit(provider)"
          >
            <v-icon icon="mdi-pencil-outline" size="18" />
          </button>
          <button
            class="icon-action-button"
            title="删除"
            @click="deleteProvider(provider)"
          >
            <v-icon icon="mdi-delete-outline" size="18" />
          </button>
        </div>
      </div>

      <div v-if="providers.length === 0" class="provider-empty">
        还没有配置任何 Provider，点击下方按钮添加。
      </div>
    </div>

    <!-- 添加按钮 -->
    <button
      v-if="!isAddingNew && !editingProvider"
      class="action-button action-button-primary"
      type="button"
      @click="startAddNew"
    >
      <v-icon icon="mdi-plus" size="20" />
      <span>添加 Provider</span>
    </button>

    <!-- 编辑表单 -->
    <div v-if="isAddingNew || editingProvider" class="provider-form">
      <h3>{{ isAddingNew ? '添加 Provider' : '编辑 Provider' }}</h3>
      <form class="settings-form" @submit.prevent="saveProviderConfig">
        <label class="field-label">
          <span>Provider 名称</span>
          <input
            v-model="providerForm.providerName"
            class="field-input"
            type="text"
            autocomplete="off"
            placeholder="自定义 Provider"
          />
        </label>
        <label class="field-label">
          <span>Base URL</span>
          <input
            v-model="providerForm.baseUrl"
            class="field-input"
            type="url"
            autocomplete="off"
            placeholder="https://api.example.com/v1"
          />
        </label>
        <label class="field-label">
          <span>模型</span>
          <input
            v-model="providerForm.model"
            class="field-input"
            type="text"
            autocomplete="off"
            placeholder="填写你的模型名称"
            @blur="normalizePrimaryModel"
          />
          <span v-if="providerModelNormalizationHint" class="field-hint field-hint-warning">
            {{ providerModelNormalizationHint }}
          </span>
          <span v-else-if="providerModelValidationMessage" class="field-hint field-hint-error">
            {{ providerModelValidationMessage }}
          </span>
          <span v-else-if="isMimoProviderForm" class="field-hint">
            MiMo 需要完整 API 模型 ID，不能只填 mimo，也不要附加“多模态”等展示标签。
          </span>
          <span v-else-if="isKimiProviderForm" class="field-hint">
            Kimi K2.6/K2.5 使用固定采样参数；TeacherAgent 会省略 temperature、保留思考模式，并提供 32K 推理与正文预算。
          </span>
          <span v-else class="field-hint">
            请填写厂商文档或控制台中的完整 API 模型 ID，不要只填写厂商名称。
          </span>
        </label>
        <div v-if="providerModelPresets.length" class="model-presets" aria-label="模型预设">
          <span class="model-presets-label">{{ providerForm.providerName.trim() || "Provider" }} 模型预设</span>
          <button
            v-for="preset in providerModelPresets"
            :key="preset.value"
            class="model-preset-button"
            :class="{ active: providerForm.model === preset.value }"
            type="button"
            @click="selectProviderModel(preset.value)"
          >
            {{ preset.label }}
          </button>
        </div>
        <label class="field-label">
          <span>Text Model <span class="field-hint">（可选，默认使用"模型"字段）</span></span>
          <input
            v-model="providerForm.textModel"
            class="field-input"
            type="text"
            autocomplete="off"
            :placeholder="textModelPlaceholder"
            @blur="normalizeTextModel"
          />
        </label>
        <label class="field-label">
          <span>Vision Model <span class="field-hint">（可选，图片输入时使用）</span></span>
          <input
            v-model="providerForm.visionModel"
            class="field-input"
            type="text"
            autocomplete="off"
            :placeholder="visionModelPlaceholder"
            @blur="normalizeVisionModel"
          />
        </label>
        <label class="field-check">
          <input v-model="providerForm.supportsVision" type="checkbox" />
          <span>支持视觉输入（配置 Vision Model 后建议勾选）</span>
        </label>
        <label class="field-label">
          <span>API Key</span>
          <input
            v-model="providerForm.apiKey"
            class="field-input"
            type="password"
            autocomplete="new-password"
            :disabled="providerForm.isLocal"
            placeholder="保存到系统凭据存储，SQLite 只保存引用"
          />
        </label>
        <label class="field-check">
          <input v-model="providerForm.isLocal" type="checkbox" />
          <span>本地 Provider，不要求 API Key</span>
        </label>
      </form>
      <div class="settings-actions">
        <button
          class="action-button action-button-primary"
          type="button"
          :disabled="!canSaveProvider"
          @click="saveProviderConfig"
        >
          <v-icon icon="mdi-content-save-outline" size="20" />
          <span>保存</span>
        </button>
        <button
          class="action-button action-button-secondary"
          type="button"
          :disabled="!canTestProvider || providerStatus === 'loading'"
          @click="testProvider"
        >
          <v-icon icon="mdi-cloud-check-outline" size="20" />
          <span>{{ providerStatus === "loading" ? "测试中" : "测试连接" }}</span>
        </button>
        <button
          class="action-button action-button-secondary"
          type="button"
          @click="cancelEdit"
        >
          <span>取消</span>
        </button>
      </div>
      <v-alert v-if="saveMessage" class="mt-4" type="info" variant="tonal">
        {{ saveMessage }}
      </v-alert>
      <v-alert
        v-if="providerStatus !== 'idle'"
        class="mt-4"
        :type="providerStatus === 'success' ? 'success' : providerStatus === 'error' ? 'error' : 'info'"
        variant="tonal"
      >
        {{ providerMessage }}
      </v-alert>
    </div>

    <ProviderGuideDrawer
      :visible="guideVisible"
      :error-message="guideError"
      :provider-hint="providerForm.baseUrl || providerForm.providerName"
      @close="guideVisible = false"
      @apply-preset="handleGuideApply"
    />
  </section>
</template>

<style scoped>
.guide-entry-btn {
  display: inline-block; margin-bottom: 12px; padding: 6px 14px;
  font-size: 13px; color: #1a3a6b; background: #eef4fc;
  border: 1px solid #c5d9f0; border-radius: 6px; cursor: pointer;
}
.guide-entry-btn:hover { background: #dceaf8; }
.embedding-hint { font-size: 12px; color: #166534; background: #dcfce7; padding: 6px 10px; border-radius: 6px; margin-bottom: 10px; }
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.provider-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border: 1px solid var(--v-border-color, #e0e0e0);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.provider-item:hover {
  border-color: var(--v-primary-base, #4a90d9);
}

.provider-item.active {
  border-color: var(--v-primary-base, #4a90d9);
  background: rgba(25, 118, 210, 0.04);
}

.provider-item.default-provider {
  border-color: var(--v-primary-base, #4a90d9);
  background: rgba(25, 118, 210, 0.08);
}

.provider-item.default-provider .provider-name {
  color: var(--v-primary-base, #4a90d9);
  font-weight: 600;
}

.provider-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.provider-name {
  font-weight: 500;
}

.provider-model {
  color: #666;
  font-size: 0.9em;
}

.provider-badge {
  background: var(--v-primary-base, #4a90d9);
  color: white;
  font-size: 0.75em;
  padding: 2px 8px;
  border-radius: 12px;
}

.provider-actions {
  display: flex;
  gap: 4px;
}

.icon-action-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: #666;
  transition: background 0.2s, color 0.2s;
}

.icon-action-button:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #333;
}

.provider-empty {
  color: #999;
  font-size: 0.9em;
  padding: 16px;
  text-align: center;
  border: 1px dashed #ddd;
  border-radius: 8px;
}

.provider-form {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--v-border-color, #e0e0e0);
  border-radius: 8px;
  background: #fafafa;
}

.provider-form h3 {
  margin: 0 0 12px;
  font-size: 1rem;
}

.field-hint {
  font-size: 0.85em;
  color: #888;
  font-weight: normal;
}

.field-hint-warning {
  color: #a66000;
}

.field-hint-error {
  color: #b42318;
}

.model-presets {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: -4px;
}

.model-presets-label {
  color: #667085;
  font-size: 0.82rem;
  font-weight: 600;
}

.model-preset-button {
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid #b9c6d8;
  border-radius: 8px;
  background: #ffffff;
  color: #344054;
  cursor: pointer;
  font-size: 0.78rem;
}

.model-preset-button:hover,
.model-preset-button.active {
  border-color: #4a90d9;
  background: #eef5ff;
  color: #235f9f;
}
</style>
