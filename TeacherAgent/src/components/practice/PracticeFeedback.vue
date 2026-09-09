<script setup lang="ts">
import { computed } from "vue"
import type { QuestionBankSearchOutput } from "../../types/tool"

type Question = QuestionBankSearchOutput["questions"][number]

const props = defineProps<{
  question: Question
  studentAnswer: string
  showSolution: boolean
}>()

const feedbackMessage = computed(() => {
  if (!props.studentAnswer.trim()) {
    return { type: "info", text: "你没有写下答案。试着回顾一下这道题的关键点。" }
  }

  const answer = props.studentAnswer.trim().toLowerCase()
  const correctAnswer = props.question.answer?.trim().toLowerCase()

  if (!correctAnswer) {
    return { type: "info", text: "这道题没有标准答案，请参考解析自行判断。" }
  }

  // Simple keyword matching for basic feedback
  if (answer.includes(correctAnswer) || correctAnswer.includes(answer)) {
    return { type: "success", text: "你的答案方向正确！看看解析了解更多细节。" }
  }

  // Check if student answer contains key terms from the solution
  const solutionText = (props.question.solutionSteps ?? []).join(" ").toLowerCase()
  const answerTokens = answer.split(/\s+/).filter((t) => t.length > 1)
  const matchedTokens = answerTokens.filter((t) => solutionText.includes(t))

  if (matchedTokens.length >= answerTokens.length * 0.5) {
    return { type: "partial", text: "你的思路部分正确，但可能遗漏了一些关键步骤。" }
  }

  return { type: "incorrect", text: "答案可能有误，建议查看提示或解析重新思考。" }
})

const feedbackIcon = computed(() => {
  switch (feedbackMessage.value.type) {
    case "success": return "✅"
    case "partial": return "⚠️"
    case "incorrect": return "❌"
    default: return "ℹ️"
  }
})

const feedbackClass = computed(() => `feedback-${feedbackMessage.value.type}`)
</script>

<template>
  <div class="practice-feedback-panel">
    <div :class="['feedback-message', feedbackClass]">
      <span class="feedback-icon">{{ feedbackIcon }}</span>
      <span>{{ feedbackMessage.text }}</span>
    </div>

    <div v-if="showSolution && question.solutionSteps?.length" class="solution-review">
      <div class="solution-header">📖 详细解析</div>
      <ol class="solution-steps">
        <li v-for="(step, i) in question.solutionSteps" :key="i">
          {{ step }}
        </li>
      </ol>
      <div v-if="question.answer" class="final-answer">
        <strong>最终答案：</strong>{{ question.answer }}
      </div>
    </div>

    <div class="feedback-tip">
      <strong>学习建议：</strong>
      即使答对了，也试着用自己的话解释为什么这样做。
      如果卡住了，先回顾相关的知识点定义和适用条件。
    </div>
  </div>
</template>

<style scoped>
.practice-feedback-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.feedback-message {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 14px 16px;
  border-radius: 8px;
  font-size: 0.95rem;
}

.feedback-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}

.feedback-success {
  background: #e8f5e9;
  border: 1px solid #a5d6a7;
  color: #2e7d32;
}

.feedback-partial {
  background: #fff3e0;
  border: 1px solid #ffcc80;
  color: #e65100;
}

.feedback-incorrect {
  background: #ffebee;
  border: 1px solid #ef9a9a;
  color: #c62828;
}

.feedback-info {
  background: #e3f2fd;
  border: 1px solid #90caf9;
  color: #1565c0;
}

.solution-review {
  padding: 16px;
  background: #f5f5f5;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
}

.solution-header {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 12px;
}

.solution-steps {
  padding-left: 20px;
  margin: 0 0 12px;
}

.solution-steps li {
  margin-bottom: 8px;
  font-size: 0.9rem;
  line-height: 1.5;
}

.final-answer {
  padding: 8px 12px;
  background: #e8f5e9;
  border-radius: 6px;
  font-size: 0.9rem;
}

.feedback-tip {
  padding: 12px;
  background: #fafafa;
  border-radius: 8px;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #555;
}
</style>
