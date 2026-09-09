<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import type { QuestionBankSearchOutput } from "../types/tool"
import { useAppStore } from "../stores/app"
import { usePackSelectionStore } from "../stores/packSelection"
import { useAlertTimeSyncStore } from "../stores/alertTimeSync"
import { bktUpdateMastery, saveAssessmentResult, ensureDefaultConversation } from "../services/tauri/commands"
import type { StudentKnowledgeMastery } from "../types/learning"
import type { PracticeSaveResult } from "../services/practice/practiceLogic"
import { submitPracticeAnswer } from "../services/practice/submitPracticeAnswer"
import { createPracticeDataLoader } from "../services/practice/practiceDataLoader"
import { recommendNextQuestion, getHintScaffoldingText, type RecommendationContext } from "../services/practice/questionRecommender"
import { decideQuestionScope, isTodayPlan, type QuestionScopeDecision } from "../engine/examTaxonomy/planScope"
import { resolvePracticeScope } from "../engine/examTaxonomy/practiceScope"
import { resolveLearnerGoalScope } from "../engine/examTaxonomy/learnerGoalScope"
import { toTrustedLearningAnalysisModel } from "../engine/sync/learningAnalysis"
import { getExamNode, getExamPath } from "../engine/examTaxonomy/registry"
import ExamScopeSelector, { type ExamScopeSelection } from "../components/practice/ExamScopeSelector.vue"
import PracticeQuestionCard from "../components/practice/PracticeQuestionCard.vue"
import PracticeFeedback from "../components/practice/PracticeFeedback.vue"

type PracticePhase = "select" | "attempt" | "feedback"

const appStore = useAppStore()
const packSelectionStore = usePackSelectionStore()
const alertTimeSyncStore = useAlertTimeSyncStore()
const subjectCode = computed(() => appStore.selectedSubject)
const phase = ref<PracticePhase>("select")
const questions = ref<QuestionBankSearchOutput["questions"]>([])
const currentIndex = ref(0)
const studentKnowledge = ref<StudentKnowledgeMastery[]>([])
const revealedHints = ref<Set<string>>(new Set())
const studentAnswer = ref("")
const showSolution = ref(false)
const saveStatus = ref<PracticeSaveResult | null>(null)
const practiceConversationId = ref<string | null>(null)
const recentResults = ref<Array<{ correct: boolean; hintsUsed: number }>>([])
const recommendedQuestion = ref<QuestionBankSearchOutput["questions"][number] | null>(null)
const isLoadingQuestions = ref(false)
const loadError = ref<string | null>(null)
const practiceDataLoader = createPracticeDataLoader()

/** 考试体系范围选择（默认不选择：保持旧行为按学科出题） */
const examSelection = ref<ExamScopeSelection>({
  trackId: null,
  subjectId: null,
  moduleId: null,
  comprehensive: false
})

/**
 * 今日计划范围决策：设备已选择并同步时，从读模型计算（规则见 planScope.ts）。
 * 可靠的唯一 today-plan 叶子会自动成为检索范围；手动选择仍然优先。
 */
const planDecision = computed<QuestionScopeDecision | null>(() => {
  const model = alertTimeSyncStore.readModel
  const deviceId = alertTimeSyncStore.selectedDeviceId
  if (!deviceId || !model) return null
  const nowMs = Date.now()
  const todayTasks = model.tasks.filter((task) => isTodayPlan(task, nowMs))
  return decideQuestionScope({
    todayTasks,
    subjects: model.subjects,
    mappings: alertTimeSyncStore.mappings.map((m) => ({
      alertSubjectRemoteId: m.alertSubjectRemoteId,
      teacherSubjectId: m.teacherSubjectId,
      examTrackId: m.examTrackId ?? null,
      examSubjectId: m.examSubjectId ?? null
    })),
    selection: {
      examTrackId: examSelection.value.trackId,
      subjectId: examSelection.value.subjectId,
      moduleId: examSelection.value.moduleId,
      comprehensive: examSelection.value.comprehensive
    },
    nowMs
  })
})

