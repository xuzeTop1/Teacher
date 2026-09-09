/**
 * DocumentContextPanel 纯逻辑函数
 *
 * 从 DocumentContextPanel.vue 中提取的可测试逻辑。
 */

/**
 * confirmDelete 的成功路径结果。
 * 调用方在 removeImportedDocument 成功后使用。
 */
export function confirmDeleteSuccess(deletedId: string): {
  removeFromList: boolean
  emitDelete: boolean
  clearError: boolean
} {
  return {
    removeFromList: true,
    emitDelete: true,
    clearError: true
  }
}

/**
 * confirmDelete 的失败路径结果。
 * 调用方在 removeImportedDocument 失败后使用。
 */
export function confirmDeleteFailure(error: unknown): {
  removeFromList: boolean
  emitDelete: boolean
  errorMessage: string
} {
  return {
    removeFromList: false,
    emitDelete: false,
    errorMessage: `删除失败：${error instanceof Error ? error.message : String(error)}`
  }
}
