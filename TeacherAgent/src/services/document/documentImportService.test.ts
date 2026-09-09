import { describe, expect, it, vi, beforeEach } from "vitest"
import { isAllowedFile, importAndPreview } from "./documentImportService"

// Mock Tauri commands
vi.mock("../tauri/commands", () => ({
  selectDocumentFile: vi.fn(),
  parseDocumentWithWorker: vi.fn()
}))

describe("isAllowedFile", () => {
  it("allows .pdf", () => {
    expect(isAllowedFile("document.pdf")).toBe(true)
  })

  it("allows .docx", () => {
    expect(isAllowedFile("report.docx")).toBe(true)
  })

  it("allows .xlsx", () => {
    expect(isAllowedFile("data.xlsx")).toBe(true)
  })

  it("allows uppercase extensions", () => {
    expect(isAllowedFile("FILE.PDF")).toBe(true)
    expect(isAllowedFile("FILE.DOCX")).toBe(true)
  })

  it("rejects .txt", () => {
    expect(isAllowedFile("notes.txt")).toBe(false)
  })

  it("rejects .exe", () => {
    expect(isAllowedFile("malware.exe")).toBe(false)
  })

  it("rejects .doc (old format)", () => {
    expect(isAllowedFile("old.doc")).toBe(false)
  })

  it("rejects .pptx", () => {
    expect(isAllowedFile("slides.pptx")).toBe(false)
  })

  it("rejects no extension", () => {
    expect(isAllowedFile("README")).toBe(false)
  })
})

