<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import ChatComposer from "../components/chat/ChatComposer.vue"
import ConversationSidebar from "../components/chat/ConversationSidebar.vue"
import ConversationTitleBar from "../components/chat/ConversationTitleBar.vue"
import LearningPanel from "../components/chat/LearningPanel.vue"
import DocumentContextPanel from "../components/chat/DocumentContextPanel.vue"
import MessageList from "../components/chat/MessageList.vue"
import MessageRenderer from "../components/chat/MessageRenderer.vue"
import ProviderSelector from "../components/chat/ProviderSelector.vue"
import PythonPlayground from "../components/chat/PythonPlayground.vue"
import {
  createGuardrailSummaryJson,
  createKnowledgeRefsJson,
  createTutorTurnToolRefsJson
} from "../components/chat/chatMessageMetadata"
import { createTutorOrchestrator } from "../engine/agents/tutorOrchestrator"
import { shouldTriggerPlanner } from "../engine/agents/plannerAgent"
import { isTurnAborted } from "../services/llm/turnAbort"
import { sanitizeErrorMessage } from "../utils/errorMessage"
import type { ChatAttachment, ChatMessage } from "../types/chat"
import { useAppStore } from "../stores/app"
import { usePackSelectionStore } from "../stores/packSelection"
import { useConversationManager } from "../composables/useConversationManager"
import { useDocumentImport } from "../composables/useDocumentImport"
import { useStreamingTurn } from "../composables/useStreamingTurn"
import { useChatAutoScroll } from "../composables/useChatAutoScroll"
import { useKnowledgeSearch } from "../composables/useKnowledgeSearch"

const appStore = useAppStore()
const packSelectionStore = usePackSelectionStore()
const tutorOrchestrator = createTutorOrchestrator()
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)
const draft = ref("")
const showPythonPlayground = ref(appStore.selectedSubject === "programming")

// ── Composables ──────────────────────────────────────────────────

const { scrollMessagesToBottom, scrollMessagesToBottomIfNear } = useChatAutoScroll(messageListRef)

const documentImport = useDocumentImport({
  conversationId: () => conversationId.value,
  isSending: () => isSending.value,
  onPushMessage: (msg) => messages.value.push(msg),
  onPersistMessage: (msg, convId) => persistChatMessage(msg, convId),
  onScrollToBottom: () => scrollMessagesToBottom()
})

const conversation = useConversationManager({
  onScrollToBottom: scrollMessagesToBottom,
  onClearDocumentState: () => documentImport.clearState()
})

const streaming = useStreamingTurn()
const search = useKnowledgeSearch()

// Destructure refs for template auto-unwrap
const {
  conversations, conversationId, messages, isLoadingHistory, isGeneratingTitle,
  showDeleteConfirm, isSending, currentConversationTitle,
  pendingMessages, studentId,
  initializeConversation, loadConversation, startNewConversation,
  archiveConversationItem, unarchiveConversationItem, confirmDeleteConversation,
  executeDeleteConversation, regenerateTitle, maybeGenerateConversationTitle,
  createMessageId, toPromptHistory, persistChatMessage
} = conversation

const {
  isImportingDocument, documentImportStatusText, documentBindError,
  recentPrivateDocument, showDocumentPanel,
  clearState: clearDocumentState,
  toggleDocumentPanel, attachDocumentToCurrentConversation,
  selectDocument, clearCurrentDocument, deleteDocumentFromPanel
} = documentImport

const {
  isStreamingActive, streamingTimingText, streamingDraftContent,
  activateStreaming, resetStreamingState
} = streaming

const {
  isSearchPanelOpen, searchQuery, searchResults, isSearching, searchError,
  toggleSearchPanel, executeKnowledgeSearch
} = search

const enabledPackCount = computed(() => packSelectionStore.getEnabledPackIds(appStore.selectedSubject).length)

