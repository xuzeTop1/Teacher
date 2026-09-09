<script setup lang="ts">
import { ref, computed, watch } from "vue"
import type { ProviderGuide, PresetApplication } from "../../services/llm/providerGuideTypes"
import {
  getApprovedProviderGuides,
  applyModelPreset,
  applyBaseUrlPreset,
  matchGuideError
} from "../../services/llm/providerGuideRegistry"

const props = defineProps<{
  visible: boolean
  errorMessage?: string
  /** Current provider baseUrl or name hint for auto-selecting the matching guide */
  providerHint?: string
}>()

const emit = defineEmits<{
  close: []
  applyPreset: [fields: PresetApplication]
}>()

const guides = computed(() => getApprovedProviderGuides())
const activeGuideId = ref(guides.value[0]?.id ?? "")
const activeGuide = computed(() => guides.value.find((g) => g.id === activeGuideId.value))

/** Detect which guide matches the current provider hint (baseUrl or name) */
function detectGuideId(hint: string | undefined): string {
  if (!hint) return guides.value[0]?.id ?? ""
  const lower = hint.toLowerCase()
  // Match by baseUrl preset URLs or provider keywords
  for (const guide of guides.value) {
    if (lower.includes(guide.providerName)) return guide.id
    for (const preset of guide.baseUrlPresets) {
      if (lower.includes(preset.url) || preset.url.includes(lower)) return guide.id
    }
  }
  // Keyword heuristics
  if (lower.includes("moonshot") || lower.includes("kimi")) return guides.value.find((g) => g.providerName === "kimi")?.id ?? ""
  if (lower.includes("localhost") || lower.includes("11434") || lower.includes("ollama")) return guides.value.find((g) => g.providerName === "ollama")?.id ?? ""
  return guides.value[0]?.id ?? ""
}

// Auto-select matching guide when drawer opens
watch(() => props.visible, (val) => {
  if (val) {
    activeGuideId.value = detectGuideId(props.providerHint)
  }
})

const matchedError = computed(() => {
  if (!props.errorMessage || !activeGuide.value) return null
  return matchGuideError(activeGuide.value, props.errorMessage)
})

// Copy feedback
const copiedUrl = ref("")
function copyUrl(url: string) {
  navigator.clipboard.writeText(url).then(() => {
    copiedUrl.value = url
    setTimeout(() => { copiedUrl.value = "" }, 2000)
  }).catch(() => {
    copiedUrl.value = "__failed__"
    setTimeout(() => { copiedUrl.value = "" }, 2000)
  })
}

function handleApplyBaseUrl(presetId: string) {
  if (!activeGuide.value) return
  const result = applyBaseUrlPreset(activeGuide.value, presetId)
  if (result) emit("applyPreset", result)
}

function handleApplyModel(presetId: string) {
  if (!activeGuide.value) return
  const result = applyModelPreset(activeGuide.value, presetId)
  if (result) emit("applyPreset", result)
}
</script>

