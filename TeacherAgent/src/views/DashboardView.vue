<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { loadStudentKnowledge, listConversations } from "../services/tauri/commands"
import type { StudentKnowledgeMastery } from "../types/learning"
import type { LocalConversation } from "../services/tauri/commands"
import { Radar } from "vue-chartjs"
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
} from "chart.js"
import LearningPathPanel from "../components/learning/LearningPathPanel.vue"
import KnowledgeDetailPanel from "../components/dashboard/KnowledgeDetailPanel.vue"
import RadarZoomDialog from "../components/dashboard/RadarZoomDialog.vue"
import { useAppStore } from "../stores/app"
import { usePackSelectionStore } from "../stores/packSelection"
import { subjectLabel } from "../utils/subject"
import { loadKnowledgePacksByIds, type KnowledgeSeedNode } from "../services/knowledge/packLoader"
import { buildPackMasteryRadar, chapterToLabel } from "../services/dashboard/dashboardMetrics"
import {
  isColdStartOverall,
  getRealOverallMastery,
  getMasteryLabel,
  hasInformativeMasteryEvidence
} from "../utils/mastery"

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const appStore = useAppStore()
const packSelectionStore = usePackSelectionStore()
const studentId = "local-default-student"
const subjectCode = computed(() => appStore.selectedSubject)
const knowledge = ref<StudentKnowledgeMastery[]>([])
const conversations = ref<LocalConversation[]>([])
const packNodesMap = ref<Map<string, KnowledgeSeedNode[]>>(new Map())

// State for side panel and modal
const selectedNodeId = ref<string | null>(null)
const isZoomOpen = ref(false)

const totalKnowledgeNodes = computed(() => {
  return packSelectionStore.getEnabledNodeCount(subjectCode.value) || knowledge.value.length || 1
})

const masteryGroups = computed(() => {
  // 冷启动和停留在 0.5 的 unknown 评估不参与分组，避免显示成“发展中 50%”
  const realKnowledge = knowledge.value.filter(hasInformativeMasteryEvidence)
  const groups = {
    strong: realKnowledge.filter((k) => k.masteryProbability >= 0.8).slice(0, 5),
    developing: realKnowledge.filter((k) => k.masteryProbability >= 0.4 && k.masteryProbability < 0.8).slice(0, 5),
    weak: realKnowledge.filter((k) => k.masteryProbability < 0.4).slice(0, 5)
  }
  return groups
})

const overallMastery = computed(() => getRealOverallMastery(knowledge.value))

const isColdStart = computed(() => isColdStartOverall(knowledge.value))

const hasRealPracticeData = computed(() => !isColdStart.value && knowledge.value.length > 0)

const totalAttempts = computed(() =>
  knowledge.value.reduce((acc, k) => acc + k.attemptsCount, 0)
)

const totalCorrect = computed(() =>
  knowledge.value.reduce((acc, k) => acc + k.correctCount, 0)
)

const accuracy = computed(() => {
  if (!totalAttempts.value) return 0
  return totalCorrect.value / totalAttempts.value
})

const coverageRate = computed(() => {
  if (!knowledge.value.length) return 0
  return knowledge.value.length / totalKnowledgeNodes.value
})

const summariesList = computed(() => {
  const enabledPacks = packSelectionStore.getEnabledPacks(subjectCode.value)
  return buildPackMasteryRadar(enabledPacks, packNodesMap.value, knowledge.value)
})

const radarChartData = computed(() => {
  const summaries = summariesList.value

  if (summaries.length === 0) {
    return {
      labels: ["暂无数据"],
      datasets: [{
        label: "掌握度",
        data: [0],
        backgroundColor: "rgba(25, 118, 210, 0.2)",
        borderColor: "#4a90d9",
        borderWidth: 2
      }]
    }
  }

  const display = summaries.slice(0, 12)

  return {
    labels: display.map((s) => chapterToLabel(s.chapter)),
    datasets: [{
      label: "章节掌握度",
      data: display.map((s) => Math.round(s.averageMastery * 100)),
      backgroundColor: "rgba(25, 118, 210, 0.2)",
      borderColor: "#4a90d9",
      borderWidth: 2,
      pointBackgroundColor: "#4a90d9",
      pointBorderColor: "#fff",
      pointHoverBackgroundColor: "#fff",
      pointHoverBorderColor: "#4a90d9"
    }]
  }
})

const radarChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    r: {
      beginAtZero: true,
      max: 100,
      ticks: {
        stepSize: 20,
        font: { size: 10 }
      },
      pointLabels: {
        font: { size: 10 }
      }
    }
  },
  plugins: {
    legend: { display: false }
  }
}

const top5WeakChapters = computed(() => {
  return [...summariesList.value]
    .sort((a, b) => a.averageMastery - b.averageMastery)
    .slice(0, 5)
    .map(s => ({
      knowledgeNodeId: s.chapter,
      title: chapterToLabel(s.chapter),
      masteryProbability: s.averageMastery
    } as unknown as StudentKnowledgeMastery))
})

const selectedKnowledge = computed(() => {
  if (!selectedNodeId.value) return null
  return knowledge.value.find(k => k.knowledgeNodeId === selectedNodeId.value) || null
})

const selectedNodeDetails = computed(() => {
  if (!selectedNodeId.value) return null
  let found: KnowledgeSeedNode | undefined
  for (const nodes of packNodesMap.value.values()) {
    found = nodes.find(n => n.id === selectedNodeId.value)
    if (found) break
  }
  return found || null
})

const selectedNodeDependents = computed(() => {
  if (!selectedNodeId.value || !packNodesMap.value) return []
  const deps: KnowledgeSeedNode[] = []
  for (const nodes of packNodesMap.value.values()) {
    for (const n of nodes) {
      if (n.prerequisites?.includes(selectedNodeId.value)) {
        deps.push(n)
      }
    }
  }
  return deps
})

async function loadDashboardData() {
  try {
    knowledge.value = await loadStudentKnowledge(studentId, subjectCode.value, 50)
    conversations.value = await listConversations(subjectCode.value, 20)
  } catch {
    // ignore
  }

  try {
    const enabledPackIds = packSelectionStore.getEnabledPackIds(subjectCode.value)
    const seeds = await loadKnowledgePacksByIds(enabledPackIds)
    const map = new Map<string, KnowledgeSeedNode[]>()
    for (const seed of seeds) {
      if (seed.__packId) {
        map.set(seed.__packId, seed.nodes)
      }
    }
    packNodesMap.value = map
  } catch {
    packNodesMap.value = new Map()
  }
}

onMounted(loadDashboardData)
watch(() => appStore.selectedSubject, loadDashboardData)

function masteryPercent(v: number): string {
  return `${Math.round(v * 100)}%`
}

function masteryBarColor(v: number): string {
  if (v >= 0.8) return "#4caf50"
  if (v >= 0.5) return "#ff9800"
  return "#f44336"
}



function handleNodeSelect(id: string) {
  selectedNodeId.value = id
}
</script>

