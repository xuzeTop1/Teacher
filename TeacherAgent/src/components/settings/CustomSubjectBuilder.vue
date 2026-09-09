<script setup lang="ts">
import { computed, ref, onMounted } from "vue"
import { safeExternalHttpUrl } from "../../utils/errorMessage"
import { useAppStore } from "../../stores/app"
import {
  bochaWebSearch,
  completeLlmChat,
  createCustomSubject,
  listCustomSubjects,
  deleteCustomSubject,
  generateKnowledgeFromSources,
  saveBochaApiKey,
  hasBochaApiKey,
  deleteBochaApiKey
} from "../../services/tauri/commands"
import type { WebSearchResult, CustomSubject, SourceItem } from "../../services/tauri/commands"

interface TopicSearchResult extends WebSearchResult {
  topic: string
  searchQuery: string
}

// ── State ──────────────────────────────────────────────────────────

const appStore = useAppStore()
const currentStep = ref(1)
const isCreating = ref(false)

// Step 1: Subject info
const subjectName = ref("")
const subjectDescription = ref("")
const scopeKeywords = ref("")

// Step 2: Search
const bochaApiKeyInput = ref("")
const bochaKeySaved = ref(false)
const searchQuery = ref("")
const searchResults = ref<TopicSearchResult[]>([])
const isSearching = ref(false)
const searchError = ref("")
const keyError = ref("")
const searchProgressText = ref("")

// Step 3: Confirm sources
const selectedSources = ref<Set<number>>(new Set())

// Step 4: Generate
const isGenerating = ref(false)
const generateMessage = ref("")
const generateStatus = ref<"idle" | "success" | "error">("idle")
const generationMode = ref<"llm" | "fallback">("fallback")

// Existing subjects
const existingSubjects = ref<CustomSubject[]>([])
const isLoadingSubjects = ref(false)

// ── Computed ───────────────────────────────────────────────────────

const canProceedStep1 = computed(() => subjectName.value.trim().length > 0)
const canProceedStep2 = computed(() => searchResults.value.length > 0)
const canProceedStep3 = computed(() => selectedSources.value.size > 0)

const selectedSourcesList = computed(() => {
  return Array.from(selectedSources.value).map(i => searchResults.value[i])
})

const searchTopics = computed(() => parseTopics(scopeKeywords.value || subjectName.value))

const topicCoverage = computed(() => {
  return searchTopics.value.map(topic => ({
    topic,
    count: searchResults.value.filter(result => result.topic === topic).length,
    selectedCount: selectedSourcesList.value.filter(result => result.topic === topic).length
  }))
})

function safeSearchResultUrl(value: string) {
  return safeExternalHttpUrl(value)
}

// ── Lifecycle ──────────────────────────────────────────────────────

onMounted(async () => {
  try {
    bochaKeySaved.value = await hasBochaApiKey()
  } catch {
    bochaKeySaved.value = false
  }
  loadExistingSubjects()
})

// ── Methods ────────────────────────────────────────────────────────

async function handleSaveBochaKey() {
  keyError.value = ""
  const key = bochaApiKeyInput.value.trim()
  if (!key) {
    keyError.value = "请输入 API Key"
    return
  }
  try {
    await saveBochaApiKey(key)
    bochaKeySaved.value = true
    bochaApiKeyInput.value = ""
  } catch (e) {
    keyError.value = `保存失败: ${e}`
  }
}

async function handleDeleteBochaKey() {
  try {
    await deleteBochaApiKey()
    bochaKeySaved.value = false
  } catch (e) {
    keyError.value = `清除失败: ${e}`
  }
}

async function loadExistingSubjects() {
  isLoadingSubjects.value = true
  try {
    const subjects = await listCustomSubjects()
    existingSubjects.value = subjects
    appStore.setCustomSubjects(subjects)
  } catch (e) {
    console.error("Failed to load custom subjects:", e)
  } finally {
    isLoadingSubjects.value = false
  }
}

