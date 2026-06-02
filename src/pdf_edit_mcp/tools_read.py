"""Read / analysis tools. None of these modify a file.

Ported from the v0.1.x ``bridge.py`` handlers; return shapes are preserved
verbatim (the integration suite pins them). The ``password`` kwarg (engine A2.3)
is exposed only on direct-verb reads whose engine call accepts it — not on the
composite ``pdf_inspect`` (its sub-calls ``detect_paragraphs`` / ``get_annotations``
do not take a password).
"""

from __future__ import annotations

from typing import Annotated

import pdf_edit_engine as engine
from pdf_edit_engine import FontInfo, Paragraph
from pdf_edit_engine.errors import PDFEditError
from pydantic import Field

from pdf_edit_mcp._runtime import READ_ONLY, engine_guard, page_count
from pdf_edit_mcp.app import mcp
from pdf_edit_mcp.constants import MAX_SEARCH_TEXT
from pdf_edit_mcp.validation import BBox, PdfPath


@mcp.tool(annotations=READ_ONLY)
def pdf_get_text(
    pdf_path: PdfPath,
    page: int | None = None,
    password: str | None = None,
) -> dict[str, object]:
    """Extract all text from a PDF (or a single 0-indexed page).

    Returns the text and the document page count. Pass ``password`` for an
    encrypted PDF.
    """
    with engine_guard():
        text = engine.get_text(pdf_path, page=page, password=password)
        count = page_count(pdf_path, password=password)
    return {"text": text, "page_count": count}


@mcp.tool(annotations=READ_ONLY)
def pdf_find_text(
    pdf_path: PdfPath,
    search: Annotated[
        str, Field(min_length=1, max_length=MAX_SEARCH_TEXT, description="Text to search for")
    ],
    case_sensitive: bool = True,
    page: int | None = None,
    password: str | None = None,
) -> dict[str, object]:
    """Find every occurrence of ``search`` and return each match's page + position."""
    with engine_guard():
        matches = engine.find(
            pdf_path, search, case_sensitive=case_sensitive, page=page, password=password
        )
    return {
        "matches": [
            {
                "text": m.matched_text,
                "page": m.page_number,
                "position": {
                    "x0": m.bounding_box[0],
                    "y0": m.bounding_box[1],
                    "x1": m.bounding_box[2],
                    "y1": m.bounding_box[3],
                },
            }
            for m in matches
        ]
    }


@mcp.tool(annotations=READ_ONLY)
def pdf_get_fonts(
    pdf_path: PdfPath,
    page: int | None = None,
    password: str | None = None,
) -> dict[str, object]:
    """List the fonts used in the PDF (name, encoding, subset/glyph info)."""
    with engine_guard():
        fonts = engine.get_fonts(pdf_path, page=page, password=password)
    return {
        "fonts": [
            {
                "name": f.name,
                "postscript_name": f.postscript_name,
                "encoding_type": f.encoding_type,
                "is_subset": f.is_subset,
                "glyph_count": f.glyph_count,
                "embedded_type": f.embedded_type,
            }
            for f in fonts
        ]
    }


@mcp.tool(annotations=READ_ONLY)
def pdf_detect_paragraphs(pdf_path: PdfPath, page: int = 0) -> dict[str, object]:
    """Detect paragraph blocks on a page (text, bbox, font, line count)."""
    with engine_guard():
        paras = engine.detect_paragraphs(pdf_path, page=page)
    return {
        "paragraphs": [
            {
                "text": p.full_text,
                "bbox": {
                    "x0": p.left_margin,
                    "y0": p.first_line_y - (p.line_count - 1) * p.line_height,
                    "x1": p.left_margin + p.paragraph_width,
                    "y1": p.first_line_y + p.line_height,
                },
                "font_name": p.font_name,
                "font_size": p.font_size,
                "line_count": p.line_count,
                "page": page,
            }
            for p in paras
        ]
    }


@mcp.tool(annotations=READ_ONLY)
def pdf_analyze_subset(
    pdf_path: PdfPath,
    text: Annotated[
        str,
        Field(min_length=1, max_length=MAX_SEARCH_TEXT, description="Text to check coverage for"),
    ],
    font_name: str | None = None,
) -> dict[str, object]:
    """Check whether a font's embedded subset can render every glyph in ``text``."""
    with engine_guard():
        if font_name is None:
            fonts = engine.get_fonts(pdf_path)
            if not fonts:
                raise PDFEditError("No fonts found in PDF")
            font_name = fonts[0].name
        info = engine.analyze_subset(pdf_path, font_name)
        missing: list[str] = []
        if info.font_cmap is not None:
            available = set(info.font_cmap.values())
            for ch in text:
                if not ch.isspace() and ch not in available and ch not in missing:
                    missing.append(ch)
    return {
        "available": len(missing) == 0,
        "missing_glyphs": missing,
        "font_name": info.name,
        "glyph_count": info.glyph_count,
    }


