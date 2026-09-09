import { ref } from "vue"
import type { ChatMessage } from "../types/chat"
import type { RecentPrivateDocumentRef } from "../engine/agents/toolAgent"
import { importAndPreview, pickDocumentFile } from "../services/document/documentImportService"
import { confirmImportToDraft } from "../services/document/privateDocumentService"
import {
  bindDocumentToConversation,
  clearDocumentBinding
} from "../services/document/privateDocumentContextService"
import {
  selectDocumentAction,
  clearCurrentDocumentAction,
  deleteDocumentAction
} from "../components/chat/documentContextManager"
import { useAppStore } from "../stores/app"
import { sanitizeErrorMessage } from "../utils/errorMessage"

export interface DocumentImportOptions {
  conversationId: () => string
  isSending: () => boolean
  onPushMessage: (message: ChatMessage) => void
  onPersistMessage: (message: ChatMessage, conversationId: string) => void
  onScrollToBottom: () => void
}

export function useDocumentImport(options: DocumentImportOptions) {
  const appStore = useAppStore()

  const isImportingDocument = ref(false)
  const documentImportStatusText = ref("")
  const documentBindError = ref<string | null>(null)
  const recentPrivateDocument = ref<RecentPrivateDocumentRef | null>(null)
  const showDocumentPanel = ref(false)

  function clearState() {
    recentPrivateDocument.value = null
    documentImportStatusText.value = ""
    documentBindError.value = null
    isImportingDocument.value = false
    showDocumentPanel.value = false
  }

  function toggleDocumentPanel() {
    showDocumentPanel.value = !showDocumentPanel.value
  }

  async function attachDocumentToCurrentConversation() {
    if (isImportingDocument.value || options.isSending()) return

    isImportingDocument.value = true
    documentImportStatusText.value = "正在打开文件选择器..."
    const currentConversationId = options.conversationId()

    try {
      const selected = await pickDocumentFile()
      if (!selected.selected || !selected.filePath || !selected.fileName) {
        documentImportStatusText.value = ""
        return
      }

      documentImportStatusText.value = `正在解析《${selected.fileName}》...`
      const result = await importAndPreview(selected.filePath, selected.fileName)
      if (!result.ok || !result.preview) {
        throw new Error(result.error || "解析失败。")
      }

      documentImportStatusText.value = `正在保存《${result.preview.fileName}》到本地资料库...`
      const saved = await confirmImportToDraft(result.preview, appStore.selectedSubject)
      recentPrivateDocument.value = {
        id: saved.id,
        title: saved.title || saved.fileName,
        fileName: saved.fileName
      }
      documentBindError.value = null
      try {
        await bindDocumentToConversation(currentConversationId, saved.id)
      } catch (error) {
        documentBindError.value = `资料绑定保存失败：${sanitizeErrorMessage(error)}。重启后可能无法恢复此绑定。`
      }

      const pageCount = result.preview.rawPagesOrSheets.length
      const attachedMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "tutor",
        content: [
          `已导入《${saved.title || saved.fileName}》。`,
          "",
          `文件类型：${saved.fileType.toUpperCase()}；页面/工作表：${pageCount || "未知"}；分块：${saved.chunkCount}。`,
          "文件只在本机解析并保存到本地 SQLite，不会上传云端，也不会写入内置知识库。",
          "",
          "你现在可以直接问：帮我总结这份资料、提炼考点、按这份资料出练习题。"
        ].join("\n")
      }

      options.onPushMessage(attachedMessage)
      options.onPersistMessage(attachedMessage, currentConversationId)
      documentImportStatusText.value = `已导入《${saved.title || saved.fileName}》，可以直接提问。`
      options.onScrollToBottom()
    } catch (error) {
      documentImportStatusText.value = "资料导入失败。"
      const failedMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "tutor",
        content: [
          `资料导入失败：${sanitizeErrorMessage(error)}`,
          "",
          "文件未上传云端。你也可以先粘贴一小段文本，我可以直接基于文本帮你总结。"
        ].join("\n")
      }

      options.onPushMessage(failedMessage)
      options.onPersistMessage(failedMessage, currentConversationId)
      options.onScrollToBottom()
    } finally {
      isImportingDocument.value = false
    }
  }

  async function selectDocument(document: RecentPrivateDocumentRef) {
    recentPrivateDocument.value = document
    const action = selectDocumentAction(document)
    documentImportStatusText.value = action.statusText
    showDocumentPanel.value = action.showPanel
    documentBindError.value = null

    try {
      await bindDocumentToConversation(options.conversationId(), document.id)
    } catch (error) {
      documentBindError.value = `资料绑定保存失败：${sanitizeErrorMessage(error)}。重启后可能无法恢复此绑定。`
    }
  }

  async function clearCurrentDocument() {
    if (!recentPrivateDocument.value) return

    const action = clearCurrentDocumentAction()
    recentPrivateDocument.value = null
    documentImportStatusText.value = action.statusText
    showDocumentPanel.value = action.showPanel
    documentBindError.value = null

    try {
      await clearDocumentBinding(options.conversationId())
    } catch (error) {
    documentBindError.value = `绑定清空保存失败：${sanitizeErrorMessage(error)}。重启后可能恢复旧绑定。`
    }

    const clearedMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "tutor",
      content: action.systemMessage
    }

    options.onPushMessage(clearedMessage)
    options.onPersistMessage(clearedMessage, options.conversationId())
    options.onScrollToBottom()
  }

  async function deleteDocumentFromPanel(documentId: string) {
    const action = deleteDocumentAction(documentId, recentPrivateDocument.value)
    const currentConversationId = options.conversationId()

    if (action.clearedCurrent) {
      recentPrivateDocument.value = null
    }

    documentImportStatusText.value = action.statusText

    const deletedMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "tutor",
      content: action.systemMessage
    }

    options.onPushMessage(deletedMessage)
    options.onPersistMessage(deletedMessage, currentConversationId)
    options.onScrollToBottom()
  }

  return {
    isImportingDocument,
    documentImportStatusText,
    documentBindError,
    recentPrivateDocument,
    showDocumentPanel,
    clearState,
    toggleDocumentPanel,
    attachDocumentToCurrentConversation,
    selectDocument,
    clearCurrentDocument,
    deleteDocumentFromPanel
  }
}
