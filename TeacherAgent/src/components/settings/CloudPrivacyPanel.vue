<script setup lang="ts">
import { computed } from "vue"
import { useAppStore } from "../../stores/app"
import type { CloudPrivacyConfig } from "../../types/cloudPrivacy"

const appStore = useAppStore()

const isCloudProvider = computed(() => !appStore.isCurrentProviderLocal)

const privacyOptions: Array<{
  key: keyof CloudPrivacyConfig
  label: string
  description: string
  warning?: string
}> = [
  {
    key: "sendSessionMemoryToCloud",
    label: "发送会话记忆到云端",
    description: "允许云端 LLM 查看当前会话的短期记忆摘要，用于维持对话连贯性。",
    warning: "会话记忆可能包含学生的学习进度和薄弱环节信息。"
  },
  {
    key: "sendStudentProfileToCloud",
    label: "发送学生画像到云端",
    description: "允许云端 LLM 查看学生的学习目标、掌握度摘要和常见误区。",
    warning: "学生画像包含长期学习数据，属于敏感个人信息。"
  },
  {
    key: "enableCloudReflection",
    label: "启用云端 LLM 反思",
    description: "使用云端 LLM 进行教学反思分析（默认关闭，使用规则版本地反思）。",
    warning: "LLM 反思会将对话内容发送到云端进行分析。"
  },
  {
    key: "sendPrivateDocumentContextToCloud",
    label: "发送私有文档到云端",
    description: "允许云端 LLM 检索用户导入的本地文档内容。",
    warning: "私有文档可能包含版权内容或个人笔记，发送到云端需谨慎。"
  }
]

function toggleOption(key: keyof CloudPrivacyConfig) {
  const current = appStore.cloudPrivacy[key]
  appStore.updateCloudPrivacy({ [key]: !current })
}
</script>

<template>
  <div class="cloud-privacy-panel">
    <h2>云端隐私设置</h2>

    <div v-if="!isCloudProvider" class="privacy-note privacy-note-local">
      <v-icon icon="mdi-shield-check" size="18" color="success" />
      <span>当前使用本地 Provider，所有数据仅在本机处理，无需额外隐私设置。</span>
    </div>

    <div v-else class="privacy-note privacy-note-cloud">
      <v-icon icon="mdi-cloud-outline" size="18" color="warning" />
      <span>当前使用云端 Provider。以下设置控制哪些数据会发送到云端 LLM。</span>
    </div>

    <div class="privacy-options">
      <div
        v-for="option in privacyOptions"
        :key="option.key"
        class="privacy-option"
        :class="{ disabled: !isCloudProvider }"
      >
        <div class="privacy-option-header">
          <label class="privacy-toggle" :for="`privacy-${option.key}`">
            <input
              :id="`privacy-${option.key}`"
              type="checkbox"
              :checked="appStore.cloudPrivacy[option.key]"
              :disabled="!isCloudProvider"
              @change="toggleOption(option.key)"
            />
            <span class="privacy-toggle-slider"></span>
          </label>
          <div class="privacy-option-text">
            <span class="privacy-option-label">{{ option.label }}</span>
            <span class="privacy-option-desc">{{ option.description }}</span>
          </div>
        </div>
        <div v-if="option.warning && appStore.cloudPrivacy[option.key]" class="privacy-warning">
          <v-icon icon="mdi-alert-circle-outline" size="14" color="warning" />
          <span>{{ option.warning }}</span>
        </div>
      </div>
    </div>

    <div v-if="isCloudProvider" class="privacy-footer">
      <span class="privacy-footer-text">
        授权状态仅保存在本地，不会发送到云端。关闭所有开关后，云端 LLM 仅接收当前问题和学科知识检索结果。
      </span>
    </div>
  </div>
</template>

<style scoped>
.cloud-privacy-panel {
  padding: 0;
}

.cloud-privacy-panel h2 {
  margin: 0 0 16px;
  color: var(--atlas-ink);
  font-family: Georgia, "Times New Roman", "Noto Serif SC", serif;
  font-size: 18px;
}

.privacy-note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 13px;
  line-height: 1.5;
}

.privacy-note-local {
  background: rgba(76, 175, 80, 0.08);
  border: 1px solid rgba(76, 175, 80, 0.2);
  color: #2e7d32;
}

.privacy-note-cloud {
  background: rgba(255, 152, 0, 0.08);
  border: 1px solid rgba(255, 152, 0, 0.2);
  color: #e65100;
}

.privacy-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.privacy-option {
  padding: 14px 16px;
  border: 1px solid rgba(214, 207, 193, 0.6);
  border-radius: 8px;
  background: #fffdf8;
  transition: opacity 0.2s;
}

.privacy-option.disabled {
  opacity: 0.5;
}

.privacy-option-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.privacy-toggle {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.privacy-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.privacy-toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: 0.2s;
  border-radius: 20px;
}

.privacy-toggle-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: 0.2s;
  border-radius: 50%;
}

.privacy-toggle input:checked + .privacy-toggle-slider {
  background-color: #1976d2;
}

.privacy-toggle input:checked + .privacy-toggle-slider:before {
  transform: translateX(16px);
}

.privacy-toggle input:disabled + .privacy-toggle-slider {
  cursor: not-allowed;
  opacity: 0.5;
}

.privacy-option-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.privacy-option-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--atlas-ink);
}

.privacy-option-desc {
  font-size: 12px;
  color: var(--atlas-muted);
  line-height: 1.5;
}

.privacy-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 12px;
  background: rgba(255, 152, 0, 0.06);
  border-radius: 4px;
  font-size: 11px;
  color: #e65100;
  line-height: 1.4;
}

.privacy-footer {
  margin-top: 16px;
  padding: 12px 16px;
  background: rgba(33, 150, 243, 0.06);
  border-radius: 6px;
  border: 1px solid rgba(33, 150, 243, 0.15);
}

.privacy-footer-text {
  font-size: 12px;
  color: #1565c0;
  line-height: 1.5;
}
</style>
