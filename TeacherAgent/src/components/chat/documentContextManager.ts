/**
 * Document Context Manager — 对话内资料上下文管理逻辑
 *
 * 提供选择、清空、删除当前对话资料的纯逻辑函数，
 * 供 ChatView.vue 调用，便于单元测试。
 */

import type { RecentPrivateDocumentRef } from "../../engine/agents/toolAgent"

export interface DocumentContextState {
  recentPrivateDocument: RecentPrivateDocumentRef | null
  documentImportStatusText: string
  showDocumentPanel: boolean
}

/**
 * 选择一份已有资料作为当前对话资料。
 * 返回新的状态和要发送的系统消息内容。
 */
export function selectDocumentAction(
  document: RecentPrivateDocumentRef
): { statusText: string; showPanel: boolean } {
  return {
    statusText: `当前资料：《${document.title}》`,
    showPanel: false
  }
}

/**
 * 清空当前资料上下文（本轮不用）。
 * 不删除 SQLite 数据，只清空当前会话引用。
 * 返回要发送的系统消息内容。
 */
export function clearCurrentDocumentAction(): {
  statusText: string
  showPanel: boolean
  systemMessage: string
} {
  return {
    statusText: "本轮已不再使用该资料。资料仍保留在本地资料库中，可随时重新选择。",
    showPanel: false,
    systemMessage: "本轮已不再使用该资料。资料仍保留在本地资料库中，你可以随时重新选择或导入新资料。"
  }
}

/**
 * 删除资料后的处理逻辑。
 * 如果删除的是当前资料，同时清空引用。
 * 返回要发送的系统消息内容。
 */
export function deleteDocumentAction(
  deletedDocumentId: string,
  currentDocument: RecentPrivateDocumentRef | null
): {
  clearedCurrent: boolean
  statusText: string
  systemMessage: string
} {
  const isCurrentDoc = currentDocument?.id === deletedDocumentId
  const title = isCurrentDoc ? (currentDocument!.title || currentDocument!.fileName) : ""

  return {
    clearedCurrent: isCurrentDoc,
    statusText: isCurrentDoc
      ? `已删除《${title}》，可导入新资料。`
      : "已删除资料。",
    systemMessage: isCurrentDoc
      ? [
          `已删除《${title}》。`,
          "",
          "这份资料的本地文本和分块已从 SQLite 彻底删除，后续对话不会再检索它。你可以导入新资料。"
        ].join("\n")
      : "已删除所选资料。本地文本和分块已从 SQLite 彻底删除。"
  }
}