/** 只从当前快照绑定且结构校验通过的分析读取用户考试目标。 */
const learnerGoalScope = computed(() =>
  resolveLearnerGoalScope(
    toTrustedLearningAnalysisModel(
      alertTimeSyncStore.latestLearningAnalysis,
      alertTimeSyncStore.lastSnapshot?.snapshotId
    )
  )
)

/** 出题范围：手动选择/今日计划叶子/综合复习叶子，或无同步决策时的旧平面学科。 */
const activeExamScope = computed(() => {
  return resolvePracticeScope(examSelection.value, planDecision.value, learnerGoalScope.value)
})

const currentQuestion = computed(() => questions.value[currentIndex.value] ?? null)

const weakNodes = computed(() =>
  studentKnowledge.value
    .filter((k) => k.masteryProbability < 0.7)
    .sort((a, b) => a.masteryProbability - b.masteryProbability)
    .slice(0, 5)
)

// 计算平均掌握度；冷启动默认 0.5（中等水平）
const averageMastery = computed(() => {
  if (studentKnowledge.value.length === 0) return 0.5
  return studentKnowledge.value.reduce((sum, n) => sum + n.masteryProbability, 0) / studentKnowledge.value.length
})

async function loadPracticeData() {
  const requestedSubject = subjectCode.value
  practiceDataLoader.invalidate()
  // 重置练习状态
  phase.value = "select"
  currentIndex.value = 0
  studentKnowledge.value = []
  questions.value = []
  revealedHints.value.clear()
  studentAnswer.value = ""
  showSolution.value = false
  saveStatus.value = null
  recommendedQuestion.value = null
  recentResults.value = []
  loadError.value = null

  try {
    const conversation = await ensureDefaultConversation(requestedSubject)
    if (subjectCode.value === requestedSubject) {
      practiceConversationId.value = conversation.conversationId
    }
  } catch {
    // Tauri not available
  }

  await loadQuestions()
}

onMounted(loadPracticeData)

watch(() => appStore.selectedSubject, loadPracticeData)

// 同步可能在页面挂载后异步完成；只监听原子 marker/浅引用，避免遍历大型 sessions 读模型。
watch(
  [
    () => alertTimeSyncStore.selectedDeviceId,
    () => alertTimeSyncStore.lastSnapshot?.snapshotId ?? null,
    () => alertTimeSyncStore.readModel,
    () => alertTimeSyncStore.mappings
  ],
  () => {
    void loadQuestions()
  }
)

async function loadQuestions() {
  isLoadingQuestions.value = true
  loadError.value = null
  studentKnowledge.value = []
  questions.value = []
  currentIndex.value = 0

  const scopeResolution = activeExamScope.value
  const examScope = scopeResolution.examScope
  // 考试叶子范围：严格按叶子出题（approved + 归属校验）；否则保持旧学科行为。
  const subjectForSearch = examScope?.subjectId
    ? (getExamNode(examScope.subjectId)?.legacySubjectCode ?? subjectCode.value)
    : subjectCode.value
  const result = await practiceDataLoader.load({
    studentId: "local-default-student",
    subjectCode: subjectForSearch,
    blocked: scopeResolution.blocked,
    blockedMessage: scopeResolution.message,
    searchInput: {
      subject: subjectForSearch,
      enabledPackIds: packSelectionStore.getEnabledPackIds(subjectForSearch),
      purpose: "practice",
      topK: 10,
      excludeRecentlyUsed: false,
      examScope
    }
  })
  if (result.status === "stale") return

  studentKnowledge.value = result.snapshot.studentKnowledge
  questions.value = result.snapshot.questions
  loadError.value = result.snapshot.error
  isLoadingQuestions.value = false
}

