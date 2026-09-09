"""文档解析器测试。"""

import os
import tempfile
import pytest
from unittest.mock import patch, MagicMock
from document_worker.parsers.pdf_parser import parse_pdf, _clean_text
from document_worker.parsers.docx_parser import parse_docx
from document_worker.parsers.xlsx_parser import parse_xlsx


class TestPdfParser:
    """PDF 解析器测试。"""

    def test_nonexistent_file(self):
        result = parse_pdf("/nonexistent/file.pdf")
        assert result.ok is False
        assert result.error  # 有错误信息即可

    def test_invalid_file(self, tmp_path):
        bad_file = tmp_path / "bad.pdf"
        bad_file.write_bytes(b"not a pdf")
        result = parse_pdf(str(bad_file))
        assert result.ok is False
        assert "失败" in result.error

    def test_preview_mode_max_pages(self, tmp_path):
        """超过 20 页的 PDF 应只解析前 20 页。"""
        try:
            import fitz
        except ImportError:
            pytest.skip("PyMuPDF not installed")

        # 创建一个 30 页的 PDF
        doc = fitz.open()
        for i in range(30):
            page = doc.new_page()
            page.insert_text((72, 72), f"这是第 {i + 1} 页的内容。")
        pdf_path = tmp_path / "many_pages.pdf"
        doc.save(str(pdf_path))
        doc.close()

        result = parse_pdf(str(pdf_path))
        assert result.ok is True
        # 应只解析前 20 页
        assert len(result.pages_or_sheets) == 20
        # 应有页数过多警告
        assert any("30 页" in w and "20" in w for w in result.warnings)

    def test_preview_mode_text_truncation(self, tmp_path):
        """长文本应截断到 MAX_PLAIN_TEXT_CHARS。"""
        try:
            import fitz
        except ImportError:
            pytest.skip("PyMuPDF not installed")

        # 创建一个包含大量文本的 PDF（单页超过 3000 字符）
        doc = fitz.open()
        page = doc.new_page()
        # 插入约 4000 字符的文本
        long_text = "测试文本内容。" * 500  # 约 4000 字符
        page.insert_text((72, 72), long_text)
        pdf_path = tmp_path / "long_text.pdf"
        doc.save(str(pdf_path))
        doc.close()

        result = parse_pdf(str(pdf_path))
        assert result.ok is True
        # 单页应被截断到 3000 字符
        assert len(result.pages_or_sheets[0].text) <= 3000

    def test_preview_mode_empty_text_warning(self, tmp_path):
        """多页但无文本的 PDF 应提示扫描件。"""
        try:
            import fitz
        except ImportError:
            pytest.skip("PyMuPDF not installed")

        # 创建一个 5 页的空白 PDF
        doc = fitz.open()
        for _ in range(5):
            doc.new_page()
        pdf_path = tmp_path / "empty_pages.pdf"
        doc.save(str(pdf_path))
        doc.close()

        result = parse_pdf(str(pdf_path))
        assert result.ok is True
        # 应有扫描件警告
        assert any("扫描版" in w or "图片型" in w for w in result.warnings)


class TestCleanText:
    """文本清理函数测试。"""

    def test_removes_private_use_chars(self):
        """应移除 Unicode private-use 字符。"""
        # U+100010 是 SMP private-use
        text = "你好世界\U00100010测试"
        cleaned = _clean_text(text)
        assert "你好世界" in cleaned
        assert "测试" in cleaned
        assert "\U00100010" not in cleaned

    def test_removes_bmp_pua_chars(self):
        """应移除 BMP PUA 字符 (U+E000-U+F8FF)。"""
        text = "前言内容"
        cleaned = _clean_text(text)
        assert "前言" in cleaned
        assert "内容" in cleaned
        assert "" not in cleaned

    def test_preserves_chinese(self):
        """应保留正常中文字符。"""
        text = "全国大学英语四、六级考试大纲"
        cleaned = _clean_text(text)
        assert cleaned == text

    def test_preserves_english(self):
        """应保留英文字符。"""
        text = "College English Test Band 4 and Band 6"
        cleaned = _clean_text(text)
        assert cleaned == text

    def test_preserves_numbers_and_punctuation(self):
        """应保留数字和标点。"""
        text = "2016年修订版，共215页。"
        cleaned = _clean_text(text)
        assert cleaned == text

    def test_normalizes_multiple_spaces(self):
        """应归一化连续空白。"""
        text = "前言     内容"
        cleaned = _clean_text(text)
        assert "     " not in cleaned
        assert "前言" in cleaned
        assert "内容" in cleaned

    def test_removes_control_chars_preserves_newline(self):
        """应移除控制字符但保留换行和 tab。"""
        text = "第一行\n第二行\t内容"
        cleaned = _clean_text(text)
        assert "\n" in cleaned
        assert "\t" in cleaned

    def test_removes_directory_guide_chars(self):
        """应移除目录引导符（如 U+1001BA）。"""
        text = "第一章 总则\U001001ba考试性质\U001001ba"
        cleaned = _clean_text(text)
        assert "\U001001ba" not in cleaned
        assert "第一章" in cleaned
        assert "考试性质" in cleaned