const currentSubjectDescriptor = computed(() =>
  appStore.allSubjects.find(s => s.code === appStore.selectedSubject)
)
const currentMentorLabel = computed(() => {
  if (appStore.selectedSubject === "programming") return "Python 编程调试导师"
  return `${currentSubjectDescriptor.value?.name ?? "学习"}导师`
})
const currentMentorStyle = computed(() =>
  appStore.selectedSubject === "programming" ? "调试伙伴" : "循循善诱"
)

onMounted(() => {
  void initializeConversation()
})

watch(
  () => appStore.selectedSubject,
  (subject) => {
    clearDocumentState()
    showPythonPlayground.value = subject === "programming"
    void initializeConversation()
  }
)

// Switching conversations (including subject-triggered switches) cancels the
// in-flight turn: a stale reply must not update the new conversation's UI,
// fire onStreamUpdate(done), or persist assessment/reflection/memory.
watch(conversationId, () => {
  streaming.cancelActiveTurn()
})

onUnmounted(() => {
  streaming.cancelActiveTurn()
})

/** Drop the empty tutor placeholder after a cancellation; never touch real content. */
function removeCancelledPlaceholder(tutorMessage: ChatMessage) {
  if (tutorMessage.content) return
  const index = messages.value.findIndex((m) => m.id === tutorMessage.id)
  if (index !== -1) messages.value.splice(index, 1)
}

async function sendMessage(attachments: ChatAttachment[] = []) {
  const content = draft.value.trim()
  if (!content && !attachments.length) return
  if (isSending.value) return

  const currentConversationId = conversationId.value
  const recentMessages = toPromptHistory(messages.value)

  const studentMessage: ChatMessage = {
    id: createMessageId(),
    role: "student",
    content: content || "（请识别图片中的题目内容）",
    attachments: attachments.length ? attachments : undefined
  }

  messages.value.push(studentMessage)
  scrollMessagesToBottom()
  draft.value = ""
  void persistChatMessage(studentMessage, currentConversationId)

  if (!appStore.hasUsableProviderConfig && !shouldTriggerPlanner(content)) {
    const missingProviderMessage: ChatMessage = {
      id: createMessageId(),
      role: "tutor",
      content: "还没有可用的 LLM Provider 配置。请先到\u201c设置\u201d里填写 Base URL、模型和 API Key，并点击\u201c保存本次运行配置\u201d。"
    }

    messages.value.push(missingProviderMessage)
    scrollMessagesToBottom()
    void persistChatMessage(missingProviderMessage, currentConversationId)
    return
  }

  const rawTutorMessage: ChatMessage = {
    id: createMessageId(),
    role: "tutor",
    content: "",
    isStreaming: true
  }

  messages.value.push(rawTutorMessage)
  const tutorMessage = messages.value[messages.value.length - 1]!
  pendingMessages.set(currentConversationId, tutorMessage)

  activateStreaming()
  const turnSignal = streaming.activeTurnSignal()
  scrollMessagesToBottom()

  const sendStartedAt = performance.now()
  await new Promise((resolve) => setTimeout(resolve, 50))

  try {
    let streamDoneContent: string | undefined

    const result = await tutorOrchestrator.handleTurnStream({
      userMessage: content || "请识别图片中的题目内容，并按当前学科进行辅导。",
      recentMessages,
      subjectCode: appStore.selectedSubject,
      enabledPackIds: packSelectionStore.getEnabledPackIds(appStore.selectedSubject),
      recentPrivateDocument: recentPrivateDocument.value ?? undefined,
      studentId: studentId.value,
      conversationId: currentConversationId,
      providerConfig: appStore.activeLlmConfig ?? undefined,
      embeddingConfig: appStore.activeEmbeddingConfig,
      cloudPrivacy: appStore.cloudPrivacy,
      attachments: attachments.length ? attachments : undefined,
      signal: turnSignal,
      onTiming: (step, stepMs, totalMs) => {
        streamingTimingText.value = `${step} (+${stepMs}ms, 总${totalMs}ms)`
      },
      onStreamUpdate: (streamedContent, done) => {
        if (turnSignal?.aborted) return // cancelled turn: never touch UI state
        const elapsed = ((performance.now() - sendStartedAt) / 1000).toFixed(1)
        streamingTimingText.value = `耗时 ${elapsed}s`
        tutorMessage.content = streamedContent
        if (done) {
          streamDoneContent = streamedContent
          tutorMessage.isStreaming = false
          isStreamingActive.value = false
          void persistChatMessage(tutorMessage, currentConversationId)
        }
        scrollMessagesToBottomIfNear()
      }
    })

    if (turnSignal?.aborted) {
      // Cancelled while settling: discard the result; do not update the UI.
      removeCancelledPlaceholder(tutorMessage)
      resetStreamingState()
      return
    }

    tutorMessage.plannerResult = result.plannerResult
    tutorMessage.knowledgeRefsJson = createKnowledgeRefsJson(result)
    tutorMessage.toolRefsJson = createTutorTurnToolRefsJson(tutorMessage, result)
    tutorMessage.guardrailJson = createGuardrailSummaryJson(result)

    if (streamDoneContent === undefined) {
      tutorMessage.content = result.content
    }
    // Streaming emits its final content before the orchestrator returns these
    // metadata fields. Persist once more after they are attached so reloads do
    // not lose guardrail, planner, or tool provenance.
    void persistChatMessage(tutorMessage, currentConversationId)

    void maybeGenerateConversationTitle(currentConversationId)
    resetStreamingState()

    if (conversationId.value === currentConversationId) scrollMessagesToBottomIfNear()
  } catch (error) {
    if (isTurnAborted(error)) {
      // Cancellation is not a failure: drop the empty placeholder, persist
      // nothing, and show no error — the user (or a conversation switch)
      // intentionally stopped this turn.
      removeCancelledPlaceholder(tutorMessage)
      resetStreamingState()
    } else {
      tutorMessage.content = `这次调用模型失败了：${sanitizeErrorMessage(error)}\n\n你可以先检查设置页的 Base URL、模型名和 API Key。`
      resetStreamingState()
      void persistChatMessage(tutorMessage, currentConversationId)
      if (conversationId.value === currentConversationId) scrollMessagesToBottom()
    }
  } finally {
    pendingMessages.delete(currentConversationId)
    isStreamingActive.value = false
    if (conversationId.value === currentConversationId) scrollMessagesToBottomIfNear()
  }
}
</script>

