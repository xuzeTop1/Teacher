import { computed, reactive, ref } from "vue"
import type { ChatMessage } from "../types/chat"
import type { TutorPromptMessage } from "../engine/prompts/tutorPromptBuilder"
import {
  createConversation,
  deleteConversation,
  ensureDefaultConversation,
  initializeDatabase,
  listConversations,
  listMessages,
  listProviderConfigs,
  listCustomSubjects,
  saveMessage,
  unarchiveConversation,
  updateConversationTitle,
  archiveConversation,
  type LocalConversation,
  type StoredMessage
} from "../services/tauri/commands"
import { seedAllKnowledgeNodes } from "../services/knowledge/knowledgeIndexer"
import { restoreChatMessagesFromStoredMessages, serializeChatMessageToolRefs } from "../components/chat/chatMessageMetadata"
import { generateConversationTitle, isDefaultTitle } from "../services/conversation/conversationTitleService"
import { createWelcomeMessages as buildWelcomeMessages } from "../components/chat/welcomeMessages"
import { useAppStore } from "../stores/app"

export interface ConversationManagerOptions {
  onScrollToBottom?: (behavior?: ScrollBehavior) => void
  onClearDocumentState?: () => void
}

export function useConversationManager(options: ConversationManagerOptions = {}) {
  const appStore = useAppStore()

  const conversations = ref<LocalConversation[]>([])
  const conversationId = ref(createMessageId())
  const studentId = ref("local-default-student")
  const messages = ref<ChatMessage[]>(createWelcomeMessages())
  const isLoadingHistory = ref(false)
  const isGeneratingTitle = ref(false)
  const showDeleteConfirm = ref(false)
  const pendingDeleteId = ref<string | null>(null)
  const persistenceStatus = ref<"memory" | "sqlite" | "error">("memory")
  const pendingMessages = reactive(new Map<string, ChatMessage>())

  const currentConversation = computed(() =>
    conversations.value.find((c) => c.conversationId === conversationId.value)
  )

  const currentConversationTitle = computed(() => currentConversation.value?.title ?? "临时对话")

  const isSending = computed(() => pendingMessages.has(conversationId.value))

  const persistenceStatusText = computed(() => {
    if (persistenceStatus.value === "sqlite") return "SQLite 已连接"
    if (persistenceStatus.value === "error") return "本地保存不可用"
    return "内存会话"
  })

  // ── Helpers ──────────────────────────────────────────────────────

  function createMessageId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function createWelcomeMessages(): ChatMessage[] {
    return buildWelcomeMessages(appStore.selectedSubject)
  }

  function stripTimingPrefix(content: string): string {
    const withNewline = content.match(/^⏱ [^\n]*\n\n([\s\S]*)$/)
    if (withNewline) return withNewline[1]
    if (/^⏱ \[[\d:]+\]\s/.test(content)) return ""
    return content
  }

  function fromStoredMessages(storedMessages: StoredMessage[]): ChatMessage[] {
    const restored = restoreChatMessagesFromStoredMessages(storedMessages)
    for (const msg of restored) {
      if (msg.role === "tutor") {
        msg.content = stripTimingPrefix(msg.content)
      }
    }
    return restored.length ? restored : createWelcomeMessages()
  }

  function toPromptHistory(items: ChatMessage[]): TutorPromptMessage[] {
    return items
      .filter((m) => m.id !== "welcome")
      .slice(-8)
      .map((m) => ({
        role: m.role === "student" ? "user" : "assistant",
        content: m.role === "tutor" ? stripTimingPrefix(m.content) : m.content
      }))
  }

  async function persistChatMessage(message: ChatMessage, targetConversationId: string = conversationId.value) {
    if (persistenceStatus.value !== "sqlite" || message.id === "welcome") return

    try {
      const cleanContent = message.role === "tutor" ? stripTimingPrefix(message.content) : message.content
      await saveMessage({
        id: message.id,
        conversationId: targetConversationId,
        role: message.role,
        content: cleanContent,
        contentFormat: "markdown",
        knowledgeRefsJson: message.knowledgeRefsJson ?? "[]",
        toolRefsJson: serializeChatMessageToolRefs(message),
        guardrailJson: message.guardrailJson ?? "{}",
        attachmentsJson: message.attachments?.length ? JSON.stringify(message.attachments) : "[]",
        createdAt: new Date().toISOString()
      })
    } catch {
      persistenceStatus.value = "error"
    }
  }

  // ── Conversation CRUD ─────────────────────────────────────────────

  async function initializeConversation() {
    isLoadingHistory.value = true

    try {
      const databaseStatus = await initializeDatabase()
      appStore.setDatabaseStatus(databaseStatus)

      try {
        await seedAllKnowledgeNodes()
      } catch { /* non-blocking */ }

      try {
        const configs = await listProviderConfigs()
        appStore.setProviderConfigs(configs)
      } catch { /* non-blocking */ }

      try {
        const customs = await listCustomSubjects()
        appStore.setCustomSubjects(customs)
      } catch { /* non-blocking */ }

      const defaultConversation = await ensureDefaultConversation(appStore.selectedSubject)
      const [activeConversations, archivedConversations] = await Promise.all([
        listConversations(appStore.selectedSubject, 30, "active"),
        listConversations(appStore.selectedSubject, 30, "archived")
      ])
      const availableConversations = [...activeConversations, ...archivedConversations]
      const selectedConversation =
        availableConversations.find((c) => c.conversationId === conversationId.value) ??
        activeConversations[0] ??
        defaultConversation

      conversations.value = availableConversations.length ? availableConversations : [defaultConversation]
      persistenceStatus.value = "sqlite"
      await loadConversation(selectedConversation)
    } catch {
      persistenceStatus.value = "error"
      conversations.value = []
      if (!messages.value.length) {
        messages.value = createWelcomeMessages()
      }
    } finally {
      isLoadingHistory.value = false
    }
  }

  async function refreshConversationList(preferredConversationId = conversationId.value) {
    if (persistenceStatus.value !== "sqlite") return

    try {
      const [activeConversations, archivedConversations] = await Promise.all([
        listConversations(appStore.selectedSubject, 30, "active"),
        listConversations(appStore.selectedSubject, 30, "archived")
      ])
      conversations.value = [...activeConversations, ...archivedConversations]
    } catch {
      persistenceStatus.value = "error"
    }
  }

  async function loadConversation(conversation: LocalConversation) {
    isLoadingHistory.value = true
    options.onClearDocumentState?.()

    try {
      const storedMessages = await listMessages(conversation.conversationId, 80)
      studentId.value = conversation.studentId
      conversationId.value = conversation.conversationId

      const loadedMessages = fromStoredMessages(storedMessages)
      const pending = pendingMessages.get(conversation.conversationId)
      if (pending && loadedMessages[loadedMessages.length - 1]?.id !== pending.id) {
        loadedMessages.push(pending)
      }
      messages.value = loadedMessages

      options.onScrollToBottom?.("auto")
    } catch {
      persistenceStatus.value = "error"
    } finally {
      isLoadingHistory.value = false
    }
  }

  async function startNewConversation() {
    options.onClearDocumentState?.()

    if (persistenceStatus.value !== "sqlite") {
      messages.value = createWelcomeMessages()
      conversationId.value = createMessageId()
      return
    }

    isLoadingHistory.value = true

    try {
      const conversation = await createConversation(appStore.selectedSubject)
      conversations.value = [conversation, ...conversations.value.filter((item) => item.conversationId !== conversation.conversationId)]
      await loadConversation(conversation)
    } catch {
      persistenceStatus.value = "error"
    } finally {
      isLoadingHistory.value = false
    }
  }

  // ── Title management ──────────────────────────────────────────────

  async function maybeGenerateConversationTitle(targetConversationId: string = conversationId.value) {
    if (persistenceStatus.value !== "sqlite") return

    const activeTitle = conversations.value.find(c => c.conversationId === targetConversationId)?.title ?? ""
    if (!isDefaultTitle(activeTitle)) return

    isGeneratingTitle.value = true

    try {
      const title = await generateConversationTitle({
        messages: messages.value.filter(m => m.id !== "welcome"),
        subjectCode: appStore.selectedSubject,
        providerConfig: appStore.activeLlmConfig ?? undefined
      })

      if (title) {
        const updated = await updateConversationTitle(targetConversationId, title)
        conversations.value = conversations.value.map((c) =>
          c.conversationId === updated.conversationId ? updated : c
        )
      }
    } catch { /* non-critical */ } finally {
      isGeneratingTitle.value = false
    }
  }

  async function regenerateTitle(targetConversationId: string = conversationId.value) {
    if (persistenceStatus.value !== "sqlite" || isGeneratingTitle.value) return

    isGeneratingTitle.value = true

    try {
      const storedMessages = await listMessages(targetConversationId, 20)
      const title = await generateConversationTitle({
        messages: storedMessages.map(m => ({ role: m.role, content: m.content })),
        subjectCode: appStore.selectedSubject,
        providerConfig: appStore.activeLlmConfig ?? undefined
      })

      if (title) {
        const updated = await updateConversationTitle(targetConversationId, title)
        conversations.value = conversations.value.map((c) =>
          c.conversationId === updated.conversationId ? updated : c
        )
      }
    } catch { /* non-critical */ } finally {
      isGeneratingTitle.value = false
    }
  }

  // ── Archive / Delete ──────────────────────────────────────────────

  async function archiveConversationItem(conversationIdToArchive: string) {
    if (persistenceStatus.value !== "sqlite") return
    try {
      await archiveConversation(conversationIdToArchive)
      await refreshConversationList()
      if (conversationIdToArchive === conversationId.value) {
        const activeConversations = conversations.value.filter(c => c.status === "active")
        if (activeConversations.length > 0) {
          await loadConversation(activeConversations[0])
        }
      }
    } catch { /* non-critical */ }
  }

  async function unarchiveConversationItem(conversationIdToUnarchive: string) {
    if (persistenceStatus.value !== "sqlite") return
    try {
      await unarchiveConversation(conversationIdToUnarchive)
      await refreshConversationList()
    } catch { /* non-critical */ }
  }

  function confirmDeleteConversation(conversationIdToDelete: string) {
    pendingDeleteId.value = conversationIdToDelete
    showDeleteConfirm.value = true
  }

  async function executeDeleteConversation() {
    if (!pendingDeleteId.value) return
    const idToDelete = pendingDeleteId.value
    showDeleteConfirm.value = false
    pendingDeleteId.value = null

    if (persistenceStatus.value !== "sqlite") return
    try {
      await deleteConversation(idToDelete)
      conversations.value = conversations.value.filter(c => c.conversationId !== idToDelete)
      if (idToDelete === conversationId.value) {
        const activeConversations = conversations.value.filter(c => c.status === "active")
        if (activeConversations.length > 0) {
          await loadConversation(activeConversations[0])
        } else {
          await startNewConversation()
        }
      }
    } catch { /* non-critical */ }
  }

  return {
    // State
    conversations,
    conversationId,
    studentId,
    messages,
    isLoadingHistory,
    isGeneratingTitle,
    showDeleteConfirm,
    pendingDeleteId,
    persistenceStatus,
    pendingMessages,

    // Computed
    currentConversation,
    currentConversationTitle,
    isSending,
    persistenceStatusText,

    // Helpers
    createMessageId,
    createWelcomeMessages,
    stripTimingPrefix,
    toPromptHistory,
    persistChatMessage,

    // Actions
    initializeConversation,
    refreshConversationList,
    loadConversation,
    startNewConversation,
    maybeGenerateConversationTitle,
    regenerateTitle,
    archiveConversationItem,
    unarchiveConversationItem,
    confirmDeleteConversation,
    executeDeleteConversation
  }
}
