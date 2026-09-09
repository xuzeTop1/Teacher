/**
 * Private Document Context Service — 会话级资料绑定持久化
 *
 * 管理会话与私有资料之间的绑定关系，持久化到 SQLite conversation_private_documents 表。
 * 切换会话、重启应用后仍能恢复当前会话绑定的资料。
 */

import type { RecentPrivateDocumentRef } from "../../engine/agents/toolAgent"
import {
  bindPrivateDocumentToConversation,
  clearPrivateDocumentBinding,
  loadConversationPrivateDocumentId,
  getPrivateDocument
} from "../tauri/commands"

/**
 * 绑定一份私有资料到指定会话。
 * 如果已有绑定则覆盖（每个会话最多绑定 1 份）。
 */
export async function bindDocumentToConversation(
  conversationId: string,
  documentId: string
): Promise<void> {
  await bindPrivateDocumentToConversation(conversationId, documentId)
}

/**
 * 清空指定会话的资料绑定。
 */
export async function clearDocumentBinding(conversationId: string): Promise<boolean> {
  return clearPrivateDocumentBinding(conversationId)
}

/**
 * 加载指定会话绑定的资料，返回 RecentPrivateDocumentRef 或 null。
 *
 * 内部流程：
 * 1. 从 conversation_private_documents 读取绑定的 documentId
 * 2. 直接按 ID 查询文档 metadata（不受列表 limit 影响）
 * 3. 如果文档已被删除（查不到），返回 null
 */
export async function loadBoundDocument(
  conversationId: string
): Promise<RecentPrivateDocumentRef | null> {
  const documentId = await loadConversationPrivateDocumentId(conversationId)
  if (!documentId) return null

  const doc = await getPrivateDocument(documentId)
  if (!doc) return null

  return {
    id: doc.id,
    title: doc.title || doc.fileName,
    fileName: doc.fileName
  }
}
