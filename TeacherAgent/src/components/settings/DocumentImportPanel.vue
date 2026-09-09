<script setup lang="ts">
import { onMounted, reactive, watch } from "vue"
import { useDocumentImportStore } from "../../stores/documentImport"
import { useAppStore } from "../../stores/app"

const store = useDocumentImportStore()
const appStore = useAppStore()

/** 默认展示的页面/工作表数量 */
const DEFAULT_SHEET_COUNT = 2

/** 跟踪每个预览项是否展开全部页面 */
const expandedPreviews = reactive(new Set<number>())

function isPreviewExpanded(previewId: number): boolean {
  return expandedPreviews.has(previewId)
}

function togglePreviewExpand(previewId: number): void {
  if (expandedPreviews.has(previewId)) {
    expandedPreviews.delete(previewId)
  } else {
    expandedPreviews.add(previewId)
  }
}

function getVisibleSheets(previewId: number, sheets: Array<{ name: string; textPreview: string; textTruncated: boolean }>) {
  if (expandedPreviews.has(previewId) || sheets.length <= DEFAULT_SHEET_COUNT) {
    return sheets
  }
  return sheets.slice(0, DEFAULT_SHEET_COUNT)
}

function getHiddenSheetCount(previewId: number, sheets: Array<{ name: string; textPreview: string; textTruncated: boolean }>): number {
  if (expandedPreviews.has(previewId) || sheets.length <= DEFAULT_SHEET_COUNT) {
    return 0
  }
  return sheets.length - DEFAULT_SHEET_COUNT
}

async function handleSelectFile() {
  await store.selectAndPreviewFile()
}

async function handleConfirmImport(previewId: number) {
  const subjectCode = appStore.selectedSubject || "math"
  await store.confirmImport(previewId, subjectCode)
}

async function handleDeleteImported(docId: string) {
  if (!confirm("从本地资料库删除？会删除文本和分块，不可恢复。")) return
  const subjectCode = appStore.selectedSubject || "math"
  await store.deleteImportedDocument(docId, subjectCode)
}

function handleRefreshImported() {
  const subjectCode = appStore.selectedSubject || "math"
  store.loadImportedDocuments(subjectCode)
}

onMounted(() => {
  const subjectCode = appStore.selectedSubject || "math"
  store.loadImportedDocuments(subjectCode)
})

// 切换学科时重新加载已导入资料
watch(
  () => appStore.selectedSubject,
  (newSubject) => {
    store.loadImportedDocuments(newSubject || "math")
  }
)
</script>

