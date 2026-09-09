<script setup lang="ts">
import { ref, computed, onMounted, watch, onErrorCaptured, onActivated } from "vue"
import { useRouter } from "vue-router"
import { loadStudentKnowledge } from "../services/tauri/commands"
import type { StudentKnowledgeMastery } from "../types/learning"
import { VNetworkGraph } from "v-network-graph"
import MessageRenderer from "../components/chat/MessageRenderer.vue"
import { useAppStore } from "../stores/app"
import { usePackSelectionStore } from "../stores/packSelection"
import { subjectLabel } from "../utils/subject"
import { getPacksBySubject, type KnowledgePack } from "../services/knowledge/packManifest"
import { loadKnowledgePack, type KnowledgeSeedNode } from "../services/knowledge/packLoader"
import {
  buildGraphNodes,
  buildGraphEdges,
  buildGraphLayout,
  buildNodeColors,
  MAX_GRAPH_NODES,
  truncateTitle,
  type GraphNodes,
  type GraphEdges,
  type GraphLayouts
} from "../services/knowledge/graphBuilder"
import {
  VISIBLE_STEP,
  getVisibleNodes,
  nextVisibleLimit,
  hasMoreNodes as hasMoreNodesFn,
  resolveListNodeSource
} from "./knowledgeGraphLogic"
import {
  isColdStartKnowledge,
  hasInformativeMasteryEvidence,
  getMasteryLabel,
  getMasteryBadgeText,
  getMasteryBadgeClass,
  getMasteryColor,
  getMasteryVisualIcon,
  getMasteryVisualState
} from "../utils/mastery"

const appStore = useAppStore()
const packSelectionStore = usePackSelectionStore()
const router = useRouter()
const subjectCode = computed(() => appStore.selectedSubject)
const studentId = "local-default-student"
const knowledge = ref<StudentKnowledgeMastery[]>([])
const selectedNode = ref<string | null>(null)

// ── Pack → Nodes 映射（基于 __packId，不依赖 node id 前缀） ────────────────

/** packId → 该 pack 的节点列表 */
const packNodesMap = ref<Map<string, KnowledgeSeedNode[]>>(new Map())

/** 所有 pack 的节点平铺（用于列表"全部"视图） */
const allPackNodes = computed(() => {
  const result: KnowledgeSeedNode[] = []
  for (const nodes of packNodesMap.value.values()) {
    result.push(...nodes)
  }
  return result
})

// 默认列表视图，避免 VNetworkGraph 崩溃导致页面空白
const viewMode = ref<"graph" | "list">("list")
const isLoading = ref(false)
const graphError = ref<string | null>(null)

// ── Pack 过滤 ──────────────────────────────────────────────────────────────

/** 当前学科的可用 packs */
const availablePacks = computed<KnowledgePack[]>(() => getPacksBySubject(subjectCode.value))

/** 当前选中的 pack id（图谱模式只渲染此 pack 的节点） */
const selectedPackId = ref<string>("")

/** 选中 pack 变更时重置为第一个 enabled pack */
function resetSelectedPack() {
  const enabled = packSelectionStore.getEnabledPackIds(subjectCode.value)
  selectedPackId.value = enabled.length > 0 ? enabled[0] : availablePacks.value[0]?.id ?? ""
}

/** 按 selectedPackId 过滤后的节点（图谱模式使用，基于 packNodesMap） */
const filteredGraphNodes = computed(() => {
  if (!selectedPackId.value) return allPackNodes.value
  return packNodesMap.value.get(selectedPackId.value) ?? []
})

/** 图谱模式截断到 MAX_GRAPH_NODES */
const cappedGraphNodes = computed(() => {
  const nodes = filteredGraphNodes.value
  if (nodes.length <= MAX_GRAPH_NODES) return nodes
  return nodes.slice(0, MAX_GRAPH_NODES)
})

const isCapped = computed(() => filteredGraphNodes.value.length > MAX_GRAPH_NODES)

// ── 列表模式：全部节点或按 pack 过滤 ──────────────────────────────────────

// 默认显示当前章节，不默认"全部"（减少首屏 DOM 数量）
const listShowAll = ref(false)

const listNodes = computed(() => resolveListNodeSource(listShowAll.value, allPackNodes.value, filteredGraphNodes.value))

// ── 渐进渲染：初始只渲染前 VISIBLE_STEP 个节点 ────────────────────────────

const visibleLimit = ref(VISIBLE_STEP)

