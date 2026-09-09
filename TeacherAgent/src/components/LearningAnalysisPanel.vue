<script setup lang="ts">
import { computed } from "vue"
import type { SyncLearningAnalysisDto } from "../types/sync"
import { formatLearningFactValue, learningAnalysisWarningLabel, toTrustedLearningAnalysisModel } from "../engine/sync/learningAnalysis"
import { resolveLearnerGoalScope } from "../engine/examTaxonomy/learnerGoalScope"

const props = defineProps<{ analysis: SyncLearningAnalysisDto | null | undefined; snapshotId: string | null | undefined }>()
const model = computed(() => toTrustedLearningAnalysisModel(props.analysis, props.snapshotId))
const learnerGoalScope = computed(() => resolveLearnerGoalScope(model.value))
const generatorLabel = computed(() => model.value?.generator === "android_llm" ? "Android LLM（手机端生成）" : model.value?.generator === "deterministic_fallback" ? "确定性降级（未使用模型）" : "未知")
const verdictLabel = computed(() => ({ reasonable: "计划基本合理", needs_adjustment: "计划需要调整", insufficient_data: "证据不足" }[model.value?.planEvaluation.verdict ?? "insufficient_data"] ?? "—"))
const generatedAtLabel = computed(() => model.value ? new Date(model.value.generatedAt).toLocaleString("zh-CN") : "—")
</script>

<template>
  <v-card variant="outlined" class="learning-analysis-panel mt-3">
    <v-card-title class="d-flex align-center"><v-icon start color="primary">mdi-account-school-outline</v-icon>本次同步学习分析</v-card-title>
    <v-card-text v-if="model">
      <div class="text-caption mb-2">生成器：{{ generatorLabel }} · Prompt：{{ model.promptVersion }} · 生成时间：{{ generatedAtLabel }}</div>
      <div class="text-caption mb-3">来源快照：{{ model.sourceSnapshotId }} · 分析 ID：{{ model.analysisId }}</div>
      <v-alert type="info" variant="tonal" density="compact" class="mb-3">
        计划评估与建议仅供参考，需由你明确决定是否采纳；TeacherAgent 不会自动修改手机计划或掌握度。
      </v-alert>
      <v-alert v-if="learnerGoalScope.status === 'unmodeled'" type="warning" variant="tonal" density="compact" class="mb-3">
        {{ learnerGoalScope.message }} 练习页不会自动把普通数学题库当作考研数学题库。
      </v-alert>
      <v-alert v-if="model.warnings.length > 0" type="warning" variant="tonal" density="compact" class="mb-3">
        <div v-for="warning in model.warnings" :key="warning">{{ learningAnalysisWarningLabel(warning) }}</div>
      </v-alert>
      <v-row>
        <v-col cols="12" md="6">
          <h3 class="text-subtitle-2 mb-2">手机同步事实</h3>
          <v-list v-if="model.facts.length > 0" density="compact" class="pa-0">
            <v-list-item v-for="fact in model.facts" :key="fact.code" class="px-0">
              <v-list-item-title>{{ fact.label }}：{{ formatLearningFactValue(fact.value) }}</v-list-item-title>
              <v-list-item-subtitle>证据：{{ fact.evidenceRefs.join("、") || "未提供" }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <div v-else class="text-body-2 text-medium-emphasis">暂无事实字段。</div>
        </v-col>
        <v-col cols="12" md="6">
          <h3 class="text-subtitle-2 mb-2">模型推断</h3>
          <v-list v-if="model.inferences.length > 0" density="compact" class="pa-0">
            <v-list-item v-for="inference in model.inferences" :key="inference.statement" class="px-0">
              <v-list-item-title>{{ inference.statement }}</v-list-item-title>
              <v-list-item-subtitle>置信度 {{ Math.round(inference.confidence * 100) }}% · 证据：{{ inference.evidenceRefs.join("、") || "未提供" }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <div v-else class="text-body-2 text-medium-emphasis">暂无模型推断。</div>
        </v-col>
      </v-row>
      <v-divider class="my-3" />
      <h3 class="text-subtitle-2 mb-2">计划合理性评估：{{ verdictLabel }}</h3>
      <div class="text-body-2 mb-2">评分：{{ model.planEvaluation.score === null ? "—" : `${model.planEvaluation.score}/100` }}</div>
      <v-list density="compact" class="pa-0"><v-list-item v-for="dimension in model.planEvaluation.dimensions" :key="dimension.code" class="px-0"><v-list-item-title>{{ dimension.summary }}</v-list-item-title><v-list-item-subtitle>维度 {{ dimension.code }} · {{ dimension.score === null ? "无评分" : `${dimension.score}/100` }}</v-list-item-subtitle></v-list-item></v-list>
      <div v-if="model.planEvaluation.risks.length > 0" class="text-body-2 mt-2">风险：{{ model.planEvaluation.risks.join("；") }}</div>
      <div v-if="model.planEvaluation.suggestions.length > 0" class="text-body-2 mt-1">建议：{{ model.planEvaluation.suggestions.join("；") }}</div>
      <v-divider class="my-3" />
      <h3 class="text-subtitle-2 mb-1">自评题草稿</h3>
      <v-alert type="info" variant="tonal" density="compact" class="mb-2">下面是让用户自省用的提示（只读，此页无需作答）：仅供用户自评与复习，不计入掌握度、不写入 assessment_results、不进入 approved 题库。真正进入掌握度的评估需先完成学科映射，再用 approved 题库诊断。</v-alert>
      <v-list v-if="model.draftQuestions.length > 0" density="compact" class="pa-0"><v-list-item v-for="question in model.draftQuestions" :key="question.questionId" class="px-0"><v-list-item-title>{{ question.prompt }}</v-list-item-title><v-list-item-subtitle>{{ question.rationale }} · 评分标准：{{ question.rubric.join("；") || "未提供" }}</v-list-item-subtitle></v-list-item></v-list>
      <div v-else class="text-body-2 text-medium-emphasis">本次没有生成自评题草稿。</div>
    </v-card-text>
    <v-card-text v-else><v-alert type="info" variant="tonal" density="compact">当前快照没有可展示的学习分析，或分析与快照不匹配。旧版手机快照仍可正常使用。</v-alert></v-card-text>
  </v-card>
</template>
