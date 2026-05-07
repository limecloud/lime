#!/usr/bin/env python3
"""将 DOCX 的标题、正文、列表和表格转换为基础 Markdown。"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from docx import Document
from docx.document import Document as DocumentObject
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

SEPARATOR_RE = re.compile(r"^[─━—\-_=]{6,}$")


def iter_block_items(parent):
    if isinstance(parent, DocumentObject):
        parent_elm = parent.element.body
        parent_obj = parent
    else:
        parent_elm = parent._tc
        parent_obj = parent
    for child in parent_elm.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, parent_obj)
        elif isinstance(child, CT_Tbl):
            yield Table(child, parent_obj)


def clean_text(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text.replace("\u00a0", " ")).strip()


def paragraph_to_markdown(paragraph: Paragraph) -> list[str]:
    text = clean_text(paragraph.text)
    if not text:
        return []

    style = paragraph.style.name if paragraph.style else ""
    if style.startswith("Heading"):
        match = re.search(r"(\d+)", style)
        level = min(max(int(match.group(1)) if match else 1, 1), 6)
        return [f"{'#' * level} {text}"]

    if SEPARATOR_RE.match(text):
        return ["---"]

    if text.startswith(("• ", "· ", "● ", "○ ")):
        return [f"- {text[2:].strip()}"]

    return [text]


def table_to_markdown(table: Table) -> list[str]:
    rows: list[list[str]] = []
    for row in table.rows:
        cells: list[str] = []
        for cell in row.cells:
            parts: list[str] = []
            for block in iter_block_items(cell):
                if isinstance(block, Paragraph):
                    line = clean_text(block.text)
                    if line:
                        parts.append(line)
                elif isinstance(block, Table):
                    nested = table_to_markdown(block)
                    if nested:
                        parts.append("<br>".join(nested))
            cells.append("<br>".join(parts).replace("|", r"\|"))
        if rows and cells == rows[-1]:
            continue
        rows.append(cells)

    if not rows:
        return []

    col_count = max(len(row) for row in rows)
    rows = [row + [""] * (col_count - len(row)) for row in rows]
    markdown = [
        "| " + " | ".join(rows[0]) + " |",
        "| " + " | ".join(["---"] * col_count) + " |",
    ]
    for row in rows[1:]:
        markdown.append("| " + " | ".join(row) + " |")
    return markdown


def convert_docx(input_path: Path, output_path: Path) -> None:
    doc = Document(str(input_path))
    lines: list[str] = [
        "<!--",
        f"源文档：{input_path}",
        "转换说明：由 DOCX 正文段落、标题和表格转换为 Markdown。",
        "-->",
        "",
    ]

    for block in iter_block_items(doc):
        block_lines = (
            paragraph_to_markdown(block)
            if isinstance(block, Paragraph)
            else table_to_markdown(block)
        )
        if not block_lines:
            continue
        if lines and lines[-1] != "":
            lines.append("")
        lines.extend(block_lines)
        lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="将 DOCX 转换为基础 Markdown。")
    parser.add_argument("input", type=Path, help="输入 DOCX 文件路径")
    parser.add_argument("output", type=Path, help="输出 Markdown 文件路径")
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"输入文件不存在：{args.input}")
    if args.input.suffix.lower() != ".docx":
        raise SystemExit("输入文件必须是 .docx")

    convert_docx(args.input, args.output)


if __name__ == "__main__":
    main()