const visibleNodes = computed(() => getVisibleNodes(sortedPackNodes.value, visibleLimit.value))
const hasMoreNodes = computed(() => hasMoreNodesFn(visibleNodes.value.length, sortedPackNodes.value.length))

function showMoreNodes() {
  visibleLimit.value = nextVisibleLimit(visibleLimit.value, sortedPackNodes.value.length)
}

function resetVisibleLimit() {
  visibleLimit.value = VISIBLE_STEP
}

// ── 图谱数据 ──────────────────────────────────────────────────────────────

// 从 pack 节点直接构建 prerequisites（不依赖 SQLite）——仅在图谱模式下计算
const packPrerequisites = computed(() => {
  if (viewMode.value !== "graph") return []
  const nodes = cappedGraphNodes.value
  const nodeIds = new Set(nodes.map((n) => n.id))
  const titleMap = new Map(nodes.map((n) => [n.id, n.title]))
  const prereqs: Array<{ targetNodeId: string; title: string; prerequisiteNodeId: string }> = []
  for (const node of nodes) {
    for (const prereqId of node.prerequisites ?? []) {
      if (nodeIds.has(prereqId) && prereqId !== node.id) {
        prereqs.push({
          targetNodeId: node.id,
          title: node.title,
          prerequisiteNodeId: prereqId,
        })
      }
    }
  }
  return prereqs
})
// 节点 ID → 标题映射（用于前置依赖显示）
const nodeIdToTitle = computed(() => {
  const map = new Map<string, string>()
  for (const node of allPackNodes.value) {
    map.set(node.id, node.title)
  }
  // 也包含 knowledge mastery 的标题
  for (const k of knowledge.value) {
    map.set(k.knowledgeNodeId, k.title)
  }
  return map
})

// 图谱数据（安全构建，不抛错）——仅在图谱模式下计算
const graphData = computed(() => {
  if (viewMode.value !== "graph") {
    return { nodes: {} as GraphNodes, edges: {} as GraphEdges, layouts: { nodes: {} } as GraphLayouts }
  }
  try {
    const nodes = buildGraphNodes(cappedGraphNodes.value)
    const edges = buildGraphEdges(cappedGraphNodes.value)
    const layouts = buildGraphLayout(cappedGraphNodes.value)
    return { nodes, edges, layouts }
  } catch (e) {
    graphError.value = `图谱构建失败: ${e instanceof Error ? e.message : String(e)}`
    return { nodes: {} as GraphNodes, edges: {} as GraphEdges, layouts: { nodes: {} } as GraphLayouts }
  }
})

// 节点颜色映射（使用全量节点，以便列表和详情面板有颜色）
const nodeColors = computed(() => buildNodeColors(allPackNodes.value, knowledge.value))

// 排序后的节点列表（用于列表视图）
const sortedPackNodes = computed(() => {
  const masteryMap = new Map<string, number>()
  for (const k of knowledge.value) {
    masteryMap.set(k.knowledgeNodeId, k.masteryProbability)
  }
  return [...listNodes.value].sort((a, b) => {
    const ma = masteryMap.get(a.id) ?? 0
    const mb = masteryMap.get(b.id) ?? 0
    return mb - ma
  })
})

// 选中节点详情
const selectedNodeData = computed(() => {
  if (!selectedNode.value) return null
  const k = knowledge.value.find((n) => n.knowledgeNodeId === selectedNode.value)
  if (k) return k
  const packNode = allPackNodes.value.find((n) => n.id === selectedNode.value)
  if (packNode) {
    return {
      knowledgeNodeId: selectedNode.value,
      title: packNode.title,
      masteryProbability: 0,
      attemptsCount: 0,
      correctCount: 0,
      updatedAt: ""
    }
  }
  return null
})

const selectedNodePrereqs = computed(() => {
  if (!selectedNode.value) return []
  return packPrerequisites.value.filter((p) => p.targetNodeId === selectedNode.value)
})

/** 选中节点的摘要 */
const selectedNodeSummary = computed(() => {
  if (!selectedNode.value) return null
  const packNode = allPackNodes.value.find((n) => n.id === selectedNode.value)
  return packNode?.summary ?? null
})

/** 选中节点所属 Pack 的中文标题 */
const selectedNodePackTitle = computed(() => {
  if (!selectedNode.value) return null
  // 遍历 packNodesMap 找到节点所属的 pack
  for (const [packId, nodes] of packNodesMap.value) {
    if (nodes.some((n) => n.id === selectedNode.value)) {
      // 从 availablePacks 找对应的 pack 信息
      const pack = availablePacks.value.find((p) => p.id === packId)
      return pack?.title ?? packId
    }
  }
  return null
})

