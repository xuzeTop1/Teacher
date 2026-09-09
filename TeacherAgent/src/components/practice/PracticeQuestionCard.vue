<script setup lang="ts">
import { computed } from "vue"
import type { QuestionBankSearchOutput } from "../../types/tool"
import MessageRenderer from "../chat/MessageRenderer.vue"

type Question = QuestionBankSearchOutput["questions"][number]

const props = defineProps<{
  question: Question
  revealedHints: Set<string>
  showAnswer?: boolean
}>()

const emit = defineEmits<{
  revealHint: [hintId: string]
}>()

const hintLevels = ["L1", "L2", "L3"] as const

const sortedHints = computed(() =>
  [...props.question.hints].sort((a, b) => {
    const ai = hintLevels.indexOf(a.level as typeof hintLevels[number])
    const bi = hintLevels.indexOf(b.level as typeof hintLevels[number])
    return ai - bi
  })
)

function isHintRevealed(hintText: string): boolean {
  return props.revealedHints.has(hintText)
}

function nextHintToReveal() {
  return sortedHints.value.find((h) => !isHintRevealed(h.text))
}

function difficultyStars(d: number): string {
  return "★".repeat(d) + "☆".repeat(5 - d)
}
</script>

<template>
  <div class="question-card">
    <div class="question-meta">
      <span v-if="question.title" class="question-title">{{ question.title }}</span>
      <div class="question-tags">
        <span class="difficulty-stars">{{ difficultyStars(question.difficulty) }}</span>
        <span class="question-type-badge">{{ question.type }}</span>
        <span
          v-for="nodeId in question.knowledgeNodeIds"
          :key="nodeId"
          class="knowledge-tag"
        >
          {{ nodeId }}
        </span>
      </div>
    </div>

    <div class="question-content">
      <MessageRenderer :content="question.content" />
    </div>

    <!-- Hints Section -->
    <div v-if="sortedHints.length" class="hints-section">
      <div class="hints-header">
        <span class="hints-label">💡 提示</span>
        <button
          v-if="nextHintToReveal()"
          class="hint-reveal-button"
          @click="emit('revealHint', nextHintToReveal()!.text)"
        >
          显示下一级提示 ({{ nextHintToReveal()!.level }})
        </button>
      </div>
      <div class="hints-list">
        <div
          v-for="hint in sortedHints"
          :key="hint.text"
          :class="['hint-item', { revealed: isHintRevealed(hint.text) }]"
        >
          <span class="hint-level">{{ hint.level }}</span>
          <span class="hint-text">
            <template v-if="isHintRevealed(hint.text)">
              <MessageRenderer :content="hint.text" />
            </template>
            <template v-else>
              点击上方按钮查看提示
            </template>
          </span>
        </div>
      </div>
    </div>

    <!-- Answer Section (review mode) -->
    <div v-if="showAnswer && question.answer" class="answer-section">
      <div class="answer-header">📋 参考答案</div>
      <div class="answer-content">
        <MessageRenderer :content="question.answer" />
      </div>
    </div>

    <div v-if="showAnswer && question.solutionSteps?.length" class="steps-section">
      <div class="steps-header">📝 解题步骤</div>
      <ol class="steps-list">
        <li v-for="(step, i) in question.solutionSteps" :key="i" class="step-item">
          <MessageRenderer :content="step" />
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.question-card {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  padding: 20px;
}

.question-meta {
  margin-bottom: 16px;
}

.question-title {
  display: block;
  font-weight: 600;
  font-size: 1.05rem;
  margin-bottom: 8px;
}

.question-tags {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.difficulty-stars {
  color: #ff9800;
  font-size: 0.85rem;
  letter-spacing: 1px;
}

.question-type-badge {
  padding: 2px 8px;
  background: #e3f2fd;
  color: #1565c0;
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 500;
}

.knowledge-tag {
  padding: 2px 6px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 0.7rem;
  color: #666;
}

.question-content {
  font-size: 1rem;
  line-height: 1.6;
  margin-bottom: 16px;
  padding: 12px;
  background: #fafafa;
  border-radius: 8px;
  border-left: 3px solid #4a90d9;
}

.hints-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

.hints-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.hints-label {
  font-weight: 500;
  font-size: 0.9rem;
}

.hint-reveal-button {
  padding: 6px 14px;
  background: #fff3e0;
  color: #e65100;
  border: 1px solid #ffcc80;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.2s;
}

.hint-reveal-button:hover {
  background: #ffe0b2;
}

.hints-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hint-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 12px;
  border-radius: 6px;
  background: #f9f9f9;
  opacity: 0.5;
  transition: opacity 0.3s, background 0.3s;
}

.hint-item.revealed {
  opacity: 1;
  background: #fff8e1;
}

.hint-level {
  display: inline-block;
  padding: 1px 6px;
  background: #e0e0e0;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: #666;
  flex-shrink: 0;
}

.hint-item.revealed .hint-level {
  background: #ff9800;
  color: white;
}

.hint-text {
  font-size: 0.85rem;
  line-height: 1.4;
}

.answer-section,
.steps-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

.answer-header,
.steps-header {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 8px;
}

.answer-content {
  padding: 12px;
  background: #e8f5e9;
  border-radius: 8px;
  font-size: 0.95rem;
  line-height: 1.5;
}

.steps-list {
  padding-left: 20px;
  margin: 0;
}

.step-item {
  margin-bottom: 8px;
  font-size: 0.9rem;
  line-height: 1.5;
}
</style>
