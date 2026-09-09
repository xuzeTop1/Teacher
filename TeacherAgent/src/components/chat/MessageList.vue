<script setup lang="ts">
import { nextTick, ref } from "vue"
import type { ChatMessage } from "../../types/chat"
import MessageRenderer from "./MessageRenderer.vue"
import PlannerSignalPanel from "./PlannerSignalPanel.vue"

defineProps<{
  messages: ChatMessage[]
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
        <PlannerSignalPanel v-if="message.plannerResult" :result="message.plannerResult" />
        <div v-if="message.role === 'tutor' && getProvenanceSummary(message)" class="message-provenance">
          {{ getProvenanceSummary(message) }}
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
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