<template>
  <div v-if="visible" class="guide-overlay" @click.self="emit('close')">
    <aside class="guide-drawer">
      <header class="guide-header">
        <h3>Provider 配置教程</h3>
        <button class="guide-close" @click="emit('close')">✕</button>
      </header>

      <nav class="guide-tabs">
        <button
          v-for="guide in guides"
          :key="guide.id"
          class="guide-tab"
          :class="{ active: guide.id === activeGuideId }"
          @click="activeGuideId = guide.id"
        >
          {{ guide.displayName }}
        </button>
      </nav>

      <div v-if="activeGuide" class="guide-body">
        <p class="guide-desc">{{ activeGuide.description }}</p>
        <p class="guide-disclaimer">本指南为 TeacherAgent 易用说明，不替代官方文档。</p>

        <!-- Matched error from diagnostics -->
        <div v-if="matchedError" class="guide-error-match">
          <h4>💡 {{ matchedError.title }}</h4>
          <p>{{ matchedError.explanation }}</p>
          <ol>
            <li v-for="(step, i) in matchedError.resolutionSteps" :key="i">{{ step }}</li>
          </ol>
        </div>

        <!-- Base URL presets -->
        <section v-if="activeGuide.baseUrlPresets.length" class="guide-section">
          <h4>Base URL 预设</h4>
          <div v-for="preset in activeGuide.baseUrlPresets" :key="preset.id" class="guide-preset-row">
            <div class="preset-info">
              <strong>{{ preset.label }}</strong>
              <code>{{ preset.url }}</code>
              <span class="preset-desc">{{ preset.description }}</span>
            </div>
            <div class="preset-actions">
              <button class="small-btn" @click="handleApplyBaseUrl(preset.id)">应用</button>
              <button class="small-btn ghost" @click="copyUrl(preset.url)">
                {{ copiedUrl === preset.url ? '已复制' : copiedUrl === '__failed__' ? '复制失败' : '复制' }}
              </button>
            </div>
          </div>
        </section>

        <!-- Model presets -->
        <section v-if="activeGuide.modelPresets.length" class="guide-section">
          <h4>模型预设</h4>
          <div v-for="preset in activeGuide.modelPresets" :key="preset.id" class="guide-preset-row">
            <div class="preset-info">
              <strong>{{ preset.label }}</strong>
              <span v-if="preset.recommended" class="preset-badge">推荐</span>
              <span class="preset-desc">{{ preset.description }}</span>
              <span v-if="preset.omitTemperature" class="preset-note">⚠️ 不可设置 temperature</span>
            </div>
            <button class="small-btn" @click="handleApplyModel(preset.id)">应用此预设</button>
          </div>
        </section>

        <!-- Setup steps -->
        <section class="guide-section">
          <h4>配置步骤</h4>
          <ol class="guide-steps">
            <li v-for="step in activeGuide.setupSteps" :key="step.id">
              <strong>{{ step.title }}</strong>
              <p>{{ step.description }}</p>
              <code v-if="step.example">{{ step.example }}</code>
            </li>
          </ol>
        </section>

        <!-- Field help -->
        <section class="guide-section">
          <h4>字段说明</h4>
          <dl class="guide-fields">
            <template v-for="field in activeGuide.fieldHelp" :key="field.field">
              <dt>{{ field.label }}</dt>
              <dd>{{ field.help }}</dd>
            </template>
          </dl>
        </section>

        <!-- Common errors -->
        <section class="guide-section">
          <h4>常见错误</h4>
          <details v-for="err in activeGuide.commonErrors" :key="err.id" class="guide-error-item">
            <summary>{{ err.title }}</summary>
            <p>{{ err.explanation }}</p>
            <ol>
              <li v-for="(step, i) in err.resolutionSteps" :key="i">{{ step }}</li>
            </ol>
          </details>
        </section>

        <!-- Official sources -->
        <section class="guide-section">
          <h4>官方文档</h4>
          <ul class="guide-sources">
            <li v-for="source in activeGuide.officialSources" :key="source.url">
              <button class="link-btn" @click="copyUrl(source.url)">
                {{ source.title }}{{ copiedUrl === source.url ? ' ✓已复制' : copiedUrl === '__failed__' ? ' ✗复制失败' : '' }}
              </button>
              <span class="source-date">核验于 {{ source.verifiedAt }}</span>
            </li>
          </ul>
        </section>

        <!-- Security notices -->
        <section v-if="activeGuide.securityNotices.length" class="guide-section">
          <h4>安全提示</h4>
          <p v-for="notice in activeGuide.securityNotices" :key="notice.id" class="guide-notice">
            🔒 <strong>{{ notice.title }}：</strong>{{ notice.description }}
          </p>
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.guide-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.3); display: flex; justify-content: flex-end;
}
.guide-drawer {
  width: 420px; max-width: 90vw; height: 100%; overflow-y: auto;
  background: var(--v-surface, #fff); padding: 20px;
  box-shadow: -4px 0 16px rgba(0,0,0,.12);
}
.guide-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.guide-header h3 { margin: 0; font-size: 17px; }
.guide-close { background: none; border: none; font-size: 18px; cursor: pointer; padding: 4px 8px; }
.guide-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
.guide-tab {
  padding: 5px 12px; border-radius: 6px; border: 1px solid #ddd;
  background: #f5f5f5; cursor: pointer; font-size: 13px;
}
.guide-tab.active { background: #1a3a6b; color: #fff; border-color: #1a3a6b; }
.guide-desc { font-size: 13px; color: #555; margin-bottom: 6px; }
.guide-disclaimer { font-size: 11px; color: #999; margin-bottom: 14px; }
.guide-section { margin-bottom: 18px; }
.guide-section h4 { font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
.guide-preset-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
.preset-info { display: flex; flex-direction: column; gap: 2px; }
.preset-info code { font-size: 12px; color: #1a3a6b; }
.preset-desc { font-size: 12px; color: #666; }
.preset-note { font-size: 11px; color: #b45309; }
.preset-badge { font-size: 11px; background: #dcfce7; color: #166534; padding: 1px 6px; border-radius: 4px; }
.preset-actions { display: flex; gap: 4px; }
.small-btn { padding: 3px 10px; font-size: 12px; border-radius: 4px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
.small-btn:hover { background: #f0f0f0; }
.small-btn.ghost { border: none; color: #1a3a6b; }
.guide-steps li { margin-bottom: 10px; }
.guide-steps p { font-size: 13px; color: #555; margin: 2px 0; }
.guide-steps code { font-size: 12px; background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
.guide-fields dt { font-weight: 600; font-size: 13px; margin-top: 8px; }
.guide-fields dd { font-size: 12px; color: #555; margin: 2px 0 0 0; }
.guide-error-item { margin-bottom: 8px; }
.guide-error-item summary { cursor: pointer; font-size: 13px; font-weight: 500; }
.guide-error-item p { font-size: 12px; color: #555; margin: 4px 0; }
.guide-error-item ol { font-size: 12px; padding-left: 18px; }
.guide-error-match { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin-bottom: 14px; }
.guide-error-match h4 { margin: 0 0 6px; font-size: 14px; }
.guide-error-match p { font-size: 13px; margin-bottom: 6px; }
.guide-error-match ol { font-size: 12px; padding-left: 18px; }
.guide-sources { list-style: none; padding: 0; }
.guide-sources li { margin-bottom: 6px; }
.link-btn { background: none; border: none; color: #1a3a6b; cursor: pointer; font-size: 13px; text-decoration: underline; padding: 0; }
.source-date { font-size: 11px; color: #999; margin-left: 6px; }
.guide-notice { font-size: 12px; color: #555; margin-bottom: 6px; }
</style>
