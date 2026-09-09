<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { deleteOrphanKnowledgeNodes, listOllamaModels } from "../../services/tauri/commands"
import { useAppStore } from "../../stores/app"
import { syncApprovedManifest } from "../../services/tauri/commands"
import { subjectLabel } from "../../utils/subject"
import {
  getPackSubjectSummary,
  getPackList,
  compareManifestWithDatabase,
  runApprovedHealthCheck,
  getCatalogStatistics,
  type PackSummary,
  type PackListItem,
  type PackDatabaseComparison,
  type HealthCheckResult,
  type CatalogStatistics
} from "../../services/knowledge/packStatus"
import { PACK_MANIFEST } from "../../services/knowledge/packManifest"
import { validateKnowledgePacks, type ValidationResult } from "../../services/knowledge/packValidator"
import { usePackSelectionStore } from "../../stores/packSelection"
import {
  generateSeedEmbeddings,
  getEmbeddingModelInventory,
  getTotalEmbeddingCount,
  classifySeedEmbeddingCoverage,
  KNOWN_EMBEDDING_MODELS,
  type EmbeddingModelInventory,
  type SeedEmbeddingProgress
} from "../../services/knowledge/seedEmbeddingService"

const appStore = useAppStore()
const packSelectionStore = usePackSelectionStore()

// ── 知识库管理状态 ──────────────────────────────────────────────────────

const packSummaries = ref<PackSummary[]>([])
const packListItems = ref<PackListItem[]>([])
const dbComparison = ref<PackDatabaseComparison | null>(null)
const validationResult = ref<ValidationResult | null>(null)
const catalogStats = ref<CatalogStatistics | null>(null)

const knowledgeStatus = ref<"idle" | "loading" | "success" | "error">("idle")
const knowledgeMessage = ref("")
const seedStatus = ref<"idle" | "loading" | "success" | "error">("idle")
const seedMessage = ref("")
const validateStatus = ref<"idle" | "loading" | "success" | "error">("idle")
const validateMessage = ref("")
const healthStatus = ref<"idle" | "loading" | "success" | "warning" | "error">("idle")
const healthMessage = ref("")
const healthResult = ref<HealthCheckResult | null>(null)
const syncStatus = ref<"idle" | "loading" | "success" | "error">("idle")
const syncMessage = ref("")
const orphanCleanupStatus = ref<"idle" | "loading" | "success" | "error">("idle")
const orphanCleanupMessage = ref("")

// Embedding 生成状态
const embeddingStatus = ref<"idle" | "loading" | "success" | "error">("idle")
const embeddingMessage = ref("")
const embeddingProgress = ref<SeedEmbeddingProgress>({ phase: "loading_nodes", current: 0, total: 0, stored: 0, failed: 0, message: "" })
const embeddingCounts = ref({ knowledge: 0, questions: 0, total: 0 })
const embeddingInventory = ref<EmbeddingModelInventory[]>([])
const embeddingModel = ref(appStore.embeddingConfig?.embeddingModel ?? "text-embedding-3-small")
const showEmbeddingConfirmDialog = ref(false)
const ollamaEmbeddingStatus = ref<"idle" | "loading" | "success" | "warning" | "error">("idle")
const ollamaEmbeddingMessage = ref("")
const ollamaModelNames = ref<string[]>([])

// Alert visibility (independent of status, so closing doesn't lose status data)
const showKnowledgeAlert = ref(true)
const showSeedAlert = ref(true)
const showValidateAlert = ref(true)
const showHealthAlert = ref(true)
const showSyncAlert = ref(true)
const showOrphanCleanupAlert = ref(true)
const showOllamaEmbeddingAlert = ref(true)
const showEmbeddingAlert = ref(true)

const totalPacks = computed(() => PACK_MANIFEST.length)
const totalExpectedNodes = computed(() => packSummaries.value.reduce((s, r) => s + r.expectedNodeCount, 0))
const totalExpectedQuestions = computed(() => packSummaries.value.reduce((s, r) => s + r.expectedQuestionCount, 0))

// Approved/draft dual statistics
const approvedPacks = computed(() => catalogStats.value?.approvedPacks ?? 0)
const approvedNodes = computed(() => catalogStats.value?.approvedNodes ?? 0)
const approvedQuestions = computed(() => catalogStats.value?.approvedQuestions ?? 0)
const draftPacks = computed(() => catalogStats.value?.draftPacks ?? 0)
const draftNodes = computed(() => catalogStats.value?.draftNodes ?? 0)
const draftQuestions = computed(() => catalogStats.value?.draftQuestions ?? 0)

// Pack 启用范围 computed
const currentSubjectPacks = computed(() => packSelectionStore.getSubjectPacks(appStore.selectedSubject))
const currentEnabledPackIds = computed(() => packSelectionStore.getEnabledPackIds(appStore.selectedSubject))
const currentEnabledNodeCount = computed(() => packSelectionStore.getEnabledNodeCount(appStore.selectedSubject))
const currentEnabledQuestionCount = computed(() => packSelectionStore.getEnabledQuestionCount(appStore.selectedSubject))
const expectedEmbeddingCount = computed(() => approvedNodes.value + approvedQuestions.value)
const embeddingCount = computed(() => embeddingCounts.value.total)
const embeddingCoverageState = computed(() =>
  classifySeedEmbeddingCoverage(embeddingCount.value, expectedEmbeddingCount.value)
)
const embeddingCoverageType = computed(() => {
  if (embeddingCoverageState.value === "complete") return "success"
  if (embeddingCoverageState.value === "empty") return "info"
  return "warning"
})
const embeddingCoverageMessage = computed(() => {
  const counts = embeddingCounts.value
  const detail = `${counts.knowledge} 个知识节点 + ${counts.questions} 道题 = ${counts.total} 条`
  if (embeddingCoverageState.value === "empty") {
    return `模型 ${embeddingModel.value} 尚无向量记录；正式内容目标为 ${expectedEmbeddingCount.value} 条。`
  }
  if (embeddingCoverageState.value === "complete") {
    return `已检测到完整向量库：${embeddingModel.value} · ${detail}，与当前 approved 目标一致，无需重复生成。`
  }
  if (embeddingCoverageState.value === "incomplete") {
    return `检测到未完成的向量库：${embeddingModel.value} · ${detail}，当前 approved 目标为 ${expectedEmbeddingCount.value} 条。`
  }
  return `检测到需收敛的旧向量库：${embeddingModel.value} · ${detail}，超过当前 approved 目标 ${expectedEmbeddingCount.value} 条。重新生成会清理内置 draft 向量并保留私有/自定义内容。`
})
const detectedEmbeddingModels = computed(() => {
  const installed = new Set(ollamaModelNames.value.map(normalizeOllamaModelName))
  return ["bge-m3", "nomic-embed-text", "mxbai-embed-large"].filter((model) => installed.has(model))
})

