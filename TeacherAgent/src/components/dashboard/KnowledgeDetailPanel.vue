<script setup lang="ts">
import { computed } from "vue"
import type { StudentKnowledgeMastery } from "../../types/learning"
import type { KnowledgeSeedNode } from "../../services/knowledge/packLoader"
import { useRouter } from "vue-router"

const props = defineProps<{
  node: KnowledgeSeedNode | null
  mastery: StudentKnowledgeMastery | null
  dependents: KnowledgeSeedNode[]
}>()

const emit = defineEmits<{
  (e: "close"): void
}>()

const router = useRouter()

const isStrong = computed(() => (props.mastery?.masteryProbability ?? 0) >= 0.8)
const isDeveloping = computed(() => (props.mastery?.masteryProbability ?? 0) >= 0.5 && (props.mastery?.masteryProbability ?? 0) < 0.8)
const isWeak = computed(() => (props.mastery?.masteryProbability ?? 0) < 0.5)

function masteryPercent(v: number): string {
  return `${Math.round(v * 100)}%`
}

function startLearning() {
  if (props.node) {
    // Nav to chat with an initial prompt about this node
    router.push({
      path: "/",
      query: { initialPrompt: `我准备学习“${props.node.title}”，请帮我梳理这个知识点的核心内容。` }
    })
  }
}

function generatePractice() {
  if (props.node) {
    router.push({
      path: "/practice",
      query: { focusNode: props.node.id }
    })
  }
}
</script>

<template>
  <div class="knowledge-detail-panel" v-if="node">
    <div class="panel-header">
      <h3 class="node-title">{{ node.title }}</h3>
      <button class="close-btn" @click="emit('close')" aria-label="关闭详情">
        <v-icon icon="mdi-close" />
      </button>
    </div>

    <div class="mastery-section" v-if="mastery">
      <div class="mastery-label">当前掌握度</div>
      <div class="mastery-value" :class="{ 'text-strong': isStrong, 'text-developing': isDeveloping, 'text-weak': isWeak }">
        {{ masteryPercent(mastery.masteryProbability) }}
      </div>
      <div class="mastery-bar-container mt-2">
        <div
          class="mastery-bar"
          :class="{ 'bg-strong': isStrong, 'bg-developing': isDeveloping, 'bg-weak': isWeak }"
          :style="{ width: masteryPercent(mastery.masteryProbability) }"
        ></div>
      </div>
      <div class="mastery-stats mt-2">
        <span class="stat-item">练习: {{ mastery.attemptsCount }}次</span>
        <span class="stat-item">正确率: {{ mastery.attemptsCount > 0 ? Math.round((mastery.correctCount / mastery.attemptsCount) * 100) + '%' : '-' }}</span>
      </div>
    </div>

    <div class="info-section">
      <div class="section-title">知识摘要</div>
      <p class="summary-text">{{ node.summary }}</p>
    </div>

    <div class="info-section" v-if="node.prerequisites && node.prerequisites.length > 0">
      <div class="section-title">前置依赖</div>
      <ul class="relation-list">
        <li v-for="req in node.prerequisites" :key="req">{{ req }}</li>
      </ul>
    </div>

    <div class="info-section" v-if="dependents.length > 0">
      <div class="section-title">后续影响</div>
      <ul class="relation-list">
        <li v-for="dep in dependents" :key="dep.id">{{ dep.title }}</li>
      </ul>
    </div>

    <div class="action-section">
      <button class="action-button action-button-primary" @click="startLearning">
        <v-icon icon="mdi-play-circle-outline" class="mr-2" />
        开始学习
      </button>
      <button class="action-button action-button-secondary" @click="generatePractice">
        <v-icon icon="mdi-pencil-ruler" class="mr-2" />
        针对性练习
      </button>
    </div>
  </div>
  <div class="knowledge-detail-empty" v-else>
    <div class="empty-icon"><v-icon icon="mdi-cursor-default-click" size="48" color="#cbd5e1" /></div>
    <p>点击左侧知识点或学习路径节点，查看详细信息和推荐动作。</p>
  </div>
</template>

<style scoped>
.knowledge-detail-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  background: #ffffff;
  border-left: 1px solid #e2e8f0;
  overflow-y: auto;
}

.knowledge-detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px 24px;
  background: #f8fafc;
  border-left: 1px solid #e2e8f0;
  color: #64748b;
  text-align: center;
}

.empty-icon {
  margin-bottom: 16px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.node-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #3b78b5;
  line-height: 1.4;
}

.close-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.close-btn:hover {
  background: #f1f5f9;
  color: #475569;
}

.mastery-section {
  background: #f8fafc;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 24px;
}

.mastery-label {
  font-size: 0.85rem;
  color: #64748b;
  margin-bottom: 4px;
}

.mastery-value {
  font-size: 1.5rem;
  font-weight: 700;
}

.text-strong { color: #10b981; }
.text-developing { color: #f59e0b; }
.text-weak { color: #ef4444; }

.bg-strong { background: #10b981; }
.bg-developing { background: #f59e0b; }
.bg-weak { background: #ef4444; }

.mastery-bar-container {
  height: 6px;
  background: #e2e8f0;
  border-radius: 3px;
  overflow: hidden;
}

.mastery-bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.mastery-stats {
  display: flex;
  gap: 16px;
  font-size: 0.8rem;
  color: #64748b;
}

.info-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #334155;
  margin-bottom: 8px;
}

.summary-text {
  font-size: 0.9rem;
  line-height: 1.6;
  color: #475569;
  margin: 0;
}

.relation-list {
  margin: 0;
  padding-left: 20px;
  font-size: 0.9rem;
  color: #475569;
}

.relation-list li {
  margin-bottom: 4px;
}

.action-section {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 24px;
}

.action-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.action-button-primary {
  background: #4a90d9;
  color: white;
}

.action-button-primary:hover {
  background: #1e40af;
}

.action-button-secondary {
  background: #ffffff;
  border-color: #cbd5e1;
  color: #334155;
}

.action-button-secondary:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}

.mr-2 {
  margin-right: 8px;
}
.mt-2 {
  margin-top: 8px;
}
</style>
