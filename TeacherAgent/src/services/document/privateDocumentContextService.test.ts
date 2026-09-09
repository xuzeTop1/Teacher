import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the IPC commands
const mockBindPrivateDocumentToConversation = vi.fn()
const mockClearPrivateDocumentBinding = vi.fn()
const mockLoadConversationPrivateDocumentId = vi.fn()
const mockGetPrivateDocument = vi.fn()

vi.mock("../../services/tauri/commands", () => ({
  bindPrivateDocumentToConversation: (...args: unknown[]) => mockBindPrivateDocumentToConversation(...args),
  clearPrivateDocumentBinding: (...args: unknown[]) => mockClearPrivateDocumentBinding(...args),
  loadConversationPrivateDocumentId: (...args: unknown[]) => mockLoadConversationPrivateDocumentId(...args),
  getPrivateDocument: (...args: unknown[]) => mockGetPrivateDocument(...args)
}))

import {
  bindDocumentToConversation,
  clearDocumentBinding,
  loadBoundDocument
} from "./privateDocumentContextService"

describe("privateDocumentContextService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("bindDocumentToConversation", () => {
    it("calls IPC with correct arguments", async () => {
      mockBindPrivateDocumentToConversation.mockResolvedValue(undefined)

      await bindDocumentToConversation("conv-1", "doc-1")

      expect(mockBindPrivateDocumentToConversation).toHaveBeenCalledWith("conv-1", "doc-1")
    })

    it("propagates errors from IPC", async () => {
      mockBindPrivateDocumentToConversation.mockRejectedValue(new Error("SQLite error"))

      await expect(bindDocumentToConversation("conv-1", "doc-1")).rejects.toThrow("SQLite error")
    })
  })

  describe("clearDocumentBinding", () => {
    it("calls IPC with correct arguments", async () => {
      mockClearPrivateDocumentBinding.mockResolvedValue(true)

      const result = await clearDocumentBinding("conv-1")

      expect(mockClearPrivateDocumentBinding).toHaveBeenCalledWith("conv-1")
      expect(result).toBe(true)
    })

    it("returns false when no binding existed", async () => {
      mockClearPrivateDocumentBinding.mockResolvedValue(false)

      const result = await clearDocumentBinding("conv-1")

      expect(result).toBe(false)
    })
  })

  describe("loadBoundDocument", () => {
    it("returns null when no binding exists", async () => {
      mockLoadConversationPrivateDocumentId.mockResolvedValue(null)

      const result = await loadBoundDocument("conv-1")

      expect(result).toBeNull()
      expect(mockGetPrivateDocument).not.toHaveBeenCalled()
    })

    it("returns RecentPrivateDocumentRef when binding and document exist", async () => {
      mockLoadConversationPrivateDocumentId.mockResolvedValue("doc-1")
      mockGetPrivateDocument.mockResolvedValue(
        { id: "doc-1", fileName: "test.pdf", fileType: "pdf", title: "测试文档", subjectCode: "math", sourceType: "", status: "", chunkCount: 5, createdAt: "" }
      )

      const result = await loadBoundDocument("conv-1")

      expect(result).toEqual({
        id: "doc-1",
        title: "测试文档",
        fileName: "test.pdf"
      })
      expect(mockGetPrivateDocument).toHaveBeenCalledWith("doc-1")
    })

    it("returns null when binding exists but document was deleted", async () => {
      mockLoadConversationPrivateDocumentId.mockResolvedValue("doc-deleted")
      mockGetPrivateDocument.mockResolvedValue(null)

      const result = await loadBoundDocument("conv-1")

      expect(result).toBeNull()
    })

    it("uses fileName as title when title is empty", async () => {
      mockLoadConversationPrivateDocumentId.mockResolvedValue("doc-1")
      mockGetPrivateDocument.mockResolvedValue(
        { id: "doc-1", fileName: "report.pdf", fileType: "pdf", title: "", subjectCode: "math", sourceType: "", status: "", chunkCount: 5, createdAt: "" }
      )

      const result = await loadBoundDocument("conv-1")

      expect(result).toEqual({
        id: "doc-1",
        title: "report.pdf",
        fileName: "report.pdf"
      })
    })
  })
})