<template>
  <div class="document-import-panel">
    <h3>私有资料导入（实验）</h3>
    <p class="panel-copy">
      选择本地 PDF / DOCX / XLSX 文件，预览解析结果。确认后保存到本机 SQLite，作为私有草稿资料。
    </p>
    <p class="privacy-notice">
      🔒 文件仅在本机解析，不会上传云端。确认导入后，解析文本会保存到本机 SQLite，作为私有草稿资料；不会上传云端，也不会写入内置知识库。
    </p>

    <div class="import-actions">
      <button
        class="action-button action-button-primary"
        type="button"
        :disabled="store.isLoading"
        @click="handleSelectFile"
      >
        <v-icon icon="mdi-file-upload-outline" size="20" />
        <span>{{ store.isLoading ? "解析中…" : "选择文件" }}</span>
      </button>
      <button
        v-if="store.previews.length > 0"
        class="action-button action-button-secondary"
        type="button"
        @click="store.clearAll"
      >
        <v-icon icon="mdi-close-circle-outline" size="20" />
        <span>清空全部 ({{ store.previews.length }})</span>
      </button>
    </div>

    <!-- Loading -->
    <div v-if="store.isLoading" class="loading-state">
      <v-progress-circular indeterminate size="24" color="primary" />
      <span>正在解析文档…</span>
    </div>

    <!-- 错误（不清空已有预览） -->
    <v-alert
      v-if="store.error"
      type="error"
      variant="tonal"
      class="mt-4"
      closable
      @click:close="store.clearError"
    >
      <div>{{ store.error }}</div>
      <div v-if="store.error.includes('扫描版') || store.error.includes('图片型')" class="error-hint">
        提示：可尝试将 PDF 转换为可复制文本的版本，或使用 OCR 工具处理后再导入。
      </div>
    </v-alert>

    <!-- 预览列表 -->
    <div v-if="store.previews.length > 0" class="previews-list">
      <div
        v-for="item in store.previews"
        :key="item.id"
        class="preview-card"
      >
        <div class="preview-card-header">
          <div class="preview-card-title">
            <span class="file-type-badge">{{ item.preview.fileType.toUpperCase() }}</span>
            <span class="file-name">{{ item.preview.fileName }}</span>
            <span v-if="item.preview.title !== item.preview.fileName" class="doc-title">— {{ item.preview.title }}</span>
          </div>
          <div class="preview-card-actions">
            <!-- 确认导入按钮 -->
            <button
              v-if="item.importStatus === 'idle' || item.importStatus === 'error'"
              class="action-button action-button-primary action-button-sm"
              type="button"
              @click="handleConfirmImport(item.id)"
            >
              <v-icon icon="mdi-check-circle-outline" size="16" />
              <span>确认导入</span>
            </button>
            <button
              v-else-if="item.importStatus === 'importing'"
              class="action-button action-button-sm"
              type="button"
              disabled
            >
              <v-progress-circular indeterminate size="14" color="primary" />
              <span>导入中…</span>
            </button>
            <button
              v-else-if="item.importStatus === 'imported'"
              class="action-button action-button-sm imported-btn"
              type="button"
              disabled
            >
              <v-icon icon="mdi-check-circle" size="16" />
              <span>已导入</span>
            </button>
            <button
              class="remove-btn"
              type="button"
              title="移除此预览"
              @click="store.removePreview(item.id)"
            >
              <v-icon icon="mdi-close" size="18" />
            </button>
          </div>
        </div>

        <div class="preview-card-meta">
          <span v-if="item.preview.sheets.length > 0">{{ item.preview.sheets.length }} 个页面/工作表</span>
        </div>

        <!-- 导入错误 -->
        <v-alert
          v-if="item.importError"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-2"
        >
          {{ item.importError }}
        </v-alert>

        <v-alert
          v-if="item.preview.warnings.length > 0"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-2"
        >
          <div v-for="(w, i) in item.preview.warnings" :key="i" class="warning-text">{{ w }}</div>
        </v-alert>

        <!-- pagesOrSheets 列表 -->
        <div v-if="item.preview.sheets.length > 0" class="sheets-list">
          <div
            v-for="(sheet, i) in getVisibleSheets(item.id, item.preview.sheets)"
            :key="i"
            class="sheet-item"
          >
            <div class="sheet-name">{{ sheet.name }}</div>
            <pre class="sheet-text">{{ sheet.textPreview }}<span v-if="sheet.textTruncated" class="truncated-marker">… [已截断，仅展示预览，确认导入会保存完整文本]</span></pre>
          </div>
          <button
            v-if="item.preview.sheets.length > DEFAULT_SHEET_COUNT"
            class="expand-toggle-btn"
            type="button"
            @click="togglePreviewExpand(item.id)"
          >
            {{ isPreviewExpanded(item.id)
              ? '收起'
              : `展开更多页面（还有 ${getHiddenSheetCount(item.id, item.preview.sheets)} 个）` }}
          </button>
        </div>

        <!-- plainText 预览 -->
        <div v-if="item.preview.plainTextPreview" class="plaintext-preview">
          <div class="plaintext-label">全文预览</div>
          <pre class="plaintext-text">{{ item.preview.plainTextPreview }}<span v-if="item.preview.plainTextTruncated" class="truncated-marker">… [已截断，仅展示预览，确认导入会保存完整文本]</span></pre>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="store.previews.length === 0 && !store.isLoading && !store.error" class="empty-state">
      尚未选择文件。点击上方按钮选择 PDF / DOCX / XLSX 文件。
    </div>

    <!-- 已导入资料列表 -->
    <div class="imported-section">
      <div class="imported-header">
        <h4>已导入资料</h4>
        <button
          class="action-button action-button-secondary action-button-sm"
          type="button"
          :disabled="store.isLoadingImported"
          @click="handleRefreshImported"
        >
          <v-icon icon="mdi-refresh" size="16" />
          <span>刷新</span>
        </button>
      </div>

      <!-- 轻量状态摘要 -->
      <div v-if="!store.isLoadingImported && store.importedDocuments.length > 0" class="rag-status-summary">
        <span>已导入资料：{{ store.importedDocuments.length }} 份</span>
        <span class="rag-status-dot">●</span>
        <span>对话检索：已接入本地私有资料 RAG</span>
      </div>

      <v-alert
        v-if="store.deleteError"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-2"
        closable
        @click:close="store.clearDeleteError"
      >
        删除失败：{{ store.deleteError }}
      </v-alert>

      <div v-if="store.isLoadingImported" class="loading-state">
        <v-progress-circular indeterminate size="20" color="primary" />
        <span>加载中…</span>
      </div>

      <v-alert
        v-else-if="store.importedError"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-2"
      >
        加载已导入资料失败：{{ store.importedError }}
      </v-alert>

      <div v-else-if="store.importedDocuments.length === 0" class="empty-imported">
        当前学科暂无已导入资料。预览文档后点击"确认导入"即可保存到本机。
      </div>

      <div v-else class="imported-list">
        <div
          v-for="doc in store.importedDocuments"
          :key="doc.id"
          class="imported-item"
        >
          <div class="imported-item-main">
            <span class="file-type-badge file-type-badge-sm">{{ doc.fileType.toUpperCase() }}</span>
            <span class="imported-file-name">{{ doc.fileName }}</span>
            <span v-if="doc.title !== doc.fileName" class="imported-title">{{ doc.title }}</span>
          </div>
          <div class="imported-item-meta">
            <span class="imported-meta-tag">{{ doc.subjectCode }}</span>
            <span class="imported-meta-tag">{{ doc.chunkCount }} chunks</span>
            <span class="imported-meta-date">{{ doc.createdAt.slice(0, 10) }}</span>
          </div>
          <button
            class="action-button action-button-secondary action-button-sm delete-doc-btn"
            type="button"
            @click="handleDeleteImported(doc.id)"
          >
            <v-icon icon="mdi-delete-outline" size="14" />
            <span>删除</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.document-import-panel {
  padding: 16px;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  background: #fff;
}