<template>
  <main class="chat-view">
    <header class="chat-atlas-header">
      <div class="atlas-title-block">
        <h1>对话辅导</h1>
        <p>围绕当前学科持续推进：提问、引导、练习、复盘。</p>
      </div>
      <div class="atlas-header-actions">
        <ProviderSelector />
      </div>
    </header>

    <section class="chat-workspace">
      <ConversationSidebar
        :conversations="conversations"
        :active-conversation-id="conversationId"
        :is-sending="isSending"
        @create="startNewConversation"
        @select="loadConversation"
        @archive="archiveConversationItem"
        @unarchive="unarchiveConversationItem"
        @delete="confirmDeleteConversation"
        @regenerate-title="regenerateTitle"
      />

      <section class="chat-main" aria-label="当前会话">
        <div class="chat-header">
          <ConversationTitleBar
            :title="currentConversationTitle"
            :is-generating="isGeneratingTitle"
            @regenerate="regenerateTitle"
          />
          <div class="header-actions">
            <button
              class="search-toggle-btn"
              :class="{ active: isSearchPanelOpen }"
              title="搜索知识库"
              @click="toggleSearchPanel"
            >
              <v-icon icon="mdi-magnify" size="18" />
              <span>搜索知识库</span>
            </button>
            <button
              v-if="appStore.selectedSubject === 'programming'"
              class="search-toggle-btn"
              :class="{ active: showPythonPlayground }"
              title="打开 Python 练习台"
              @click="showPythonPlayground = !showPythonPlayground"
            >
              <v-icon icon="mdi-language-python" size="18" />
              <span>Python 练习台</span>
            </button>
            <LearningPanel :conversation-id="conversationId" />
          </div>
        </div>

        <div class="chat-layout-flex">
          <div class="chat-center">
            <!-- 知识库搜索面板 -->
            <div v-if="isSearchPanelOpen" class="knowledge-search-panel">
              <div class="search-input-row">
                <input
                  v-model="searchQuery"
                  class="search-input"
                  placeholder="输入知识点关键词..."
                  @keydown.enter="executeKnowledgeSearch"
                />
                <button
                  class="action-button action-button-primary search-btn"
                  :disabled="isSearching"
                  @click="executeKnowledgeSearch"
                >
                  {{ isSearching ? "搜索中…" : "搜索" }}
                </button>
              </div>

              <div v-if="searchError" class="search-error">{{ searchError }}</div>

              <div v-if="searchResults.length > 0" class="search-results">
                <div
                  v-for="r in searchResults"
                  :key="r.knowledgeNodeId"
                  class="search-result-item"
                >
                  <div class="search-result-header">
                    <span class="search-result-title">{{ r.title }}</span>
                    <span class="search-result-score">匹配度 {{ r.score }}</span>
                  </div>
                  <p class="search-result-summary">{{ r.summary }}</p>
                  <span class="search-result-id">{{ r.knowledgeNodeId }}</span>
                </div>
              </div>
            </div>
        <PythonPlayground
          v-if="appStore.selectedSubject === 'programming' && showPythonPlayground"
          @close="showPythonPlayground = false"
        />
        <MessageList ref="messageListRef" :messages="messages" />

        <!-- 流式输出状态：左下角小字提示 -->
        <div v-if="isStreamingActive" class="streaming-status-text">
          <v-icon icon="mdi-loading" class="spin" size="14" />
          <span>{{ streamingTimingText }}</span>
        </div>
            <div class="chat-input-area">
              <div class="chat-column">
                <div class="attachment-chip-container" v-if="isImportingDocument || !!recentPrivateDocument || showDocumentPanel">
                  <div class="attachment-chip" :class="{ 'attachment-chip-active': isImportingDocument || !!recentPrivateDocument }">
                    <span class="attachment-status-dot"></span>
                    <span class="attachment-status-text">
                      <template v-if="isImportingDocument">
                        {{ documentImportStatusText }}
                      </template>
                      <template v-else-if="recentPrivateDocument && documentImportStatusText">
                        {{ documentImportStatusText }}
                      </template>
                      <template v-else-if="recentPrivateDocument">
                        当前资料：《{{ recentPrivateDocument.title }}》
                      </template>
                      <template v-else>
                        当前对话未选择资料
                      </template>
                    </span>
                    <button
                      class="attachment-manage-button"
                      type="button"
                      :disabled="isImportingDocument"
                      title="管理资料上下文"
                      @click="toggleDocumentPanel"
                    >
                      {{ showDocumentPanel ? "关闭" : "管理资料" }}
                    </button>
                  </div>

                  <div v-if="documentBindError" class="document-bind-error">
                    <span>{{ documentBindError }}</span>
                    <button class="document-bind-error-dismiss" type="button" @click="documentBindError = null">×</button>
                  </div>
                </div>

                <ChatComposer
                  v-model="draft"
                  :is-sending="isSending"
                  :is-attaching="isImportingDocument"
                  @send="(atts) => sendMessage(atts)"
                  @attach="attachDocumentToCurrentConversation"
                />
                <div v-if="appStore.selectedSubject === 'programming'" class="code-runner-hint">
                  当前仅支持 Python；可使用上方练习台运行可信代码，教学护栏不是安全沙箱
                </div>
                <div v-if="appStore.isCurrentSubjectCustom && currentSubjectDescriptor?.reviewStatus === 'draft'" class="draft-content-hint">
                  当前使用未审核的自建学习资料（草稿状态）
                </div>
              </div>
            </div>
          </div>

          <aside class="atlas-right-panel">
            <DocumentContextPanel
              v-if="showDocumentPanel"
              :current-document="recentPrivateDocument"
              :subject-code="appStore.selectedSubject"
              @select="selectDocument"
              @clear="clearCurrentDocument"
              @delete="deleteDocumentFromPanel"
              @close="showDocumentPanel = false"
            />

            <template v-else>
              <section class="mentor-card mentor-card-compact">
                <div class="mentor-card-header">
                  <span>记忆亮点</span>
                  <button type="button" @click="toggleSearchPanel">查看更多</button>
                </div>
                <div class="memory-list">
                  <div class="memory-item">
                    <strong>当前会话</strong>
                    <span>{{ currentConversationTitle || "新的学习讨论" }}</span>
                  </div>
                  <div class="memory-item">
                    <strong>资料上下文</strong>
                    <span>{{ recentPrivateDocument ? recentPrivateDocument.title : "未选择资料" }}</span>
                  </div>
                  <div class="memory-item">
                    <strong>知识库范围</strong>
                    <span>{{ enabledPackCount }} 个 Pack 已启用</span>
                  </div>
                </div>
              </section>

              <section class="mentor-card">
                <div class="mentor-card-header">
                  <span>推荐动作</span>
                </div>
                <button class="mentor-action" type="button" @click="toggleSearchPanel">
                  <v-icon icon="mdi-magnify" size="18" />
                  搜索知识库
                </button>
                <button class="mentor-action" type="button" @click="toggleDocumentPanel">
                  <v-icon icon="mdi-file-document-outline" size="18" />
                  管理资料
                </button>
                <button class="mentor-action" type="button" @click="regenerateTitle(conversationId)">
                  <v-icon icon="mdi-format-title" size="18" />
                  整理标题
                </button>
              </section>

              <section class="mentor-card tutor-state-card">
                <div class="tutor-emblem">T</div>
                <strong>TeacherAgent</strong>
                <span>{{ currentMentorLabel }}</span>
                <dl>
                  <div>
                    <dt>风格</dt>
                    <dd>{{ currentMentorStyle }}</dd>
                  </div>
                  <div>
                    <dt>响应</dt>
                    <dd>{{ isStreamingActive ? "生成中" : "就绪" }}</dd>
                  </div>
                </dl>
              </section>
            </template>
          </aside>
        </div>
      </section>
    </section>

    <!-- 删除确认弹窗 -->
    <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="showDeleteConfirm = false">
      <div class="modal-dialog">
        <h3>确认删除会话</h3>
        <p>删除后该会话将不再显示，但本地记录会保留用于安全恢复/审计。</p>
        <div class="modal-actions">
          <button class="action-button action-button-secondary" @click="showDeleteConfirm = false">取消</button>
          <button class="action-button action-button-danger" @click="executeDeleteConversation">确认删除</button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.chat-view {
  --chat-page-gutter: clamp(24px, 3vw, 52px);
}

