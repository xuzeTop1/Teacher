"""Document Worker — 稳定 JSON 输出 schema 定义。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PageOrSheet:
    """单页/单工作表内容。"""
    name: str
    text: str


@dataclass
class ParseResult:
    """文档解析结果。"""
    ok: bool
    file_type: str = ""
    title: str = ""
    pages_or_sheets: list[PageOrSheet] = field(default_factory=list)
    plain_text: str = ""
    warnings: list[str] = field(default_factory=list)
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        if not self.ok:
            return {"ok": False, "error": self.error}
        return {
            "ok": True,
            "fileType": self.file_type,
            "title": self.title,
            "pagesOrSheets": [
                {"name": p.name, "text": p.text} for p in self.pages_or_sheets
            ],
            "plainText": self.plain_text,
            "warnings": self.warnings,
        }


@dataclass
class MathResult:
    """数学计算结果。"""
    ok: bool
    input: str = ""
    result: str = ""
    latex: str = ""
    steps: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        if not self.ok:
            return {"ok": False, "error": self.error}
        return {
            "ok": True,
            "input": self.input,
            "result": self.result,
            "latex": self.latex,
            "steps": self.steps,
            "warnings": self.warnings,
        }