.document-import-panel h3 {
  margin: 0 0 8px;
  font-size: 1.1rem;
  font-weight: 600;
}

.panel-copy {
  margin: 0 0 8px;
  font-size: 0.85rem;
  color: #666;
}

.privacy-notice {
  margin: 0 0 16px;
  padding: 8px 12px;
  background: #e8f5e9;
  border-radius: 8px;
  font-size: 0.8rem;
  color: #2e7d32;
  line-height: 1.5;
}

.import-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 0;
  font-size: 0.9rem;
  color: #666;
}

.empty-state {
  text-align: center;
  padding: 24px;
  color: #999;
  font-size: 0.85rem;
}

/* ── 按钮 ──────────────────────────────────────────────── */

.action-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid #d0d0d0;
  border-radius: 8px;
  background: #fff;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s;
}

.action-button:hover:not(:disabled) {
  background: #f5f5f5;
}

.action-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.action-button-primary {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
}

.action-button-primary:hover:not(:disabled) {
  background: #1565c0;
}

.action-button-secondary {
  background: #fff;
  color: #666;
}

.action-button-sm {
  padding: 4px 10px;
  font-size: 0.78rem;
}

.imported-btn {
  background: #e8f5e9;
  color: #2e7d32;
  border-color: #a5d6a7;
  cursor: default;
}