/** 选中节点是否有真实学习数据 */
const selectedNodeHasRealData = computed(() => {
  if (!selectedNode.value) return false
  const k = knowledge.value.find((n) => n.knowledgeNodeId === selectedNode.value)
  return k ? hasInformativeMasteryEvidence(k) : false
})

/** 已有交互记录，但仍只有 50% 冷启动先验，不能展示为真实进度 */
const selectedNodeNeedsEvaluation = computed(() => {
  if (!selectedNode.value) return false
  const k = knowledge.value.find((n) => n.knowledgeNodeId === selectedNode.value)
  return Boolean(k && k.attemptsCount > 0 && !hasInformativeMasteryEvidence(k))
})

/** 选中节点是否为冷启动状态 */
const selectedNodeIsColdStart = computed(() => {
  if (!selectedNode.value) return false
  const k = knowledge.value.find((n) => n.knowledgeNodeId === selectedNode.value)
  return k ? isColdStartKnowledge(k) : true // 无记录视为冷启动
})

/** 让导师讲解当前节点 */
function askTutorToExplain() {
  if (!selectedNode.value) return
  const node = allPackNodes.value.find((n) => n.id === selectedNode.value)
  if (!node) return
  const title = node.title
  const subject = subjectLabel(subjectCode.value)
  router.push({
    path: "/chat",
    query: {
      message: `请帮我讲解${subject}中的"${title}"这个知识点，用苏格拉底式引导。`
    }
  })
}

/** 请求练习当前节点 */
function askForPractice() {
  if (!selectedNode.value) return
  const node = allPackNodes.value.find((n) => n.id === selectedNode.value)
  if (!node) return
  const title = node.title
  const subject = subjectLabel(subjectCode.value)
  router.push({
    path: "/chat",
    query: {
      message: `请给我一道关于${subject}中"${title}"的练习题。`
    }
  })
}

// v-network-graph 配置
const configs = {
  node: {
    normal: {
      type: "circle" as const,
      radius: 25,
      color: (node: unknown) => {
        const id = (node as { id?: string })?.id ?? ""
        return nodeColors.value[id] ?? "#9e9e9e"
      }
    },
    hover: { radius: 27, color: "#4a90d9" },
    selected: { radius: 27, color: "#4a90d9" },
    label: {
      visible: true,
      fontSize: 10,
      color: "#333",
      direction: "south" as const,
      directionAutoAdjustment: true
    }
  },
  edge: {
    normal: {
      color: "#ccc",
      width: 1.5,
      marker: { target: { type: "arrow" as const, color: "#ccc" } }
    },
    hover: { color: "#4a90d9", width: 2 }
  }
}

const eventHandlers = {
  "node:click": ({ node }: { node: string }) => selectNode(node)
}

// 捕获 VNetworkGraph 渲染错误
onErrorCaptured((err) => {
  graphError.value = `图谱渲染异常: ${err.message}`
  viewMode.value = "list"
  return false // 阻止错误向上传播导致整个 app 崩溃
})

// ── 请求取消：subject 切换时忽略旧结果 ─────────────────────────────────────

let loadGeneration = 0

/** 加载单个 pack 并加入 map（如果 generation 匹配） */
async function loadSinglePackIntoMap(
  packId: string,
  map: Map<string, KnowledgeSeedNode[]>,
  generation: number
): Promise<boolean> {
  try {
    const seed = await loadKnowledgePack(packId)
    if (generation !== loadGeneration) return false // subject 已切换，丢弃
    const id = seed.__packId ?? seed.chapter ?? packId
    map.set(id, seed.nodes)
    return true
  } catch {
    return true // 加载失败不阻塞其他 pack
  }
}

