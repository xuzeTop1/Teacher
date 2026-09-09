<script setup lang="ts">
import { ref, watch, nextTick } from "vue"
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
import type { StudentKnowledgeMastery } from "../../types/learning"

// Register Chart.js components
ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const props = defineProps<{
  modelValue: boolean
  chartData: any
  chartOptions: any
  weakChapters: StudentKnowledgeMastery[]
}>()

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void
}>()

const isOpen = ref(props.modelValue)

watch(() => props.modelValue, (val) => {
  isOpen.value = val
})

watch(isOpen, (val) => {
  emit("update:modelValue", val)
  if (val) {
    // When opened, the chart might need a resize if the container size wasn't ready
    nextTick(() => {
      // chart.js in vue-chartjs automatically handles resize, but we provide a wrapper that flexes
    })
  }
})

function close() {
  isOpen.value = false
}

function masteryPercent(v: number): string {
  return `${Math.round(v * 100)}%`
}

// Chart options specialized for the large view
const largeChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    r: {
      beginAtZero: true,
      max: 100,
      ticks: {
        stepSize: 20,
        font: {
          size: 12
        }
      },
      pointLabels: {
        font: {
          size: 14,
          weight: 'bold' as const
        }
      }
    }
  },
  plugins: {
    legend: {
      display: false
    },
    tooltip: {
      bodyFont: {
        size: 14
      },
      titleFont: {
        size: 16
      }
    }
  }
}
</script>

<template>
  <v-dialog v-model="isOpen" max-width="1100" persistent>
    <div class="zoom-dialog-content">
      <div class="dialog-header">
        <h2 class="dialog-title">掌握度雷达图预览</h2>
        <button class="close-btn" @click="close" aria-label="关闭">
          <v-icon icon="mdi-close" size="24" />
        </button>
      </div>

      <div class="dialog-body">
        <div class="radar-container">
          <!-- We render the radar only when open to avoid resize issues in background -->
          <Radar v-if="isOpen" :data="chartData" :options="largeChartOptions" />
        </div>
        
        <div class="weak-chapters-panel">
          <h3>薄弱章节 TOP 5</h3>
          <p class="panel-desc">优先突破以下知识点可快速提升整体掌握度。</p>
          
          <div class="weak-list">
            <div v-for="(chapter, index) in weakChapters" :key="chapter.knowledgeNodeId" class="weak-item">
              <div class="item-rank">{{ index + 1 }}</div>
              <div class="item-content">
                <div class="item-title">{{ chapter.title }}</div>
                <div class="item-progress">
                  <div class="bar-bg">
                    <div class="bar-fill" :style="{ width: masteryPercent(chapter.masteryProbability) }"></div>
                  </div>
                  <span class="bar-text">{{ masteryPercent(chapter.masteryProbability) }}</span>
                </div>
              </div>
            </div>
            <div v-if="weakChapters.length === 0" class="empty-weak">
              太棒了，目前没有明显薄弱的章节！
            </div>
          </div>
        </div>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.zoom-dialog-content {
  background: #ffffff;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 90vh;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e2e8f0;
}

.dialog-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #3b78b5;
}

.close-btn {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  border-radius: 4px;
  padding: 4px;
}

.close-btn:hover {
  background: #f1f5f9;
  color: #334155;
}

.dialog-body {
  display: flex;
  flex-direction: row;
  padding: 24px;
  gap: 32px;
  min-height: 520px;
}

.radar-container {
  flex: 1;
  position: relative;
  min-width: 500px;
}

.weak-chapters-panel {
  width: 320px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #e2e8f0;
  padding-left: 32px;
}

.weak-chapters-panel h3 {
  margin: 0 0 8px;
  font-size: 1.1rem;
  color: #3b78b5;
}

.panel-desc {
  font-size: 0.9rem;
  color: #64748b;
  margin: 0 0 20px;
}

.weak-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.weak-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.item-rank {
  width: 24px;
  height: 24px;
  background: #ef4444;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 600;
  flex-shrink: 0;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 0.95rem;
  color: #334155;
  font-weight: 500;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bar-bg {
  flex: 1;
  height: 6px;
  background: #fee2e2;
  border-radius: 3px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: #ef4444;
  border-radius: 3px;
}

.bar-text {
  font-size: 0.85rem;
  color: #ef4444;
  font-weight: 500;
  width: 36px;
  text-align: right;
}

.empty-weak {
  color: #10b981;
  font-size: 0.95rem;
  padding: 16px 0;
}

@media (max-width: 900px) {
  .dialog-body {
    flex-direction: column;
  }
  
  .weak-chapters-panel {
    width: 100%;
    border-left: none;
    border-top: 1px solid #e2e8f0;
    padding-left: 0;
    padding-top: 24px;
  }
  
  .radar-container {
    min-width: 100%;
    height: 400px;
  }
}
</style>
