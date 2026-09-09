/**
 * Private Document Service — 私有资料确认入库与检索服务
 *
 * 封装 save / list / delete / load chunks / search 的 Tauri IPC 调用。
 * 不上传云端，不调用 LLM，不生成 embedding。
 */

import {
  savePrivateDocument,
  listPrivateDocuments,
  deletePrivateDocument,
  loadPrivateDocumentChunks,
  searchPrivateDocumentChunks,
  type SavePrivateDocumentInput,
  type SavedPrivateDocument,
  type PrivateDocumentChunk,
  type PrivateChunkSearchResult
} from "../tauri/commands"
import type { DocumentPreview } from "./documentImportService"

/**
 * 将预览结果保存为私有草稿文档。
 */
export async function confirmImportToDraft(
  preview: DocumentPreview,
  subjectCode: string
): Promise<SavedPrivateDocument> {
  const input: SavePrivateDocumentInput = {
    fileName: preview.fileName,
    fileType: preview.fileType,
    title: preview.title !== preview.fileName ? preview.title : undefined,
    subjectCode,
    // 入库必须使用原始未截断文本
    pagesOrSheets: preview.rawPagesOrSheets,
    plainText: preview.rawPlainText
  }

  return savePrivateDocument(input)
}

/**
 * 列出已导入的私有文档。
 */
export async function listImportedDocuments(
  subjectCode?: string
): Promise<SavedPrivateDocument[]> {
  return listPrivateDocuments(subjectCode)
}

/**
 * 彻底删除已导入的私有文档（chunks + document，不可恢复）。
 */
export async function removeImportedDocument(documentId: string): Promise<boolean> {
  return deletePrivateDocument(documentId)
}

/**
 * 读取某个私有文档的 chunks。
 * 仅用于本地 RAG prompt 注入，不上传云端。
 */
export async function loadPrivateChunks(documentId: string): Promise<PrivateDocumentChunk[]> {
  return loadPrivateDocumentChunks(documentId)
}

/**
 * 在私有资料 chunks 中搜索关键词。
 * 只搜索指定学科、未删除的文档。
 */
export async function searchPrivateChunks(
  query: string,
  subjectCode: string,
  limit?: number
): Promise<PrivateChunkSearchResult[]> {
  return searchPrivateDocumentChunks(query, subjectCode, limit)
}