describe("importAndPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns error for unsupported file type", async () => {
    const result = await importAndPreview("/path/file.txt", "file.txt")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("不支持")
  })

  it("returns preview on successful parse", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    vi.mocked(parseDocumentWithWorker).mockResolvedValue({
      ok: true,
      fileType: "pdf",
      title: "测试文档",
      pagesOrSheets: [{ name: "Page 1", text: "第一段内容" }],
      plainText: "第一段内容",
      warnings: []
    })

    const result = await importAndPreview("/path/doc.pdf", "doc.pdf")
    expect(result.ok).toBe(true)
    expect(result.preview?.fileName).toBe("doc.pdf")
    expect(result.preview?.fileType).toBe("pdf")
    expect(result.preview?.title).toBe("测试文档")
    expect(result.preview?.sheets).toHaveLength(1)
    expect(result.preview?.sheets[0].name).toBe("Page 1")
    // raw fields also populated
    expect(result.preview?.rawPlainText).toBe("第一段内容")
    expect(result.preview?.rawPagesOrSheets).toHaveLength(1)
    expect(result.preview?.rawPagesOrSheets[0].text).toBe("第一段内容")
  })

  it("truncates long plainText but preserves raw for import", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    const longText = "x".repeat(5000)
    vi.mocked(parseDocumentWithWorker).mockResolvedValue({
      ok: true,
      fileType: "docx",
      title: "Long Doc",
      pagesOrSheets: [],
      plainText: longText,
      warnings: []
    })

    const result = await importAndPreview("/path/long.docx", "long.docx")
    expect(result.ok).toBe(true)
    // UI preview is truncated
    expect(result.preview?.plainTextPreview.length).toBe(2000)
    expect(result.preview?.plainTextTruncated).toBe(true)
    // raw text is preserved for import
    expect(result.preview?.rawPlainText.length).toBe(5000)
    expect(result.preview?.rawPlainText).toBe(longText)
  })

  it("truncates long sheet text but preserves raw for import", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    const longSheetText = "y".repeat(1000)
    vi.mocked(parseDocumentWithWorker).mockResolvedValue({
      ok: true,
      fileType: "xlsx",
      title: "Sheet",
      pagesOrSheets: [{ name: "Sheet1", text: longSheetText }],
      plainText: "",
      warnings: []
    })

    const result = await importAndPreview("/path/sheet.xlsx", "sheet.xlsx")
    expect(result.ok).toBe(true)
    // UI preview is truncated
    expect(result.preview?.sheets[0].textPreview.length).toBe(800)
    expect(result.preview?.sheets[0].textTruncated).toBe(true)
    // raw page text is preserved for import
    expect(result.preview?.rawPagesOrSheets[0].text.length).toBe(1000)
    expect(result.preview?.rawPagesOrSheets[0].text).toBe(longSheetText)
  })

  it("returns error when worker returns ok=false", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    vi.mocked(parseDocumentWithWorker).mockResolvedValue({
      ok: false,
      pagesOrSheets: [],
      warnings: [],
      error: "文件损坏"
    })

    const result = await importAndPreview("/path/bad.pdf", "bad.pdf")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("文件损坏")
  })

  it("returns error when worker throws", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    vi.mocked(parseDocumentWithWorker).mockRejectedValue(
      new Error("无法启动 Python worker")
    )

    const result = await importAndPreview("/path/doc.pdf", "doc.pdf")
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it("includes warnings in preview", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    vi.mocked(parseDocumentWithWorker).mockResolvedValue({
      ok: true,
      fileType: "pdf",
      title: "Scan",
      pagesOrSheets: [{ name: "Page 1", text: "text" }],
      plainText: "text",
      warnings: ["文档未提取到文本内容，可能是扫描件"]
    })

    const result = await importAndPreview("/path/scan.pdf", "scan.pdf")
    expect(result.ok).toBe(true)
    expect(result.preview?.warnings).toHaveLength(1)
    expect(result.preview?.warnings[0]).toContain("扫描件")
  })

  it("sanitizes Windows path in raw.error", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    vi.mocked(parseDocumentWithWorker).mockResolvedValue({
      ok: false,
      pagesOrSheets: [],
      warnings: [],
      error: "PDF 解析失败: D:\\Users\\secret\\Documents\\report.pdf 无法读取"
    })

    const result = await importAndPreview("D:\\Users\\secret\\Documents\\report.pdf", "report.pdf")
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain("D:\\Users\\secret")
    expect(result.error).not.toContain("D:\\Users\\secret\\Documents")
    expect(result.error).toContain("report.pdf")
  })

  it("sanitizes Unix path in raw.error", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    vi.mocked(parseDocumentWithWorker).mockResolvedValue({
      ok: false,
      pagesOrSheets: [],
      warnings: [],
      error: "解析失败: /home/user/private/data.xlsx 格式异常"
    })

    const result = await importAndPreview("/home/user/private/data.xlsx", "data.xlsx")
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain("/home/user/private")
    expect(result.error).toContain("data.xlsx")
  })

  it("sanitizes path in worker throw error", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    vi.mocked(parseDocumentWithWorker).mockRejectedValue(
      new Error("无法启动 Python worker: D:/Python311/python.exe not found")
    )

    const result = await importAndPreview("D:/docs/file.pdf", "file.pdf")
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain("D:/Python311")
    expect(result.error).toContain("无法启动")
  })

  it("preserves readable error without path", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    vi.mocked(parseDocumentWithWorker).mockResolvedValue({
      ok: false,
      pagesOrSheets: [],
      warnings: [],
      error: "文件大小超过限制"
    })

    const result = await importAndPreview("/path/big.pdf", "big.pdf")
    expect(result.ok).toBe(false)
    expect(result.error).toBe("文件大小超过限制")
  })

  it("timeout error message is user-friendly", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    vi.mocked(parseDocumentWithWorker).mockRejectedValue(
      new Error("解析超时（30秒）。文件可能过大或包含大量图片/复杂表格，可尝试压缩或拆分后重试。")
    )

    const result = await importAndPreview("/path/huge.docx", "huge.docx")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("扫描版")
    expect(result.error).toContain("图片型")
    expect(result.error).not.toContain("D:")
  })

  it("timeout error suggests PDF conversion", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")
    vi.mocked(parseDocumentWithWorker).mockRejectedValue(
      new Error("解析超时（30秒）。")
    )

    const result = await importAndPreview("/path/complex.pdf", "complex.pdf")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("可复制文本")
  })

  it("second file failure does not affect first file result", async () => {
    const { parseDocumentWithWorker } = await import("../tauri/commands")

    // First file succeeds
    vi.mocked(parseDocumentWithWorker).mockResolvedValueOnce({
      ok: true,
      fileType: "pdf",
      title: "First Doc",
      pagesOrSheets: [{ name: "Page 1", text: "content" }],
      plainText: "content",
      warnings: []
    })
    const first = await importAndPreview("/path/first.pdf", "first.pdf")
    expect(first.ok).toBe(true)
    expect(first.preview?.title).toBe("First Doc")

    // Second file fails
    vi.mocked(parseDocumentWithWorker).mockResolvedValueOnce({
      ok: false,
      pagesOrSheets: [],
      warnings: [],
      error: "解析失败"
    })
    const second = await importAndPreview("/path/bad.docx", "bad.docx")
    expect(second.ok).toBe(false)

    // First result is independent - this is a service-level test
    // The component's previews list handles this at UI level
    expect(first.ok).toBe(true)
    expect(first.preview?.title).toBe("First Doc")
  })
})