<template>
  <div class="dashboard-layout">
    <div class="dashboard-main">
      <div class="dashboard-header">
        <p class="eyebrow">Learning Dashboard</p>
        <h2>学习仪表盘</h2>
        <p class="dashboard-subtitle">{{ subjectLabel(subjectCode) }} 的学习情况总览</p>
      </div>

      <!-- Cold Start Hint -->
      <div v-if="isColdStart && knowledge.length > 0" class="cold-start-hint">
        <p>数据还在初始化中，完成几次练习后会有更准确的评估。</p>
      </div>

      <!-- Summary Cards -->
      <div class="summary-cards">
        <div class="summary-card">
          <div class="summary-value">{{ hasRealPracticeData ? masteryPercent(overallMastery) : "暂无" }}</div>
          <div class="summary-label">{{ hasRealPracticeData ? "总掌握度" : "总掌握度（初始）" }}</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ knowledge.length }}</div>
          <div class="summary-label">{{ hasRealPracticeData ? "已学知识点" : "已初始化知识点" }}</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ masteryPercent(coverageRate) }}</div>
          <div class="summary-label">知识点覆盖</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ hasRealPracticeData ? masteryPercent(accuracy) : "暂无" }}</div>
          <div class="summary-label">练习正确率</div>
        </div>
      </div>

      <div class="dashboard-content-grid">
        <!-- Left Column in Main: Learning Path & Radar -->
        <div class="dashboard-column-left">
          <!-- Learning Path -->
          <div class="section">
            <LearningPathPanel :subject-code="subjectCode" @select-node="handleNodeSelect" />
          </div>

          <!-- Radar Chart (Smaller Summary) -->
          <div class="section radar-section">
            <div class="section-header-flex">
              <h3>章节掌握度概览</h3>
              <button class="zoom-btn" @click="isZoomOpen = true">
                <v-icon icon="mdi-magnify-plus-outline" size="18" class="mr-1" />
                放大查看
              </button>
            </div>
            <div class="radar-chart-container-small">
              <Radar :data="radarChartData" :options="radarChartOptions" />
            </div>
          </div>
        </div>

        <!-- Right Column in Main: Distribution Lists -->
        <div class="dashboard-column-right">
          <!-- Mastery Distribution (Top 5 limits) -->
          <div class="section">
            <h3>掌握度分布 (Top 5)</h3>
            <div class="mastery-distribution">
              <div class="mastery-group">
                <div class="mastery-group-header">
                  <span class="mastery-dot" style="background: #f44336"></span>
                  <span>待加强 (&lt;40%)</span>
                </div>
                <div class="mastery-items">
                  <div 
                    v-for="k in masteryGroups.weak" 
                    :key="k.knowledgeNodeId" 
                    class="mastery-item clickable"
                    :class="{ 'active': selectedNodeId === k.knowledgeNodeId }"
                    @click="handleNodeSelect(k.knowledgeNodeId)"
                  >
                    <span class="mastery-item-title">{{ k.title }}</span>
                    <div class="mastery-bar-container">
                      <div class="mastery-bar" :style="{ width: masteryPercent(k.masteryProbability), background: masteryBarColor(k.masteryProbability) }"></div>
                    </div>
                    <span class="mastery-item-percent">{{ masteryPercent(k.masteryProbability) }}</span>
                  </div>
                  <div v-if="masteryGroups.weak.length === 0" class="empty-list-hint">暂无知识点</div>
                </div>
              </div>

              <div class="mastery-group">
                <div class="mastery-group-header">
                  <span class="mastery-dot" style="background: #ff9800"></span>
                  <span>发展中 (40-79%)</span>
                </div>
                <div class="mastery-items">
                  <div 
                    v-for="k in masteryGroups.developing" 
                    :key="k.knowledgeNodeId" 
                    class="mastery-item clickable"
                    :class="{ 'active': selectedNodeId === k.knowledgeNodeId }"
                    @click="handleNodeSelect(k.knowledgeNodeId)"
                  >
                    <span class="mastery-item-title">{{ k.title }}</span>
                    <div class="mastery-bar-container">
                      <div class="mastery-bar" :style="{ width: masteryPercent(k.masteryProbability), background: masteryBarColor(k.masteryProbability) }"></div>
                    </div>
                    <span class="mastery-item-percent">{{ masteryPercent(k.masteryProbability) }}</span>
                  </div>
                  <div v-if="masteryGroups.developing.length === 0" class="empty-list-hint">暂无知识点</div>
                </div>
              </div>

              <div class="mastery-group">
                <div class="mastery-group-header">
                  <span class="mastery-dot" style="background: #4caf50"></span>
                  <span>已掌握 (≥80%)</span>
                </div>
                <div class="mastery-items">
                  <div 
                    v-for="k in masteryGroups.strong" 
                    :key="k.knowledgeNodeId" 
                    class="mastery-item clickable"
                    :class="{ 'active': selectedNodeId === k.knowledgeNodeId }"
                    @click="handleNodeSelect(k.knowledgeNodeId)"
                  >
                    <span class="mastery-item-title">{{ k.title }}</span>
                    <div class="mastery-bar-container">
                      <div class="mastery-bar" :style="{ width: masteryPercent(k.masteryProbability), background: masteryBarColor(k.masteryProbability) }"></div>
                    </div>
                    <span class="mastery-item-percent">{{ masteryPercent(k.masteryProbability) }}</span>
                  </div>
                  <div v-if="masteryGroups.strong.length === 0" class="empty-list-hint">暂无知识点</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Right Detail Panel -->
    <div class="dashboard-sidebar">
      <KnowledgeDetailPanel 
        :node="selectedNodeDetails" 
        :mastery="selectedKnowledge"
        :dependents="selectedNodeDependents"
        @close="selectedNodeId = null"
      />
    </div>

    <RadarZoomDialog 
      v-model="isZoomOpen"
      :chartData="radarChartData"
      :chartOptions="radarChartOptions"
      :weakChapters="top5WeakChapters"
    />
  </div>
