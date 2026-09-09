<script setup lang="ts">
import { ref, onMounted, watch } from "vue"
import type { RecentPrivateDocumentRef } from "../../engine/agents/toolAgent"
import type { SavedPrivateDocument } from "../../services/tauri/commands"
import { listImportedDocuments, removeImportedDocument } from "../../services/document/privateDocumentService"
import { confirmDeleteSuccess, confirmDeleteFailure } from "./documentContextPanelLogic"

const props = defineProps<{
  currentDocument: RecentPrivateDocumentRef | null
  subjectCode: string
}>()

const emit = defineEmits<{
  select: [document: RecentPrivateDocumentRef]
  clear: []
  delete: [documentId: string]
  close: []
}>()

const importedDocuments = ref<SavedPrivateDocument[]>([])
const isLoading = ref(false)
const loadError = ref<string | null>(null)
const isDeleting = ref(false)
const deleteError = ref<string | null>(null)
const showDeleteConfirm = ref(false)
const pendingDeleteDocument = ref<SavedPrivateDocument | null>(null)

onMounted(() => {
  void loadDocumentList()
})

watch(() => props.subjectCode, () => {
  void loadDocumentList()
})

async function loadDocumentList() {
  isLoading.value = true
  loadError.value = null

  try {
    importedDocuments.value = await listImportedDocuments(props.subjectCode)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "加载失败"
  } finally {
    isLoading.value = false
  }
}

function selectDocument(doc: SavedPrivateDocument) {
  emit("select", {
    id: doc.id,
    title: doc.title || doc.fileName,
    fileName: doc.fileName
  })
}

function clearCurrentDocument() {
  emit("clear")
}

function requestDeleteDocument(doc: SavedPrivateDocument) {
  pendingDeleteDocument.value = doc
  showDeleteConfirm.value = true
  deleteError.value = null
}

async function confirmDelete() {
  const doc = pendingDeleteDocument.value
  if (!doc || isDeleting.value) return

  showDeleteConfirm.value = false
  isDeleting.value = true
  deleteError.value = null

  try {
    await removeImportedDocument(doc.id)
    const result = confirmDeleteSuccess(doc.id)
    if (result.emitDelete) emit("delete", doc.id)
    if (result.removeFromList) {
      importedDocuments.value = importedDocuments.value.filter(d => d.id !== doc.id)
    }
  } catch (error) {
    const result = confirmDeleteFailure(error)
    deleteError.value = result.errorMessage
    // removeFromList = false → 列表保留
    // emitDelete = false → 父组件不收到 delete 事件
  } finally {
    isDeleting.value = false
    pendingDeleteDocument.value = null
  }
}

function cancelDelete() {
  showDeleteConfirm.value = false
  pendingDeleteDocument.value = null
}

function closePanel() {
  emit("close")
}
</script>