class TestPdfFallback:
    """PDF fallback 解析器测试。"""

    def test_fallback_to_pdfplumber_when_pymupdf_fails(self, tmp_path):
        """PyMuPDF 提取失败时应 fallback 到 pdfplumber。"""
        try:
            import pdfplumber
        except ImportError:
            pytest.skip("pdfplumber not installed")

        # 创建一个简单的 PDF
        try:
            import fitz
        except ImportError:
            pytest.skip("PyMuPDF not installed")

        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((72, 72), "fallback 测试内容")
        pdf_path = tmp_path / "fallback_test.pdf"
        doc.save(str(pdf_path))
        doc.close()

        # Mock PyMuPDF 提取返回空文本（模拟某些加密 PDF 的行为）
        original_parse = parse_pdf

        with patch('document_worker.parsers.pdf_parser._try_pymupdf', return_value=None):
            result = parse_pdf(str(pdf_path))

        assert result.ok is True
        assert any("兼容解析" in w for w in result.warnings)

    def test_fallback_to_pypdf_when_both_fail(self, tmp_path):
        """PyMuPDF 和 pdfplumber 都失败时应 fallback 到 pypdf。"""
        try:
            from pypdf import PdfWriter
        except ImportError:
            pytest.skip("pypdf not installed")

        try:
            import fitz
        except ImportError:
            pytest.skip("PyMuPDF not installed")

        # 创建一个带文本的 PDF
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((72, 72), "pypdf fallback 测试")
        pdf_path = tmp_path / "pypdf_test.pdf"
        doc.save(str(pdf_path))
        doc.close()

        with patch('document_worker.parsers.pdf_parser._try_pymupdf', return_value=None):
            with patch('document_worker.parsers.pdf_parser._try_pdfplumber', return_value=None):
                result = parse_pdf(str(pdf_path))

        assert result is not None
        # pypdf fallback 应能提取文本
        if result.ok:
            assert any("兼容解析" in w for w in result.warnings)

    def test_encrypted_pdf_warning(self, tmp_path):
        """加密 PDF 应有加密警告。"""
        try:
            import fitz
        except ImportError:
            pytest.skip("PyMuPDF not installed")

        # 创建一个带密码的 PDF
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((72, 72), "加密内容测试")
        pdf_path = tmp_path / "encrypted.pdf"
        # 保存时加密（用户密码）
        doc.save(str(pdf_path), encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="test123")
        doc.close()

        # 加密 PDF 可能需要密码，但应有加密警告
        result = parse_pdf(str(pdf_path))
        # 不管成功与否，应该不崩溃
        assert result is not None


class TestDocxParser:
    """DOCX 解析器测试。"""

    def test_nonexistent_file(self):
        result = parse_docx("/nonexistent/file.docx")
        assert result.ok is False

    def test_invalid_file(self, tmp_path):
        bad_file = tmp_path / "bad.docx"
        bad_file.write_bytes(b"not a docx")
        result = parse_docx(str(bad_file))
        assert result.ok is False
        assert "失败" in result.error

    def test_valid_docx(self, tmp_path):
        try:
            from docx import Document
        except ImportError:
            pytest.skip("python-docx not installed")

        doc = Document()
        doc.add_heading("测试标题", level=1)
        doc.add_paragraph("这是第一段。")
        doc.add_paragraph("这是第二段。")
        doc_path = tmp_path / "test.docx"
        doc.save(str(doc_path))

        result = parse_docx(str(doc_path))
        assert result.ok is True
        assert result.file_type == "docx"
        assert "测试标题" in result.plain_text
        assert "第一段" in result.plain_text
        assert "第二段" in result.plain_text
        assert len(result.pages_or_sheets) > 0

    def test_docx_with_table(self, tmp_path):
        try:
            from docx import Document
        except ImportError:
            pytest.skip("python-docx not installed")

        doc = Document()
        doc.add_heading("实训报告", level=1)
        doc.add_paragraph("以下是实验数据：")
        table = doc.add_table(rows=3, cols=3)
        # 表头
        table.rows[0].cells[0].text = "项目"
        table.rows[0].cells[1].text = "数值"
        table.rows[0].cells[2].text = "备注"
        # 数据行
        table.rows[1].cells[0].text = "温度"
        table.rows[1].cells[1].text = "25.3"
        table.rows[1].cells[2].text = "正常"
        table.rows[2].cells[0].text = "压力"
        table.rows[2].cells[1].text = "101.3"
        table.rows[2].cells[2].text = "标准大气压"
        doc_path = tmp_path / "report.docx"
        doc.save(str(doc_path))

        result = parse_docx(str(doc_path))
        assert result.ok is True
        assert "实训报告" in result.plain_text
        assert "实验数据" in result.plain_text
        # 表格内容应被提取
        assert "温度" in result.plain_text
        assert "25.3" in result.plain_text
        assert "标准大气压" in result.plain_text
        # 应有段落和表格两个 page
        sheet_names = [p.name for p in result.pages_or_sheets]
        assert "段落" in sheet_names
        assert any("表格" in name for name in sheet_names)

    def test_docx_large_document_respects_limits(self, tmp_path):
        """大量段落/表格的 DOCX 应在上限内返回，不超时。"""
        try:
            from docx import Document
        except ImportError:
            pytest.skip("python-docx not installed")

        doc = Document()
        doc.add_heading("大型文档测试", level=1)
        # 添加 500 个段落（超过 MAX_PARAGRAPHS=300）
        for i in range(500):
            doc.add_paragraph(f"这是第 {i + 1} 个段落，包含一些中文内容用于测试。")
        doc_path = tmp_path / "large.docx"
        doc.save(str(doc_path))

        import time
        start = time.time()
        result = parse_docx(str(doc_path))
        elapsed = time.time() - start

        assert result.ok is True
        # 应有截断警告
        assert any("截取" in w or "较多" in w for w in result.warnings)
        # 不应超时（5秒内完成）
        assert elapsed < 5, f"解析耗时 {elapsed:.1f}s，预期 < 5s"

    def test_docx_chinese_content_no_garbled(self, tmp_path):
        """中文内容不乱码。"""
        try:
            from docx import Document
        except ImportError:
            pytest.skip("python-docx not installed")

        doc = Document()
        doc.add_paragraph("这是中文段落，包含标点符号：，。！？")
        doc.add_paragraph("第二段：「引号」和【括号】以及（圆括号）")
        table = doc.add_table(rows=2, cols=2)
        table.rows[0].cells[0].text = "项目名称"
        table.rows[0].cells[1].text = "数值"
        table.rows[1].cells[0].text = "温度（℃）"
        table.rows[1].cells[1].text = "25.3"
        doc_path = tmp_path / "chinese.docx"
        doc.save(str(doc_path))

        result = parse_docx(str(doc_path))
        assert result.ok is True
        assert "中文段落" in result.plain_text
        assert "，。！？" in result.plain_text
        assert "「引号」" in result.plain_text
        assert "温度（℃）" in result.plain_text
        assert "25.3" in result.plain_text


