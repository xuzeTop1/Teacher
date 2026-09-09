import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("../tauri/commands", () => ({
  savePrivateDocument: vi.fn(),
  listPrivateDocuments: vi.fn(),
  deletePrivateDocument: vi.fn(),
  searchPrivateDocumentChunks: vi.fn()
}))

import {
  confirmImportToDraft,
  listImportedDocuments,
  removeImportedDocument,
  searchPrivateChunks
} from "./privateDocumentService"
import {
  savePrivateDocument,
  listPrivateDocuments,
  deletePrivateDocument,
  searchPrivateDocumentChunks
} from "../tauri/commands"

const mockSave = vi.mocked(savePrivateDocument)
const mockList = vi.mocked(listPrivateDocuments)
const mockDelete = vi.mocked(deletePrivateDocument)
const mockSearch = vi.mocked(searchPrivateDocumentChunks)

describe("privateDocumentService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("searchPrivateChunks", () => {
    it("calls searchPrivateDocumentChunks with correct parameters", async () => {
      mockSearch.mockResolvedValue([
        {
          documentId: "privdoc-001",
          documentTitle: "微积分笔记",
          fileName: "calculus.pdf",
          heading: "第一章 极限",
          text: "极限的定义",
          score: 5,
          sourceType: "private_document"
        }
      ])

      const results = await searchPrivateChunks("极限", "math", 3)

      expect(mockSearch).toHaveBeenCalledWith("极限", "math", 3)
      expect(results).toHaveLength(1)
      expect(results[0].sourceType).toBe("private_document")
      expect(results[0].documentTitle).toBe("微积分笔记")
    })

    it("returns empty array when no matches", async () => {
      mockSearch.mockResolvedValue([])

      const results = await searchPrivateChunks("量子力学", "math")

      expect(results).toHaveLength(0)
    })

    it("uses default limit of 5", async () => {
      mockSearch.mockResolvedValue([])

      await searchPrivateChunks("test", "math")

      expect(mockSearch).toHaveBeenCalledWith("test", "math", undefined)
    })
  })

  describe("confirmImportToDraft", () => {
    it("saves with raw text, not truncated preview", async () => {
      const rawText = "a".repeat(5000)
      mockSave.mockResolvedValue({
        id: "privdoc-001",
        fileName: "test.pdf",
        fileType: "pdf",
        title: "Test",
        subjectCode: "math",
        sourceType: "private_user_import",
        status: "draft",
        chunkCount: 1,
        createdAt: "2026-01-01"
      })

      await confirmImportToDraft(
        {
          fileName: "test.pdf",
          fileType: "pdf",
          title: "Test",
          plainTextPreview: "a".repeat(3000),
          plainTextTruncated: true,
          sheets: [],
          warnings: [],
          rawPlainText: rawText,
          rawPagesOrSheets: [{ name: "Page 1", text: rawText }]
        },
        "math"
      )

      // 应使用 raw 文本，不是截断后的 preview
      const callInput = mockSave.mock.calls[0][0]
      expect(callInput.plainText).toBe(rawText)
      expect(callInput.pagesOrSheets[0].text).toBe(rawText)
    })
  })

  describe("removeImportedDocument", () => {
    it("calls deletePrivateDocument", async () => {
      mockDelete.mockResolvedValue(true)

      const result = await removeImportedDocument("privdoc-001")

      expect(result).toBe(true)
      expect(mockDelete).toHaveBeenCalledWith("privdoc-001")
    })
  })
})