@mcp.tool(annotations=READ_ONLY)
def pdf_get_text_layout(
    pdf_path: PdfPath, page: int = 0, password: str | None = None
) -> dict[str, object]:
    """Return positioned text blocks on a page (x, y, width, height, font)."""
    with engine_guard():
        blocks = engine.get_text_layout(pdf_path, page=page, password=password)
    return {
        "blocks": [
            {
                "text": b.text,
                "x": b.x,
                "y": b.y,
                "width": b.width,
                "height": b.height,
                "font_name": b.font_name,
                "font_size": b.font_size,
                "page": page,
            }
            for b in blocks
        ]
    }


@mcp.tool(annotations=READ_ONLY)
def pdf_extract_bbox_text(
    pdf_path: PdfPath,
    bbox: BBox,
    page: int,
    tolerance: Annotated[float, Field(ge=0, le=500, description="Bbox overlap tolerance")] = 0.0,
    password: str | None = None,
) -> dict[str, object]:
    """Extract the text inside a bounding box on a page."""
    with engine_guard():
        text = engine.extract_bbox_text(
            pdf_path, bbox=bbox.as_tuple(), page=page, tolerance=tolerance, password=password
        )
    return {"text": text}


def _para_entry(p: Paragraph, page: int) -> dict[str, object]:
    return {
        "text": p.full_text,
        "bbox": {
            "x0": p.left_margin,
            "y0": p.first_line_y - (p.line_count - 1) * p.line_height,
            "x1": p.left_margin + p.paragraph_width,
            "y1": p.first_line_y + p.line_height,
        },
        "font_name": p.font_name,
        "font_size": p.font_size,
        "page": page,
    }


def _font_entry(f: FontInfo) -> dict[str, object]:
    return {
        "name": f.name,
        "postscript_name": f.postscript_name,
        "encoding_type": f.encoding_type,
        "is_subset": f.is_subset,
        "glyph_count": f.glyph_count,
        "embedded_type": f.embedded_type,
    }


@mcp.tool(annotations=READ_ONLY)
def pdf_inspect(pdf_path: PdfPath, include_layout: bool = False) -> dict[str, object]:
    """One-call overview: page count, text, fonts, paragraphs, annotations.

    Optionally include positioned text layout. Paragraph + layout detection is
    bounded to the first 20 pages and is resilient to per-page failures.
    """
    with engine_guard():
        text = engine.get_text(pdf_path)
        fonts = engine.get_fonts(pdf_path)
        count = page_count(pdf_path)
        max_pages = min(count, 20)

        paragraphs: list[dict[str, object]] = []
        for pidx in range(max_pages):
            try:
                paragraphs.extend(
                    _para_entry(p, pidx) for p in engine.detect_paragraphs(pdf_path, page=pidx)
                )
            except Exception:
                continue

        annotations: list[dict[str, object]] = []
        for a in engine.get_annotations(pdf_path):
            entry: dict[str, object] = {
                "index": a.index,
                "subtype": a.subtype,
                "rect": {"x0": a.rect[0], "y0": a.rect[1], "x1": a.rect[2], "y1": a.rect[3]},
                "page": a.page,
            }
            if a.uri:
                entry["url"] = a.uri
                entry["uri"] = a.uri
            if a.text:
                entry["text"] = a.text
            annotations.append(entry)

        layout: list[dict[str, object]] = []
        if include_layout:
            for pidx in range(max_pages):
                try:
                    layout.extend(
                        {
                            "text": b.text,
                            "x": b.x,
                            "y": b.y,
                            "width": b.width,
                            "height": b.height,
                            "font_name": b.font_name,
                            "font_size": b.font_size,
                            "page": pidx,
                        }
                        for b in engine.get_text_layout(pdf_path, page=pidx)
                    )
                except Exception:
                    continue

    result: dict[str, object] = {
        "page_count": count,
        "text": text,
        "fonts": [_font_entry(f) for f in fonts],
        "paragraphs": paragraphs,
        "annotations": annotations,
    }
    if include_layout:
        result["text_layout"] = layout
    return result
