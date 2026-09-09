"""Document Worker CLI 入口。

用法:
    python -m document_worker parse --file <path>
    python -m document_worker math --expr "<expression>" [--op <operation>] [--var <variable>]
"""

from __future__ import annotations

import argparse
import json
import os
import sys

# 强制 stdout/stderr 为 UTF-8，避免中文乱码
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    # Python < 3.7 或不支持 reconfigure 的环境
    pass


def cmd_parse(args: argparse.Namespace) -> None:
    """执行文档解析。"""
    file_path = args.file

    if not os.path.exists(file_path):
        print(json.dumps({"ok": False, "error": f"文件不存在: {file_path}"}))
        sys.exit(1)

    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".pdf":
        from .parsers.pdf_parser import parse_pdf
        result = parse_pdf(file_path)
    elif ext == ".docx":
        from .parsers.docx_parser import parse_docx
        result = parse_docx(file_path)
    elif ext == ".xlsx":
        from .parsers.xlsx_parser import parse_xlsx
        result = parse_xlsx(file_path)
    else:
        print(json.dumps({"ok": False, "error": f"不支持的文件类型: {ext}，支持 .pdf/.docx/.xlsx"}))
        sys.exit(1)

    print(json.dumps(result.to_dict(), ensure_ascii=False))
    sys.exit(0 if result.ok else 1)


def cmd_math(args: argparse.Namespace) -> None:
    """执行数学计算。"""
    from .math_engine import compute_math

    result = compute_math(
        expression=args.expr,
        operation=args.op,
        variable=args.var,
    )
    print(json.dumps(result.to_dict(), ensure_ascii=False))
    sys.exit(0 if result.ok else 1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="TeacherAgent Document Worker — 本地文档解析与数学计算"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # parse 子命令
    parse_parser = subparsers.add_parser("parse", help="解析文档")
    parse_parser.add_argument("--file", required=True, help="文件路径 (.pdf/.docx/.xlsx)")

    # math 子命令
    math_parser = subparsers.add_parser("math", help="数学计算")
    math_parser.add_argument("--expr", required=True, help="数学表达式")
    math_parser.add_argument("--op", default="eval", help="操作: simplify/expand/factor/diff/integrate/solve/eval")
    math_parser.add_argument("--var", default="x", help="变量名 (默认 x)")

    args = parser.parse_args()

    if args.command == "parse":
        cmd_parse(args)
    elif args.command == "math":
        cmd_math(args)


if __name__ == "__main__":
    main()
