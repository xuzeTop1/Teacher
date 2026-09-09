import { describe, expect, it } from "vitest"
import {
  selectDocumentAction,
  clearCurrentDocumentAction,
  deleteDocumentAction
} from "./documentContextManager"
import type { RecentPrivateDocumentRef } from "../../engine/agents/toolAgent"

const mockDoc: RecentPrivateDocumentRef = {
  id: "doc-001",
  title: "微积分笔记",
  fileName: "calculus-notes.pdf"
}

describe("documentContextManager", () => {
  describe("selectDocumentAction", () => {
    it("returns status text with document title", () => {
      const result = selectDocumentAction(mockDoc)

      expect(result.statusText).toContain("微积分笔记")
    })

    it("选择资料后面板应关闭（showPanel = false）", () => {
      const result = selectDocumentAction(mockDoc)

      expect(result.showPanel).toBe(false)
    })
  })

  describe("clearCurrentDocumentAction", () => {
    it("returns status text indicating document is preserved", () => {
      const result = clearCurrentDocumentAction()

      expect(result.statusText).toContain("仍保留在本地资料库中")
    })

    it("本轮不用后面板应关闭（showPanel = false）", () => {
      const result = clearCurrentDocumentAction()

      expect(result.showPanel).toBe(false)
    })

    it("returns system message explaining the action", () => {
      const result = clearCurrentDocumentAction()

      expect(result.systemMessage).toContain("仍保留在本地资料库中")
      expect(result.systemMessage).toContain("随时重新选择")
    })

    it("does NOT mention deletion or SQLite removal", () => {
      const result = clearCurrentDocumentAction()

      expect(result.systemMessage).not.toContain("删除")
      expect(result.systemMessage).not.toContain("彻底")
    })
  })

  describe("deleteDocumentAction", () => {
    it("clears current document when deleting the active document", () => {
      const result = deleteDocumentAction("doc-001", mockDoc)

      expect(result.clearedCurrent).toBe(true)
      expect(result.statusText).toContain("微积分笔记")
      expect(result.systemMessage).toContain("彻底删除")
    })

    it("does not clear current document when deleting a different document", () => {
      const result = deleteDocumentAction("doc-002", mockDoc)

      expect(result.clearedCurrent).toBe(false)
      expect(result.statusText).toBe("已删除资料。")
      expect(result.systemMessage).not.toContain("微积分笔记")
    })

    it("handles null current document gracefully", () => {
      const result = deleteDocumentAction("doc-001", null)

      expect(result.clearedCurrent).toBe(false)
      expect(result.statusText).toBe("已删除资料。")
    })

    it("uses fileName as fallback when title is empty", () => {
      const docNoTitle: RecentPrivateDocumentRef = {
        id: "doc-003",
        title: "",
        fileName: "fallback.pdf"
      }

      const result = deleteDocumentAction("doc-003", docNoTitle)

      expect(result.clearedCurrent).toBe(true)
      expect(result.systemMessage).toContain("fallback.pdf")
    })

    it("删除失败时不调用此函数——组件在 catch 中跳过 emit 和列表移除", () => {
      // deleteDocumentAction 是纯函数，只在删除成功后由 ChatView 调用。
      // 删除失败时 DocumentContextPanel.confirmDelete 的 catch 分支：
      //   1. 不从 importedDocuments 移除文档
      //   2. 不 emit("delete")
      //   3. 设置 deleteError 给用户可见提示
      // 此测试记录该契约：调用方必须在 try 成功路径中使用此函数。
      const result = deleteDocumentAction("doc-001", mockDoc)

      // 成功路径才返回 clearedCurrent: true
      expect(result.clearedCurrent).toBe(true)
      expect(result.systemMessage).toContain("彻底删除")
    })
  })
})