.chat-atlas-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 34px var(--chat-page-gutter) 24px;
}

.atlas-title-block {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.atlas-title-block h1 {
  margin: 0;
  color: var(--atlas-ink);
  font-family: Georgia, "Times New Roman", "Noto Serif SC", serif;
  font-size: clamp(30px, 3vw, 42px);
  line-height: 1.05;
}

.atlas-title-block p:last-child {
  margin: 0;
  color: var(--atlas-muted);
  font-size: 14px;
}

.atlas-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 280px;
}

.chat-workspace {
  gap: 20px;
  padding: 0 var(--chat-page-gutter) var(--chat-page-gutter);
  grid-template-columns: minmax(268px, 292px) minmax(0, 1fr);
}

.chat-main {
  border-radius: 10px;
  box-shadow: 0 24px 60px rgba(44, 38, 27, 0.08);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(214, 207, 193, 0.78);
  background: rgba(255, 253, 248, 0.92);
  gap: 16px;
}

.chat-header > :first-child {
  flex: 1;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-layout-flex {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.chat-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
}

.chat-input-area {
  flex-shrink: 0;
  padding: 14px 22px 20px;
  border-top: 1px solid rgba(214, 207, 193, 0.72);
  background: linear-gradient(180deg, rgba(255, 253, 248, 0.8), rgba(250, 247, 239, 0.96));
  z-index: 10;
}

.chat-right-panel {
  width: 330px;
  flex-shrink: 0;
  border-left: 1px solid rgba(214, 207, 193, 0.78);
  background: #faf7ef;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.atlas-right-panel {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border-left: 1px solid rgba(214, 207, 193, 0.78);
  background: linear-gradient(180deg, #fffdf8, #faf6ed);
  overflow-y: auto;
}

.mentor-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(214, 207, 193, 0.82);
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.9);
}

