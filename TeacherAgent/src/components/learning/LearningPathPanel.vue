<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { loadStudentKnowledge, loadKnowledgePrerequisites } from "../../services/tauri/commands"
import type { StudentKnowledgeMastery, KnowledgePrerequisite, SubjectCode } from "../../types/learning"
import { buildChapterDAG, topologicalSort, findRecommendedNext } from "../../engine/agents/plannerAgent"

const props = defineProps<{
  subjectCode: SubjectCode
}>()

const emit = defineEmits<{
  (e: "select-node", nodeId: string): void
}>()

const studentId = "local-default-student"
const knowledge = ref<StudentKnowledgeMastery[]>([])
const prerequisites = ref<KnowledgePrerequisite[]>([])

interface LearningStep {
  id: string
  title: string
  mastery: number
  isCompleted: boolean
  isReady: boolean
  isRecommended: boolean
}

const learningPath = computed<LearningStep[]>(() => {
  if (knowledge.value.length === 0) return []

  // 构建章节 DAG
  const dag = buildChapterDAG(prerequisites.value, knowledge.value, props.subjectCode)
  if (!dag) return []

  // 拓扑排序
  const topoOrder = topologicalSort(dag.chapters)
  const recommendedId = findRecommendedNext(dag.chapters)

  // 过滤掉已掌握的节点，生成学习路径
  const steps: LearningStep[] = []
  for (const chapterId of topoOrder) {
    const chapter = dag.chapters.find((ch) => ch.id === chapterId)
    if (!chapter) continue

    // 已掌握的节点标记为完成，但仍显示在路径中
    steps.push({
      id: chapter.id,
      title: chapter.title,
      mastery: chapter.masteryProbability,
      isCompleted: chapter.isCompleted,
      isReady: chapter.isReady,
      isRecommended: chapter.id === recommendedId
    })
  }

  return steps
})

const currentStep = computed(() => learningPath.value.find((s) => s.isRecommended))
const completedCount = computed(() => learningPath.value.filter((s) => s.isCompleted).length)
const totalCount = computed(() => learningPath.value.length)
const progressPercent = computed(() => {
  if (totalCount.value === 0) return 0
  return Math.round((completedCount.value / totalCount.value) * 100)
})

const showFullPath = ref(false)
const visiblePath = computed(() => {
  if (showFullPath.value || learningPath.value.length <= 4) return learningPath.value

  const recIndex = learningPath.value.findIndex(s => s.isRecommended)
  const startIndex = recIndex === -1 ? 0 : recIndex
  return learningPath.value.slice(startIndex, startIndex + 4)
})

function handleNodeClick(nodeId: string) {
  emit("select-node", nodeId)
}

async function loadPathData() {
  try {
    knowledge.value = await loadStudentKnowledge(studentId, props.subjectCode, 50)
    const nodeIds = knowledge.value.map((k) => k.knowledgeNodeId)
    if (nodeIds.length) {
      prerequisites.value = await loadKnowledgePrerequisites(props.subjectCode, nodeIds, 80)
    } else {
      prerequisites.value = []
    }
  } catch {
    // Tauri not available
  }
}

onMounted(loadPathData)

watch(() => props.subjectCode, loadPathData)

function masteryColor(v: number): string {
  if (v >= 0.8) return "#4caf50"
  if (v >= 0.4) return "#ff9800"
  if (v > 0) return "#f44336"
  return "#9e9e9e"
}
</script>

