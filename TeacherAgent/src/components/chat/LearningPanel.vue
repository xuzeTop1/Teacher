<script setup lang="ts">
import { ref, onMounted, watch } from "vue"
import { useAppStore } from "../../stores/app"
import { getLocalPromptContext } from "../../services/student/memoryService"
import type { LearningMemoryPromptContext } from "../../services/student/memoryService"

const props = defineProps<{
  conversationId: string
}>()

const appStore = useAppStore()
const isOpen = ref(false)
const memoryContext = ref<LearningMemoryPromptContext | null>(null)

function togglePanel() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    loadMemory()
  }
}

function loadMemory() {
  try {
    const context = getLocalPromptContext({
      studentId: "local-default-student",
      conversationId: props.conversationId,
      subjectCode: appStore.selectedSubject
    })
    memoryContext.value = context
  } catch {
    memoryContext.value = null
  }
}

watch(() => props.conversationId, () => {
  if (isOpen.value) {
    loadMemory()
  }
})

onMounted(() => {
  if (isOpen.value) {
    loadMemory()
  }
})
</script>

<template>
  <div class="learning-panel-wrapper">
    <button
      class="learning-panel-toggle"
      :class="{ active: isOpen }"
      title="学习面板"
      @click="togglePanel"
    >
      📊
    </button>

    <div v-if="isOpen" class="learning-panel-backdrop" @click="isOpen = false" />

    <Transition name="slide">
      <div v-if="isOpen" class="learning-panel">
        <div class="learning-panel-header">
          <h3>📊 学习面板</h3>
          <button class="close-btn" @click="isOpen = false">✕</button>
        </div>

        <div class="learning-panel-content">
          <!-- 学生画像 -->
          <section class="panel-section">
            <h4>👤 学生画像</h4>
            <div v-if="memoryContext?.studentContext" class="section-content">
              <p v-if="memoryContext.studentContext.learningGoal">
                <strong>目标：</strong>{{ memoryContext.studentContext.learningGoal }}
              </p>
              <p v-if="memoryContext.studentContext.preferenceSummary">
                <strong>偏好：</strong>{{ memoryContext.studentContext.preferenceSummary }}
              </p>
              <p v-if="memoryContext.studentContext.masterySummary">
                <strong>掌握度：</strong>{{ memoryContext.studentContext.masterySummary }}
              </p>
              <div v-if="memoryContext.studentContext.misconceptionPatterns?.length">
                <strong>常见误区：</strong>
                <ul>
                  <li v-for="(item, i) in memoryContext.studentContext.misconceptionPatterns" :key="i">
                    {{ item }}
                  </li>
                </ul>
              </div>
            </div>
            <p v-else class="empty-hint">暂无画像数据</p>
          </section>

          <!-- 长期记忆 -->
          <section class="panel-section">
            <h4>🧠 长期记忆</h4>
            <div v-if="memoryContext?.longTermMemories?.length" class="section-content">
              <div v-for="memory in memoryContext.longTermMemories.slice(0, 6)" :key="memory.id" class="memory-item">
                <span class="memory-kind">{{ memory.kind }}</span>
                <span class="memory-summary">{{ memory.summary }}</span>
              </div>
            </div>
            <p v-else class="empty-hint">暂无长期记忆</p>
          </section>

          <!-- 短期记忆 -->
          <section class="panel-section">
            <h4>📝 短期记忆（本会话）</h4>
            <div v-if="memoryContext?.shortTermMemory" class="section-content">
              <p><strong>摘要：</strong>{{ memoryContext.shortTermMemory.summary }}</p>
              <div v-if="memoryContext.shortTermMemory.recentFocus?.length">
                <strong>近期关注：</strong>
                <div class="tag-list">
                  <span v-for="(tag, i) in memoryContext.shortTermMemory.recentFocus" :key="i" class="tag">
                    {{ tag }}
                  </span>
                </div>
              </div>
              <div v-if="memoryContext.shortTermMemory.openQuestions?.length">
                <strong>待跟进问题：</strong>
                <ul>
                  <li v-for="(q, i) in memoryContext.shortTermMemory.openQuestions" :key="i">
                    {{ q }}
                  </li>
                </ul>
              </div>
              <p><strong>对话轮次：</strong>{{ memoryContext.shortTermMemory.turnCount }}</p>
            </div>
            <p v-else class="empty-hint">暂无短期记忆</p>
          </section>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.learning-panel-wrapper {
  position: relative;
}

.learning-panel-toggle {
  width: 36px;
  height: 36px;
  border: 1px solid #dce2ea;
  border-radius: 8px;
  background: white;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.learning-panel-toggle:hover {
  border-color: #4a90d9;
  background: #f5f8ff;
}

.learning-panel-toggle.active {
  border-color: #4a90d9;
  background: #e3f2fd;
}

.learning-panel-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 99;
}

.learning-panel {
  position: absolute;
  top: 44px;
  right: 0;
  width: 320px;
  max-height: 70vh;
  background: white;
  border: 1px solid #dce2ea;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.learning-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}

.learning-panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  color: #666;
  border-radius: 4px;
}

.close-btn:hover {
  background: #f5f5f5;
}

.learning-panel-content {
  overflow-y: auto;
  padding: 12px 16px;
  flex: 1;
}

.panel-section {
  margin-bottom: 16px;
}

.panel-section:last-child {
  margin-bottom: 0;
}

.panel-section h4 {
  margin: 0 0 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: #333;
}

.section-content {
  font-size: 12px;
  line-height: 1.6;
  color: #555;
}

.section-content p {
  margin: 4px 0;
}

.section-content strong {
  color: #333;
}

.section-content ul {
  margin: 4px 0;
  padding-left: 16px;
}

.section-content li {
  margin: 2px 0;
}

.memory-item {
  padding: 6px 0;
  border-bottom: 1px solid #f5f5f5;
}

.memory-item:last-child {
  border-bottom: none;
}

.memory-kind {
  display: inline-block;
  padding: 1px 6px;
  background: #e3f2fd;
  color: #4a90d9;
  border-radius: 4px;
  font-size: 10px;
  margin-right: 6px;
}

.memory-summary {
  font-size: 12px;
  color: #555;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.tag {
  padding: 2px 8px;
  background: #f0f0f0;
  border-radius: 4px;
  font-size: 11px;
  color: #666;
}

.empty-hint {
  font-size: 12px;
  color: #999;
  font-style: italic;
}

/* 动画 */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