function updateExamSelection(selection: ExamScopeSelection) {
  examSelection.value = selection
  void loadQuestions()
}

/** 使用今日计划范围：把决策中的叶子设置为选择范围（用户点击确认后生效）。 */
function useTodayPlanScope() {
  const decision = planDecision.value
  if (!decision?.subjectId) return
  examSelection.value = {
    trackId: decision.examTrackId,
    subjectId: decision.subjectId,
    moduleId: decision.moduleId,
    comprehensive: decision.mode === "comprehensive"
  }
  void loadQuestions()
}

/** 题目范围展示（本题属于：考试组 / 课程 / 模块）。 */
function questionScopeText(question: QuestionBankSearchOutput["questions"][number]): string | null {
  if (question.subjectId) {
    return formatQuestionScope(question.subjectId)
  }
  return null
}

function formatQuestionScope(stableId: string): string {
  const path = getExamPath(stableId)
  if (path.length === 0) return stableId
  return path.map((node) => node.displayName).join(" / ")
}

/** 推荐依据展示文本。 */
function recommendationBasisText(): string {
  if (planDecision.value?.mode === "today-plan" && !examSelection.value.subjectId) {
    return "推荐依据：今日计划"
  }
  if (examSelection.value.comprehensive) {
    return "推荐依据：综合复习策略"
  }
  if (examSelection.value.subjectId) {
    return "推荐依据：用户手动选择"
  }
  return "推荐依据：默认学科范围"
}

function startQuestion(index: number) {
  currentIndex.value = index
  phase.value = "attempt"
  revealedHints.value.clear()
  studentAnswer.value = ""
  showSolution.value = false
  saveStatus.value = null
  recommendedQuestion.value = null
}

function revealHint(hintId: string) {
  revealedHints.value.add(hintId)
}

async function submitAnswer() {
  phase.value = "feedback"
  saveStatus.value = null

  if (!currentQuestion.value) return

  saveStatus.value = await submitPracticeAnswer({
    question: currentQuestion.value,
    studentAnswer: studentAnswer.value,
    subjectCode: subjectCode.value,
    studentId: "local-default-student",
    revealedHintsCount: revealedHints.value.size,
    studentKnowledge: studentKnowledge.value,
    conversationId: practiceConversationId.value,
    bktUpdateMastery,
    saveAssessmentResult
  })

  // 记录答题结果用于自适应推荐（使用真实答题正确性，非保存状态）
  const isCorrect = saveStatus.value?.correct ?? false
  recentResults.value.push({
    correct: isCorrect,
    hintsUsed: revealedHints.value.size
  })

  // 推荐下一题
  updateRecommendation()
}

function updateRecommendation() {
  const context: RecommendationContext = {
    studentKnowledge: studentKnowledge.value,
    recentResults: recentResults.value,
    subjectCode: subjectCode.value
  }
  recommendedQuestion.value = recommendNextQuestion(context, questions.value)
}

function viewSolution() {
  showSolution.value = true
}

function nextQuestion() {
  // 如果有推荐题目，跳转到推荐题目
  if (recommendedQuestion.value) {
    const recommendedIndex = questions.value.findIndex(
      (q) => q.questionId === recommendedQuestion.value!.questionId
    )
    if (recommendedIndex >= 0) {
      startQuestion(recommendedIndex)
      return
    }
  }
  // 否则按顺序下一题
  if (currentIndex.value < questions.value.length - 1) {
    startQuestion(currentQuestion.value ? currentIndex.value + 1 : 0)
  } else {
    phase.value = "select"
  }
}

function startRecommendedQuestion() {
  if (!recommendedQuestion.value) return
  const recommendedIndex = questions.value.findIndex(
    (q) => q.questionId === recommendedQuestion.value!.questionId
  )
  if (recommendedIndex >= 0) {
    startQuestion(recommendedIndex)
  }
}

function backToList() {
  phase.value = "select"
  saveStatus.value = null
  recommendedQuestion.value = null
}