.mentor-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--atlas-ink);
  font-weight: 800;
}

.mentor-card-header button {
  border: 0;
  background: transparent;
  color: var(--atlas-blue);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.memory-list {
  display: grid;
  gap: 10px;
}

.memory-item {
  display: grid;
  gap: 3px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(214, 207, 193, 0.62);
}

.memory-item:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.memory-item strong {
  color: var(--atlas-ink);
  font-size: 13px;
}

.memory-item span {
  color: var(--atlas-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mentor-action {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  border: 1px solid rgba(214, 207, 193, 0.8);
  border-radius: 8px;
  background: #fffdf8;
  color: var(--atlas-ink);
  cursor: pointer;
  padding: 0 10px;
  font-weight: 700;
  text-align: left;
}

.mentor-action:hover {
  border-color: var(--atlas-blue);
  background: var(--atlas-blue-soft);
  color: var(--atlas-navy);
}

.tutor-state-card {
  justify-items: start;
}

.tutor-emblem {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid rgba(214, 154, 45, 0.55);
  border-radius: 12px;
  background: linear-gradient(145deg, #0b2c5e, #123f78);
  color: #fff8df;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 24px;
  font-weight: 800;
}

.tutor-state-card > strong {
  color: var(--atlas-ink);
  font-family: Georgia, "Times New Roman", "Noto Serif SC", serif;
  font-size: 18px;
}

.tutor-state-card > span {
  color: var(--atlas-muted);
  font-size: 12px;
}

.tutor-state-card dl {
  display: grid;
  gap: 8px;
  width: 100%;
  margin: 4px 0 0;
}

.tutor-state-card dl div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.tutor-state-card dt,
.tutor-state-card dd {
  margin: 0;
  font-size: 12px;
}

.tutor-state-card dt {
  color: var(--atlas-soft);
}

.tutor-state-card dd {
  color: var(--atlas-ink);
  font-weight: 800;
}

.attachment-chip-container {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  background: #fffdf8;
  border: 1px solid rgba(214, 207, 193, 0.78);
  border-radius: 8px;
  font-size: 0.8rem;
  color: #64748b;
  transition: all 0.2s;
}

.attachment-chip-active {
  background: var(--atlas-blue-soft);
  border-color: #c8daf2;
  color: var(--atlas-navy);
}

.attachment-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #94a3b8;
}

.attachment-chip-active .attachment-status-dot {
  background-color: var(--atlas-blue);
  box-shadow: 0 0 0 3px rgba(46, 108, 183, 0.12);
}

.attachment-status-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}

.attachment-manage-button {
  border: none;
  background: transparent;
  color: var(--atlas-blue);
  cursor: pointer;
  padding: 0 4px;
  font-weight: 500;
  margin-left: 4px;
}
.attachment-manage-button:hover {
  text-decoration: underline;
}
.attachment-manage-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  text-decoration: none;
}

.streaming-status-text {
  align-self: flex-start;
  margin: 0 0 8px 16px;
  padding: 4px 12px;
  font-size: 0.75rem;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 253, 248, 0.9);
  border: 1px solid rgba(214, 207, 193, 0.78);
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  100% { transform: rotate(360deg); }
}

