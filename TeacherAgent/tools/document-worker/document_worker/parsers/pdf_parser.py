"""PDF 文档解析器——预览模式，支持 fallback。"""

from __future__ import annotations

import re
from ..schema import PageOrSheet, ParseResult

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB（预览解析上限）

# ── 预览模式限制 ────────────────────────────────────────────────────────────
MAX_PREVIEW_PAGES = 20       # 最多解析页数
MAX_PLAIN_TEXT_CHARS = 30000  # 全文最大字符数
MAX_PAGE_TEXT_CHARS = 3000    # 单页最大字符数

# ── Unicode 清理 ────────────────────────────────────────────────────────────
# 匹配 U+100000 以上的 private-use 字符（SMP 区域），以及 U+E000-U+FFFF 的 BMP PUA
_PRIVATE_USE_RE = re.compile(
    r'[\U00100000-\U0010FFFF]'  # SMP private-use
    r'|[-]'         # BMP PUA
    r'|�'                   # replacement character
)
# 匹配连续的控制字符（保留换行和 tab）
_CONTROL_RE = re.compile(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')
# 多个连续空白归一化
_MULTI_SPACE_RE = re.compile(r'[ \t]{3,}')


def _clean_text(text: str) -> str:
    """清理文本中的 private-use 字符和控制字符，空白归一化。"""
    text = _PRIVATE_USE_RE.sub('', text)
    text = _CONTROL_RE.sub('', text)
    text = _MULTI_SPACE_RE.sub('  ', text)
    return text.strip()


def _check_encrypted(file_path: str, warnings: list[str]) -> None:
    """检查 PDF 是否带加密标记。"""
    try:
        from pypdf import PdfReader
        reader = PdfReader(file_path)
        if reader.is_encrypted:
            warnings.append("PDF 带加密标记，已尝试文本预览解析。")
    except Exception:
        pass


def parse_pdf(file_path: str) -> ParseResult:
    """解析 PDF 文件，提取文本内容（预览模式，带 fallback）。"""
    import os

    if not os.path.exists(file_path):
        return ParseResult(ok=False, error=f"文件不存在: {file_path}")

    file_size = os.path.getsize(file_path)
    if file_size > MAX_FILE_SIZE:
        return ParseResult(
            ok=False,
            error=f"文件大小超过当前上限 50MB（{file_size // (1024 * 1024)}MB）。扫描版 PDF 或含大量图片的文档建议压缩或拆分。"
        )

    # 检查加密状态（轻量操作）
    warnings: list[str] = []
    _check_encrypted(file_path, warnings)

    # ── 尝试 1: PyMuPDF ─────────────────────────────────────────────────────
    result = _try_pymupdf(file_path, warnings)
    if result is not None:
        return result

    # ── 尝试 2: pdfplumber ───────────────────────────────────────────────────
    warnings.append("已使用兼容解析模式提取文本。")
    result = _try_pdfplumber(file_path, warnings)
    if result is not None:
        return result

    # ── 尝试 3: pypdf ───────────────────────────────────────────────────────
    result = _try_pypdf(file_path, warnings)
    if result is not None:
        return result

    return ParseResult(ok=False, error="PDF 解析失败：所有解析引擎均无法提取文本。")


def _try_pymupdf(file_path: str, warnings: list[str]) -> ParseResult | None:
    """尝试 PyMuPDF 解析。"""
    try:
        import fitz
    except ImportError:
        return None

    try:
        doc = fitz.open(file_path)
    except Exception:
        return None

    total_pages = len(doc)
    pages: list[PageOrSheet] = []
    all_text_parts: list[str] = []
    total_chars = 0
    empty_pages = 0
    pages_to_parse = min(total_pages, MAX_PREVIEW_PAGES)

    if total_pages > MAX_PREVIEW_PAGES:
        warnings.append(f"文档共 {total_pages} 页，已仅解析前 {MAX_PREVIEW_PAGES} 页用于预览。")

    for i in range(pages_to_parse):
        if total_chars >= MAX_PLAIN_TEXT_CHARS:
            warnings.append(f"内容较长，已截取前 {MAX_PLAIN_TEXT_CHARS} 字符用于预览。")
            break

        try:
            text = doc[i].get_text()
        except Exception:
            warnings.append(f"第 {i + 1} 页解析异常，已跳过。")
            continue

        text = _clean_text(text)

        if not text:
            empty_pages += 1
            continue

        if len(text) > MAX_PAGE_TEXT_CHARS:
            text = text[:MAX_PAGE_TEXT_CHARS]

        page_name = f"Page {i + 1}"
        pages.append(PageOrSheet(name=page_name, text=text))
        all_text_parts.append(text)
        total_chars += len(text)

    title = ""
    try:
        meta = doc.metadata
        if meta:
            title = meta.get("title", "") or ""
    except Exception:
        pass
    doc.close()

    plain_text = "\n\n".join(all_text_parts)

    if empty_pages > 0:
        warnings.append(f"部分页面未提取到文本（{empty_pages} 页），可能是图片页或封面页。")

    # 检测提取文本过少（少于 100 字符但页数 > 5）
    if len(plain_text.strip()) < 100 and total_pages > 5:
        # PyMuPDF 提取失败，返回 None 让 fallback 尝试
        return None

    if not plain_text.strip() and total_pages > 2:
        warnings.append("可能是扫描版或图片型 PDF，当前未启用 OCR。")

    return ParseResult(
        ok=True,
        file_type="pdf",
        title=title,
        pages_or_sheets=pages,
        plain_text=plain_text,
        warnings=warnings,
    )


def _try_pdfplumber(file_path: str, warnings: list[str]) -> ParseResult | None:
    """尝试 pdfplumber 解析。"""
    try:
        import pdfplumber
    except ImportError:
        return None

    try:
        with pdfplumber.open(file_path) as pdf:
            total_pages = len(pdf.pages)
            pages: list[PageOrSheet] = []
            all_text_parts: list[str] = []
            total_chars = 0
            empty_pages = 0
            pages_to_parse = min(total_pages, MAX_PREVIEW_PAGES)

            if total_pages > MAX_PREVIEW_PAGES:
                # 如果已有页数警告则不重复
                if not any("已仅解析前" in w for w in warnings):
                    warnings.append(f"文档共 {total_pages} 页，已仅解析前 {MAX_PREVIEW_PAGES} 页用于预览。")

            for i in range(pages_to_parse):
                if total_chars >= MAX_PLAIN_TEXT_CHARS:
                    if not any("截取" in w for w in warnings):
                        warnings.append(f"内容较长，已截取前 {MAX_PLAIN_TEXT_CHARS} 字符用于预览。")
                    break

                try:
                    text = pdf.pages[i].extract_text() or ""
                except Exception:
                    warnings.append(f"第 {i + 1} 页解析异常，已跳过。")
                    continue

                text = _clean_text(text)

                if not text:
                    empty_pages += 1
                    continue

                if len(text) > MAX_PAGE_TEXT_CHARS:
                    text = text[:MAX_PAGE_TEXT_CHARS]

                page_name = f"Page {i + 1}"
                pages.append(PageOrSheet(name=page_name, text=text))
                all_text_parts.append(text)
                total_chars += len(text)

            plain_text = "\n\n".join(all_text_parts)

            if empty_pages > 0:
                if not any("未提取到文本" in w for w in warnings):
                    warnings.append(f"部分页面未提取到文本（{empty_pages} 页），可能是图片页或封面页。")

            if not plain_text.strip():
                return None

            # 获取 metadata
            title = ""
            try:
                meta = pdf.metadata or {}
                title = meta.get("Title", "") or ""
            except Exception:
                pass

            return ParseResult(
                ok=True,
                file_type="pdf",
                title=title,
                pages_or_sheets=pages,
                plain_text=plain_text,
                warnings=warnings,
            )
    except Exception:
        return None


def _try_pypdf(file_path: str, warnings: list[str]) -> ParseResult | None:
    """尝试 pypdf 解析。"""
    try:
        from pypdf import PdfReader
    except ImportError:
        return None

    try:
        reader = PdfReader(file_path)
        # 如果加密且需要密码，跳过
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                return None

        total_pages = len(reader.pages)
        pages: list[PageOrSheet] = []
        all_text_parts: list[str] = []
        total_chars = 0
        empty_pages = 0
        pages_to_parse = min(total_pages, MAX_PREVIEW_PAGES)

        if total_pages > MAX_PREVIEW_PAGES:
            if not any("已仅解析前" in w for w in warnings):
                warnings.append(f"文档共 {total_pages} 页，已仅解析前 {MAX_PREVIEW_PAGES} 页用于预览。")

        for i in range(pages_to_parse):
            if total_chars >= MAX_PLAIN_TEXT_CHARS:
                if not any("截取" in w for w in warnings):
                    warnings.append(f"内容较长，已截取前 {MAX_PLAIN_TEXT_CHARS} 字符用于预览。")
                break

            try:
                text = reader.pages[i].extract_text() or ""
            except Exception:
                warnings.append(f"第 {i + 1} 页解析异常，已跳过。")
                continue

            text = _clean_text(text)

            if not text:
                empty_pages += 1
                continue

            if len(text) > MAX_PAGE_TEXT_CHARS:
                text = text[:MAX_PAGE_TEXT_CHARS]

            page_name = f"Page {i + 1}"
            pages.append(PageOrSheet(name=page_name, text=text))
            all_text_parts.append(text)
            total_chars += len(text)

        plain_text = "\n\n".join(all_text_parts)

        if empty_pages > 0:
            if not any("未提取到文本" in w for w in warnings):
                warnings.append(f"部分页面未提取到文本（{empty_pages} 页），可能是图片页或封面页。")

        if not plain_text.strip():
            return None

        # 获取 metadata
        title = ""
        try:
            meta = reader.metadata or {}
            title = meta.get("/Title", "") or meta.get("title", "") or ""
        except Exception:
            pass

        return ParseResult(
            ok=True,
            file_type="pdf",
            title=title,
            pages_or_sheets=pages,
            plain_text=plain_text,
            warnings=warnings,
        )
    except Exception:
        return None
