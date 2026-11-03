import { defineStore } from "pinia"
import { ref } from "vue"
import {
  pickDocumentFile,
  importAndPreview,
  type DocumentPreview,
  type ImportResult
} from "../services/document/documentImportService"
import {
  confirmImportToDraft,
  listImportedDocuments,
  removeImportedDocument
} from "../services/document/privateDocumentService"
import type { SavedPrivateDocument } from "../services/tauri/commands"

export type ImportStatus = "idle" | "importing" | "imported" | "error"

export interface PreviewItem {
  id: number
  preview: DocumentPreview
  /**
   * 解析时所属的学科。
   *
   * 预览项必须绑定学科：预览区是"待确认导入"的暂存区，若不记学科，
   * 切学科后旧预览会继续显示（看起来像"页面没刷新"），且确认时会按
   * **当前**学科入库，导致同一份文档落进两个学科。
   */
  subjectCode: string
  importStatus: ImportStatus
  importedDocId?: string
  importError?: string
}

export const useDocumentImportStore = defineStore("documentImport", () => {
  const isLoading = ref(false)
  const previews = ref<PreviewItem[]>([])
  const error = ref<string | null>(null)
  const nextId = ref(1)

  // 已导入文档列表
  const importedDocuments = ref<SavedPrivateDocument[]>([])
  const isLoadingImported = ref(false)
  const importedError = ref<string | null>(null)
  const deleteError = ref<string | null>(null)

  async function selectAndPreviewFile(subjectCode: string): Promise<void> {
    const result = await pickDocumentFile()
    if (!result.selected || !result.filePath || !result.fileName) {
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const importResult: ImportResult = await importAndPreview(result.filePath, result.fileName)
      if (importResult.ok && importResult.preview) {
        previews.value.push({
          id: nextId.value++,
          preview: importResult.preview,
          subjectCode,
          importStatus: "idle"
        })
      } else {
        error.value = importResult.error || "解析失败。"
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : "未知错误"
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 确认导入某个预览到本地 SQLite（private draft）。
   */
  async function confirmImport(previewId: number, subjectCode: string): Promise<boolean> {
    const item = previews.value.find((p) => p.id === previewId)
    if (!item || item.importStatus === "imported" || item.importStatus === "importing") {
      return false
    }

    item.importStatus = "importing"
    item.importError = undefined

    try {
      // 用预览项自己的学科入库：预览是在某个学科下解析的，若改按"当前学科"保存，
      // 切学科后确认就会把同一份文档存进另一个学科。
      const targetSubject = item.subjectCode || subjectCode
      const saved = await confirmImportToDraft(item.preview, targetSubject)
      item.importStatus = "imported"
      item.importedDocId = saved.id
      // 刷新已导入列表
      await loadImportedDocuments(targetSubject)
      return true
    } catch (e) {
      item.importStatus = "error"
      item.importError = e instanceof Error ? e.message : "导入失败"
      return false
    }
  }

  /**
   * 加载已导入的私有文档列表。
   */
  async function loadImportedDocuments(subjectCode?: string): Promise<void> {
    isLoadingImported.value = true
    importedError.value = null
    try {
      importedDocuments.value = await listImportedDocuments(subjectCode)
    } catch (e) {
      importedDocuments.value = []
      importedError.value = e instanceof Error ? e.message : "加载已导入资料失败"
    } finally {
      isLoadingImported.value = false
    }
  }

  /**
   * 彻底删除已导入的私有文档（hard delete: chunks + document，不可恢复）。
   * 失败时设置 deleteError，由调用方展示。
   */
  async function deleteImportedDocument(
    docId: string,
    subjectCode?: string
  ): Promise<boolean> {
    deleteError.value = null
    try {
      const ok = await removeImportedDocument(docId)
      if (ok) {
        // 如果当前 preview 列表中有对应项，重置其状态
        const previewItem = previews.value.find((p) => p.importedDocId === docId)
        if (previewItem) {
          previewItem.importStatus = "idle"
          previewItem.importedDocId = undefined
        }
        await loadImportedDocuments(subjectCode)
      }
      return ok
    } catch (e) {
      deleteError.value = e instanceof Error ? e.message : "删除失败"
      return false
    }
  }

  function clearDeleteError(): void {
    deleteError.value = null
  }

  function removePreview(id: number): void {
    previews.value = previews.value.filter((p) => p.id !== id)
  }

  function clearAll(): void {
    previews.value = []
    error.value = null
  }

  /**
   * 丢弃不属于当前学科的预览项（切学科时调用）。
   *
   * 修复"导入后换学科页面不刷新"：预览区原先是全局的、与学科无关，
   * 在学科 A 解析/导入后切到 B，A 的预览会继续留在界面上，
   * 必须手动刷新或重新进入页面才消失。
   */
  function dropPreviewsForOtherSubjects(subjectCode: string): void {
    previews.value = previews.value.filter((p) => p.subjectCode === subjectCode)
  }

  function clearError(): void {
    error.value = null
  }

  return {
    isLoading,
    previews,
    error,
    importedDocuments,
    isLoadingImported,
    importedError,
    deleteError,
    selectAndPreviewFile,
    confirmImport,
    loadImportedDocuments,
    deleteImportedDocument,
    clearDeleteError,
    removePreview,
    clearAll,
    dropPreviewsForOtherSubjects,
    clearError
  }
})