<template>
  <div class="learning-path-panel">
    <div class="path-header">
      <h3>📍 学习路径</h3>
      <div class="path-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${progressPercent}%` }"></div>
        </div>
        <span class="progress-label">{{ completedCount }}/{{ totalCount }} 已完成</span>
      </div>
    </div>

    <div v-if="currentStep" class="current-recommendation">
      <div class="recommendation-icon"><v-icon icon="mdi-lightbulb-on-outline" color="#4a90d9" /></div>
      <div class="recommendation-content" @click="handleNodeClick(currentStep.id)" style="cursor: pointer;">
        <div class="recommendation-label">当前推荐学习</div>
        <div class="recommendation-title">{{ currentStep.title }}</div>
        <div class="recommendation-mastery">
          当前掌握度: {{ Math.round(currentStep.mastery * 100) }}%
        </div>
      </div>
    </div>

    <div v-if="learningPath.length" class="path-timeline">
      <div
        v-for="(step, index) in visiblePath"
        :key="step.id"
        :class="['timeline-item', { completed: step.isCompleted, recommended: step.isRecommended, ready: step.isReady }]"
        @click="handleNodeClick(step.id)"
      >
        <div class="timeline-connector">
          <div class="timeline-dot" :style="{ background: masteryColor(step.mastery) }">
            <v-icon v-if="step.isCompleted" icon="mdi-check" size="14" color="white" />
            <v-icon v-else-if="step.isRecommended" icon="mdi-star" size="14" color="white" />
          </div>
          <div v-if="index < visiblePath.length - 1" class="timeline-line"></div>
        </div>
        <div class="timeline-content">
          <div class="timeline-title">{{ step.title }}</div>
          <div class="timeline-mastery">
            <div class="mini-bar">
              <div class="mini-fill" :style="{ width: `${Math.round(step.mastery * 100)}%`, background: masteryColor(step.mastery) }"></div>
            </div>
            <span>{{ Math.round(step.mastery * 100) }}%</span>
          </div>
        </div>
      </div>
    </div>
    
    <div v-if="learningPath.length > 4" class="path-actions">
      <button class="toggle-path-btn" @click="showFullPath = !showFullPath">
        {{ showFullPath ? '收起完整路径' : '展开完整路径' }}
        <v-icon :icon="showFullPath ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="20" />
      </button>
    </div>

    <div v-if="learningPath.length === 0" class="empty-state">
      <p>暂无学习路径数据。开始对话后，系统会自动生成个性化学习路径。</p>
    </div>
  </div>
</template>

<style scoped>
.learning-path-panel {
  padding: 16px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
}

.path-header {
  margin-bottom: 16px;
}

.path-header h3 {
  margin: 0 0 12px;
  font-size: 1.1rem;
  font-weight: 600;
}

.path-progress {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-bar {
  flex: 1;
  height: 8px;
  background: #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4caf50, #8bc34a);
  border-radius: 4px;
  transition: width 0.3s;
}

.progress-label {
  font-size: 0.8rem;
  color: #666;
  white-space: nowrap;
}

.current-recommendation {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #e3f2fd;
  border-radius: 8px;
  margin-bottom: 16px;
}

.recommendation-icon {
  font-size: 1.5rem;
}

.recommendation-content {
  flex: 1;
}

.recommendation-label {
  font-size: 0.75rem;
  color: #4a90d9;
  font-weight: 500;
  margin-bottom: 2px;
}

.recommendation-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #333;
}

.recommendation-mastery {
  font-size: 0.8rem;
  color: #666;
  margin-top: 2px;
}

.path-timeline {
  display: flex;
  flex-direction: column;
}

.timeline-item {
  display: flex;
  gap: 12px;
  min-height: 60px;
}

.timeline-connector {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 24px;
  flex-shrink: 0;
}

.timeline-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  color: white;
  font-weight: 600;
  flex-shrink: 0;
}

.timeline-line {
  width: 2px;
  flex: 1;
  background: #e0e0e0;
  min-height: 12px;
}

.timeline-item.completed .timeline-line {
  background: #4caf50;
}

.timeline-content {
  flex: 1;
  padding-bottom: 12px;
}

.timeline-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
}

.timeline-item.completed .timeline-title {
  color: #999;
  text-decoration: line-through;
}

.timeline-item.recommended .timeline-title {
  color: #4a90d9;
  font-weight: 600;
}

.timeline-mastery {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mini-bar {
  flex: 1;
  max-width: 120px;
  height: 4px;
  background: #f0f0f0;
  border-radius: 2px;
  overflow: hidden;
}

.mini-fill {
  height: 100%;
  border-radius: 2px;
}

.timeline-mastery span {
  font-size: 0.75rem;
  color: #999;
  min-width: 30px;
}

.empty-state {
  text-align: center;
  padding: 24px;
  color: #999;
  font-size: 0.9rem;
}

.timeline-item {
  cursor: pointer;
  border-radius: 8px;
  padding: 4px;
  transition: background 0.2s;
}

.timeline-item:hover {
  background: #f8fafc;
}

.path-actions {
  display: flex;
  justify-content: center;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed #e2e8f0;
}

.toggle-path-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: #4a90d9;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 6px;
}

.toggle-path-btn:hover {
  background: #eff6ff;
}
</style>