function difficultyLabel(d: number): string {
  return ["", "入门", "基础", "中等"][d] ?? "未知"
}

function hintLevelLabel(level: string): string {
  return getHintScaffoldingText(level as "L1" | "L2" | "L3")
}
</script>

<template>
  <div class="practice-view">
    <!-- Question List -->
    <div v-if="phase === 'select'" class="practice-list">
      <div class="practice-header">
        <p class="eyebrow">Practice Studio</p>
        <h2>练习模式</h2>
        <p v-if="weakNodes.length" class="practice-subtitle">
          根据你的掌握度，优先练习以下知识点
        </p>
        <p v-else class="practice-subtitle">
          选择一道题目开始练习
        </p>
      </div>

      <ExamScopeSelector
        :selection="examSelection"
        :plan-decision="planDecision"
        @update:selection="updateExamSelection"
        @use-plan="useTodayPlanScope"
      />

      <div v-if="learnerGoalScope.status === 'unmodeled'" class="goal-scope-warning">
        ⚠️ {{ learnerGoalScope.message }}
        <span v-if="!examSelection.subjectId">当前不会自动采用普通数学题库；请先显式选择具体 approved 叶子。</span>
        <span v-else>当前已使用你的显式具体叶子选择，系统不会将其改写为考研数学。</span>
      </div>

      <div v-if="weakNodes.length" class="weak-nodes-bar">
        <span
          v-for="node in weakNodes"
          :key="node.knowledgeNodeId"
          class="weak-node-tag"
        >
          {{ node.title }} ({{ Math.round(node.masteryProbability * 100) }}%)
        </span>
      </div>

      <div class="question-list">
        <div
          v-for="(q, index) in questions"
          :key="q.questionId"
          class="question-list-item"
          @click="startQuestion(index)"
        >
          <div class="question-list-item-header">
            <span class="question-title">{{ q.title ?? q.content.slice(0, 60) }}</span>
            <span :class="['difficulty-badge', `difficulty-${q.difficulty}`]">
              {{ difficultyLabel(q.difficulty) }}
            </span>
          </div>
          <div class="question-list-item-meta">
            <span class="question-type">{{ q.type }}</span>
            <span
              v-for="nodeId in q.knowledgeNodeIds.slice(0, 3)"
              :key="nodeId"
              class="knowledge-tag"
            >
              {{ nodeId }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="isLoadingQuestions" class="empty-state">
        <p>正在加载题目…</p>
      </div>

      <div v-else-if="loadError" class="empty-state">
        <p>⚠️ {{ loadError }}</p>
        <button class="action-button action-button-secondary" @click="loadQuestions">
          重试
        </button>
      </div>

      <div v-else-if="questions.length === 0" class="empty-state">
        <p>暂无可用题目。请先导入题库数据。</p>
      </div>
    </div>

    <!-- Question Attempt -->
    <div v-else-if="phase === 'attempt' && currentQuestion" class="practice-attempt">
      <div class="attempt-header">
        <button class="back-button" @click="backToList">← 返回题目列表</button>
        <span class="question-counter">
          {{ currentIndex + 1 }} / {{ questions.length }}
        </span>
      </div>

      <div v-if="questionScopeText(currentQuestion)" class="question-scope-banner">
        <strong>本题属于：</strong>{{ questionScopeText(currentQuestion) }}
        <span class="scope-basis">｜{{ recommendationBasisText() }}</span>
      </div>

      <PracticeQuestionCard
        :question="currentQuestion"
        :revealed-hints="revealedHints"
        @reveal-hint="revealHint"
      />

      <div class="answer-area">
        <label class="answer-label">你的解答：</label>
        <textarea
          v-model="studentAnswer"
          class="answer-input"
          placeholder="写下你的思路或答案..."
          rows="4"
        ></textarea>
        <div class="answer-actions">
          <button
            class="action-button action-button-primary"
            :disabled="!studentAnswer.trim()"
            @click="submitAnswer"
          >
            提交答案
          </button>
          <button
            class="action-button action-button-secondary"
            @click="viewSolution"
          >
            查看解析
          </button>
        </div>
      </div>
    </div>

    <!-- Feedback -->
    <div v-else-if="phase === 'feedback' && currentQuestion" class="practice-feedback">
      <div class="attempt-header">
        <button class="back-button" @click="backToList">← 返回题目列表</button>
        <span class="question-counter">
          {{ currentIndex + 1 }} / {{ questions.length }}
        </span>
      </div>

      <!-- 掌握度进度条 -->
      <div class="mastery-progress">
        <div class="mastery-bar">
          <div
            class="mastery-fill"
            :style="{ width: `${Math.round(averageMastery * 100)}%` }"
          ></div>
        </div>
        <span class="mastery-label">整体掌握度 {{ Math.round(averageMastery * 100) }}%</span>
      </div>

      <PracticeQuestionCard
        :question="currentQuestion"
        :revealed-hints="new Set(currentQuestion.hints.map(h => h.text))"
        :show-answer="showSolution"
      />

      <PracticeFeedback
        :question="currentQuestion"
        :student-answer="studentAnswer"
        :show-solution="showSolution"
      />

      <!-- 保存状态提示 -->
      <div v-if="saveStatus" :class="['save-status', saveStatus.success ? 'save-success' : 'save-error']">
        <template v-if="saveStatus.success">
          ✅ 掌握度已更新
        </template>
        <template v-else>
          ⚠️ 练习结果未保存：{{ saveStatus.error ?? '保存失败' }}
        </template>
      </div>

      <!-- 智能推荐下一题 -->
      <div v-if="recommendedQuestion" class="recommendation-card">
        <div class="recommendation-header">
          🎯 推荐下一题
        </div>
        <div class="recommendation-body">
          <div class="recommendation-question">
            <span class="recommendation-title">{{ recommendedQuestion.title ?? recommendedQuestion.content.slice(0, 60) }}</span>
            <span :class="['difficulty-badge', `difficulty-${recommendedQuestion.difficulty}`]">
              {{ difficultyLabel(recommendedQuestion.difficulty) }}
            </span>
          </div>
          <div class="recommendation-reason">
            根据你的掌握度和答题表现推荐
          </div>
          <button
            class="action-button action-button-primary"
            @click="startRecommendedQuestion"
          >
            开始练习推荐题目
          </button>
        </div>
      </div>

      <div class="feedback-actions">
        <button
          class="action-button action-button-primary"
          @click="nextQuestion"
        >
          {{ currentIndex < questions.length - 1 ? '下一题' : '完成练习' }}
        </button>
        <button
          class="action-button action-button-secondary"
          @click="viewSolution"
        >
          查看完整解析
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.practice-view {
  max-width: 1000px;
  width: 100%;
  margin: 0 auto;
  padding: 28px 34px 42px;
}

.practice-header {
  margin-bottom: 24px;
  padding: 26px;
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.92);
  box-shadow: 0 16px 34px rgba(44, 38, 27, 0.07);
}