/* ── 预览卡片列表 ────────────────────────────────────── */

.previews-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}

.preview-card {
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  padding: 14px;
  background: #fafafa;
  content-visibility: auto;
  contain-intrinsic-size: auto 200px;
}

.preview-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.preview-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
}

.preview-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.file-type-badge {
  padding: 2px 6px;
  background: #e3f2fd;
  color: #1565c0;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
}

.file-type-badge-sm {
  font-size: 0.65rem;
  padding: 1px 4px;
}

.file-name {
  font-weight: 500;
  color: #333;
}

.doc-title {
  color: #888;
  font-size: 0.8rem;
}

.remove-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: #999;
  transition: all 0.15s;
}

.remove-btn:hover {
  background: #ffebee;
  color: #c62828;
}

.remove-btn-sm {
  padding: 2px;
}

.preview-card-meta {
  font-size: 0.78rem;
  color: #888;
  margin-bottom: 8px;
}

.warning-text {
  font-size: 0.8rem;
}

.error-hint {
  margin-top: 8px;
  font-size: 0.8rem;
  color: #666;
  line-height: 1.5;
}

/* ── 内容预览 ────────────────────────────────────────── */

.sheets-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.sheet-item {
  border: 1px solid #eee;
  border-radius: 6px;
  overflow: hidden;
}

.sheet-name {
  padding: 4px 10px;
  background: #f5f5f5;
  font-size: 0.75rem;
  font-weight: 500;
  color: #555;
  border-bottom: 1px solid #eee;
}

.sheet-text,
.plaintext-text {
  margin: 0;
  padding: 8px 10px;
  font-size: 0.75rem;
  line-height: 1.5;
  color: #333;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  background: #fff;
  font-family: "Cascadia Code", "Fira Code", "Consolas", monospace;
  content-visibility: auto;
  contain-intrinsic-size: auto 120px;
}

.expand-toggle-btn {
  display: block;
  width: 100%;
  padding: 6px 12px;
  margin-top: 4px;
  border: 1px dashed #d0d0d0;
  border-radius: 6px;
  background: #fafafa;
  color: #666;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s;
}

.expand-toggle-btn:hover {
  background: #f0f0f0;
  border-color: #bbb;
  color: #333;
}

.plaintext-preview {
  margin-top: 8px;
}

.plaintext-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #555;
  margin-bottom: 4px;
}

.truncated-marker {
  color: #999;
  font-style: italic;
}

/* ── 已导入资料列表 ──────────────────────────────────── */

.imported-section {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #e0e0e0;
}

.imported-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.imported-header h4 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.empty-imported {
  text-align: center;
  padding: 16px;
  color: #999;
  font-size: 0.82rem;
}

.imported-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.imported-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid #eee;
  border-radius: 8px;
  background: #fafafa;
}

.imported-item-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.imported-file-name {
  font-size: 0.82rem;
  font-weight: 500;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.imported-title {
  font-size: 0.78rem;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.imported-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.imported-meta-tag {
  padding: 1px 6px;
  background: #f0f0f0;
  border-radius: 4px;
  font-size: 0.7rem;
  color: #666;
}

.imported-meta-date {
  font-size: 0.7rem;
  color: #999;
}

.delete-doc-btn:hover:not(:disabled) {
  background: #ffebee;
  color: #c62828;
  border-color: #ef9a9a;
}

/* ── RAG 状态摘要 ────────────────────────────────────── */

.rag-status-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: #f1f8e9;
  border-radius: 6px;
  font-size: 0.78rem;
  color: #558b2f;
}

.rag-status-dot {
  font-size: 0.5rem;
  color: #7cb342;
}
</style>
