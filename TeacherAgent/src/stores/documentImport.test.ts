import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { useDocumentImportStore } from "./documentImport"

const mockListImportedDocuments = vi.fn().mockResolvedValue([])
const mockRemoveImportedDocument = vi.fn()

vi.mock("../services/document/documentImportService", () => ({
  pickDocumentFile: vi.fn(),
  importAndPreview: vi.fn()
}))

vi.mock("../services/document/privateDocumentService", () => ({
  confirmImportToDraft: vi.fn(),
  listImportedDocuments: (...args: any[]) => mockListImportedDocuments(...args),
  removeImportedDocument: (...args: any[]) => mockRemoveImportedDocument(...args)
}))

const makePreview = (fileName: string) => ({
  fileName,
  fileType: fileName.endsWith(".pdf") ? "pdf" : "docx",
  title: fileName,
  plainTextPreview: "preview",
  plainTextTruncated: false,
  sheets: [],
  warnings: [],
  rawPlainText: "raw full text content",
  rawPagesOrSheets: [] as Array<{ name: string; text: string }>
})

describe("documentImport store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it("keeps previews in the shared store across component remounts", async () => {
    const { pickDocumentFile, importAndPreview } = await import("../services/document/documentImportService")
    vi.mocked(pickDocumentFile).mockResolvedValue({
      selected: true,
      filePath: "D:\\docs\\first.pdf",
      fileName: "first.pdf"
    })
    vi.mocked(importAndPreview).mockResolvedValue({
      ok: true,
      preview: makePreview("first.pdf")
    })

    const firstInstance = useDocumentImportStore()
    await firstInstance.selectAndPreviewFile()

    const remountedInstance = useDocumentImportStore()
    expect(remountedInstance.previews).toHaveLength(1)
    expect(remountedInstance.previews[0].preview.fileName).toBe("first.pdf")
  })

  it("keeps existing previews when a later file fails", async () => {
    const { pickDocumentFile, importAndPreview } = await import("../services/document/documentImportService")
    vi.mocked(pickDocumentFile)
      .mockResolvedValueOnce({
        selected: true,
        filePath: "D:\\docs\\first.pdf",
        fileName: "first.pdf"
      })
      .mockResolvedValueOnce({
        selected: true,
        filePath: "D:\\docs\\bad.docx",
        fileName: "bad.docx"
      })
    vi.mocked(importAndPreview)
      .mockResolvedValueOnce({
        ok: true,
        preview: makePreview("first.pdf")
      })
      .mockResolvedValueOnce({
        ok: false,
        error: "解析失败"
      })

    const store = useDocumentImportStore()
    await store.selectAndPreviewFile()
    await store.selectAndPreviewFile()

    expect(store.previews).toHaveLength(1)
    expect(store.previews[0].preview.fileName).toBe("first.pdf")
    expect(store.error).toBe("解析失败")
  })

  it("does not change state when file selection is cancelled", async () => {
    const { pickDocumentFile, importAndPreview } = await import("../services/document/documentImportService")
    vi.mocked(pickDocumentFile).mockResolvedValue({ selected: false })

    const store = useDocumentImportStore()
    await store.selectAndPreviewFile()

    expect(store.previews).toHaveLength(0)
    expect(store.error).toBeNull()
    expect(importAndPreview).not.toHaveBeenCalled()
  })

  it("removes and clears previews explicitly", () => {
    const store = useDocumentImportStore()
    store.previews.push({ id: 1, preview: makePreview("first.pdf"), importStatus: "idle" })
    store.previews.push({ id: 2, preview: makePreview("second.docx"), importStatus: "idle" })

    store.removePreview(1)
    expect(store.previews.map((p) => p.id)).toEqual([2])

    store.clearAll()
    expect(store.previews).toHaveLength(0)
    expect(store.error).toBeNull()
  })

  it("confirmImport calls loadImportedDocuments with subjectCode", async () => {
    const { confirmImportToDraft } = await import("../services/document/privateDocumentService")
    vi.mocked(confirmImportToDraft).mockResolvedValue({
      id: "doc-001",
      fileName: "test.pdf",
      fileType: "pdf",
      title: "test.pdf",
      subjectCode: "politics",
      sourceType: "private_user_import",
      status: "draft",
      chunkCount: 5,
      createdAt: "2026-07-05T00:00:00Z"
    })
    mockListImportedDocuments.mockResolvedValue([
      {
        id: "doc-001",
        fileName: "test.pdf",
        fileType: "pdf",
        title: "test.pdf",
        subjectCode: "politics",
        sourceType: "private_user_import",
        status: "draft",
        chunkCount: 5,
        createdAt: "2026-07-05T00:00:00Z"
      }
    ])

    const store = useDocumentImportStore()
    store.previews.push({ id: 1, preview: makePreview("test.pdf"), importStatus: "idle" })

    const result = await store.confirmImport(1, "politics")
    expect(result).toBe(true)
    expect(store.previews[0].importStatus).toBe("imported")
    // loadImportedDocuments should have been called with the same subjectCode
    expect(mockListImportedDocuments).toHaveBeenCalledWith("politics")
    expect(store.importedDocuments).toHaveLength(1)
  })

  it("loadImportedDocuments records error instead of silent swallowing", async () => {
    mockListImportedDocuments.mockRejectedValueOnce(new Error("SQLite 连接失败"))

    const store = useDocumentImportStore()
    await store.loadImportedDocuments("politics")

    expect(store.importedDocuments).toEqual([])
    expect(store.importedError).toBe("SQLite 连接失败")
    expect(store.isLoadingImported).toBe(false)
  })

  it("loadImportedDocuments clears previous error on success", async () => {
    mockListImportedDocuments
      .mockRejectedValueOnce(new Error("previous error"))
      .mockResolvedValueOnce([])

    const store = useDocumentImportStore()

    await store.loadImportedDocuments("politics")
    expect(store.importedError).toBe("previous error")

    await store.loadImportedDocuments("politics")
    expect(store.importedError).toBeNull()
  })

  describe("deleteImportedDocument", () => {
    const savedDoc = {
      id: "doc-del-001",
      fileName: "to-delete.pdf",
      fileType: "pdf",
      title: "to-delete.pdf",
      subjectCode: "math",
      sourceType: "private_user_import",
      status: "draft",
      chunkCount: 3,
      createdAt: "2026-07-06T00:00:00Z"
    }

    it("removes document from imported list on successful delete", async () => {
      mockRemoveImportedDocument.mockResolvedValue(true)
      mockListImportedDocuments.mockResolvedValueOnce([savedDoc]).mockResolvedValueOnce([])

      const store = useDocumentImportStore()
      await store.loadImportedDocuments("math")
      expect(store.importedDocuments).toHaveLength(1)

      const result = await store.deleteImportedDocument("doc-del-001", "math")

      expect(result).toBe(true)
      expect(mockRemoveImportedDocument).toHaveBeenCalledWith("doc-del-001")
      expect(store.importedDocuments).toHaveLength(0)
      expect(store.deleteError).toBeNull()
    })

    it("sets deleteError when delete throws", async () => {
      mockRemoveImportedDocument.mockRejectedValue(new Error("数据库锁定"))
      mockListImportedDocuments.mockResolvedValue([savedDoc])

      const store = useDocumentImportStore()
      await store.loadImportedDocuments("math")
      expect(store.importedDocuments).toHaveLength(1)

      const result = await store.deleteImportedDocument("doc-del-001", "math")

      expect(result).toBe(false)
      // list should be preserved (loadImportedDocuments was NOT called again)
      expect(store.importedDocuments).toHaveLength(1)
      expect(store.deleteError).toBe("数据库锁定")
    })

    it("sets generic deleteError when delete throws non-Error", async () => {
      mockRemoveImportedDocument.mockRejectedValue("unknown failure")

      const store = useDocumentImportStore()
      const result = await store.deleteImportedDocument("doc-del-001", "math")

      expect(result).toBe(false)
      expect(store.deleteError).toBe("删除失败")
    })

    it("clears deleteError on next delete attempt", async () => {
      mockRemoveImportedDocument
        .mockRejectedValueOnce(new Error("第一次失败"))
        .mockResolvedValueOnce(true)
      mockListImportedDocuments.mockResolvedValue([])

      const store = useDocumentImportStore()

      await store.deleteImportedDocument("doc-del-001", "math")
      expect(store.deleteError).toBe("第一次失败")

      await store.deleteImportedDocument("doc-del-001", "math")
      expect(store.deleteError).toBeNull()
    })

    it("resets preview importStatus when deleting an imported preview item", async () => {
      mockRemoveImportedDocument.mockResolvedValue(true)
      mockListImportedDocuments.mockResolvedValue([])

      const store = useDocumentImportStore()
      store.previews.push({
        id: 1,
        preview: makePreview("test.pdf"),
        importStatus: "imported",
        importedDocId: "doc-del-001"
      })

      await store.deleteImportedDocument("doc-del-001", "math")

      expect(store.previews[0].importStatus).toBe("idle")
      expect(store.previews[0].importedDocId).toBeUndefined()
    })
  })
})
