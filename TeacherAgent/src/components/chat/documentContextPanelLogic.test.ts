import { describe, expect, it } from "vitest"
import { confirmDeleteSuccess, confirmDeleteFailure } from "./documentContextPanelLogic"

describe("documentContextPanelLogic", () => {
  describe("confirmDeleteSuccess", () => {
    it("instructs caller to remove document from list", () => {
      const result = confirmDeleteSuccess("doc-001")

      expect(result.removeFromList).toBe(true)
    })

    it("instructs caller to emit delete event", () => {
      const result = confirmDeleteSuccess("doc-001")

      expect(result.emitDelete).toBe(true)
    })

    it("instructs caller to clear any prior error", () => {
      const result = confirmDeleteSuccess("doc-001")

      expect(result.clearError).toBe(true)
    })
  })

  describe("confirmDeleteFailure", () => {
    it("删除失败时列表保留（removeFromList = false）", () => {
      const result = confirmDeleteFailure(new Error("网络错误"))

      expect(result.removeFromList).toBe(false)
    })

    it("删除失败时不 emit delete（emitDelete = false）", () => {
      const result = confirmDeleteFailure(new Error("网络错误"))

      expect(result.emitDelete).toBe(false)
    })

    it("删除失败时返回用户可见错误文案", () => {
      const result = confirmDeleteFailure(new Error("SQLite 锁定"))

      expect(result.errorMessage).toContain("删除失败")
      expect(result.errorMessage).toContain("SQLite 锁定")
    })

    it("handles non-Error thrown values", () => {
      const result = confirmDeleteFailure("字符串错误")

      expect(result.errorMessage).toContain("删除失败")
      expect(result.errorMessage).toContain("字符串错误")
    })

    it("handles null/undefined thrown values", () => {
      const result = confirmDeleteFailure(null)

      expect(result.errorMessage).toContain("删除失败")
    })
  })
})