.document-context-area {
  position: relative;
}

.document-bind-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  background: #fef3f2;
  color: #b42318;
  border: 1px solid #fecdca;
  border-radius: 6px;
  font-size: 0.78rem;
  margin-top: 4px;
}

.document-bind-error-dismiss {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #b42318;
  font-size: 0.9rem;
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
}

.document-bind-error-dismiss:hover {
  background: #fecdca;
}

.attachment-status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  flex-wrap: wrap;
  padding: 7px 12px;
  border: 1px solid #d6e4ff;
  border-radius: 8px;
  background: #f5f9ff;
  color: #344054;
  font-size: 0.82rem;
}

.attachment-status-text {
  min-width: 0;
  flex: 1 1 220px;
  overflow-wrap: anywhere;
}

.attachment-status-active {
  color: #4a90d9;
}

.attachment-status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #4a90d9;
}

.attachment-status-active .attachment-status-dot {
  animation: status-pulse 1s ease-in-out infinite;
}

.attachment-manage-button {
  flex: 0 0 auto;
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid #b7c9f7;
  border-radius: 6px;
  background: #fff;
  color: #4a90d9;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.attachment-manage-button:hover:not(:disabled) {
  border-color: #4a90d9;
  background: #eff6ff;
}

.attachment-manage-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