async function loadGraphData() {
  loadGeneration++
  const generation = loadGeneration

  isLoading.value = true
  graphError.value = null
  // Clear the prior subject immediately; otherwise its nodes remain visible
  // while the first pack for the newly selected subject is awaited.
  packNodesMap.value = new Map()
  knowledge.value = []

  try {
    const enabledPackIds = packSelectionStore.getEnabledPackIds(subjectCode.value)
    const allPackIds = enabledPackIds.length > 0
      ? enabledPackIds
      : availablePacks.value.map((p) => p.id)

    // 只加载当前选中的 pack（或第一个），让首屏快速渲染
    const initialPackId = selectedPackId.value || allPackIds[0]
    const map = new Map<string, KnowledgeSeedNode[]>()

    if (initialPackId) {
      await loadSinglePackIntoMap(initialPackId, map, generation)
    }

    if (generation !== loadGeneration) return // subject 已切换

    packNodesMap.value = map
    resetSelectedPack()

    // 加载学生掌握度（可选）
    try {
      knowledge.value = await loadStudentKnowledge(studentId, subjectCode.value, 50)
    } catch {
      knowledge.value = []
    }

    if (generation !== loadGeneration) return

    // 后台分批加载剩余 pack，每批之间让出主线程
    const remainingIds = allPackIds.filter((id) => id !== initialPackId)
    const BATCH_SIZE = 3
    for (let i = 0; i < remainingIds.length; i += BATCH_SIZE) {
      if (generation !== loadGeneration) return // subject 已切换
      const batch = remainingIds.slice(i, i + BATCH_SIZE)
      await Promise.all(batch.map((id) => loadSinglePackIntoMap(id, map, generation)))
      // 让出主线程，避免阻塞 UI
      if (i + BATCH_SIZE < remainingIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    if (generation !== loadGeneration) return

    // 触发响应式更新
    packNodesMap.value = new Map(map)
  } catch (e) {
    if (generation !== loadGeneration) return
    graphError.value = `数据加载失败: ${e instanceof Error ? e.message : String(e)}`
    packNodesMap.value = new Map()
    knowledge.value = []
  } finally {
    if (generation === loadGeneration) {
      isLoading.value = false
    }
  }
}

// 延迟加载数据，让组件先渲染首屏，避免切页卡顿
onMounted(() => setTimeout(loadGraphData, 0))
onActivated(() => {
  if (packNodesMap.value.size === 0) {
    setTimeout(loadGraphData, 0)
  }
})

watch(() => appStore.selectedSubject, () => {
  resetVisibleLimit()
  loadGraphData()
})

// 切换 selectedPackId 时，如果目标 pack 还没加载到，按需单独加载
watch(selectedPackId, async (newPackId) => {
  resetVisibleLimit()
  if (!newPackId) return
  if (packNodesMap.value.has(newPackId)) return // 已加载

  const generation = loadGeneration
  try {
    const seed = await loadKnowledgePack(newPackId)
    if (generation !== loadGeneration) return // subject 已切换
    const id = seed.__packId ?? seed.chapter ?? newPackId
    const updated = new Map(packNodesMap.value)
    updated.set(id, seed.nodes)
    packNodesMap.value = updated
  } catch {
    // 加载失败不阻塞，用户可重试
  }
})

function selectNode(id: string) {
  selectedNode.value = selectedNode.value === id ? null : id
}

function getNodeColor(nodeId: string): string {
  return nodeColors.value[nodeId] ?? "#9e9e9e"
}

function getNodeMasteryPercent(nodeId: string): number {
  const k = knowledge.value.find((n) => n.knowledgeNodeId === nodeId)
  return Math.round((k?.masteryProbability ?? 0) * 100)
}

/** 获取节点的 mastery 记录（含冷启动默认） */
function getNodeMasteryRecord(nodeId: string) {
  const k = knowledge.value.find((n) => n.knowledgeNodeId === nodeId)
  if (k) return k
  // 冷启动默认：无记录视为未开始
  return {
    knowledgeNodeId: nodeId,
    title: "",
    masteryProbability: 0,
    attemptsCount: 0,
    correctCount: 0,
    updatedAt: ""
  }
}

function getNodeMasteryLabel(nodeId: string): string {
  const record = getNodeMasteryRecord(nodeId)
  return getMasteryLabel(record)
}

function getNodeMasteryBadgeText(nodeId: string): string {
  const record = getNodeMasteryRecord(nodeId)
  return getMasteryBadgeText(record)
}

function getNodeMasteryBadgeClass(nodeId: string): string {
  const record = getNodeMasteryRecord(nodeId)
  return getMasteryBadgeClass(record)
}

function getNodeVisualIcon(nodeId: string): string {
  return getMasteryVisualIcon(getNodeMasteryRecord(nodeId))
}

function getNodeVisualState(nodeId: string): string {
  return getMasteryVisualState(getNodeMasteryRecord(nodeId))
}
</script>

<template>
  <div class="knowledge-graph-view">
    <div class="graph-header">
      <p class="eyebrow">Knowledge Atlas</p>
      <h2>知识天赋树</h2>
      <p class="graph-subtitle">{{ subjectLabel(subjectCode) }} · 节点颜色表示掌握度，箭头表示前置依赖</p>

      <!-- 状态条（简化） -->
      <div class="status-bar">
        <span>{{ subjectLabel(subjectCode) }}</span>
        <span v-if="selectedPackId">· {{ availablePacks.find(p => p.id === selectedPackId)?.chapter ?? selectedPackId }}</span>
        <span v-if="viewMode === 'graph'">· {{ Object.keys(graphData.nodes).length }} 节点 / {{ Object.keys(graphData.edges).length }} 边</span>
        <span v-else>· {{ sortedPackNodes.length }} 节点{{ listShowAll ? '（全部）' : '' }}</span>
        <span v-if="isLoading" class="status-loading">⏳</span>
        <span v-if="graphError" class="status-error">⚠️</span>
      </div>

      <!-- Pack 选择器 -->
      <div v-if="availablePacks.length > 1" class="pack-selector">
        <label class="pack-selector-label">章节：</label>
        <div class="pack-selector-buttons">
          <button
            v-for="pack in availablePacks"
            :key="pack.id"
            :class="['pack-btn', { active: selectedPackId === pack.id }]"
            type="button"
            @click="selectedPackId = pack.id"
          >
            {{ pack.shortTitle }}
            <span class="pack-btn-count">{{ pack.expectedNodeCount }}</span>
          </button>
        </div>
      </div>

      <div class="legend">
        <span class="legend-item"><span class="legend-symbol mastered">✓</span> 已掌握 (≥80%)</span>
        <span class="legend-item"><span class="legend-symbol learning">↗</span> 学习中 (40-79%)</span>
        <span class="legend-item"><span class="legend-symbol needs-work">!</span> 待加强 (&lt;40%)</span>
        <span class="legend-item"><span class="legend-symbol not-started">◇</span> 未评估</span>
      </div>
      <div class="view-toggle">
        <button
          :class="['toggle-btn', { active: viewMode === 'list' }]"
          @click="viewMode = 'list'"
        >
          列表
        </button>
        <button
          :class="['toggle-btn', { active: viewMode === 'graph' }]"
          @click="viewMode = 'graph'"
        >
          图谱
        </button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="graphError" class="error-banner">
      ⚠️ {{ graphError }}
      <button class="dismiss-btn" @click="graphError = null">×</button>
    </div>

    <!-- 节点数过多提示 -->
    <div v-if="isCapped && viewMode === 'graph'" class="cap-banner">
      当前章节节点较多（{{ filteredGraphNodes.length }} 个），仅显示前 {{ MAX_GRAPH_NODES }} 个；完整内容请查看列表。
    </div>

    <!-- 图谱视图 -->
    <div v-if="viewMode === 'graph'" class="graph-container">
      <VNetworkGraph
        v-if="Object.keys(graphData.nodes).length"
        :nodes="graphData.nodes"
        :edges="graphData.edges"
        :layouts="graphData.layouts"
        :configs="configs"
        :event-handlers="eventHandlers"
        class="graph-canvas"
      >
        <template #override-node="{ nodeId }">
          <g :class="['talent-node-token', `state-${getNodeVisualState(nodeId)}`]">
            <circle class="talent-node-halo" r="28" :fill="getNodeColor(nodeId)" />
            <circle class="talent-node-core" r="22" :fill="getNodeColor(nodeId)" />
            <circle class="talent-node-inner" r="15" />
            <text class="talent-node-icon" text-anchor="middle" dominant-baseline="central">
              {{ getNodeVisualIcon(nodeId) }}
            </text>
            <circle
              v-if="selectedNode === nodeId"
              class="talent-node-selection"
              r="30"
            />
          </g>
        </template>
      </VNetworkGraph>
      <div v-else class="empty-state">
        <p v-if="isLoading">正在加载图谱数据…</p>
        <p v-else>暂无知识图谱数据。请切换到列表视图查看节点。</p>
      </div>
    </div>

    <!-- 列表视图（默认） -->
    <div v-if="viewMode === 'list'" class="node-list">
      <!-- 列表模式切换：全部 / 当前 pack -->
      <div v-if="availablePacks.length > 1" class="list-toggle">
        <button
          :class="['toggle-btn', 'toggle-btn-sm', { active: listShowAll }]"
          type="button"
          @click="listShowAll = true; resetVisibleLimit()"
        >
          全部 ({{ allPackNodes.length }})
        </button>
        <button
          :class="['toggle-btn', 'toggle-btn-sm', { active: !listShowAll }]"
          type="button"
          @click="listShowAll = false; resetVisibleLimit()"
        >
          当前章节 ({{ filteredGraphNodes.length }})
        </button>
      </div>

      <div v-if="isLoading" class="empty-state">
        <p>正在加载知识点…</p>
      </div>
      <div v-else-if="sortedPackNodes.length === 0" class="empty-state">
        <p>暂无知识点数据。</p>
      </div>
      <div
        v-for="node in visibleNodes"
        :key="node.id"
        class="node-list-item"
        :style="{ borderLeftColor: getNodeColor(node.id) }"
        @click="selectNode(node.id)"
      >
        <div class="node-list-header">
          <span class="node-list-title">{{ node.title }}</span>
          <span :class="['node-list-mastery', getNodeMasteryBadgeClass(node.id)]">{{ getNodeMasteryLabel(node.id) }}</span>
        </div>
        <p class="node-list-summary">{{ node.summary?.slice(0, 100) }}{{ (node.summary?.length ?? 0) > 100 ? '…' : '' }}</p>
        <div v-if="node.prerequisites && node.prerequisites.length" class="node-list-prereqs">
          前置：{{ node.prerequisites.map(id => nodeIdToTitle.get(id) ?? id).join('、') }}
        </div>
      </div>

      <!-- 渐进渲染：显示更多 -->
      <div v-if="hasMoreNodes" class="show-more-bar">
        <button class="toggle-btn" type="button" @click="showMoreNodes">
          显示更多（{{ visibleNodes.length }} / {{ sortedPackNodes.length }}）
        </button>
      </div>
    </div>

    <!-- 选中节点详情 -->
    <div v-if="selectedNodeData" class="modal-overlay" @click.self="selectedNode = null">
      <div class="node-detail modal-dialog">
        <div class="node-detail-header">
          <h3>{{ selectedNodeData.title }}</h3>
          <div class="header-actions">
            <span :class="['status-badge', getNodeMasteryBadgeClass(selectedNode!)]">
              {{ getNodeMasteryBadgeText(selectedNode!) }}
            </span>
            <button class="close-btn" @click="selectedNode = null">×</button>
          </div>
        </div>

      <!-- 摘要 -->
      <div v-if="selectedNodeSummary" class="detail-summary">
        <MessageRenderer :content="selectedNodeSummary" />
      </div>

      <!-- 所属学科和 Pack -->
      <div class="detail-row">
        <span class="detail-label">学科：</span>
        <span>{{ subjectLabel(subjectCode) }}</span>
      </div>
      <div v-if="selectedNodePackTitle" class="detail-row">
        <span class="detail-label">章节：</span>
        <span>{{ selectedNodePackTitle }}</span>
      </div>

      <!-- 掌握度（仅真实学习记录显示百分比） -->
      <div v-if="selectedNodeHasRealData" class="detail-row">
        <span class="detail-label">掌握度：</span>
        <div class="detail-bar-container">
          <div
            class="detail-bar"
            :style="{ width: `${Math.round(selectedNodeData.masteryProbability * 100)}%`, background: getMasteryColor(selectedNodeData) }"
          ></div>
        </div>
        <span>{{ Math.round(selectedNodeData.masteryProbability * 100) }}%</span>
      </div>
      <div v-else-if="selectedNodeIsColdStart" class="detail-row">
        <span class="detail-label">掌握度：</span>
        <span class="cold-start-note">尚无真实学习记录；系统内部先验不会作为进度展示。</span>
      </div>
      <div v-else-if="selectedNodeNeedsEvaluation" class="detail-row">
        <span class="detail-label">掌握度：</span>
        <span class="cold-start-note">已有练习记录，但尚未形成有效掌握度证据；暂不展示 50% 先验值。</span>
      </div>
      <div v-if="selectedNodeData.attemptsCount > 0" class="detail-row">
        <span class="detail-label">练习次数：</span>
        <span>{{ selectedNodeData.attemptsCount }} 次（正确 {{ selectedNodeData.correctCount }} 次）</span>
      </div>

      <!-- 前置知识 -->
      <div class="detail-prereqs">
        <span class="detail-label">前置知识：</span>
        <span v-if="!selectedNodePrereqs.length">无（基础节点）</span>
        <span
          v-for="p in selectedNodePrereqs"
          :key="p.prerequisiteNodeId"
          class="prereq-tag"
          :title="p.prerequisiteNodeId"
        >
          {{ nodeIdToTitle.get(p.prerequisiteNodeId) ?? p.prerequisiteNodeId }}
        </span>
      </div>

      <!-- 操作按钮 -->
      <div class="detail-actions">
        <button
          class="action-btn action-btn-primary"
          type="button"
          @click="askTutorToExplain"
        >
          让导师讲解
        </button>
        <button
          class="action-btn action-btn-secondary"
          type="button"
          @click="askForPractice"
        >
          出一道练习
        </button>
      </div>
    </div>
    </div>

    <!-- 知识库管理入口 -->
    <div class="settings-hint">
      <span>数据数量异常？请到 设置 → 知识库管理 → 健康检查 处理孤立节点。</span>
      <router-link class="settings-hint-link" :to="{ path: '/settings', query: { scrollTo: 'knowledge-management' } }">
        打开知识库管理
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.knowledge-graph-view {
  max-width: 1200px; /* Expand to 1200px while we are at it */
  width: 100%;
  margin: 0 auto;
  padding: 28px 34px 42px;
}

.graph-header {
  margin-bottom: 20px;
  padding: 26px;
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.92);
  box-shadow: 0 16px 34px rgba(44, 38, 27, 0.07);
}

.graph-header h2 {
  margin: 0 0 4px;
  font-size: 1.8rem;
  font-weight: 600;
}

.graph-subtitle {
  margin: 0 0 8px;
  color: #666;
  font-size: 0.9rem;
}

/* ── 简化状态条 ─────────────────────────────────────────── */

.status-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid rgba(214, 207, 193, 0.72);
  background: #fffdf8;
  border-radius: 6px;
  font-size: 0.75rem;
  color: #888;
  margin-bottom: 10px;
}

