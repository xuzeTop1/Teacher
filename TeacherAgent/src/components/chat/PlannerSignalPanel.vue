<script setup lang="ts">
import type { PlannerResult } from "../../types/planner"

defineProps<{
  result: PlannerResult
}>()

function plannerSignalGroups(result: PlannerResult) {
  return [
    {
      key: "chapter",
      label: "章节路径",
      icon: "mdi-map-marker-path",
      color: "info",
      items: result.chapterSignals ?? []
    },
    {
      key: "mastery",
      label: "薄弱掌握",
      icon: "mdi-chart-bell-curve-cumulative",
      color: "warning",
      items: result.masterySignals
    },
    {
      key: "prerequisite",
      label: "前置依赖",
      icon: "mdi-graph-outline",
      color: "primary",
      items: result.prerequisiteSignals
    },
    {
      key: "review",
      label: "复习到期",
      icon: "mdi-calendar-clock",
      color: "success",
      items: result.reviewDueSignals
    }
  ].filter((group) => group.items.length)
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`
}
</script>

<template>
  <v-expansion-panels class="planner-panel" density="compact" variant="accordion">
    <v-expansion-panel>
      <v-expansion-panel-title>
        <v-icon icon="mdi-routes" size="18" />
        <span>规划信号</span>
        <v-chip size="x-small" variant="tonal" color="secondary">
          {{ formatConfidence(result.confidence) }}
        </v-chip>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <div class="planner-summary">
          {{ result.summary }}
        </div>

        <div class="planner-signal-grid">
          <section
            v-for="group in plannerSignalGroups(result)"
            :key="group.key"
            class="planner-signal-group"
          >
            <v-chip :prepend-icon="group.icon" :color="group.color" size="small" variant="tonal">
              {{ group.label }}
            </v-chip>
            <ul>
              <li v-for="item in group.items" :key="item">{{ item }}</li>
            </ul>
          </section>
        </div>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>