@keyframes status-pulse {
  50% {
    opacity: 0.35;
    transform: scale(0.82);
  }
}

.streaming-cursor {
  color: #4a90d9;
  font-weight: bold;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-dialog {
  background: white;
  border-radius: 12px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.modal-dialog h3 {
  margin: 0 0 12px;
  font-size: 1.1rem;
}

.modal-dialog p {
  margin: 0 0 20px;
  color: #666;
  font-size: 0.9rem;
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.action-button-danger {
  background: #d32f2f;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}

.action-button-danger:hover {
  background: #b71c1c;
}

.search-toggle-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 6px;
  background: #fffdf8;
  color: #555;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.search-toggle-btn:hover {
  border-color: var(--atlas-blue);
  color: var(--atlas-blue);
}

.search-toggle-btn.active {
  background: var(--atlas-blue-soft);
  border-color: var(--atlas-blue);
  color: var(--atlas-navy);
}

.knowledge-search-panel {
  flex: 0 0 auto;
  width: calc(100% - 32px);
  max-width: 900px;
  margin: 14px auto 0;
  padding: 12px;
  border: 1px solid rgba(214, 207, 193, 0.72);
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.78);
}

.search-input-row {
  display: flex;
  gap: 8px;
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid rgba(214, 207, 193, 0.9);
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
}

.search-input:focus {
  outline: none;
  border-color: var(--atlas-blue);
  box-shadow: 0 0 0 3px rgba(46, 108, 183, 0.12);
}

.search-btn {
  padding: 8px 16px;
  font-size: 0.8rem;
  white-space: nowrap;
}

.search-error {
  margin-top: 8px;
  padding: 8px 12px;
  background: #fff3e0;
  color: #e65100;
  border-radius: 6px;
  font-size: 0.8rem;
}

.search-results {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  padding-bottom: 12px;
}

.search-result-item {
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.search-result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.search-result-title {
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--atlas-navy);
}

.search-result-score {
  font-size: 0.7rem;
  color: #999;
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 8px;
}

.search-result-summary {
  margin: 0;
  font-size: 0.8rem;
  color: #555;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.search-result-id {
  font-size: 0.7rem;
  color: #aaa;
  font-family: monospace;
}

.atlas-right-panel :deep(.document-context-panel) {
  position: static;
  max-width: none;
  width: 100%;
  margin: 0;
  border-color: rgba(214, 207, 193, 0.82);
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.94);
  box-shadow: none;
}

@media (max-width: 1500px) {
  .atlas-right-panel,
  .chat-right-panel {
    display: none;
  }
}

@media (max-width: 1180px) {
  .chat-workspace {
    gap: 14px;
    grid-template-columns: minmax(220px, 240px) minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .chat-atlas-header {
    align-items: stretch;
    flex-direction: column;
    padding: 22px 16px 16px;
  }

  .atlas-header-actions {
    justify-content: flex-start;
    min-width: 0;
  }

  .chat-workspace {
    padding: 0 12px 16px;
  }
}

.code-runner-hint {
  text-align: center;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.4);
  padding: 2px 0 4px;
  user-select: none;
}

.draft-content-hint {
  text-align: center;
  font-size: 11px;
  color: #856404;
  background: #fff3cd;
  border-radius: 4px;
  padding: 3px 8px;
  margin: 2px 0;
  user-select: none;
}
</style>