.status-loading { color: #4a90d9; }
.status-error { color: #e65100; }

/* ── Pack 选择器 ─────────────────────────────────────────── */

.pack-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.pack-selector-label {
  font-size: 0.8rem;
  color: #666;
  font-weight: 500;
}

.pack-selector-buttons {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.pack-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  background: #fffdf8;
  color: #555;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s;
}

.pack-btn:hover {
  border-color: var(--atlas-blue);
  color: var(--atlas-blue);
}

.pack-btn.active {
  background: linear-gradient(135deg, var(--atlas-navy), var(--atlas-blue));
  border-color: var(--atlas-blue);
  color: #fff;
}

.pack-btn-count {
  font-size: 0.65rem;
  opacity: 0.7;
}

/* ── 图例 & 视图切换 ─────────────────────────────────────── */

.legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #555;
}

.legend-symbol {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1;
}

.legend-symbol.mastered { background: #4caf50; }
.legend-symbol.learning { background: #ff9800; }
.legend-symbol.needs-work { background: #f44336; }
.legend-symbol.not-started { background: #9e9e9e; }

.view-toggle {
  display: flex;
  gap: 4px;
}

.toggle-btn {
  padding: 4px 12px;
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 6px;
  background: #fffdf8;
  color: #666;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-btn:hover {
  border-color: var(--atlas-blue);
  color: var(--atlas-blue);
}

.toggle-btn.active {
  background: linear-gradient(135deg, var(--atlas-navy), var(--atlas-blue));
  border-color: var(--atlas-blue);
  color: #fff;
}

.toggle-btn-sm {
  padding: 2px 8px;
  font-size: 0.7rem;
}

/* ── 提示横幅 ───────────────────────────────────────────── */

.error-banner,
.cap-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 0.85rem;
}

.error-banner {
  background: #fff3e0;
  border: 1px solid #ffe0b2;
  color: #e65100;
}

.cap-banner {
  background: #e3f2fd;
  border: 1px solid #bbdefb;
  color: #1565c0;
}

.dismiss-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  color: #e65100;
  cursor: pointer;
  padding: 0 4px;
}

/* ── 图谱容器 ───────────────────────────────────────────── */

.graph-container {
  background: rgba(255, 253, 248, 0.94);
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
  height: 450px;
  min-height: 300px;
}

.graph-canvas {
  width: 100%;
  height: 100%;
}

.talent-node-token {
  cursor: pointer;
  transition: filter 0.18s ease;
}

.talent-node-token:hover {
  filter: brightness(1.06) drop-shadow(0 4px 6px rgba(17, 51, 85, 0.22));
}

.talent-node-halo {
  opacity: 0.18;
}

.talent-node-core {
  stroke: rgba(255, 255, 255, 0.94);
  stroke-width: 2;
}

.talent-node-inner {
  fill: rgba(255, 255, 255, 0.16);
}

.talent-node-icon {
  fill: #fff;
  font-size: 17px;
  font-weight: 800;
  pointer-events: none;
  user-select: none;
}

.state-not_started .talent-node-icon {
  fill: #fff;
}

.talent-node-selection {
  fill: none;
  stroke: var(--atlas-blue);
  stroke-width: 3;
  stroke-dasharray: 4 3;
}

/* Modal 覆盖层 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.modal-dialog {
  width: 90%;
  max-width: 500px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
}

/* 节点详情 */
.node-detail {
  padding: 24px;
  background: #fffdf8;
  border-radius: 8px;
}

.node-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.node-detail-header h3 {
  margin: 0;
  font-size: 1.25rem;
  line-height: 1.4;
  flex: 1;
  padding-right: 12px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  color: #9e9e9e;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  color: #f44336;
  background: #ffebee;
}

.status-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
}

.status-mastered {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-learning {
  background: #fff3e0;
  color: #e65100;
}

.status-weak {
  background: #fce4ec;
  color: #c62828;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.9rem;
}

.detail-label {
  font-weight: 500;
  min-width: 70px;
}

.detail-bar-container {
  flex: 1;
  height: 8px;
  background: #f0f0f0;
  border-radius: 4px;
  overflow: hidden;
}

.detail-bar {
  height: 100%;
  border-radius: 4px;
}

.detail-prereqs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 0.9rem;
}

.prereq-tag {
  padding: 2px 8px;
  background: var(--atlas-blue-soft);
  border-radius: 8px;
  font-size: 0.8rem;
}

.detail-summary {
  margin: 0 0 12px;
  font-size: 0.85rem;
  color: #555;
  line-height: 1.5;
}

.cold-start-note {
  font-size: 0.8rem;
  color: #888;
  font-style: italic;
}

/* ── 操作按钮 ───────────────────────────────────────────── */

.detail-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.action-btn {
  padding: 8px 16px;
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.action-btn-primary {
  background: linear-gradient(135deg, var(--atlas-navy), var(--atlas-blue));
  border-color: var(--atlas-blue);
  color: #fff;
}

.action-btn-primary:hover {
  background: #1565c0;
}

.action-btn-secondary {
  background: #fffdf8;
  border-color: var(--atlas-blue);
  color: var(--atlas-blue);
}

.action-btn-secondary:hover {
  background: #e3f2fd;
}

/* ── 冷启动状态 badge ───────────────────────────────────── */

.status-cold {
  background: #f5f5f5;
  color: #9e9e9e;
}

.status-insufficient {
  background: #fff3e0;
  color: #e65100;
}

/* ── 列表视图 ───────────────────────────────────────────── */

.list-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #999;
}

.node-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.node-list-item {
  padding: 12px 14px;
  background: rgba(255, 253, 248, 0.94);
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-left: 4px solid #9e9e9e;
  border-radius: 8px;
  cursor: pointer;
  transition: box-shadow 0.2s;
  content-visibility: auto;
  contain-intrinsic-size: auto 80px;
}

.node-list-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.node-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.node-list-title {
  font-weight: 500;
  font-size: 0.9rem;
  color: #333;
}

.node-list-mastery {
  font-size: 0.75rem;
  color: #666;
  background: #f5f5f5;
  padding: 2px 8px;
  border-radius: 10px;
}

.node-list-summary {
  margin: 0 0 4px;
  font-size: 0.8rem;
  color: #666;
  line-height: 1.4;
}

.node-list-prereqs {
  font-size: 0.75rem;
  color: #999;
}

/* ── 渐进渲染 / 设置入口 ───────────────────────────────────── */

.show-more-bar {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}

.settings-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  margin-top: 20px;
  background: #fffdf8;
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  font-size: 0.8rem;
  color: #666;
}

.settings-hint-link {
  flex-shrink: 0;
  padding: 4px 12px;
  border: 1px solid var(--atlas-blue);
  border-radius: 6px;
  background: #fff;
  color: var(--atlas-blue);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.15s;
}

.settings-hint-link:hover {
  background: #e3f2fd;
}
</style>