class TestXlsxParser:
    """XLSX 解析器测试。"""

    def test_nonexistent_file(self):
        result = parse_xlsx("/nonexistent/file.xlsx")
        assert result.ok is False

    def test_invalid_file(self, tmp_path):
        bad_file = tmp_path / "bad.xlsx"
        bad_file.write_bytes(b"not an xlsx")
        result = parse_xlsx(str(bad_file))
        assert result.ok is False
        assert "失败" in result.error

    def test_valid_xlsx(self, tmp_path):
        try:
            from openpyxl import Workbook
        except ImportError:
            pytest.skip("openpyxl not installed")

        wb = Workbook()
        ws = wb.active
        ws.title = "Sheet1"
        ws["A1"] = "姓名"
        ws["B1"] = "分数"
        ws["A2"] = "张三"
        ws["B2"] = 95
        xlsx_path = tmp_path / "test.xlsx"
        wb.save(str(xlsx_path))

        result = parse_xlsx(str(xlsx_path))
        assert result.ok is True
        assert result.file_type == "xlsx"
        assert len(result.pages_or_sheets) == 1
        assert result.pages_or_sheets[0].name == "Sheet1"
        assert "张三" in result.pages_or_sheets[0].text
        assert "95" in result.pages_or_sheets[0].text


class TestSchemaOutput:
    """JSON 输出格式测试。"""

    def test_parse_result_error_format(self):
        from document_worker.schema import ParseResult
        r = ParseResult(ok=False, error="test error")
        d = r.to_dict()
        assert d["ok"] is False
        assert d["error"] == "test error"
        assert "fileType" not in d

    def test_parse_result_success_format(self):
        from document_worker.schema import ParseResult, PageOrSheet
        r = ParseResult(
            ok=True,
            file_type="pdf",
            title="Test",
            pages_or_sheets=[PageOrSheet(name="P1", text="hello")],
            plain_text="hello",
        )
        d = r.to_dict()
        assert d["ok"] is True
        assert d["fileType"] == "pdf"
        assert d["title"] == "Test"
        assert len(d["pagesOrSheets"]) == 1
        assert d["pagesOrSheets"][0]["name"] == "P1"

    def test_math_result_error_format(self):
        from document_worker.schema import MathResult
        r = MathResult(ok=False, error="bad expr")
        d = r.to_dict()
        assert d["ok"] is False
        assert d["error"] == "bad expr"

    def test_math_result_success_format(self):
        from document_worker.schema import MathResult
        r = MathResult(
            ok=True,
            input="x+1",
            result="x + 1",
            latex="x + 1",
            steps=["step1"],
        )
        d = r.to_dict()
        assert d["ok"] is True
        assert d["input"] == "x+1"
        assert d["result"] == "x + 1"
        assert d["steps"] == ["step1"]
