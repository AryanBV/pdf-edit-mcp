"""Document-level operations (15 tools): pages, metadata, bookmarks, encryption, etc.

Thin wrappers over ``pdf_edit_engine.wrapper``; ported verbatim from ``bridge.py``.
Each returns ``{"output_path": ...}`` (or ``{"page_paths": [...]}`` for split). These
verbs do NOT accept a ``password`` (the engine wrapper functions don't), so encrypted
inputs must be decrypted first — except ``pdf_decrypt``, which takes the password.
"""

from __future__ import annotations

from typing import Annotated, Literal

import pdf_edit_engine as engine
from pydantic import AfterValidator, Field

from pdf_edit_mcp._runtime import WRITE, engine_guard
from pdf_edit_mcp.app import mcp
from pdf_edit_mcp.constants import (
    MAX_FORM_FIELD_VALUE,
    MAX_FORM_FIELDS,
    MAX_HIGHLIGHT_VALUES,
    MAX_METADATA_KEYS,
    MAX_METADATA_VALUE,
    MAX_PAGE_INDICES,
    MAX_PASSWORD,
    MAX_PDFS_PER_MERGE,
    MAX_TITLE,
    MAX_URI,
    MIN_HIGHLIGHT_VALUES,
)
from pdf_edit_mcp.validation import BBox, DirPath, OutputPath, PdfPath

_PageList = Annotated[
    list[Annotated[int, Field(ge=0)]], Field(min_length=1, max_length=MAX_PAGE_INDICES)
]
_Page = Annotated[int, Field(ge=0)]
_Password = Annotated[str, Field(max_length=MAX_PASSWORD)]
_Metadata = Annotated[
    dict[str, Annotated[str, Field(max_length=MAX_METADATA_VALUE)]],
    Field(max_length=MAX_METADATA_KEYS),
]
_FormFields = Annotated[
    dict[str, Annotated[str, Field(max_length=MAX_FORM_FIELD_VALUE)]],
    Field(max_length=MAX_FORM_FIELDS),
]


def _multiple_of_8(v: list[float]) -> list[float]:
    if len(v) % 8 != 0:
        raise ValueError("quad_points length must be a multiple of 8 (x,y per corner, 4 corners)")
    return v


_QuadPoints = Annotated[
    list[float],
    Field(min_length=MIN_HIGHLIGHT_VALUES, max_length=MAX_HIGHLIGHT_VALUES),
    AfterValidator(_multiple_of_8),
]


@mcp.tool(annotations=WRITE)
def pdf_merge(
    pdf_paths: Annotated[list[PdfPath], Field(min_length=2, max_length=MAX_PDFS_PER_MERGE)],
    output_path: OutputPath,
) -> dict[str, object]:
    """Merge multiple PDFs into one, in the given order."""
    with engine_guard():
        result = engine.merge_pdfs(pdf_paths, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_split(pdf_path: PdfPath, output_dir: DirPath) -> dict[str, object]:
    """Split a PDF into one file per page, written into output_dir."""
    with engine_guard():
        pages = engine.split_pdf(pdf_path, output_dir)
    return {"page_paths": pages}


@mcp.tool(annotations=WRITE)
def pdf_reorder_pages(
    pdf_path: PdfPath, page_order: _PageList, output_path: OutputPath
) -> dict[str, object]:
    """Reorder pages to the given 0-based order."""
    with engine_guard():
        result = engine.reorder_pages(pdf_path, page_order, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_rotate_pages(
    pdf_path: PdfPath,
    pages: _PageList,
    angle: Literal[90, 180, 270],
    output_path: OutputPath,
) -> dict[str, object]:
    """Rotate the given pages clockwise by 90, 180, or 270 degrees."""
    with engine_guard():
        result = engine.rotate_pages(pdf_path, pages, angle, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_delete_pages(
    pdf_path: PdfPath, pages: _PageList, output_path: OutputPath
) -> dict[str, object]:
    """Delete the given 0-based pages."""
    with engine_guard():
        result = engine.delete_pages(pdf_path, pages, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_crop_pages(pdf_path: PdfPath, box: BBox, output_path: OutputPath) -> dict[str, object]:
    """Crop every page to the given box."""
    with engine_guard():
        result = engine.crop_pages(pdf_path, box.as_tuple(), output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_edit_metadata(
    pdf_path: PdfPath, metadata: _Metadata, output_path: OutputPath
) -> dict[str, object]:
    """Set document metadata (e.g. title, author, subject, keywords)."""
    with engine_guard():
        result = engine.edit_metadata(pdf_path, metadata, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_add_bookmark(
    pdf_path: PdfPath,
    title: Annotated[str, Field(min_length=1, max_length=MAX_TITLE)],
    page: _Page,
    output_path: OutputPath,
) -> dict[str, object]:
    """Add a bookmark (outline entry) pointing to a page."""
    with engine_guard():
        result = engine.add_bookmark(pdf_path, title, page, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_encrypt(
    pdf_path: PdfPath,
    owner_password: _Password,
    user_password: _Password,
    output_path: OutputPath,
) -> dict[str, object]:
    """Encrypt a PDF with owner + user passwords."""
    with engine_guard():
        result = engine.encrypt_pdf(pdf_path, owner_password, user_password, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_decrypt(
    pdf_path: PdfPath, password: _Password, output_path: OutputPath
) -> dict[str, object]:
    """Decrypt a password-protected PDF (writes an unencrypted copy)."""
    with engine_guard():
        result = engine.decrypt_pdf(pdf_path, password, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_add_hyperlink(
    pdf_path: PdfPath,
    page: _Page,
    bbox: BBox,
    uri: Annotated[str, Field(min_length=1, max_length=MAX_URI)],
    output_path: OutputPath,
) -> dict[str, object]:
    """Add a clickable hyperlink over a bbox region."""
    with engine_guard():
        result = engine.add_hyperlink(pdf_path, page, bbox.as_tuple(), uri, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_add_highlight(
    pdf_path: PdfPath,
    page: _Page,
    quad_points: _QuadPoints,
    output_path: OutputPath,
) -> dict[str, object]:
    """Add highlight annotations over quadrilateral regions (8 floats per quad)."""
    with engine_guard():
        result = engine.add_highlight(pdf_path, page, quad_points, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_flatten_annotations(pdf_path: PdfPath, output_path: OutputPath) -> dict[str, object]:
    """Flatten all annotations into the page content (no longer interactive)."""
    with engine_guard():
        result = engine.flatten_annotations(pdf_path, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_fill_form(
    pdf_path: PdfPath, field_values: _FormFields, output_path: OutputPath
) -> dict[str, object]:
    """Fill AcroForm fields with the given name -> value mapping."""
    with engine_guard():
        result = engine.fill_form(pdf_path, field_values, output_path)
    return {"output_path": result}


@mcp.tool(annotations=WRITE)
def pdf_add_watermark(
    pdf_path: PdfPath, watermark_path: PdfPath, output_path: OutputPath
) -> dict[str, object]:
    """Stamp a watermark PDF's first page onto every page of the input."""
    with engine_guard():
        result = engine.add_watermark(pdf_path, watermark_path, output_path)
    return {"output_path": result}
