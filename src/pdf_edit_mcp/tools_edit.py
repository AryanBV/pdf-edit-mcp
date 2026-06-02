"""Text and block editing tools (7 of the 38).

Ported from the v0.1.x ``bridge.py`` handlers; return shapes preserved verbatim.
v0.2.0 additions: a ``password`` kwarg (encrypted PDFs, engine A2.3) on every
edit verb, and ``fit="none"|"shrink"`` (engine E.8) on the two block tools.

Optional engine kwargs are passed as ``None`` when unset — the engine's defaults
are ``None`` (it auto-detects), so this is equivalent to omitting them.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

import pdf_edit_engine as engine
from pdf_edit_engine import Edit
from pdf_edit_engine.errors import PDFEditError
from pydantic import Field

from pdf_edit_mcp._runtime import WRITE, engine_guard
from pdf_edit_mcp.app import mcp
from pdf_edit_mcp.constants import (
    DEFAULT_FONT_SIZE,
    MAX_COORDINATE,
    MAX_EDITS_PER_BATCH,
    MAX_FONT_NAME,
    MAX_FONT_SIZE,
    MAX_INSERT_TEXT,
    MAX_LINE_HEIGHT,
    MAX_REPLACEMENT_TEXT,
    MAX_REPLACEMENTS_PER_BATCH,
    MAX_SEARCH_TEXT,
    MIN_FONT_SIZE,
    MIN_LINE_HEIGHT,
)
from pdf_edit_mcp.serialize import aggregate_fidelity, serialize_edit_result
from pdf_edit_mcp.validation import BBox, BlockReplacement, EditItem, OutputPath, PdfPath

_Search = Annotated[
    str, Field(min_length=1, max_length=MAX_SEARCH_TEXT, description="Text to find")
]
_Replacement = Annotated[
    str, Field(max_length=MAX_REPLACEMENT_TEXT, description="Replacement text (may be empty)")
]
_FontName = Annotated[str | None, Field(max_length=MAX_FONT_NAME, description="Font name override")]
_FontSize = Annotated[float | None, Field(ge=MIN_FONT_SIZE, le=MAX_FONT_SIZE)]
_LineHeight = Annotated[float | None, Field(ge=MIN_LINE_HEIGHT, le=MAX_LINE_HEIGHT)]
_Coord = Annotated[float, Field(ge=-MAX_COORDINATE, le=MAX_COORDINATE)]
_Fit = Annotated[
    Literal["none", "shrink"], Field(description="Shrink-to-fit policy for the region (E.8)")
]


def _maybe_overwrite_warning(
    result: dict[str, Any], output_path: str, pdf_path: str, *, skip: bool = False
) -> dict[str, Any]:
    """Append (never overwrite) an advisory warning when output == input path.

    Root-fixes the v0.1.x TS behaviour that *replaced* the result's warnings list
    with just the overwrite notice, discarding any engine warnings.
    """
    if not skip and output_path == pdf_path:
        warnings = list(result.get("warnings") or [])
        warnings.append(
            "output_path is the same as the input pdf_path; the original file will be overwritten."
        )
        result["warnings"] = warnings
    return result


@mcp.tool(annotations=WRITE)
def pdf_replace_text(
    pdf_path: PdfPath,
    search: _Search,
    replacement: _Replacement,
    output_path: OutputPath,
    reflow: bool = True,
    dry_run: bool = False,
    password: str | None = None,
) -> dict[str, object]:
    """Replace every occurrence of ``search`` with ``replacement``, preserving fonts.

    Set ``dry_run=True`` to preview without writing. Inspect each result's fidelity
    report (and the top-level ``fidelity.degradation_kinds``) to verify quality.
    """
    with engine_guard():
        results = engine.replace_all(
            pdf_path,
            search,
            replacement,
            output_path,
            reflow=reflow,
            dry_run=dry_run,
            password=password,
        )
    if not results:
        return {
            "success": False,
            "edits_applied": 0,
            "message": "No matches found",
            "results": [],
            "dry_run": dry_run,
        }
    succeeded = sum(1 for r in results if r.success)
    out: dict[str, object] = {
        "success": succeeded > 0,
        "edits_applied": succeeded,
        "dry_run": dry_run,
        "results": [serialize_edit_result(r) for r in results],
        "fidelity": aggregate_fidelity(results),
    }
    return _maybe_overwrite_warning(out, output_path, pdf_path, skip=dry_run)


@mcp.tool(annotations=WRITE)
def pdf_replace_single(
    pdf_path: PdfPath,
    search: _Search,
    replacement: _Replacement,
    output_path: OutputPath,
    match_index: Annotated[int, Field(ge=0, description="0-based index among the matches")] = 0,
    reflow: bool = True,
    dry_run: bool = False,
    password: str | None = None,
) -> dict[str, object]:
    """Replace a single occurrence (by ``match_index``) of ``search``."""
    with engine_guard():
        matches = engine.find(pdf_path, search, password=password)
        if not matches:
            return {"success": False, "message": "No matches found", "dry_run": dry_run}
        if match_index >= len(matches):
            plural = "es" if len(matches) != 1 else ""
            raise PDFEditError(
                f"match_index {match_index} out of range (found {len(matches)} match{plural})"
            )
        result = engine.replace(
            pdf_path,
            matches[match_index],
            replacement,
            output_path,
            reflow=reflow,
            dry_run=dry_run,
            password=password,
        )
    out = serialize_edit_result(result)
    out["dry_run"] = dry_run
    return _maybe_overwrite_warning(out, output_path, pdf_path, skip=dry_run)


@mcp.tool(annotations=WRITE)
def pdf_batch_replace(
    pdf_path: PdfPath,
    edits: Annotated[list[EditItem], Field(min_length=1, max_length=MAX_EDITS_PER_BATCH)],
    output_path: OutputPath,
    dry_run: bool = False,
    password: str | None = None,
) -> dict[str, object]:
    """Apply many find/replace edits in one pass; verifies each landed in the output."""
    engine_edits = [Edit(find=e.find, replace=e.replace) for e in edits]
    output_text: str | None = None
    with engine_guard():
        results = engine.batch_replace(
            pdf_path, engine_edits, output_path, dry_run=dry_run, password=password
        )
        if not dry_run:
            try:
                output_text = engine.get_text(output_path)
            except Exception:
                output_text = None

    summary = {
        "total": len(results),
        "succeeded": sum(1 for r in results if r.success),
        "failed": sum(1 for r in results if not r.success),
        "any_degradation": any(bool(r.fidelity_report.degradations) for r in results),
        "degradation_kinds": sorted(
            {d.kind for r in results for d in r.fidelity_report.degradations}
        ),
    }
    if dry_run:
        verification = {
            "output_text_preview": "(dry_run — no file written)",
            "all_replacements_confirmed": True,
            "unconfirmed": [],
        }
    elif output_text is not None:
        unconfirmed = [e.replace for e in edits if e.replace and e.replace not in output_text]
        verification = {
            "output_text_preview": output_text[:500],
            "all_replacements_confirmed": len(unconfirmed) == 0,
            "unconfirmed": unconfirmed,
        }
    else:
        verification = {
            "output_text_preview": "",
            "all_replacements_confirmed": False,
            "unconfirmed": [],
        }
    out: dict[str, object] = {
        "dry_run": dry_run,
        "results": [serialize_edit_result(r) for r in results],
        "summary": summary,
        "verification": verification,
    }
    return _maybe_overwrite_warning(out, output_path, pdf_path, skip=dry_run)


@mcp.tool(annotations=WRITE)
def pdf_replace_block(
    pdf_path: PdfPath,
    page: Annotated[int, Field(ge=0)],
    bbox: BBox,
    new_text: Annotated[str, Field(min_length=1, max_length=MAX_REPLACEMENT_TEXT)],
    output_path: OutputPath,
    font_name: _FontName = None,
    font_size: _FontSize = None,
    line_height: _LineHeight = None,
    fit: _Fit = "none",
    password: str | None = None,
) -> dict[str, object]:
    """Replace all text within a bounding box, re-flowing to fit. ``fit='shrink'``
    shrinks the font to fit a fixed-height region (E.8)."""
    with engine_guard():
        result = engine.replace_block(
            pdf_path,
            page,
            bbox.as_tuple(),
            new_text,
            output_path,
            font_name=font_name,
            font_size=font_size,
            line_height=line_height,
            fit=fit,
            password=password,
        )
    return _maybe_overwrite_warning(serialize_edit_result(result), output_path, pdf_path)


@mcp.tool(annotations=WRITE)
def pdf_batch_replace_block(
    pdf_path: PdfPath,
    output_path: OutputPath,
    replacements: Annotated[
        list[BlockReplacement], Field(min_length=1, max_length=MAX_REPLACEMENTS_PER_BATCH)
    ],
    page: Annotated[int | None, Field(ge=0)] = None,
    page_number: Annotated[
        int | None, Field(ge=0, description="Deprecated alias for `page`")
    ] = None,
    line_height: _LineHeight = None,
    section_gap: _LineHeight = None,
    fit: _Fit = "none",
    password: str | None = None,
) -> dict[str, object]:
    """Replace text in several bounding boxes on one page. Use ``page`` (``page_number``
    is a deprecated alias)."""
    resolved = page if page is not None else page_number
    if resolved is None:
        raise PDFEditError("Missing required parameter: 'page'")
    engine_reps = [(r.bbox.as_tuple(), r.new_text) for r in replacements]
    with engine_guard():
        results = engine.batch_replace_block(
            pdf_path,
            int(resolved),
            engine_reps,
            output_path,
            line_height=line_height,
            section_gap=section_gap,
            fit=fit,
            password=password,
        )
    out: dict[str, object] = {
        "results": [serialize_edit_result(r) for r in results],
        "summary": {
            "total": len(results),
            "succeeded": sum(1 for r in results if r.success),
            "failed": sum(1 for r in results if not r.success),
        },
    }
    return _maybe_overwrite_warning(out, output_path, pdf_path)


@mcp.tool(annotations=WRITE)
def pdf_insert_text_block(
    pdf_path: PdfPath,
    page: Annotated[int, Field(ge=0)],
    x: _Coord,
    y: _Coord,
    text: Annotated[str, Field(min_length=1, max_length=MAX_INSERT_TEXT)],
    output_path: OutputPath,
    font_name: _FontName = None,
    font_size: Annotated[float, Field(ge=MIN_FONT_SIZE, le=MAX_FONT_SIZE)] = DEFAULT_FONT_SIZE,
    max_width: Annotated[float | None, Field(ge=0, le=MAX_COORDINATE)] = None,
    password: str | None = None,
) -> dict[str, object]:
    """Insert a new text block at ``(x, y)``, optionally wrapping at ``max_width``."""
    with engine_guard():
        result = engine.insert_text_block(
            pdf_path,
            page,
            x,
            y,
            text,
            output_path,
            font_name=font_name,
            font_size=font_size,
            max_width=max_width,
            password=password,
        )
    return _maybe_overwrite_warning(serialize_edit_result(result), output_path, pdf_path)


@mcp.tool(annotations=WRITE)
def pdf_delete_block(
    pdf_path: PdfPath,
    page: Annotated[int, Field(ge=0)],
    bbox: BBox,
    output_path: OutputPath,
    close_gap: bool = True,
    password: str | None = None,
) -> dict[str, object]:
    """Delete all text within a bounding box; ``close_gap`` pulls content up to fill it."""
    with engine_guard():
        result = engine.delete_block(
            pdf_path, page, bbox.as_tuple(), output_path, close_gap=close_gap, password=password
        )
    return _maybe_overwrite_warning(serialize_edit_result(result), output_path, pdf_path)
