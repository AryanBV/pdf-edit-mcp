"""Annotation tools (5): read + create / update / delete / move via the engine API.

Ported verbatim from ``bridge.py``. Index-based verbs re-read the page's annotations
and range-check the index (the engine annotations are addressed positionally).
"""

from __future__ import annotations

from typing import Annotated

import pdf_edit_engine as engine
from pdf_edit_engine import delete_annotation as engine_delete_annotation
from pdf_edit_engine.errors import PDFEditError
from pydantic import Field

from pdf_edit_mcp._runtime import READ_ONLY, WRITE, engine_guard
from pdf_edit_mcp.app import mcp
from pdf_edit_mcp.constants import MAX_URI
from pdf_edit_mcp.validation import BBox, OutputPath, PdfPath

_Page = Annotated[int, Field(ge=0)]
_Index = Annotated[int, Field(ge=0, description="0-based annotation index on the page")]
_Uri = Annotated[str, Field(min_length=1, max_length=MAX_URI)]


@mcp.tool(annotations=READ_ONLY)
def pdf_get_annotations(pdf_path: PdfPath, page: int | None = None) -> dict[str, object]:
    """List annotations (index, subtype, rect, uri, text), optionally for one page."""
    with engine_guard():
        annots = engine.get_annotations(pdf_path, page=page)
    return {
        "annotations": [
            {
                "index": a.index,
                "page": a.page,
                "subtype": a.subtype,
                "rect": {"x0": a.rect[0], "y0": a.rect[1], "x1": a.rect[2], "y1": a.rect[3]},
                "uri": a.uri,
                "text": a.text,
            }
            for a in annots
        ]
    }


@mcp.tool(annotations=WRITE)
def pdf_add_annotation(
    pdf_path: PdfPath,
    page: _Page,
    rect: BBox,
    uri: _Uri,
    output_path: OutputPath,
    border_style: Annotated[str, Field(max_length=20)] = "none",
) -> dict[str, object]:
    """Add a link annotation over a rect region."""
    with engine_guard():
        engine.add_annotation(
            pdf_path, page, rect.as_tuple(), uri, output_path, border_style=border_style
        )
    return {"success": True, "output_path": output_path}


@mcp.tool(annotations=WRITE)
def pdf_update_annotation(
    pdf_path: PdfPath,
    page: _Page,
    annotation_index: _Index,
    url: _Uri,
    output_path: OutputPath,
) -> dict[str, object]:
    """Update an existing annotation's URI, addressed by page + index."""
    with engine_guard():
        annots = engine.get_annotations(pdf_path, page=page)
        if not annots:
            raise PDFEditError(f"Page {page} has no annotations")
        if annotation_index >= len(annots):
            raise PDFEditError(
                f"Annotation index {annotation_index} out of range "
                f"(page has {len(annots)} annotations)"
            )
        annot = annots[annotation_index]
        old_url = annot.uri or ""
        engine.update_annotation_uri(pdf_path, annot, url, output_path)
    return {"success": True, "old_url": old_url, "new_url": url}


@mcp.tool(annotations=WRITE)
def pdf_delete_annotation_v2(
    pdf_path: PdfPath,
    page: _Page,
    annotation_index: _Index,
    output_path: OutputPath,
) -> dict[str, object]:
    """Delete an annotation by page + index."""
    with engine_guard():
        annots = engine.get_annotations(pdf_path, page=page)
        if annotation_index >= len(annots):
            raise PDFEditError(
                f"Annotation index {annotation_index} out of range (page has {len(annots)})"
            )
        engine_delete_annotation(pdf_path, annots[annotation_index], output_path)
    return {"success": True, "output_path": output_path}


@mcp.tool(annotations=WRITE)
def pdf_move_annotation(
    pdf_path: PdfPath,
    page: _Page,
    annotation_index: _Index,
    new_rect: BBox,
    output_path: OutputPath,
) -> dict[str, object]:
    """Move an annotation to a new rect, addressed by page + index."""
    with engine_guard():
        annots = engine.get_annotations(pdf_path, page=page)
        if annotation_index >= len(annots):
            raise PDFEditError(
                f"Annotation index {annotation_index} out of range (page has {len(annots)})"
            )
        engine.move_annotation(pdf_path, annots[annotation_index], new_rect.as_tuple(), output_path)
    return {"success": True, "output_path": output_path}
