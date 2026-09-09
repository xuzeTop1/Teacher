"""DOCX 文档解析器（基于 zipfile + XML 快速提取）。

不使用 python-docx 的 DOM 解析，直接从 docx zip 中提取 word/document.xml，
用 iterparse 流式读取 w:t 文本节点。速度远快于 python-docx，且有硬上限保护。
"""

from __future__ import annotations

import io
import os
import re
import zipfile
from xml.etree import ElementTree as ET

from ..schema import PageOrSheet, ParseResult

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB（预览解析上限）
MAX_PARAGRAPHS = 300
MAX_TABLES = 30
MAX_TABLE_ROWS = 80
MAX_CELL_CHARS = 1000
MAX_PLAINTEXT_CHARS = 30000

# OOXML 命名空间
_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_T = f"{{{_W}}}t"
_P = f"{{{_W}}}p"
_TR = f"{{{_W}}}tr"
_TBL = f"{{{_W}}}tbl"


def _extract_text_from_xml(xml_bytes: bytes) -> tuple[str, list[str], list[str], list[str]]:
    """从 document.xml 提取文本，返回 (title, paragraphs, table_texts, warnings)。

    使用 iterparse 流式解析，遇到限制立即停止。
    """
    paragraphs: list[str] = []
    table_texts: list[str] = []
    warnings: list[str] = []
    truncated = False

    in_table = False
    current_row_cells: list[str] = []
    current_table_rows: list[str] = []
    current_para_texts: list[str] = []
    total_chars = 0

    def flush_para():
        nonlocal total_chars
        text = "".join(current_para_texts).strip()
        current_para_texts.clear()
        if not text:
            return
        if len(paragraphs) >= MAX_PARAGRAPHS:
            return
        if total_chars + len(text) > MAX_PLAINTEXT_CHARS:
            text = text[: max(0, MAX_PLAINTEXT_CHARS - total_chars)]
            if text:
                paragraphs.append(text)
            return
        paragraphs.append(text)
        total_chars += len(text)

    def flush_row():
        nonlocal total_chars
        if not current_row_cells:
            return
        if len(current_table_rows) >= MAX_TABLE_ROWS:
            return
        row_text = "\t".join(current_row_cells)
        current_table_rows.append(row_text)
        total_chars += len(row_text)
        current_row_cells.clear()

    def flush_table():
        if not current_table_rows:
            return
        if len(table_texts) >= MAX_TABLES:
            return
        table_text = "\n".join(current_table_rows)
        table_texts.append(table_text)
        current_table_rows.clear()

    try:
        # 流式解析 XML：同时监听 start 和 end 事件
        for event, elem in ET.iterparse(io.BytesIO(xml_bytes), events=("start", "end")):
            tag = elem.tag

            if event == "start":
                # 表格开始
                if tag == _TBL:
                    in_table = True

            elif event == "end":
                # 文本节点
                if tag == _T:
                    if elem.text:
                        current_para_texts.append(elem.text)

                # 段落结束
                elif tag == _P:
                    if in_table:
                        cell_text = "".join(current_para_texts).strip()
                        current_para_texts.clear()
                        if cell_text:
                            cell_text = cell_text[:MAX_CELL_CHARS]
                            current_row_cells.append(cell_text)
                    else:
                        flush_para()
                        if len(paragraphs) >= MAX_PARAGRAPHS or total_chars >= MAX_PLAINTEXT_CHARS:
                            truncated = True
                    elem.clear()

                # 表格行结束
                elif tag == _TR:
                    if in_table:
                        flush_row()
                    elem.clear()

                # 表格结束
                elif tag == _TBL:
                    flush_table()
                    in_table = False
                    if len(table_texts) >= MAX_TABLES:
                        truncated = True
                    elem.clear()

    except Exception:
        warnings.append("文档 XML 解析异常，仅返回部分内容")

    # 收尾
    if current_para_texts and not in_table:
        flush_para()

    if truncated:
        warnings.append(
            f"文档内容较多，已截取前 {MAX_PLAINTEXT_CHARS} 字符用于预览"
        )

    # 提取标题（从首段推断）
    title = ""
    if paragraphs:
        first = paragraphs[0]
        if len(first) < 80 and not first.endswith("。"):
            title = first

    return title, paragraphs, table_texts, warnings


def _read_docx_xml(file_path: str) -> bytes | None:
    """从 docx zip 中读取 word/document.xml 的原始字节。"""
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            if "word/document.xml" in zf.namelist():
                return zf.read("word/document.xml")
    except Exception:
        pass
    return None


def _read_core_properties(file_path: str) -> str:
    """从 docx zip 中读取 core.xml 的标题。"""
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            if "docProps/core.xml" in zf.namelist():
                raw = zf.read("docProps/core.xml")
                match = re.search(
                    r"<dc:title[^>]*>([^<]*)</dc:title>",
                    raw.decode("utf-8", errors="ignore"),
                )
                if match:
                    return match.group(1).strip()
    except Exception:
        pass
    return ""


def parse_docx(file_path: str) -> ParseResult:
    """解析 DOCX 文件，提取段落和表格文本（快速 zipfile 方式）。"""
    if not os.path.exists(file_path):
        return ParseResult(ok=False, error=f"文件不存在: {os.path.basename(file_path)}")

    file_size = os.path.getsize(file_path)
    if file_size > MAX_FILE_SIZE:
        return ParseResult(
            ok=False,
            error=f"文件大小超过当前上限 50MB（{file_size // (1024 * 1024)}MB）。建议压缩或拆分后重试。"
        )

    # 读取 document.xml
    xml_bytes = _read_docx_xml(file_path)
    if xml_bytes is None:
        return ParseResult(
            ok=False,
            error="DOCX 解析失败: 无法读取 word/document.xml，文件可能损坏"
        )

    # 提取标题
    title = _read_core_properties(file_path)

    # 流式提取文本
    xml_title, paragraphs, table_texts, warnings = _extract_text_from_xml(xml_bytes)

    if not title:
        title = xml_title

    # 合并段落和表格
    all_parts: list[str] = []
    if paragraphs:
        all_parts.append("\n".join(paragraphs))
    if table_texts:
        all_parts.append("\n\n".join(table_texts))

    plain_text = "\n\n".join(all_parts)

    # 构建 pages
    pages: list[PageOrSheet] = []
    if paragraphs:
        pages.append(PageOrSheet(name="段落", text="\n".join(paragraphs)))
    for i, t in enumerate(table_texts):
        pages.append(PageOrSheet(name=f"表格 {i + 1}", text=t))

    if not plain_text.strip():
        warnings.append("文档未提取到文本内容")
    elif len(paragraphs) < 3 and not table_texts:
        warnings.append(
            "提取到的文本较少，可能包含文本框/图片/复杂版式，当前仅提取段落和表格文本"
        )

    return ParseResult(
        ok=True,
        file_type="docx",
        title=title,
        pages_or_sheets=pages,
        plain_text=plain_text,
        warnings=warnings,
    )