// ── 知识库管理函数 ──────────────────────────────────────────────────────

async function refreshKnowledgeStatus() {
  showKnowledgeAlert.value = true
  knowledgeStatus.value = "loading"
  knowledgeMessage.value = "正在加载知识库状态..."

  try {
    packSummaries.value = getPackSubjectSummary()
    packListItems.value = getPackList()
    dbComparison.value = await compareManifestWithDatabase()
    catalogStats.value = getCatalogStatistics()

    knowledgeStatus.value = "success"
    knowledgeMessage.value = `正式内容：${approvedPacks.value} Pack / ${approvedNodes.value} 节点 / ${approvedQuestions.value} 题 | 待审核：${draftPacks.value} Pack / ${draftNodes.value} 节点 / ${draftQuestions.value} 题`
  } catch (error) {
    knowledgeStatus.value = "error"
    knowledgeMessage.value = `加载失败: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function handleSeedAll() {
  showSeedAlert.value = true
  seedStatus.value = "loading"
  seedMessage.value = "正在 seed 正式（approved）知识节点..."

  try {
    const result = await syncApprovedManifest()

    seedStatus.value = result.errors.length > 0 ? "error" : "success"
    if (result.errors.length > 0) {
      seedMessage.value = `Seed 完成，但有 ${result.errors.length} 个错误`
    } else if (result.updated > 0) {
      seedMessage.value = `Seed 完成：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`
    } else {
      seedMessage.value = `Seed 完成：新增 ${result.inserted}，跳过 ${result.skipped}`
    }

    // 刷新状态
    await refreshKnowledgeStatus()
  } catch (error) {
    seedStatus.value = "error"
    seedMessage.value = `Seed 失败: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function handleValidate() {
  showValidateAlert.value = true
  validateStatus.value = "loading"
  validateMessage.value = "正在校验 Pack..."
  validationResult.value = null

  try {
    const result = await validateKnowledgePacks()
    validationResult.value = result

    if (result.ok) {
      validateStatus.value = "success"
      validateMessage.value = `校验通过：${result.summary.packCount} 个 pack，${result.summary.nodeCount} 个节点，${result.summary.questionCount} 道题目`
    } else {
      validateStatus.value = "error"
      validateMessage.value = `校验发现 ${result.errors.length} 个错误，${result.warnings.length} 个警告`
    }
  } catch (error) {
    validateStatus.value = "error"
    validateMessage.value = `校验失败: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function handleHealthCheck() {
  showHealthAlert.value = true
  healthStatus.value = "loading"
  healthMessage.value = "正在检查正式内容健康状态..."
  healthResult.value = null

  try {
    const result = await runApprovedHealthCheck()
    healthResult.value = result

    if (result.safeToSync) {
      healthStatus.value = "success"
      healthMessage.value = `正式内容已同步，无异常。共 ${result.totalExpected} 个正式节点，${result.totalDb} 个已入库。`
    } else {
      healthStatus.value = "warning"
      healthMessage.value = result.message
    }
  } catch (error) {
    healthStatus.value = "error"
    healthMessage.value = `健康检查失败: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function handleSync() {
  showSyncAlert.value = true
  syncStatus.value = "loading"
  syncMessage.value = "正在同步知识库..."

  try {
    const result = await syncApprovedManifest()

    if (result.errors.length > 0) {
      syncStatus.value = "error"
      syncMessage.value = `同步完成，但有 ${result.errors.length} 个错误`
    } else {
      syncStatus.value = "success"
      syncMessage.value = `同步完成：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`
    }

    // 同步后自动刷新健康检查
    await handleHealthCheck()
    await refreshKnowledgeStatus()
  } catch (error) {
    syncStatus.value = "error"
    syncMessage.value = `同步失败: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function handleGenerateEmbeddings() {
  showEmbeddingAlert.value = true
  const savedEmbeddingConfig = appStore.embeddingConfig?.embeddingModel === embeddingModel.value
    ? appStore.embeddingConfig
    : null
  const isLocalOllama = detectedEmbeddingModels.value.includes(embeddingModel.value)
    || Boolean(savedEmbeddingConfig?.baseUrl.includes("localhost:11434")
      || savedEmbeddingConfig?.baseUrl.includes("127.0.0.1:11434"))

  let embeddingConfig: { baseUrl: string; apiKeyRef: string; embeddingModel: string }
  if (savedEmbeddingConfig?.apiKeyRef && savedEmbeddingConfig.baseUrl) {
    embeddingConfig = {
      baseUrl: savedEmbeddingConfig.baseUrl,
      apiKeyRef: savedEmbeddingConfig.apiKeyRef,
      embeddingModel: embeddingModel.value
    }
  } else if (isLocalOllama) {
    embeddingConfig = {
      baseUrl: "http://localhost:11434/v1",
      apiKeyRef: "ollama-local",
      embeddingModel: embeddingModel.value
    }
  } else {
    const config = appStore.activeProviderConfig
    if (!config?.apiKeyRef || !config?.baseUrl) {
      embeddingStatus.value = "error"
      embeddingMessage.value = "请先配置 LLM Provider（需要支持 Embedding 的 API，如 OpenAI text-embedding-3-small 或 Ollama bge-m3）"
      return
    }
    embeddingConfig = {
      baseUrl: config.baseUrl,
      apiKeyRef: config.apiKeyRef,
      embeddingModel: embeddingModel.value
    }
  }

  embeddingStatus.value = "loading"
  if (isLocalOllama) {
    embeddingMessage.value = "将使用本地 Ollama v1 · localhost 生成正式内容 Embedding..."
  } else {
    embeddingMessage.value = "正在生成正式内容 Embedding..."
  }

  try {
    const result = await generateSeedEmbeddings(
      embeddingConfig,
      (progress: SeedEmbeddingProgress) => {
        embeddingProgress.value = progress
        embeddingMessage.value = progress.message
      }
    )

    embeddingStatus.value = "success"
    embeddingMessage.value = `Embedding 生成完成：${result.stored} 条已存储，${result.failed} 条失败（${result.totalNodes} 条 approved 内容，清理 ${result.cleanedStale} 条旧向量）`

    // Persist the embedding config so chat queries use the same model/endpoint as generation.
    // Without this, queries could fall back to a different model (e.g. bge-m3 default) while
    // vectors were generated with text-embedding-3-small, causing empty results.
    appStore.setEmbeddingConfig(embeddingConfig)

    // 刷新计数
    await refreshEmbeddingInventory()
  } catch (error) {
    embeddingStatus.value = "error"
    const raw = error instanceof Error ? error.message : String(error)
    if (isLocalOllama) {
      if (raw.includes("连接") || raw.includes("ECONNREFUSED") || raw.includes("fetch")) {
        embeddingMessage.value = "请先启动 Ollama 并拉取 Embedding 模型（如 ollama pull bge-m3）。"
      } else {
        embeddingMessage.value = `Ollama Embedding 生成失败: ${raw}。请确认 Ollama 正在运行且模型已就绪。`
      }
    } else if (raw.includes("不支持 Embedding") || raw.includes("预检失败") || raw.includes("认证失败") || raw.includes("不被当前 Provider 支持")) {
      embeddingMessage.value = raw
    } else {
      embeddingMessage.value = `Embedding 生成失败: ${raw}。知识库 keyword 检索仍可正常使用。`
    }
  }
}

async function refreshEmbeddingCount() {
  embeddingCounts.value = await getTotalEmbeddingCount(embeddingModel.value)
}

async function refreshEmbeddingInventory(autoSelectExisting = false) {
  const candidates = [
    ...KNOWN_EMBEDDING_MODELS,
    embeddingModel.value,
    appStore.embeddingConfig?.embeddingModel ?? ""
  ]
  embeddingInventory.value = await getEmbeddingModelInventory(candidates)

  const current = embeddingInventory.value.find((item) => item.model === embeddingModel.value)
  if (autoSelectExisting && !current && embeddingInventory.value.length > 0) {
    embeddingModel.value = embeddingInventory.value[0].model
  }
  await refreshEmbeddingCount()
}

async function requestGenerateEmbeddings() {
  await refreshEmbeddingInventory()
  if (embeddingCount.value > 0) {
    showEmbeddingConfirmDialog.value = true
    return
  }
  await handleGenerateEmbeddings()
}

async function confirmGenerateEmbeddings() {
  showEmbeddingConfirmDialog.value = false
  await handleGenerateEmbeddings()
}

function normalizeOllamaModelName(name: string): string {
  return name.split(":")[0]?.trim().toLowerCase() ?? name.trim().toLowerCase()
}

function shouldAutoUseLocalEmbeddingModel(): boolean {
  const current = embeddingModel.value.trim()
  return current.length === 0 || current === "text-embedding-3-small"
}

async function refreshOllamaEmbeddingModels() {
  showOllamaEmbeddingAlert.value = true
  ollamaEmbeddingStatus.value = "loading"
  ollamaEmbeddingMessage.value = "正在检测本地 Ollama 模型..."

  try {
    const result = await listOllamaModels()
    ollamaModelNames.value = result.models.map((model) => model.name)
    const recommendation = result.embeddingRecommendation

    if (recommendation) {
      if (shouldAutoUseLocalEmbeddingModel()) {
        embeddingModel.value = recommendation
        await refreshEmbeddingCount()
        ollamaEmbeddingMessage.value = `已检测到本地 Embedding 模型 ${recommendation}，并自动填入。`
      } else {
        ollamaEmbeddingMessage.value = `已检测到本地 Embedding 模型 ${recommendation}。当前保留你的手动模型：${embeddingModel.value}。`
      }
      ollamaEmbeddingStatus.value = "success"
      return
    }

    ollamaEmbeddingStatus.value = "warning"
    ollamaEmbeddingMessage.value = result.models.length > 0
      ? `已检测到 ${result.models.length} 个 Ollama 模型，但未发现 bge-m3 / nomic-embed-text / mxbai-embed-large。建议运行 ollama pull bge-m3。`
      : "Ollama 正在运行，但还没有检测到已安装模型。建议运行 ollama pull bge-m3。"
  } catch (error) {
    ollamaModelNames.value = []
    ollamaEmbeddingStatus.value = "warning"
    ollamaEmbeddingMessage.value = `未能读取 Ollama 模型列表：${error instanceof Error ? error.message : String(error)}`
  }
}

async function useDetectedEmbeddingModel(model: string) {
  showOllamaEmbeddingAlert.value = true
  embeddingModel.value = model
  await refreshEmbeddingCount()
  ollamaEmbeddingStatus.value = "success"
  ollamaEmbeddingMessage.value = `已切换为本地 Embedding 模型 ${model}。`
}

const showCleanupDialog = ref(false)

function handleCleanupOrphans() {
  if (!healthResult.value || healthResult.value.orphanCount === 0) return
  showCleanupDialog.value = true
}

async function confirmCleanupOrphans(force: boolean) {
  showCleanupDialog.value = false
  if (!healthResult.value) return
  const orphans = healthResult.value.orphanDetails

  showOrphanCleanupAlert.value = true
  orphanCleanupStatus.value = "loading"
  orphanCleanupMessage.value = "正在清理孤立节点..."

  try {
    const { loadAllKnowledgePacksStrict } = await import("../../services/knowledge/packLoader")
    const packs = await loadAllKnowledgePacksStrict()
    const manifestNodeIds: string[] = []
    for (const pack of packs) {
      for (const node of pack.nodes) {
        manifestNodeIds.push(node.id)
      }
    }

    const orphanIds = orphans.map((o) => o.id)
    const result = await deleteOrphanKnowledgeNodes(orphanIds, manifestNodeIds, force)

    orphanCleanupStatus.value = "success"
    orphanCleanupMessage.value = result.message || `清理完成：删除 ${result.nodesDeleted} 个节点，${result.edgesDeleted} 条边`

    await handleHealthCheck()
    await refreshKnowledgeStatus()
  } catch (error) {
    orphanCleanupStatus.value = "error"
    orphanCleanupMessage.value = `清理失败: ${error instanceof Error ? error.message : String(error)}`
  }
}

function handleTogglePack(packId: string) {
  packSelectionStore.togglePack(appStore.selectedSubject, packId)
}

function handleEnableAllPacks() {
  packSelectionStore.enableAllPacks(appStore.selectedSubject)
}

async function initializeKnowledgePanel() {
  await refreshKnowledgeStatus()
  await refreshEmbeddingInventory(true)
  if (embeddingInventory.value.length === 0 && !appStore.embeddingConfig) {
    await refreshOllamaEmbeddingModels()
  }
}

onMounted(() => {
  void initializeKnowledgePanel()
})

defineExpose({ refreshKnowledgeStatus })
</script>

<template>
  <section id="knowledge-management" class="settings-panel">
    <h2>知识库管理</h2>
    <p class="panel-copy">查看 Pack 状态、Seed 全部入库、校验数据完整性。</p>

    <!-- 总览卡片 -->
    <div class="pack-overview">
      <div class="pack-stat pack-stat-approved">
        <span class="pack-stat-value">{{ approvedPacks }}</span>
        <span class="pack-stat-label">正式 Pack</span>
      </div>
      <div class="pack-stat pack-stat-approved">
        <span class="pack-stat-value">{{ approvedNodes }}</span>
        <span class="pack-stat-label">正式节点</span>
      </div>
      <div class="pack-stat pack-stat-approved">
        <span class="pack-stat-value">{{ approvedQuestions }}</span>
        <span class="pack-stat-label">正式题目</span>
      </div>
      <div class="pack-stat pack-stat-draft">
        <span class="pack-stat-value">{{ draftPacks }}</span>
        <span class="pack-stat-label">待审核 Pack</span>
      </div>
      <div class="pack-stat pack-stat-draft">
        <span class="pack-stat-value">{{ draftNodes }}</span>
        <span class="pack-stat-label">待审核节点</span>
      </div>
      <div class="pack-stat pack-stat-draft">
        <span class="pack-stat-value">{{ draftQuestions }}</span>
        <span class="pack-stat-label">待审核题目</span>
      </div>
      <div v-if="dbComparison" class="pack-stat">
        <span class="pack-stat-value">{{ dbComparison.totalActual }}</span>
        <span class="pack-stat-label">DB 节点</span>
      </div>
      <div class="pack-stat">
        <span class="pack-stat-value">{{ embeddingCount }}</span>
        <span class="pack-stat-label">向量记录</span>
      </div>
    </div>

    <!-- 按 subject 汇总 -->
    <div v-if="dbComparison" class="pack-subject-list">
      <div
        v-for="subject in dbComparison.subjects"
        :key="subject.subject"
        class="pack-subject-item"
      >
        <div class="pack-subject-header">
          <span class="pack-subject-name">{{ subjectLabel(subject.subject) }}</span>
          <span :class="['pack-status-badge', `pack-status-${subject.status}`]">
            {{ subject.status === "ok" ? "匹配" : subject.status === "warning" ? "警告" : "错误" }}
          </span>
        </div>
        <div class="pack-subject-detail">
          预期 {{ subject.expectedNodes }} 节点 / DB {{ subject.actualNodes }} 节点
        </div>
        <div v-if="subject.message" class="pack-subject-message">{{ subject.message }}</div>
      </div>
    </div>

    <!-- Pack 列表 -->
    <details class="pack-details">
      <summary>查看全部 Pack 列表 ({{ packListItems.length }})</summary>
      <div class="pack-list">
        <div
          v-for="item in packListItems"
          :key="item.id"
          class="pack-list-item"
        >
          <span class="pack-list-subject">{{ subjectLabel(item.subject) }}</span>
          <span class="pack-list-chapter" :title="item.id">{{ item.chapter }}</span>
          <span class="pack-list-counts">{{ item.expectedNodeCount }}N / {{ item.expectedQuestionCount }}Q</span>
          <span
            v-if="item.status"
            :class="['pack-list-status', `pack-list-status-${item.status}`]"
          >
            {{ item.status === "approved" ? "正式" : "待审核" }}
          </span>
        </div>
      </div>
    </details>

    <!-- Pack 启用/禁用管理 -->
    <div class="pack-enable-section">
      <h3>Pack 启用范围</h3>
      <p class="panel-copy">选择当前学科下要启用的知识库 Pack。禁用的 Pack 不会出现在搜索、练习和图谱中。</p>

      <!-- 学科选择 -->
      <div class="subject-selector">
        <label class="subject-label">当前学科：</label>
        <div class="subject-buttons">
          <button
            v-for="subject in appStore.allSubjects"
            :key="subject.code"
            :class="['subject-button', { active: appStore.selectedSubject === subject.code }]"
            type="button"
            @click="appStore.setSelectedSubject(subject.code)"
          >
            {{ subject.name }}
            <span v-if="subject.reviewStatus" class="subject-status-badge" :class="`status-${subject.reviewStatus}`">
              {{ subject.reviewStatus === 'draft' ? '草稿' : subject.reviewStatus }}
            </span>
          </button>
        </div>
      </div>

      <!-- 启用统计 -->
      <div class="pack-enable-stats">
        <span>已启用 {{ currentEnabledPackIds.length }} / {{ currentSubjectPacks.length }} 个 Pack</span>
        <span>•</span>
        <span>{{ currentEnabledNodeCount }} 节点 / {{ currentEnabledQuestionCount }} 题目</span>
      </div>

      <!-- Pack 启用列表 -->
      <div class="pack-enable-list">
        <div
          v-for="pack in currentSubjectPacks"
          :key="pack.id"
          :class="['pack-enable-item', { disabled: !packSelectionStore.isPackEnabled(appStore.selectedSubject, pack.id) }]"
        >
          <label class="pack-enable-label">
            <input
              type="checkbox"
              :checked="packSelectionStore.isPackEnabled(appStore.selectedSubject, pack.id)"
              @change="handleTogglePack(pack.id)"
            />
            <span class="pack-enable-name" :title="pack.id">{{ pack.shortTitle }}</span>
            <span class="pack-enable-counts">{{ pack.expectedNodeCount }}N / {{ pack.expectedQuestionCount }}Q</span>
          </label>
        </div>
      </div>

      <!-- 批量操作按钮 -->
      <div class="settings-actions">
        <button
          class="action-button action-button-secondary"
          type="button"
          @click="handleEnableAllPacks"
        >
          启用全部（含待审核）
        </button>
        <button
          class="action-button action-button-secondary"
          type="button"
          @click="packSelectionStore.disableAllPacks(appStore.selectedSubject)"
        >
          禁用全部
        </button>
        <button
          class="action-button action-button-secondary"
          type="button"
          @click="packSelectionStore.resetToDefault(appStore.selectedSubject)"
        >
          恢复默认
        </button>
      </div>

      <!-- 禁用全部警告 -->
      <v-alert
        v-if="!packSelectionStore.hasEnabledPacks(appStore.selectedSubject)"
        class="mt-4"
        type="warning"
        variant="tonal"
      >
        当前学科没有启用的 Pack。请至少启用一个 Pack 才能使用搜索和练习功能。
        <button class="reset-link" type="button" @click="packSelectionStore.resetToDefault(appStore.selectedSubject)">恢复默认</button>
      </v-alert>
    </div>

    <!-- 操作按钮 -->
    <div class="settings-actions">
      <button
        class="action-button action-button-primary"
        type="button"
        :disabled="knowledgeStatus === 'loading'"
        @click="refreshKnowledgeStatus"
      >
        <v-icon icon="mdi-refresh" size="20" />
        <span>{{ knowledgeStatus === "loading" ? "刷新中" : "刷新状态" }}</span>
      </button>
      <button
        class="action-button action-button-secondary"
        type="button"
        :disabled="seedStatus === 'loading'"
        @click="handleSeedAll"
      >
        <v-icon icon="mdi-database-import-outline" size="20" />
        <span>{{ seedStatus === "loading" ? "Seed 中" : "Seed 正式内容" }}</span>
      </button>
      <button
        class="action-button action-button-secondary"
        type="button"
        :disabled="validateStatus === 'loading'"
        @click="handleValidate"
      >
        <v-icon icon="mdi-check-decagram-outline" size="20" />
        <span>{{ validateStatus === "loading" ? "校验中" : "校验 Pack" }}</span>
      </button>
    </div>

    <!-- 健康检查 & 一键同步 -->
    <div id="knowledge-health-check" class="health-section">
      <h3>健康检查 & 同步</h3>
      <p class="panel-copy">检查 DB 与当前正式（approved）Pack 声明是否一致。同步会用当前正式 Pack 更新 knowledge_nodes 的标题、摘要、难度、依赖和 subject 归属；不会删除对话、练习记录或学习进度。Draft 节点在 DB 中是正常状态，不被当作缺失。</p>
      <div class="settings-actions">
        <button
          class="action-button action-button-secondary"
          type="button"
          :disabled="healthStatus === 'loading'"
          @click="handleHealthCheck"
        >
          <v-icon icon="mdi-heart-pulse" size="20" />
          <span>{{ healthStatus === "loading" ? "检查中" : "健康检查" }}</span>
        </button>
        <button
          class="action-button action-button-primary"
          type="button"
          :disabled="syncStatus === 'loading' || (healthResult !== null && healthResult.safeToSync && healthResult.orphanCount === 0)"
          @click="handleSync"
        >
          <v-icon icon="mdi-sync" size="20" />
          <span>{{ syncStatus === "loading" ? "同步中" : "一键同步" }}</span>
        </button>
      </div>

      <!-- 健康检查结果 -->
      <v-alert
        v-if="healthStatus !== 'idle'"
        v-model="showHealthAlert"
        closable
        class="mt-4"
        :type="healthStatus === 'success' ? 'success' : healthStatus === 'error' ? 'error' : 'warning'"
        variant="tonal"
      >
        {{ healthMessage }}
      </v-alert>
      <div v-if="healthResult" class="health-result">
        <div class="health-stat-row">
          <span class="health-stat-label">预期节点</span>
          <span class="health-stat-value">{{ healthResult.totalExpected }}</span>
        </div>
        <div class="health-stat-row">
          <span class="health-stat-label">DB 节点</span>
          <span class="health-stat-value">{{ healthResult.totalDb }}</span>
        </div>
        <div v-if="healthResult.missingCount > 0" class="health-stat-row health-stat-warn">
          <span class="health-stat-label">缺少节点</span>
          <span class="health-stat-value">{{ healthResult.missingCount }}</span>
        </div>
        <div v-if="healthResult.subjectMismatchCount > 0" class="health-stat-row health-stat-warn">
          <span class="health-stat-label">Subject 不一致</span>
          <span class="health-stat-value">{{ healthResult.subjectMismatchCount }}</span>
        </div>
        <div v-if="healthResult.statusMismatchCount > 0" class="health-stat-row health-stat-warn">
          <span class="health-stat-label">审核状态不一致</span>
          <span class="health-stat-value">{{ healthResult.statusMismatchCount }}</span>
        </div>
        <div v-if="healthResult.statusMismatchCount > 0" class="health-note">
          {{ healthResult.statusMismatchCount }} 个节点的 review_status 不是 approved，需要同步修复。
        </div>
        <div v-if="healthResult.orphanCount > 0" class="health-stat-row health-stat-info">
          <span class="health-stat-label">孤立节点</span>
          <span class="health-stat-value">{{ healthResult.orphanCount }}</span>
        </div>
        <div v-if="healthResult.orphanCount > 0" class="health-note">
          DB 中存在当前 manifest 未声明的知识节点，可能来自旧版本或实验数据。
        </div>
        <!-- 孤立节点详情 -->
        <div v-if="healthResult.orphanDetails.length > 0" class="orphan-details">
          <div class="orphan-details-header">
            <span class="orphan-details-title">孤立节点列表</span>
          </div>
          <div
            v-for="orphan in healthResult.orphanDetails"
            :key="orphan.id"
            class="orphan-item"
          >
            <span class="orphan-id">{{ orphan.id }}</span>
            <span class="orphan-title">{{ orphan.title }}</span>
            <span v-if="orphan.subjectCode" class="orphan-meta">{{ orphan.subjectCode }}</span>
            <span v-if="orphan.reviewStatus" class="orphan-meta">{{ orphan.reviewStatus }}</span>
          </div>
          <button
            class="action-button action-button-danger mt-2"
            type="button"
            :disabled="orphanCleanupStatus === 'loading'"
            @click="handleCleanupOrphans"
          >
            <v-icon icon="mdi-delete-sweep" size="18" />
            <span>{{ orphanCleanupStatus === "loading" ? "清理中..." : "清理孤立知识节点" }}</span>
          </button>
        </div>
      </div>

      <!-- 同步结果 -->
      <v-alert
        v-if="syncStatus !== 'idle'"
        v-model="showSyncAlert"
        closable
        class="mt-4"
        :type="syncStatus === 'success' ? 'success' : 'error'"
        variant="tonal"
      >
        {{ syncMessage }}
      </v-alert>

      <!-- 孤立节点清理结果 -->
      <v-alert
        v-if="orphanCleanupStatus !== 'idle'"
        v-model="showOrphanCleanupAlert"
        closable
        class="mt-4"
        :type="orphanCleanupStatus === 'success' ? 'success' : 'error'"
        variant="tonal"
      >
        {{ orphanCleanupMessage }}
      </v-alert>
    </div>

    <v-dialog v-model="showCleanupDialog" max-width="500">
      <v-card>
        <v-card-title class="text-h6">确认清理孤立节点</v-card-title>
        <v-card-text>
          即将清理 {{ healthResult?.orphanCount }} 个孤立知识节点。
          <br><br>
          <div class="orphan-list-preview">
            <div v-for="o in healthResult?.orphanDetails.slice(0, 5)" :key="o.id">
              - {{ o.id }} ({{ o.title }})
            </div>
            <div v-if="healthResult?.orphanDetails && healthResult.orphanDetails.length > 5">
              ...等 {{ healthResult.orphanDetails.length }} 个节点
            </div>
          </div>
          <br>
          通常只删除未被当前 manifest 声明的内置孤立知识节点。<br>
          <b>注意：</b>如果有遗留的测试数据（如 <code>privdoc-</code> 开头的私有资料），您可以选择强制清理它们（这也会删除关联的测试进度）。
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="grey-darken-1" variant="text" @click="showCleanupDialog = false">取消</v-btn>
          <v-btn color="warning" variant="text" @click="confirmCleanupOrphans(false)">安全清理(跳过有进度节点)</v-btn>
          <v-btn color="error" variant="flat" @click="confirmCleanupOrphans(true)">强制清理(含进度)</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 状态提示 -->
    <v-alert
      v-if="knowledgeStatus !== 'idle'"
      v-model="showKnowledgeAlert"
      closable
      class="mt-4"
      :type="knowledgeStatus === 'success' ? 'success' : knowledgeStatus === 'error' ? 'error' : 'info'"
      variant="tonal"
    >
      {{ knowledgeMessage }}
    </v-alert>
    <v-alert
      v-if="seedStatus !== 'idle'"
      v-model="showSeedAlert"
      closable
      class="mt-4"
      :type="seedStatus === 'success' ? 'success' : seedStatus === 'error' ? 'error' : 'info'"
      variant="tonal"
    >
      {{ seedMessage }}
    </v-alert>
    <v-alert
      v-if="validateStatus !== 'idle'"
      v-model="showValidateAlert"
      closable
      class="mt-4"
      :type="validateStatus === 'success' ? 'success' : validateStatus === 'error' ? 'error' : 'info'"
      variant="tonal"
    >
      {{ validateMessage }}
    </v-alert>

    <!-- 校验结果详情 -->
    <div v-if="validationResult" class="validation-result">
      <div v-if="validationResult.errors.length > 0" class="validation-section">
        <h4 class="validation-section-title validation-errors-title">
          错误 ({{ validationResult.errors.length }})
        </h4>
        <div
          v-for="(error, i) in validationResult.errors"
          :key="i"
          class="validation-item validation-error"
        >
          <span class="validation-code">{{ error.code }}</span>
          <span class="validation-message">{{ error.message }}</span>
        </div>
      </div>
      <div v-if="validationResult.warnings.length > 0" class="validation-section">
        <h4 class="validation-section-title validation-warnings-title">
          警告 ({{ validationResult.warnings.length }})
        </h4>
        <div
          v-for="(warning, i) in validationResult.warnings"
          :key="i"
          class="validation-item validation-warning"
        >
          <span class="validation-code">{{ warning.code }}</span>
          <span class="validation-message">{{ warning.message }}</span>
        </div>
      </div>
      <div v-if="validationResult.ok && validationResult.warnings.length === 0" class="validation-success">
        ✅ 全部校验通过，无错误无警告
      </div>
    </div>

    <!-- 向量 Embedding 生成 -->
    <div class="health-section">
      <h3>向量 Embedding</h3>
      <p class="panel-copy">
        一次性为所有学科的正式知识节点和题目生成向量 Embedding，启用语义搜索增强。需要配置支持 Embedding 的 Provider（如 OpenAI text-embedding-3-small 或 Ollama bge-m3）。如果当前 Provider 不支持 Embedding 接口，keyword 检索仍可正常使用。仅处理全部 approved Pack，不处理 draft 内容。
      </p>
      <v-alert
        class="mt-4 embedding-coverage-alert"
        :type="embeddingCoverageType"
        variant="tonal"
      >
        {{ embeddingCoverageMessage }}
        <div v-if="embeddingInventory.length > 0" class="detected-embedding-models">
          <button
            v-for="item in embeddingInventory"
            :key="item.model"
            :class="['embedding-chip', { active: item.model === embeddingModel }]"
            type="button"
            @click="embeddingModel = item.model; refreshEmbeddingCount()"
          >
            {{ item.model }} · {{ item.total }} 条
          </button>
        </div>
      </v-alert>
      <v-alert
        v-if="ollamaEmbeddingStatus !== 'idle'"
        v-model="showOllamaEmbeddingAlert"
        closable
        class="mt-4"
        :type="ollamaEmbeddingStatus === 'success' ? 'success' : ollamaEmbeddingStatus === 'error' ? 'error' : ollamaEmbeddingStatus === 'loading' ? 'info' : 'warning'"
        variant="tonal"
      >
        {{ ollamaEmbeddingMessage }}
        <div v-if="detectedEmbeddingModels.length > 0" class="detected-embedding-models">
          <button
            v-for="model in detectedEmbeddingModels"
            :key="model"
            class="embedding-chip"
            type="button"
            @click="useDetectedEmbeddingModel(model)"
          >
            使用 {{ model }}
          </button>
        </div>
      </v-alert>
      <div class="settings-actions">
        <label class="embedding-model-label">
          <span>模型：</span>
          <input
            v-model="embeddingModel"
            class="field-input embedding-model-input"
            type="text"
            placeholder="text-embedding-3-small"
          />
        </label>
        <button
          class="action-button action-button-secondary"
          type="button"
          :disabled="ollamaEmbeddingStatus === 'loading'"
          @click="refreshOllamaEmbeddingModels"
        >
          <v-icon icon="mdi-lan-search" size="20" />
          <span>{{ ollamaEmbeddingStatus === "loading" ? "检测中" : "检测 Ollama 模型" }}</span>
        </button>
        <button
          class="action-button action-button-secondary"
          type="button"
          :disabled="embeddingStatus === 'loading'"
          @click="requestGenerateEmbeddings"
        >
          <v-icon icon="mdi-vector-line" size="20" />
          <span>
            {{
              embeddingStatus === 'loading'
                ? `生成中 ${embeddingProgress.current}/${embeddingProgress.total}`
                : embeddingCount > 0
                  ? '重新生成全部 approved Embedding'
                  : '生成全部 approved Embedding'
            }}
          </span>
        </button>
        <button
          class="action-button action-button-secondary"
          type="button"
          @click="refreshEmbeddingInventory()"
        >
          <v-icon icon="mdi-refresh" size="16" />
          <span>刷新计数</span>
        </button>
      </div>

      <!-- 进度条 -->
      <div v-if="embeddingStatus === 'loading' && embeddingProgress.total > 0" class="embedding-progress">
        <div class="embedding-progress-bar">
          <div
            class="embedding-progress-fill"
            :style="{ width: `${Math.round((embeddingProgress.current / embeddingProgress.total) * 100)}%` }"
          ></div>
        </div>
        <span class="embedding-progress-text">
          {{ embeddingProgress.current }} / {{ embeddingProgress.total }}
        </span>
      </div>

      <v-alert
        v-if="embeddingStatus !== 'idle'"
        v-model="showEmbeddingAlert"
        closable
        class="mt-4"
        :type="embeddingStatus === 'success' ? 'success' : embeddingStatus === 'error' ? 'error' : 'info'"
        variant="tonal"
      >
        {{ embeddingMessage }}
      </v-alert>

      <v-dialog v-model="showEmbeddingConfirmDialog" max-width="560">
        <v-card>
          <v-card-title>确认重新生成向量库</v-card-title>
          <v-card-text>
            当前已检测到 {{ embeddingModel }} 的 {{ embeddingCount }} 条向量记录
            （{{ embeddingCounts.knowledge }} 个知识节点 + {{ embeddingCounts.questions }} 道题）。
            重新生成将按当前 approved 清单进行 upsert 和收敛；内置 draft 向量会被清理，
            自定义学科、私有资料和其他模型的向量不会被删除。
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="showEmbeddingConfirmDialog = false">取消</v-btn>
            <v-btn color="primary" variant="flat" @click="confirmGenerateEmbeddings">继续生成</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </div>
  </section>
</template>

<style scoped>
.pack-overview {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}

.pack-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 16px;
  border: 1px solid var(--v-border-color, #e0e0e0);
  border-radius: 8px;
  min-width: 80px;
}

.pack-stat-value {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--v-primary-base, #4a90d9);
}

.pack-stat-label {
  font-size: 0.75rem;
  color: #666;
  margin-top: 2px;
}

.pack-stat-warn .pack-stat-value {
  color: #e65100;
}

.pack-stat-approved .pack-stat-value {
  color: #2e7d32;
}

.pack-stat-draft .pack-stat-value {
  color: #9e9e9e;
}

.pack-stat-draft .pack-stat-label {
  color: #999;
}

.pack-subject-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.pack-subject-item {
  padding: 8px 12px;
  border: 1px solid var(--v-border-color, #e0e0e0);
  border-radius: 6px;
}

.pack-subject-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pack-subject-name {
  font-weight: 500;
}

.pack-status-badge {
  font-size: 0.75em;
  padding: 2px 8px;
  border-radius: 12px;
}

.pack-status-ok {
  background: #e8f5e9;
  color: #2e7d32;
}

.pack-status-warning {
  background: #fff3e0;
  color: #e65100;
}

.pack-status-error {
  background: #ffebee;
  color: #c62828;
}

.pack-subject-detail {
  font-size: 0.85em;
  color: #666;
  margin-top: 4px;
}

.pack-subject-message {
  font-size: 0.85em;
  color: #e65100;
  margin-top: 4px;
}

.pack-details {
  margin-bottom: 16px;
}

.pack-details summary {
  cursor: pointer;
  color: var(--v-primary-base, #4a90d9);
  font-size: 0.9em;
}

.pack-list {
  margin-top: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.pack-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 0.85em;
}

.pack-list-subject {
  font-weight: 500;
  min-width: 60px;
}

.pack-list-chapter {
  flex: 1;
  color: #333;
}

.pack-list-counts {
  color: #666;
  font-size: 0.85em;
}

.pack-list-status {
  font-size: 0.75em;
  padding: 2px 6px;
  border-radius: 4px;
}

.pack-list-status-approved {
  background: #e8f5e9;
  color: #2e7d32;
}

.pack-list-status-draft {
  background: #f5f5f5;
  color: #9e9e9e;
}

/* Pack 启用/禁用 */
.pack-enable-section {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}

.pack-enable-section h3 {
  margin: 0 0 8px;
  font-size: 1rem;
}

.subject-selector {
  margin-bottom: 12px;
}

.subject-label {
  font-size: 0.9em;
  color: #666;
  margin-bottom: 8px;
  display: block;
}

.subject-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.subject-button {
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 0.85em;
  transition: all 0.2s;
}

.subject-button:hover {
  border-color: var(--v-primary-base, #4a90d9);
}

.subject-button.active {
  background: var(--v-primary-base, #4a90d9);
  color: white;
  border-color: var(--v-primary-base, #4a90d9);
}

.subject-status-badge {
  display: inline-block;
  font-size: 0.7em;
  padding: 1px 5px;
  border-radius: 4px;
  margin-left: 4px;
  vertical-align: middle;
}

.status-draft {
  background: #fff3cd;
  color: #856404;
}

.pack-enable-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85em;
  color: #666;
  margin-bottom: 12px;
}

.pack-enable-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 8px;
}

.pack-enable-item {
  padding: 6px 8px;
  border-radius: 4px;
}

.pack-enable-item.disabled {
  opacity: 0.5;
}

.pack-enable-item:hover {
  background: #f8f9fa;
}

.pack-enable-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.9em;
}

.pack-enable-name {
  flex: 1;
}

.pack-enable-counts {
  color: #666;
  font-size: 0.85em;
}

.reset-link {
  background: none;
  border: none;
  color: var(--v-primary-base, #4a90d9);
  cursor: pointer;
  text-decoration: underline;
  font-size: inherit;
}

/* 健康检查 */
.health-section {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}

.health-section h3 {
  margin: 0 0 8px;
  font-size: 1rem;
}

.health-result {
  margin-top: 12px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 8px;
}

.health-stat-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 0.9em;
}

.health-stat-label {
  color: #666;
}

.health-stat-value {
  font-weight: 500;
}

.health-stat-warn .health-stat-value {
  color: #e65100;
}

.health-stat-info .health-stat-value {
  color: #0288d1;
}

.health-note {
  font-size: 0.85em;
  color: #666;
  margin-top: 8px;
  padding: 8px;
  background: #fff8e1;
  border-radius: 4px;
}

.orphan-details {
  margin-top: 12px;
  padding: 12px;
  background: #fff8e1;
  border-radius: 8px;
  border: 1px solid #ffe082;
}

.orphan-details-header {
  margin-bottom: 8px;
}

.orphan-details-title {
  font-weight: 500;
  font-size: 0.9em;
}

.orphan-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 0.85em;
}

.orphan-id {
  font-family: monospace;
  color: #666;
  min-width: 120px;
}

.orphan-title {
  flex: 1;
}

.orphan-meta {
  color: #999;
  font-size: 0.8em;
}

/* 校验结果 */
.validation-result {
  margin-top: 12px;
}

.validation-section {
  margin-bottom: 12px;
}

.validation-section-title {
  font-size: 0.9em;
  font-weight: 500;
  margin-bottom: 6px;
}

.validation-errors-title {
  color: #c62828;
}

.validation-warnings-title {
  color: #e65100;
}

.validation-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  font-size: 0.85em;
}

.validation-code {
  font-family: monospace;
  font-size: 0.8em;
  padding: 2px 6px;
  background: #f0f0f0;
  border-radius: 3px;
  min-width: 80px;
}

.validation-message {
  flex: 1;
}

.validation-error .validation-code {
  background: #ffebee;
  color: #c62828;
}

.validation-warning .validation-code {
  background: #fff3e0;
  color: #e65100;
}

.validation-success {
  padding: 12px;
  background: #e8f5e9;
  color: #2e7d32;
  border-radius: 8px;
  font-size: 0.9em;
}

/* Embedding 进度 */
.embedding-model-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
}

.embedding-model-input {
  width: 200px;
}

.embedding-progress {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.embedding-progress-bar {
  flex: 1;
  height: 8px;
  background: #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
}

.embedding-progress-fill {
  height: 100%;
  background: var(--v-primary-base, #4a90d9);
  border-radius: 4px;
  transition: width 0.3s;
}

.embedding-progress-text {
  font-size: 0.85em;
  color: #666;
  min-width: 80px;
  text-align: right;
}

.embedding-coverage-alert {
  margin-bottom: 14px;
}

.detected-embedding-models {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.embedding-chip {
  border: 1px solid rgba(46, 125, 50, 0.3);
  border-radius: 999px;
  background: rgba(46, 125, 50, 0.08);
  color: #1b5e20;
  cursor: pointer;
  font-size: 0.85em;
  font-weight: 600;
  padding: 5px 10px;
}

.embedding-chip.active {
  border-color: var(--atlas-blue, #2f6fb2);
  background: rgba(47, 111, 178, 0.1);
  color: var(--atlas-blue, #2f6fb2);
  font-weight: 700;
}

.embedding-chip:hover {
  background: rgba(46, 125, 50, 0.14);
}

.seed-overwrite-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  color: #666;
}

.orphan-list-preview {
  font-size: 0.85em;
  color: #666;
}
</style>