</template>

<style scoped>
.dashboard-layout {
  display: flex;
  height: 100%;
  width: 100%;
}

.dashboard-main {
  flex: 1;
  max-width: 1200px;
  padding: 28px 34px 42px;
  min-width: 0; /* allows flex children to shrink */
  /* We let .app-content handle scroll */
}

.dashboard-sidebar {
  width: 340px;
  flex-shrink: 0;
  border-left: 1px solid rgba(214, 207, 193, 0.86);
  background: #fffdf8;
  height: calc(100vh - 40px);
  position: sticky;
  top: 0;
}

.dashboard-header {
  margin-bottom: 24px;
  padding: 26px;
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.92);
  box-shadow: 0 16px 34px rgba(44, 38, 27, 0.07);
}

.dashboard-header h2 {
  margin: 0 0 4px;
  font-size: 1.8rem;
  font-weight: 600;
}

.dashboard-subtitle {
  margin: 0;
  color: #666;
  font-size: 0.9rem;
}

.cold-start-hint {
  background: #fff8e1;
  border: 1px solid #ffe082;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 0.85rem;
  color: #795548;
}

.cold-start-hint p {
  margin: 0;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.summary-card {
  padding: 20px 16px;
  background: rgba(255, 253, 248, 0.94);
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  text-align: center;
  box-shadow: 0 10px 22px rgba(44, 38, 27, 0.04);
}

.summary-value {
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--atlas-navy);
}

.summary-label {
  font-size: 0.85rem;
  color: #64748b;
  margin-top: 6px;
}

.dashboard-content-grid {
  display: flex;
  gap: 32px;
}

.dashboard-column-left {
  flex: 3;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.dashboard-column-right {
  flex: 2;
  min-width: 0;
}

.section h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 16px;
  color: var(--atlas-navy);
}

.section-header-flex {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header-flex h3 {
  margin: 0;
}

.zoom-btn {
  display: flex;
  align-items: center;
  background: #fffdf8;
  border: 1px solid rgba(214, 207, 193, 0.86);
  color: #475569;
  font-size: 0.85rem;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.zoom-btn:hover {
  background: var(--atlas-blue-soft);
  color: var(--atlas-navy);
}

.mr-1 {
  margin-right: 4px;
}

.radar-chart-container-small {
  background: rgba(255, 253, 248, 0.94);
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  padding: 16px;
  height: 280px;
}

.mastery-distribution {
  display: flex;
  flex-direction: column;
  gap: 24px;
  background: rgba(255, 253, 248, 0.94);
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  padding: 20px;
}

.mastery-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 600;
  font-size: 0.95rem;
  color: #334155;
}

.mastery-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mastery-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mastery-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 6px;
  transition: background 0.2s;
}

.mastery-item.clickable {
  cursor: pointer;
}

.mastery-item.clickable:hover {
  background: #faf6ed;
}

.mastery-item.active {
  background: var(--atlas-blue-soft);
  border-left: 3px solid var(--atlas-blue);
  padding-left: 5px;
}

.mastery-item-title {
  font-size: 0.85rem;
  width: 100px;
  color: #334155;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mastery-bar-container {
  flex: 1;
  height: 6px;
  background: #e2e8f0;
  border-radius: 3px;
  overflow: hidden;
}

.mastery-bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s;
}

.mastery-item-percent {
  font-size: 0.8rem;
  color: #64748b;
  width: 40px;
  text-align: right;
  font-weight: 500;
  white-space: nowrap;
}

.empty-list-hint {
  font-size: 0.85rem;
  color: #94a3b8;
  padding-left: 8px;
  font-style: italic;
}

@media (max-width: 900px) {
  .dashboard-content-grid {
    flex-direction: column;
  }
  
  .dashboard-sidebar {
    display: none; /* Hide sidebar on small screens or convert to drawer in future */
  }
}
</style>
