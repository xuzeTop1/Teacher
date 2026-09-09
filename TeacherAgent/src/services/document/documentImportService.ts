/**
 * Document Import Service — 私有资料上传解析预览服务
 *
 * 封装文件选择、解析调用、预览截断、错误文案。
 * 不写入数据库，不上传云端。
 */

import {
  selectDocumentFile,
  parseDocumentWithWorker,
  type ParseDocumentResult,
  type FileSelectionResult
} from "../tauri/commands"

/** 允许的文件扩展名 */
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".xlsx"]

/** plainText 预览最大字符数 */
const PREVIEW_MAX_CHARS = 2000

/** pagesOrSheets 单项预览最大字符数 */
const SHEET_PREVIEW_MAX_CHARS = 800

export interface DocumentPreview {
  fileName: string
  fileType: string
  title: string
  /** UI 截断后的预览文本 */
  plainTextPreview: string
  plainTextTruncated: boolean
  /** UI 截断后的页面预览 */
  sheets: Array<{ name: string; textPreview: string; textTruncated: boolean }>
  warnings: string[]
  /** 原始全文（用于入库，不截断） */
  rawPlainText: string
  /** 原始页面（用于入库，不截断） */
  rawPagesOrSheets: Array<{ name: string; text: string }>
}

export interface ImportResult {
  ok: boolean
  preview?: DocumentPreview
  error?: string
}

/**
 * 打开文件选择对话框，返回选中的文件路径和文件名。
 * 用户取消时返回 { selected: false }。
 */
export async function pickDocumentFile(): Promise<FileSelectionResult> {
  return selectDocumentFile()
}

/**
 * 校验文件扩展名是否合法。
 */
export function isAllowedFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."))
  return ALLOWED_EXTENSIONS.includes(ext)
}

/**
 * 调用 worker 解析文档并生成预览。
 * 不写入数据库，不上传云端。
 */
export async function importAndPreview(filePath: string, fileName: string): Promise<ImportResult> {
  if (!isAllowedFile(fileName)) {
    const ext = fileName.slice(fileName.lastIndexOf("."))
    return {
      ok: false,
      error: `不支持的文件类型: ${ext}。仅支持 .pdf / .docx / .xlsx。`
    }
  }

  let raw: ParseDocumentResult
  try {
    raw = await parseDocumentWithWorker(filePath)
  } catch (e) {
    return {
      ok: false,
      error: formatWorkerError(e)
    }
  }

  if (!raw.ok) {
    return {
      ok: false,
      error: sanitizeErrorMessage(raw.error || "解析失败，未知错误。")
    }
  }

  const rawPlainText = raw.plainText || ""
  const rawPages = raw.pagesOrSheets || []

  const preview: DocumentPreview = {
    fileName,
    fileType: raw.fileType || "unknown",
    title: raw.title || fileName,
    plainTextPreview: truncate(rawPlainText, PREVIEW_MAX_CHARS),
    plainTextTruncated: rawPlainText.length > PREVIEW_MAX_CHARS,
    sheets: rawPages.map((s) => ({
      name: s.name,
      textPreview: truncate(s.text, SHEET_PREVIEW_MAX_CHARS),
      textTruncated: s.text.length > SHEET_PREVIEW_MAX_CHARS
    })),
    warnings: raw.warnings || [],
    rawPlainText,
    rawPagesOrSheets: rawPages.map((s) => ({ name: s.name, text: s.text }))
  }

  return { ok: true, preview }
}

/**
 * 截断文本，返回截断后的内容。
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen)
}

/**
 * 格式化 worker 错误信息，避免暴露完整路径。
 */
function formatWorkerError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)

  if (msg.includes("Python") && msg.includes("未安装")) {
    return "Python 环境未找到。开发期需安装 Python 3.10+；生产版将内置解析引擎。"
  }
  if (msg.includes("document_worker") && msg.includes("模块")) {
    return "Document Worker 模块未找到。请运行: cd tools/document-worker && pip install -e \".[dev]\""
  }
  if (msg.includes("超时")) {
    return "该文件可能是扫描版、图片型或版式复杂。当前仅支持快速文本预览，可尝试压缩、拆分或转换为可复制文本的 PDF。"
  }
  if (msg.includes("超过") && msg.includes("上限")) {
    return "文件过大，当前仅支持 50MB 以内的文档预览。"
  }
  if (msg.includes("无法启动")) {
    return "无法启动解析引擎。开发期需安装 Python；生产版将内置。"
  }

  return sanitizeErrorMessage(msg)
}

/**
 * 脱敏错误信息中的文件路径。
 *
 * 规则：
 * - Windows 盘符路径 D:\foo\bar.pdf → 文件名 bar.pdf
 * - Unix 绝对路径 /home/user/file.pdf → 文件名 file.pdf
 * - 相对路径 docs/file.pdf → 文件名 file.pdf
 * - 截断到 200 字符
 */
function sanitizeErrorMessage(msg: string): string {
  // Windows 盘符路径: D:\foo\bar.pdf 或 D:/foo/bar.pdf
  let sanitized = msg.replace(/[A-Za-z]:[\\\/][^\s"'<>|*?]+/g, (match) => {
    const parts = match.replace(/\\/g, "/").split("/")
    return parts[parts.length - 1] || "文件路径已隐藏"
  })

  // Unix 绝对路径: /home/user/file.pdf
  sanitized = sanitized.replace(/\/[^\s"'<>|*?]+\.(pdf|docx|xlsx)/gi, (match) => {
    const parts = match.split("/")
    return parts[parts.length - 1] || "文件路径已隐藏"
  })

  return sanitized.length > 200 ? sanitized.slice(0, 200) + "…" : sanitized
}
