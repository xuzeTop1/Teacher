<script setup lang="ts">
/**
 * 考试范围选择器：考试组 → 具体课程 → 模块 + 综合复习入口 + 今日计划映射状态。
 *
 * 硬约束：
 * - 只允许选择到叶子 SUBJECT/MODULE 后出题；父级考试组不能直接当课程；
 * - 「今日计划」只显示可解释的依据，不能伪造；
 * - 综合复习模式必须展示当前实际选择的子科目。
 */
import { computed } from "vue"
import {
  getExamChildren,
  getExamNode,
  getExamTracks,
  formatExamPath
} from "../../engine/examTaxonomy/registry"
import type { QuestionScopeDecision } from "../../engine/examTaxonomy/planScope"
import type { ExamCatalogNode } from "../../engine/examTaxonomy/catalogTypes"

export interface ExamScopeSelection {
  trackId: string | null
  subjectId: string | null
  moduleId: string | null
  comprehensive: boolean
}

const props = defineProps<{
  selection: ExamScopeSelection
  /** 今日计划范围决策（父组件计算传入；null 表示没有同步设备/数据） */
  planDecision: QuestionScopeDecision | null
}>()

const emit = defineEmits<{
  "update:selection": [value: ExamScopeSelection]
  "use-plan": []
}>()

const tracks = getExamTracks()

const subjects = computed<ExamCatalogNode[]>(() =>
  props.selection.trackId ? getExamChildren(props.selection.trackId) : []
)

const modules = computed<ExamCatalogNode[]>(() =>
  props.selection.subjectId ? getExamChildren(props.selection.subjectId) : []
)

const selectedSubjectLabel = computed(() => {
  if (!props.selection.subjectId) return null
  const node = getExamNode(props.selection.subjectId)
  return node ? formatExamPath(node.stableId) : null
})

function update(patch: Partial<ExamScopeSelection>) {
  emit("update:selection", { ...props.selection, ...patch })
}

function selectTrack(trackId: string) {
  update({ trackId, subjectId: null, moduleId: null, comprehensive: false })
}

function selectSubject(subjectId: string) {
  update({ subjectId, moduleId: null, comprehensive: false })
}

const planModeLabel = computed(() => {
  const decision = props.planDecision
  if (!decision) return null
  const labels: Record<string, string> = {
    explicit: "用户手动选择",
    "today-plan": "今日计划驱动",
    comprehensive: "综合复习策略",
    "requires-choice": "需要选择具体课程",
    "no-plan": "没有今日计划"
  }
  return labels[decision.mode] ?? decision.mode
})

const planModeColor = computed(() => {
  const decision = props.planDecision
  if (!decision) return null
  if (decision.mode === "today-plan" || decision.mode === "comprehensive") return "success"
  if (decision.mode === "requires-choice") return "warning"
  return "grey"
})
</script>

<template>
  <div class="exam-scope-selector">
    <div class="scope-row">
      <label class="scope-label">考试组</label>
      <select
        class="scope-select"
        :value="selection.trackId ?? ''"
        @change="selectTrack(($event.target as HTMLSelectElement).value)"
      >
        <option value="">— 选择考试组 —</option>
        <option v-for="track in tracks" :key="track.stableId" :value="track.stableId">
          {{ track.code ? `${track.code} · ` : "" }}{{ track.displayName }}
        </option>
      </select>

      <label class="scope-label">具体课程</label>
      <select
        class="scope-select"
        :value="selection.subjectId ?? ''"
        :disabled="subjects.length === 0"
        @change="selectSubject(($event.target as HTMLSelectElement).value)"
      >
        <option value="">— 选择具体课程 —</option>
        <option v-for="subject in subjects" :key="subject.stableId" :value="subject.stableId">
          {{ subject.displayName }}{{ subject.status === "draft" ? "（题库待审核）" : "" }}
        </option>
      </select>

      <template v-if="modules.length > 0">
        <label class="scope-label">模块</label>
        <select
          class="scope-select"
          :value="selection.moduleId ?? ''"
          @change="update({ moduleId: ($event.target as HTMLSelectElement).value || null })"
        >
          <option value="">— 选择模块 —</option>
          <option v-for="module in modules" :key="module.stableId" :value="module.stableId">
            {{ module.displayName }}
          </option>
        </select>
      </template>

      <button
        v-if="selection.trackId && !selection.subjectId"
        class="action-button action-button-secondary scope-comprehensive"
        :class="{ 'scope-comprehensive-active': selection.comprehensive }"
        @click="update({ comprehensive: !selection.comprehensive })"
      >
        {{ selection.comprehensive ? "综合复习模式 ✓" : "进入综合复习" }}
      </button>
    </div>

    <div v-if="selectedSubjectLabel" class="scope-banner">
      <strong>当前出题范围：</strong>{{ selectedSubjectLabel }}
      <template v-if="selection.comprehensive">（综合复习模式）</template>
    </div>
    <div v-else-if="selection.trackId && !selection.comprehensive" class="scope-banner scope-banner-warn">
      已选择考试组，请选择具体课程，或进入「综合复习」模式。
      父级考试组不能直接作为出题范围。
    </div>

    <div v-if="planDecision" class="plan-evidence">
      <span :class="['plan-badge', planModeColor ?? 'grey']">📋 {{ planModeLabel }}</span>
      <span class="plan-text">{{ planDecision.evidenceText }}</span>
      <button
        v-if="planDecision.mode === 'today-plan' && planDecision.subjectId"
        class="action-button action-button-primary scope-use-plan"
        @click="emit('use-plan')"
      >
        使用今日计划范围
      </button>
    </div>
    <div v-else class="plan-evidence plan-evidence-empty">
      <span class="plan-badge grey">📋 今日计划</span>
      <span class="plan-text">尚未同步手机数据；请在「AlertTime 同步」页选择设备并同步后，这里会显示今日计划驱动出题。</span>
    </div>
  </div>
</template>

<style scoped>
.exam-scope-selector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
  padding: 14px 16px;
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.92);
}

.scope-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.scope-label {
  font-size: 0.8rem;
  color: #666;
  white-space: nowrap;
}

.scope-select {
  padding: 6px 8px;
  border: 1px solid rgba(214, 207, 193, 0.9);
  border-radius: 6px;
  font-size: 0.85rem;
  background: white;
  max-width: 220px;
}

.scope-comprehensive {
  padding: 6px 12px;
  font-size: 0.8rem;
}

.scope-comprehensive-active {
  background: #e8f5e9;
  color: #2e7d32;
  border-color: #2e7d32;
}

.scope-banner {
  font-size: 0.85rem;
  color: #2e7d32;
  background: #f0f8f0;
  border-radius: 6px;
  padding: 6px 10px;
}

.scope-banner-warn {
  color: #9b6416;
  background: #fff7e7;
}

.plan-evidence {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 0.85rem;
}

.plan-evidence-empty {
  color: #999;
}

.plan-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

.plan-badge.success { background: #e8f5e9; color: #2e7d32; }
.plan-badge.warning { background: #fff7e7; color: #9b6416; }
.plan-badge.grey { background: #f0f0f0; color: #666; }

.plan-text {
  flex: 1;
  color: #555;
}

.scope-use-plan {
  padding: 6px 12px;
  font-size: 0.8rem;
}
</style>