.practice-header h2 {
  margin: 0 0 8px;
  font-size: 1.8rem;
  font-weight: 600;
}

.practice-subtitle {
  margin: 0;
  color: #666;
  font-size: 0.9rem;
}

.weak-nodes-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.weak-node-tag {
  display: inline-block;
  padding: 4px 10px;
  border: 1px solid rgba(214, 154, 45, 0.32);
  background: #fff7e7;
  color: #9b6416;
  border-radius: 8px;
  font-size: 0.8rem;
}

.question-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.question-list-item {
  padding: 16px;
  background: rgba(255, 253, 248, 0.94);
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}

.question-list-item:hover {
  border-color: var(--atlas-blue);
  box-shadow: 0 12px 26px rgba(44, 38, 27, 0.08);
  transform: translateY(-1px);
}

.question-list-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.question-title {
  font-weight: 500;
  font-size: 0.95rem;
}

.difficulty-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 500;
}

.difficulty-1 { background: #e8f5e9; color: #2e7d32; }
.difficulty-2 { background: var(--atlas-blue-soft); color: var(--atlas-navy); }
.difficulty-3 { background: #fff3e0; color: #9b6416; }

.question-list-item-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.question-type {
  font-size: 0.75rem;
  color: #999;
  text-transform: uppercase;
}

.knowledge-tag {
  font-size: 0.7rem;
  padding: 2px 6px;
  background: #f2eadc;
  border-radius: 4px;
  color: #666;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #999;
}

.goal-scope-warning {
  margin: 12px 0;
  padding: 12px 16px;
  border: 1px solid rgba(198, 40, 40, 0.35);
  border-radius: 8px;
  background: #fff4f2;
  color: #8f1d1d;
  line-height: 1.6;
}

.practice-attempt,
.practice-feedback {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.attempt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.back-button {
  background: none;
  border: none;
  color: #4a90d9;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 4px 0;
}

.back-button:hover {
  text-decoration: underline;
}

.question-counter {
  font-size: 0.85rem;
  color: #999;
}

.answer-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.answer-label {
  font-weight: 500;
  font-size: 0.9rem;
}

.answer-input {
  width: 100%;
  padding: 12px;
  border: 1px solid rgba(214, 207, 193, 0.9);
  border-radius: 8px;
  font-size: 0.95rem;
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
}

.answer-input:focus {
  outline: none;
  border-color: var(--atlas-blue);
  box-shadow: 0 0 0 3px rgba(46, 108, 183, 0.12);
}

.answer-actions,
.feedback-actions {
  display: flex;
  gap: 12px;
}

.action-button {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.2s;
}

.action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-button-primary {
  background: #4a90d9;
  color: white;
}

.action-button-primary:hover:not(:disabled) {
  background: #1565c0;
}

.action-button-secondary {
  background: #f5f5f5;
  color: #333;
  border: 1px solid #ddd;
}

.action-button-secondary:hover {
  background: #eee;
}

.save-status {
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
}

.save-success {
  background: #e8f5e9;
  color: #2e7d32;
}

.save-error {
  background: #fff3e0;
  color: #e65100;
}

/* 掌握度进度条 */
.mastery-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid rgba(214, 207, 193, 0.78);
  background: rgba(255, 253, 248, 0.92);
  border-radius: 8px;
}

/* 题目归属横幅（本题属于：考试组 / 课程 / 模块 + 推荐依据） */
.question-scope-banner {
  font-size: 0.85rem;
  color: #2e7d32;
  background: #f0f8f0;
  border: 1px solid rgba(46, 125, 50, 0.3);
  border-radius: 8px;
  padding: 8px 12px;
}

.scope-basis {
  color: #666;
}

.mastery-bar {
  flex: 1;
  height: 8px;
  background: #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
}

.mastery-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--atlas-green), #8bbf75);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.mastery-label {
  font-size: 0.85rem;
  color: #666;
  white-space: nowrap;
}

/* 智能推荐卡片 */
.recommendation-card {
  border: 1px solid rgba(46, 108, 183, 0.42);
  border-radius: 8px;
  overflow: hidden;
  background: #fffdf8;
}

.recommendation-header {
  background: linear-gradient(135deg, var(--atlas-navy), var(--atlas-blue));
  color: white;
  padding: 10px 16px;
  font-weight: 600;
  font-size: 0.95rem;
}

.recommendation-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.recommendation-question {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.recommendation-title {
  font-weight: 500;
  font-size: 0.95rem;
}

.recommendation-reason {
  font-size: 0.85rem;
  color: #666;
  font-style: italic;
}
</style>