async function handleSearch() {
  if (!bochaKeySaved.value || !searchQuery.value.trim()) return

  isSearching.value = true
  searchError.value = ""
  searchProgressText.value = ""
  searchResults.value = []
  selectedSources.value = new Set()

  try {
    const topics = parseTopics(searchQuery.value)
    const merged = new Map<string, TopicSearchResult>()
    const errors: string[] = []

    for (const [index, topic] of topics.entries()) {
      const query = buildTopicSearchQuery(topic)
      searchProgressText.value = `正在搜索 ${index + 1}/${topics.length}：${topic}`

      try {
        const response = await bochaWebSearch(query, 8, "noLimit")
        for (const result of response.results) {
          const key = normalizeSourceKey(result.url || result.title)
          if (!key || merged.has(key)) continue
          merged.set(key, {
            ...result,
            topic,
            searchQuery: query
          })
        }
      } catch (e) {
        errors.push(`${topic}: ${e}`)
      }
    }

    const results = Array.from(merged.values())
    searchResults.value = results
    selectedSources.value = createBalancedInitialSelection(results, topics, 3)

    if (results.length === 0) {
      searchError.value = "未找到相关结果，请尝试其他关键词"
    } else if (errors.length > 0) {
      searchError.value = `部分关键词搜索失败：${errors.join("；")}`
    }
  } catch (e) {
    searchError.value = `搜索失败: ${e}`
  } finally {
    isSearching.value = false
    searchProgressText.value = ""
  }
}

function toggleSource(index: number) {
  const set = new Set(selectedSources.value)
  if (set.has(index)) {
    set.delete(index)
  } else {
    set.add(index)
  }
  selectedSources.value = set
}

function selectAllSources() {
  selectedSources.value = new Set(searchResults.value.map((_, i) => i))
}

function clearSelection() {
  selectedSources.value = new Set()
}

async function handleGenerate() {
  isGenerating.value = true
  generateMessage.value = ""
  generateStatus.value = "idle"

  try {
    // Create the custom subject
    const subject = await createCustomSubject(
      subjectName.value.trim(),
      subjectDescription.value.trim() || undefined,
      scopeKeywords.value.trim() || undefined
    )
    appStore.addCustomSubject(subject)

    const selectedWebSources: SourceItem[] = selectedSourcesList.value.map(r => ({
      title: r.title,
      url: r.url,
      summary: `[${r.topic}] ${r.summary}`,
      siteName: r.siteName || r.topic
    }))

    const topics = searchTopics.value
    const llmSources = await generateLlmCuratedSources(topics, selectedSourcesList.value)
    generationMode.value = llmSources.length > 0 ? "llm" : "fallback"
    const sources = [...llmSources, ...selectedWebSources]

    // Generate knowledge nodes
    const count = await generateKnowledgeFromSources(subject.id, sources, topics)

    generateStatus.value = "success"
    generateMessage.value = generationMode.value === "llm"
      ? `成功创建学科「${subject.name}」，已用 LLM 归纳主题大纲并生成 ${count} 个知识条目`
      : `成功创建学科「${subject.name}」，生成了 ${count} 个知识条目（未配置可用 LLM，已使用搜索摘要降级生成）`

    // Reset form
    setTimeout(() => {
      currentStep.value = 1
      subjectName.value = ""
      subjectDescription.value = ""
      scopeKeywords.value = ""
      searchQuery.value = ""
      searchResults.value = []
      selectedSources.value = new Set()
      generateStatus.value = "idle"
      loadExistingSubjects()
    }, 2000)
  } catch (e) {
    generateStatus.value = "error"
    generateMessage.value = `生成失败: ${e}`
  } finally {
    isGenerating.value = false
  }
}

async function handleDeleteSubject(subjectId: string) {
  if (!confirm("确定删除此自建学科？关联的知识条目也将被删除。")) return

  try {
    await deleteCustomSubject(subjectId)
    appStore.removeCustomSubject(subjectId)
    await loadExistingSubjects()
  } catch (e) {
    console.error("Failed to delete subject:", e)
  }
}