<template>
  <div class="document-context-panel" role="dialog" aria-label="资料上下文管理">
    <div class="panel-header">
      <span class="panel-title">资料上下文</span>
      <button class="panel-close-btn" type="button" title="关闭" @click="closePanel">×</button>
    </div>

    <!-- 当前资料 -->
    <div class="panel-section">
      <div class="section-label">当前资料</div>
      <div v-if="currentDocument" class="current-doc">
        <span class="current-doc-name">{{ currentDocument.title }}</span>
        <div class="current-doc-actions">
          <button
            class="doc-action-btn doc-action-clear"
            type="button"
            title="本轮对话不再使用此资料（不删除本地文件）"
            @click="clearCurrentDocument"
          >
            本轮不用
          </button>
          <button
            class="doc-action-btn doc-action-delete"
            type="button"
            title="从本地 SQLite 彻底删除此资料"
            @click="requestDeleteDocument({ id: currentDocument.id, fileName: currentDocument.fileName, title: currentDocument.title, fileType: '', subjectCode: subjectCode, sourceType: '', status: '', chunkCount: 0, createdAt: '' })"
          >
            删除资料
          </button>
        </div>
      </div>
      <div v-else class="no-current-doc">
        当前对话未选择资料
      </div>
    </div>

    <!-- 已导入资料列表 -->
    <div class="panel-section">
      <div class="section-label">
        已导入资料（{{ subjectCode }}）
        <button
          class="refresh-btn"
          type="button"
          title="刷新列表"
          :disabled="isLoading"
          @click="loadDocumentList"
        >
          ↻
        </button>
      </div>

      <div v-if="isLoading" class="loading-text">加载中...</div>
      <div v-else-if="loadError" class="error-text">{{ loadError }}</div>
      <div v-else-if="importedDocuments.length === 0" class="empty-text">
        暂无已导入资料
      </div>
      <div v-else class="doc-list">
        <div
          v-for="doc in importedDocuments"
          :key="doc.id"
          class="doc-item"
          :class="{ 'doc-item-active': currentDocument?.id === doc.id }"
        >
          <button
            class="doc-item-select-btn"
            type="button"
            :disabled="currentDocument?.id === doc.id"
            @click="selectDocument(doc)"
          >
            <span class="doc-item-name">{{ doc.title || doc.fileName }}</span>
            <span class="doc-item-meta">{{ doc.fileType.toUpperCase() }} · {{ doc.chunkCount }} 块</span>
          </button>
          <button
            class="doc-item-delete-btn"
            type="button"
            title="删除此资料"
            :disabled="isDeleting"
            @click="requestDeleteDocument(doc)"
          >
            ×
          </button>
        </div>
      </div>
    </div>

    <div v-if="deleteError" class="delete-error-bar">
      <span>{{ deleteError }}</span>
      <button class="delete-error-dismiss" type="button" @click="deleteError = null">×</button>
    </div>

    <div class="panel-footer">
      资料仅保存在本地 SQLite，不会上传云端。
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="showDeleteConfirm" class="delete-confirm-overlay" @click.self="cancelDelete">
      <div class="delete-confirm-dialog">
        <p>确认删除《{{ pendingDeleteDocument?.title || pendingDeleteDocument?.fileName }}》？</p>
        <p class="delete-confirm-warning">此操作将从本地 SQLite 彻底删除文档和所有分块，不可恢复。</p>
        <div class="delete-confirm-actions">
          <button class="doc-action-btn doc-action-clear" type="button" @click="cancelDelete">取消</button>
          <button class="doc-action-btn doc-action-delete" type="button" :disabled="isDeleting" @click="confirmDelete">
            {{ isDeleting ? "删除中..." : "确认删除" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.document-context-panel {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  max-width: 420px;
  margin-bottom: 8px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 50;
  font-size: 0.82rem;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #f8f9fa;
  border-bottom: 1px solid #eee;
}

.panel-title {
  font-weight: 600;
  color: #333;
}

.panel-close-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #666;
  font-size: 1.1rem;
  cursor: pointer;
  border-radius: 4px;
}

.panel-close-btn:hover {
  background: #e8e8e8;
  color: #333;
}

.panel-section {
  padding: 10px 14px;
  border-bottom: 1px solid #f0f0f0;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.refresh-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #888;
  font-size: 0.85rem;
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
}

.refresh-btn:hover:not(:disabled) {
  background: #e8e8e8;
  color: #333;
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.current-doc {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.current-doc-name {
  font-weight: 500;
  color: #4a90d9;
  word-break: break-word;
}

.current-doc-actions {
  display: flex;
  gap: 6px;
}

.doc-action-btn {
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid;
  transition: all 0.15s;
}

.doc-action-clear {
  background: #fff;
  border-color: #d0d5dd;
  color: #344054;
}

.doc-action-clear:hover {
  background: #f2f4f7;
  border-color: #98a2b3;
}

.doc-action-delete {
  background: #fff;
  border-color: #fda29b;
  color: #b42318;
}

.doc-action-delete:hover {
  background: #fef3f2;
  border-color: #f97066;
}

.doc-action-delete:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.no-current-doc {
  color: #666;
  font-style: italic;
}

.loading-text,
.error-text,
.empty-text {
  padding: 6px 0;
  color: #888;
  font-size: 0.78rem;
}

.error-text {
  color: #d32f2f;
}

.doc-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
}

.doc-item {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 6px;
  border: 1px solid transparent;
}

.doc-item-active {
  border-color: #4a90d9;
  background: #e3f2fd;
}

.doc-item-select-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
}

.doc-item-select-btn:hover:not(:disabled) {
  background: #f0f4ff;
}

.doc-item-select-btn:disabled {
  cursor: default;
}

.doc-item-name {
  font-weight: 500;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-item-meta {
  font-size: 0.7rem;
  color: #999;
}

.doc-item-delete-btn {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #999;
  font-size: 1rem;
  cursor: pointer;
  border-radius: 4px;
}

.doc-item-delete-btn:hover:not(:disabled) {
  background: #fef3f2;
  color: #b42318;
}

.doc-item-delete-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.delete-error-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 14px;
  background: #fef3f2;
  color: #b42318;
  font-size: 0.78rem;
  border-top: 1px solid #fecdca;
}

.delete-error-dismiss {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #b42318;
  font-size: 0.9rem;
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
}

.delete-error-dismiss:hover {
  background: #fecdca;
}

.panel-footer {
  padding: 8px 14px;
  color: #aaa;
  font-size: 0.7rem;
  text-align: center;
}

.delete-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.delete-confirm-dialog {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  max-width: 340px;
  width: 90%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.delete-confirm-dialog p {
  margin: 0 0 8px;
  font-size: 0.85rem;
  color: #333;
}

.delete-confirm-warning {
  color: #b42318 !important;
  font-size: 0.78rem !important;
}

.delete-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
