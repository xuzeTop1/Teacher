<script setup lang="ts">
import { nextTick, ref } from "vue"
import type { ChatMessage } from "../../types/chat"
import MessageRenderer from "./MessageRenderer.vue"
import PlannerSignalPanel from "./PlannerSignalPanel.vue"

defineProps<{
  messages: ChatMessage[]
}>()

const emit = defineEmits<{
  (e: "retry", prompt: string): void
  (e: "retry-assessment", messageId: string): void
}>()

/** Parse provenance summary from toolRefsJson for verification display. */
function getProvenanceSummary(message: ChatMessage): string | null {
  if (!message.toolRefsJson) return null
  try {
    const parsed = JSON.parse(message.toolRefsJson)
    const prov = parsed?.tools?.knowledgeSearch?.provenance
    if (!prov) return null
    const mode = prov.retrievalMode === "vector" ? "向量命中" : prov.retrievalMode === "database_keyword" ? "关键词命中" : "JSON 种子"
    const count = parsed?.tools?.knowledgeSearch?.resultCount ?? 0
    const model = prov.embeddingModel ? ` · ${prov.embeddingModel}` : ""
    const score = prov.topScore != null ? ` · topScore ${prov.topScore.toFixed(2)}` : ""
    return `知识库：${mode} ${count} 条${model}${score}`
  } catch {
    return null
  }
}

const NEAR_BOTTOM_THRESHOLD = 120

const messageListEl = ref<HTMLElement | null>(null)

function isNearBottom(): boolean {
  const element = messageListEl.value
  if (!element) return true
  return element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_THRESHOLD
}

function scrollToBottom(behavior: ScrollBehavior = "smooth") {
  void nextTick(() => {
    const element = messageListEl.value
    if (!element) return

    element.scrollTo({
      top: element.scrollHeight,
      behavior
    })
  })
}

function scrollToBottomIfNear(behavior: ScrollBehavior = "smooth") {
  if (!isNearBottom()) return
  scrollToBottom(behavior)
}

defineExpose({
  scrollToBottom,
  scrollToBottomIfNear
})
</script>

<template>
  <section ref="messageListEl" class="message-list" aria-label="对话消息">
    <div class="chat-column">
      <article
        v-for="message in messages"
        :key="message.id"
        class="message"
        :class="`message-${message.role}`"
        v-show="message.content || message.plannerResult || message.isStreaming || message.attachments?.length"
      >
        <span class="message-role">{{ message.role === "student" ? "学生" : "导师" }}</span>
        
        <div v-if="message.attachments?.length" class="message-attachments">
          <img 
            v-for="att in message.attachments" 
            :key="att.id" 
            :src="att.dataUrl" 
            :alt="att.name || '图片'" 
            class="message-attachment-img" 
          />
        </div>

        <MessageRenderer v-if="message.content" :content="message.content" :streaming="message.isStreaming" />
        <div v-else-if="message.isStreaming" class="message-typing-indicator">
          正在接收...
        </div>
        <div v-if="message.assessmentResult?.persistenceStatus === 'failed'" class="msg-error-actions" role="status">
          <span>本轮学习评估未保存。</span>
          <button class="msg-error-action-btn retry-btn" :disabled="message.isSavingAssessment"
            @click="emit('retry-assessment', message.id)">
            {{ message.isSavingAssessment ? '保存中…' : '重试保存' }}
          </button>
        </div>
        <PlannerSignalPanel v-if="message.plannerResult" :result="message.plannerResult" />
        <div v-if="message.role === 'tutor' && message.isError" class="message-error-action-row">
          <RouterLink
            v-if="message.errorType === 'missing_provider' || message.errorType === 'llm_error'"
            to="/settings"
            class="msg-error-action-btn config-btn"
          >
            <v-icon icon="mdi-cog-outline" size="14" />
            <span>{{ message.errorType === 'missing_provider' ? '前往设置配置模型' : '检查模型设置' }}</span>
          </RouterLink>
          <button
            v-if="message.retryPrompt"
            type="button"
            class="msg-error-action-btn retry-btn"
            @click="emit('retry', message.retryPrompt)"
          >
            <v-icon icon="mdi-refresh" size="14" />
            <span>重试发送</span>
          </button>
        </div>
        <div v-if="message.role === 'tutor' && getProvenanceSummary(message)" class="message-provenance">
          {{ getProvenanceSummary(message) }}
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.message-error-action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.msg-error-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  text-decoration: none;
  font-weight: 500;
  transition: all 0.2s ease;
}

.msg-error-action-btn.config-btn {
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}

.msg-error-action-btn.config-btn:hover {
  background: #dbeafe;
}

.msg-error-action-btn.retry-btn {
  color: #047857;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
}

.msg-error-action-btn.retry-btn:hover {
  background: #d1fae5;
}

.message-provenance {
  margin-top: 4px;
  padding: 2px 6px;
  font-family: "Cascadia Code", "Fira Code", monospace;
  font-size: 11px;
  color: var(--v-text-secondary, #888);
  background: var(--v-surface-variant, #f5f5f5);
  border-radius: 3px;
  display: inline-block;
}
</style>