function nextStep() {
  if (currentStep.value < 4) {
    currentStep.value++
    if (currentStep.value === 2) {
      searchQuery.value = searchTopics.value.join("，") || subjectName.value
    }
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

function parseTopics(input: string): string[] {
  const topics = input
    .split(/[,，、;\n；。]+/)
    .map(topic => topic.trim())
    .map(topic => topic.replace(/^["'“”‘’]+|["'“”‘’]+$/g, ""))
    .filter(Boolean)
  return Array.from(new Set(topics)).slice(0, 8)
}

function buildTopicSearchQuery(topic: string): string {
  const name = subjectName.value.trim()
  const scope = subjectDescription.value.trim()
  return [name, topic, scope, "学习路线 核心概念 教程 课程"]
    .filter(Boolean)
    .join(" ")
}

function normalizeSourceKey(value: string): string {
  return value.trim().toLowerCase().replace(/#.*$/, "").replace(/\/$/, "")
}

function createBalancedInitialSelection(
  results: TopicSearchResult[],
  topics: string[],
  perTopic: number
): Set<number> {
  const selected = new Set<number>()
  for (const topic of topics) {
    results.forEach((result, index) => {
      if (result.topic === topic && Array.from(selected).filter(i => results[i]?.topic === topic).length < perTopic) {
        selected.add(index)
      }
    })
  }
  return selected
}

async function generateLlmCuratedSources(
  topics: string[],
  sources: TopicSearchResult[]
): Promise<SourceItem[]> {
  if (!appStore.hasUsableProviderConfig || !appStore.activeLlmConfig || topics.length === 0 || sources.length === 0) {
    return []
  }

  const compactSources = sources.slice(0, 24).map((source, index) => ({
    index: index + 1,
    topic: source.topic,
    title: source.title,
    siteName: source.siteName,
    url: source.url,
    summary: source.summary
  }))

  try {
    const result = await completeLlmChat(appStore.activeLlmConfig, {
      temperature: 0.2,
      maxTokens: 2200,
      messages: [
        {
          role: "system",
          content:
            "你是 TeacherAgent 的本地知识库策划器。你只能基于用户确认的搜索结果做学习型摘要，不得虚构来源、不得复制长段网页原文。输出必须是 JSON。"
        },
        {
          role: "user",
          content: JSON.stringify({
            task:
              "为自建学科生成覆盖每个 topic 的知识节点。每个 topic 生成 1 个 overview 节点；如果必要，可再生成 1 个 prerequisite 或 misconception 节点。summary 应面向学习者，包含核心定义、学习顺序、常见误区和可追问问题，控制在 260-420 中文字。",
            subject: subjectName.value.trim(),
            description: subjectDescription.value.trim(),
            topics,
            confirmedSources: compactSources,
            outputSchema: {
              nodes: [
                {
                  topic: "主题关键词",
                  title: "知识节点标题",
                  summary: "综合摘要，不复制长段原文",
                  sourceIndexes: [1, 2]
                }
              ]
            }
          })
        }
      ]
    })

    const parsed = parseLlmJson(result.content)
    const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : []

    return nodes
      .map((node: Record<string, unknown>, index: number) => {
        const title = typeof node.title === "string" ? node.title.trim() : ""
        const summary = typeof node.summary === "string" ? node.summary.trim() : ""
        const topic = typeof node.topic === "string" ? node.topic.trim() : topics[index % topics.length]
        const sourceIndexes = Array.isArray(node.sourceIndexes) ? node.sourceIndexes : []
        const firstSourceIndex = Number(sourceIndexes[0]) - 1
        const firstSource = sources[firstSourceIndex] ?? sources.find(source => source.topic === topic) ?? sources[0]
        if (!title || !summary || !firstSource) return null
        return {
          title: `AI 归纳：${title}`,
          url: firstSource.url,
          summary: `[${topic}] ${summary}`,
          siteName: "LLM synthesized from confirmed sources"
        } satisfies SourceItem
      })
      .filter((source: SourceItem | null): source is SourceItem => Boolean(source))
      .slice(0, Math.max(topics.length, 12))
  } catch (e) {
    console.warn("LLM custom subject synthesis failed, falling back to web summaries:", e)
    return []
  }
}

function parseLlmJson(content: string): any {
  const trimmed = content.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

// ── Init ───────────────────────────────────────────────────────────
</script>

<template>
  <section class="settings-panel custom-subject-panel">
    <h2>自建学科</h2>
    <p class="panel-copy">
      创建自定义学科，通过网络搜索获取学习资料，生成本地知识库。
    </p>

    <!-- Existing subjects -->
    <div v-if="existingSubjects.length > 0" class="existing-subjects">
      <h3>已创建的学科</h3>
      <div
        v-for="subject in existingSubjects"
        :key="subject.id"
        class="subject-card"
      >
        <div class="subject-info">
          <span class="subject-name">{{ subject.name }}</span>
          <span v-if="subject.description" class="subject-desc">{{ subject.description }}</span>
          <span class="subject-status">{{ subject.reviewStatus === "draft" ? "草稿" : subject.reviewStatus }}</span>
        </div>
        <button
          class="action-button action-button-danger"
          type="button"
          @click="handleDeleteSubject(subject.id)"
        >
          删除
        </button>
      </div>
    </div>

    <!-- Wizard -->
    <div v-if="!isCreating" class="create-section">
      <button
        class="action-button action-button-primary"
        type="button"
        @click="isCreating = true"
      >
        <v-icon icon="mdi-plus" size="20" />
        <span>创建新学科</span>
      </button>
    </div>

    <div v-if="isCreating" class="wizard">
      <!-- Step indicator -->
      <div class="step-indicator">
        <div
          v-for="step in 4"
          :key="step"
          :class="['step-dot', { active: currentStep === step, completed: currentStep > step }]"
        >
          {{ step }}
        </div>
      </div>

      <!-- Step 1: Subject info -->
      <div v-if="currentStep === 1" class="step-content">
        <h3>步骤 1：学科信息</h3>
        <div class="form-group">
          <label>学科名称 *</label>
          <input
            v-model="subjectName"
            type="text"
            class="form-input"
            placeholder="例如：古希腊哲学、机器学习基础"
          />
        </div>
        <div class="form-group">
          <label>学科描述</label>
          <textarea
            v-model="subjectDescription"
            class="form-textarea"
            placeholder="简要描述这个学科的范围和目标"
            rows="3"
          ></textarea>
        </div>
        <div class="form-group">
          <label>搜索关键词</label>
          <input
            v-model="scopeKeywords"
            type="text"
            class="form-input"
            placeholder="用逗号分隔，例如：古希腊,苏格拉底,柏拉图"
          />
          <small>用于网络搜索，多个关键词用逗号分隔</small>
          <div v-if="searchTopics.length > 0" class="topic-chip-row">
            <span
              v-for="topic in searchTopics"
              :key="topic"
              class="topic-chip"
            >
              {{ topic }}
            </span>
          </div>
        </div>
        <div class="step-actions">
          <button
            class="action-button action-button-secondary"
            type="button"
            @click="isCreating = false"
          >
            取消
          </button>
          <button
            class="action-button action-button-primary"
            type="button"
            :disabled="!canProceedStep1"
            @click="nextStep"
          >
            下一步
          </button>
        </div>
      </div>

      <!-- Step 2: Search -->
      <div v-if="currentStep === 2" class="step-content">
        <h3>步骤 2：搜索学习资料</h3>
        <div class="form-group">
          <label>Bocha API Key</label>
          <div v-if="bochaKeySaved" class="key-status">
            <span class="key-saved">Key 已保存</span>
            <button class="action-button action-button-danger" type="button" @click="handleDeleteBochaKey">
              清除 Key
            </button>
          </div>
          <div v-else class="key-input-row">
            <input
              v-model="bochaApiKeyInput"
              type="password"
              class="form-input"
              placeholder="输入你的 Bocha API Key"
            />
            <button class="action-button action-button-primary" type="button" @click="handleSaveBochaKey">
              保存 Key
            </button>
          </div>
          <div v-if="keyError" class="error-text">{{ keyError }}</div>
          <small>
            Key 保存在系统凭据存储中，不经过前端明文持久化。
            前往 <a href="https://open.bochaai.com" target="_blank" rel="noopener">open.bochaai.com</a> 获取 API Key。
          </small>
        </div>
        <div class="form-group">
          <label>搜索关键词</label>
          <div class="search-row">
            <input
              v-model="searchQuery"
              type="text"
              class="form-input"
              placeholder="输入搜索关键词"
              @keyup.enter="handleSearch"
            />
            <button
              class="action-button action-button-primary"
              type="button"
              :disabled="isSearching || !bochaKeySaved || !searchQuery.trim()"
              @click="handleSearch"
            >
              {{ isSearching ? "搜索中..." : "搜索" }}
            </button>
          </div>
          <small>会按每个关键词分别搜索，再合并去重，避免单一主题挤掉其它主题。</small>
          <div v-if="searchProgressText" class="progress-text">{{ searchProgressText }}</div>
        </div>

        <v-alert
          v-if="searchError"
          type="warning"
          variant="tonal"
          class="mt-2"
        >
          {{ searchError }}
        </v-alert>

        <div v-if="searchResults.length > 0" class="search-results">
          <p class="results-count">找到 {{ searchResults.length }} 条结果</p>
          <div class="topic-coverage">
            <span
              v-for="item in topicCoverage"
              :key="item.topic"
              :class="['coverage-pill', { empty: item.count === 0 }]"
            >
              {{ item.topic }}：{{ item.count }} 条，已选 {{ item.selectedCount }}
            </span>
          </div>
        </div>

        <div class="step-actions">
          <button
            class="action-button action-button-secondary"
            type="button"
            @click="prevStep"
          >
            上一步
          </button>
          <button
            class="action-button action-button-primary"
            type="button"
            :disabled="!canProceedStep2"
            @click="nextStep"
          >
            下一步
          </button>
        </div>
      </div>

      <!-- Step 3: Confirm sources -->
      <div v-if="currentStep === 3" class="step-content">
        <h3>步骤 3：选择资料来源</h3>
        <div class="selection-actions">
          <button
            class="action-button action-button-secondary"
            type="button"
            @click="selectAllSources"
          >
            全选
          </button>
          <button
            class="action-button action-button-secondary"
            type="button"
            @click="clearSelection"
          >
            清空
          </button>
          <span class="selection-count">已选 {{ selectedSources.size }} 项</span>
        </div>
        <div class="source-list">
          <div
            v-for="(result, index) in searchResults"
            :key="index"
            :class="['source-item', { selected: selectedSources.has(index) }]"
            @click="toggleSource(index)"
          >
            <input
              type="checkbox"
              :checked="selectedSources.has(index)"
              class="source-checkbox"
            />
            <div class="source-info">
              <a
                v-if="safeSearchResultUrl(result.url)"
                :href="safeSearchResultUrl(result.url)"
                target="_blank"
                rel="noopener"
                class="source-title"
                @click.stop
              >
                {{ result.title }}
              </a>
              <span v-else class="source-title">{{ result.title }}</span>
              <span class="source-topic">{{ result.topic }}</span>
              <span class="source-site">{{ result.siteName }}</span>
              <p class="source-summary">{{ result.summary }}</p>
            </div>
          </div>
        </div>
        <div class="step-actions">
          <button
            class="action-button action-button-secondary"
            type="button"
            @click="prevStep"
          >
            上一步
          </button>
          <button
            class="action-button action-button-primary"
            type="button"
            :disabled="!canProceedStep3"
            @click="nextStep"
          >
            下一步
          </button>
        </div>
      </div>

      <!-- Step 4: Generate -->
      <div v-if="currentStep === 4" class="step-content">
        <h3>步骤 4：生成知识库</h3>
        <div class="generate-summary">
          <p><strong>学科名称：</strong>{{ subjectName }}</p>
          <p v-if="subjectDescription"><strong>描述：</strong>{{ subjectDescription }}</p>
          <p><strong>覆盖主题：</strong>{{ searchTopics.join("、") }}</p>
          <p><strong>选中来源：</strong>{{ selectedSources.size }} 条</p>
          <p class="generate-mode-note">
            {{ appStore.hasUsableProviderConfig ? "将优先调用当前 LLM，对已确认来源做主题化归纳后入库。" : "未配置可用 LLM，将使用搜索摘要降级生成 draft 知识条目。" }}
          </p>
          <div class="selected-preview">
            <div
              v-for="source in selectedSourcesList"
              :key="source.url"
              class="preview-item"
            >
              <span>{{ source.topic }}</span>
              {{ source.title }}
            </div>
          </div>
        </div>

        <v-alert
          v-if="generateStatus !== 'idle'"
          :type="generateStatus === 'success' ? 'success' : 'error'"
          variant="tonal"
          class="mt-2"
        >
          {{ generateMessage }}
        </v-alert>

        <div class="step-actions">
          <button
            class="action-button action-button-secondary"
            type="button"
            :disabled="isGenerating"
            @click="prevStep"
          >
            上一步
          </button>
          <button
            class="action-button action-button-primary"
            type="button"
            :disabled="isGenerating"
            @click="handleGenerate"
          >
            {{ isGenerating ? "生成中..." : "生成知识库" }}
          </button>
        </div>
      </div>

      <!-- Cancel button -->
      <button
        class="cancel-link"
        type="button"
        @click="isCreating = false"
      >
        取消创建
      </button>
    </div>
  </section>
</template>

<style scoped>
.custom-subject-panel {
  margin-top: 1.5rem;
}

.panel-copy {
  color: rgba(0, 0, 0, 0.6);
  margin-bottom: 1rem;
}

.existing-subjects {
  margin-bottom: 1.5rem;
}

.existing-subjects h3 {
  font-size: 0.95rem;
  margin-bottom: 0.75rem;
  color: rgba(0, 0, 0, 0.7);
}

.subject-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  margin-bottom: 0.5rem;
}

.subject-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.subject-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.subject-desc {
  font-size: 0.85rem;
  color: rgba(0, 0, 0, 0.6);
}

.subject-status {
  font-size: 0.75rem;
  color: rgba(0, 0, 0, 0.5);
  text-transform: uppercase;
}

.create-section {
  margin-top: 1rem;
}

.wizard {
  margin-top: 1.5rem;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  padding: 1.5rem;
}

.step-indicator {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.step-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.08);
  color: rgba(0, 0, 0, 0.5);
  transition: all 0.2s;
}

.step-dot.active {
  background: #4a90d9;
  color: white;
}

.step-dot.completed {
  background: #4caf50;
  color: white;
}

.step-content h3 {
  font-size: 1rem;
  margin-bottom: 1rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  font-size: 0.9rem;
  font-weight: 500;
  margin-bottom: 0.4rem;
  color: rgba(0, 0, 0, 0.7);
}

.form-group small {
  display: block;
  font-size: 0.8rem;
  color: rgba(0, 0, 0, 0.5);
  margin-top: 0.25rem;
}

.topic-chip-row,
.topic-coverage {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.65rem;
}

.topic-chip,
.coverage-pill,
.source-topic {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 600;
}

.topic-chip {
  padding: 0.24rem 0.58rem;
  background: #e7f0fc;
  color: #0d3264;
  border: 1px solid rgba(46, 108, 183, 0.18);
}

.coverage-pill {
  padding: 0.28rem 0.66rem;
  background: #eef8f0;
  color: #276749;
  border: 1px solid rgba(61, 138, 98, 0.22);
}

.coverage-pill.empty {
  background: #fff7ed;
  color: #9a3412;
  border-color: rgba(214, 154, 45, 0.32);
}

.progress-text {
  margin-top: 0.5rem;
  color: #4a90d9;
  font-size: 0.82rem;
}

.form-input {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: #4a90d9;
}

.form-textarea {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  font-size: 0.9rem;
  outline: none;
  resize: vertical;
  font-family: inherit;
  transition: border-color 0.2s;
}

.form-textarea:focus {
  border-color: #4a90d9;
}

.search-row {
  display: flex;
  gap: 0.5rem;
}

.search-row .form-input {
  flex: 1;
}

.results-count {
  font-size: 0.85rem;
  color: rgba(0, 0, 0, 0.6);
  margin: 0.75rem 0;
}

.selection-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.selection-count {
  margin-left: auto;
  font-size: 0.85rem;
  color: rgba(0, 0, 0, 0.6);
}

.source-list {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
}

.source-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  cursor: pointer;
  transition: background 0.15s;
}

.source-item:hover {
  background: rgba(0, 0, 0, 0.02);
}

.source-item.selected {
  background: rgba(25, 118, 210, 0.06);
}

.source-checkbox {
  margin-top: 0.2rem;
  flex-shrink: 0;
}

.source-info {
  flex: 1;
  min-width: 0;
}

.source-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: #4a90d9;
  text-decoration: none;
}

.source-title:hover {
  text-decoration: underline;
}

.source-topic {
  margin-left: 0.5rem;
  padding: 0.12rem 0.45rem;
  background: #f2eadc;
  color: #7a4e12;
}

.source-site {
  font-size: 0.75rem;
  color: rgba(0, 0, 0, 0.5);
  margin-left: 0.5rem;
}

.source-summary {
  font-size: 0.82rem;
  color: rgba(0, 0, 0, 0.6);
  margin: 0.25rem 0 0;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.generate-summary {
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.generate-summary p {
  margin: 0.25rem 0;
  font-size: 0.9rem;
}

.generate-mode-note {
  color: #4a5568;
  line-height: 1.55;
}

.selected-preview {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}

.preview-item {
  font-size: 0.82rem;
  color: rgba(0, 0, 0, 0.6);
  padding: 0.2rem 0;
}

.preview-item span {
  display: inline-flex;
  margin-right: 0.45rem;
  padding: 0.08rem 0.4rem;
  border-radius: 999px;
  background: #e7f0fc;
  color: #0d3264;
  font-size: 0.72rem;
  font-weight: 700;
}

.step-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
  justify-content: flex-end;
}

.cancel-link {
  display: block;
  margin: 1rem auto 0;
  background: none;
  border: none;
  color: rgba(0, 0, 0, 0.5);
  font-size: 0.85rem;
  cursor: pointer;
  text-decoration: underline;
}

.cancel-link:hover {
  color: rgba(0, 0, 0, 0.7);
}

.action-button {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
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
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.7);
}

.action-button-secondary:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.1);
}

.action-button-danger {
  background: #d32f2f;
  color: white;
  font-size: 0.8rem;
  padding: 0.35rem 0.75rem;
}

.action-button-danger:hover:not(:disabled) {
  background: #c62828;
}

.mt-2 {
  margin-top: 0.75rem;
}

.key-status {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.key-saved {
  color: #2e7d32;
  font-size: 0.85rem;
  font-weight: 500;
}

.key-input-row {
  display: flex;
  gap: 0.5rem;
}

.key-input-row .form-input {
  flex: 1;
}

.error-text {
  color: #c62828;
  font-size: 0.8rem;
  margin-top: 0.25rem;
}
</style>
