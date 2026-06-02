"""Section operations: detect / swap / replace by name.

These are NOT thin engine wrappers — they are an MCP-side font-hierarchy section
detector plus orchestration (fuzzy name resolution, atomic temp-file swap, and
pikepdf link-annotation repositioning). Ported verbatim from the v0.1.x
``bridge.py`` handlers; the algorithm and its invariants (ambiguous-name refusal,
atomic finalize, no-output-on-failure) are preserved exactly.

The internal ``_detect_sections`` / ``_swap_sections`` / ``_replace_section``
functions run *inside* the calling tool's ``engine_guard()`` (single-flight lock +
error translation), so they call engine + pikepdf directly and raise
``PDFEditError`` on failure.
"""

from __future__ import annotations

import os
from collections import Counter
from typing import Annotated, Any

import pdf_edit_engine as engine
import pikepdf
from pdf_edit_engine import TextBlock
from pdf_edit_engine.errors import PDFEditError
from pydantic import Field

from pdf_edit_mcp._runtime import READ_ONLY, WRITE, engine_guard
from pdf_edit_mcp.app import mcp
from pdf_edit_mcp.constants import MAX_REPLACEMENT_TEXT, MAX_SECTION_NAME
from pdf_edit_mcp.validation import OutputPath, PdfPath

_MARGIN_TOL = 5.0

_SectionName = Annotated[
    str, Field(min_length=1, max_length=MAX_SECTION_NAME, description="Section name (fuzzy match)")
]


def _flatten(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten the section tree (top-level + children) into one list."""
    out: list[dict[str, Any]] = []
    for s in sections:
        out.append(s)
        out.extend(s.get("children", []))
    return out


def _bbox_tuple(b: dict[str, Any]) -> tuple[float, float, float, float]:
    return (b["x0"], b["y0"], b["x1"], b["y1"])


def _detect_sections(pdf_path: str, page: int, include_text: bool) -> dict[str, Any]:
    """Universal section detection via font hierarchy — no text patterns."""
    blocks = engine.get_text_layout(pdf_path, page=page)
    all_visible = [b for b in blocks if b.text.strip()]
    if not all_visible:
        return {"sections": [], "body_font": None, "heading_fonts": []}

    # For font frequency, only count multi-char blocks (skip markers like bullets).
    multi_char = [b for b in all_visible if len(b.text.strip()) > 1]
    if not multi_char:
        return {"sections": [], "body_font": None, "heading_fonts": []}

    # Step 1: identify font hierarchy from frequency.
    font_freq: Counter[tuple[str, float]] = Counter(
        (b.font_name, round(b.font_size, 1)) for b in multi_char
    )
    body_font, body_size = font_freq.most_common(1)[0][0]

    heading_font_names = {fn for fn, _fs in font_freq if fn != body_font}
    if not heading_font_names:
        sizes = sorted({round(b.font_size, 1) for b in multi_char}, reverse=True)
        if len(sizes) > 1:
            heading_font_names = {body_font}
        else:
            return {"sections": [], "body_font": body_font, "heading_fonts": []}

    page_x0 = min(b.x for b in all_visible)
    page_x1 = max(b.x + b.width for b in all_visible)

    # Step 2: group heading-font blocks into visual lines.
    lines_by_y: dict[float, list[TextBlock]] = {}
    for b in all_visible:
        if b.font_name in heading_font_names:
            y_key = round(b.y * 2) / 2
            lines_by_y.setdefault(y_key, []).append(b)

    heading_lines: list[dict[str, Any]] = []
    for y_key in sorted(lines_by_y.keys(), reverse=True):
        line_blocks = sorted(lines_by_y[y_key], key=lambda blk: blk.x)
        first_sig = next((b for b in line_blocks if len(b.text.strip()) > 1), None)
        if first_sig is None:
            continue
        if abs(first_sig.x - page_x0) > _MARGIN_TOL:
            continue
        joined = "".join(b.text for b in line_blocks).strip()
        if not joined:
            continue
        font_size = round(line_blocks[0].font_size, 1)
        sig_blocks = [b for b in line_blocks if len(b.text.strip()) > 1]
        if not sig_blocks:
            continue
        if sig_blocks[0].font_name == body_font and font_size <= body_size:
            continue
        heading_lines.append(
            {
                "y": y_key,
                "title": joined,
                "font_name": line_blocks[0].font_name,
                "font_size": font_size,
            }
        )

    if not heading_lines:
        return {
            "sections": [],
            "body_font": body_font,
            "heading_fonts": list(heading_font_names),
        }

    # Step 3: assign hierarchy levels by font size (descending -> 0, 1, 2 ...).
    distinct_sizes = sorted({h["font_size"] for h in heading_lines}, reverse=True)
    size_to_level = {s: i for i, s in enumerate(distinct_sizes)}
    for h in heading_lines:
        h["level"] = size_to_level[h["font_size"]]

    # Step 4: build sections + compute bboxes.
    page_bottom = min(b.y for b in all_visible) - 1.0
    sections: list[dict[str, Any]] = []
    for i, h in enumerate(heading_lines):
        y1 = h["y"] + h["font_size"] + 0.5
        y0 = page_bottom
        for j in range(i + 1, len(heading_lines)):
            if heading_lines[j]["level"] <= h["level"]:
                nxt = heading_lines[j]
                y0 = nxt["y"] + nxt["font_size"] + 0.5
                break
        bbox = {"x0": page_x0, "y0": y0, "x1": page_x1, "y1": y1}
        section: dict[str, Any] = {
            "title": h["title"],
            "level": h["level"],
            "bbox": bbox,
            "font_name": h["font_name"],
            "font_size": h["font_size"],
            "page": page,
        }
        if include_text:
            try:
                section["text"] = engine.extract_bbox_text(
                    pdf_path,
                    bbox=(bbox["x0"], bbox["y0"], bbox["x1"], bbox["y1"]),
                    page=page,
                    tolerance=0.0,
                )
            except Exception:
                section["text"] = ""
        sections.append(section)

    # Step 5: nest level-1+ sections under their containing level-0 parent.
    top_level = [s for s in sections if s["level"] == 0]
    for parent in top_level:
        parent["children"] = [
            s
            for s in sections
            if s["level"] > parent["level"]
            and s["bbox"]["y0"] >= parent["bbox"]["y0"]
            and s["bbox"]["y1"] <= parent["bbox"]["y1"]
        ]

    return {
        "sections": top_level if top_level else sections,
        "body_font": body_font,
        "heading_fonts": list(heading_font_names),
    }


def _get_link_annotations_in_bbox(
    pdf_path: str, page: int, bbox: dict[str, Any]
) -> list[dict[str, Any]]:
    """Link annotations whose CENTER point lies within a bbox (avoids boundary bleed)."""
    result: list[dict[str, Any]] = []
    for a in engine.get_annotations(pdf_path, page=page):
        if a.subtype != "Link" or not a.uri:
            continue
        cy = (a.rect[1] + a.rect[3]) / 2
        cx = (a.rect[0] + a.rect[2]) / 2
        if bbox["y0"] < cy < bbox["y1"] and bbox["x0"] < cx < bbox["x1"]:
            result.append({"rect": a.rect, "uri": a.uri})
    return result


def _resolve_section(name: str, all_secs: list[dict[str, Any]]) -> dict[str, Any]:
    """Fuzzy-match a section by name; raise on ambiguous (>1) or missing (refuses
    to silently pick the first substring match)."""
    low = name.lower()
    matches = [s for s in all_secs if low in s["title"].lower()]
    if not matches:
        titles = [s["title"][:40] for s in all_secs]
        raise PDFEditError(f"Section '{name}' not found. Available: {titles}")
    if len(matches) > 1:
        ambiguous = [s["title"][:50] for s in matches]
        raise PDFEditError(
            f"Section name '{name}' is ambiguous — matches {len(matches)} sections: "
            f"{ambiguous}. Provide a more specific substring."
        )
    return matches[0]


def _rewrite_link_annotations_for_swap(
    target_path: str,
    page: int,
    siblings: list[dict[str, Any]],
    saved_annots: dict[str, list[dict[str, Any]]],
) -> int:
    """Re-add saved link annotations at their post-swap (re-rendered) positions.

    Opens the temp swap file, drops link annotations whose center lies in any
    sibling bbox (clean slate), re-detects sections to learn each sibling's new
    y-position, and re-adds the saved annotations shifted accordingly.
    """
    total_annots = sum(len(v) for v in saved_annots.values())
    if total_annots == 0:
        return 0

    with pikepdf.open(target_path, allow_overwriting_input=True) as pdf:
        page_obj = pdf.pages[page]
        annots_key = pikepdf.Name("/Annots")
        rect_key = pikepdf.Name("/Rect")

        # Step 1: clean slate — drop annotations centred in any sibling bbox.
        if annots_key in page_obj:
            kept: list[Any] = []
            for annot_ref in list(page_obj[annots_key]):
                remove = False
                try:
                    annot = annot_ref
                    if hasattr(annot, "resolve"):
                        annot = annot.resolve()  # type: ignore[operator]  # pikepdf dynamic attr
                    if isinstance(annot, pikepdf.Dictionary) and rect_key in annot:
                        r = annot[rect_key]
                        cy = (float(r[1]) + float(r[3])) / 2
                        cx = (float(r[0]) + float(r[2])) / 2
                        for sib in siblings:
                            b = sib["bbox"]
                            if b["y0"] < cy < b["y1"] and b["x0"] < cx < b["x1"]:
                                remove = True
                                break
                except Exception:
                    pass
                if not remove:
                    kept.append(annot_ref)
            page_obj[annots_key] = pikepdf.Array(kept) if kept else pikepdf.Array()

        if annots_key not in page_obj:
            page_obj[annots_key] = pikepdf.Array()

        def _make_link(rect_tuple: tuple[float, float, float, float], uri: str) -> Any:
            action = pikepdf.Dictionary({"/S": pikepdf.Name("/URI"), "/URI": pikepdf.String(uri)})
            return pdf.make_indirect(
                pikepdf.Dictionary(
                    {
                        "/Type": pikepdf.Name("/Annot"),
                        "/Subtype": pikepdf.Name("/Link"),
                        "/Rect": pikepdf.Array([float(v) for v in rect_tuple]),
                        "/Border": pikepdf.Array([0, 0, 0]),
                        "/A": action,
                    }
                )
            )

        # Step 3: re-detect to find each sibling's final y, match on first word.
        sib_shifts: dict[str, float] = {}
        try:
            out_all = _flatten(_detect_sections(target_path, page, include_text=False)["sections"])
            for sib in siblings:
                words = sib["title"].split()
                first_word = words[0].lower() if words else ""
                out_sib = next(
                    (
                        s
                        for s in out_all
                        if s["level"] == sib["level"]
                        and first_word
                        and s["title"].lower().startswith(first_word)
                    ),
                    None,
                )
                sib_shifts[sib["title"]] = (
                    out_sib["bbox"]["y1"] - sib["bbox"]["y1"] if out_sib else 0.0
                )
        except Exception:
            for sib in siblings:
                sib_shifts[sib["title"]] = 0.0

        # Step 4: re-add saved annotations at their shifted positions.
        for sib in siblings:
            dy = sib_shifts.get(sib["title"], 0.0)
            for a in saved_annots.get(sib["title"], []):
                new_rect = (a["rect"][0], a["rect"][1] + dy, a["rect"][2], a["rect"][3] + dy)
                page_obj[annots_key].append(_make_link(new_rect, a["uri"]))

        pdf.save(target_path)
    return total_annots


def _container_and_siblings(
    match: dict[str, Any], all_secs: list[dict[str, Any]], *, second: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Resolve the same-level siblings of ``match`` within its containing parent.

    When ``second`` is given (swap), the container must contain BOTH sections.
    """
    target_level = match["level"]

    def _contains(s: dict[str, Any], m: dict[str, Any]) -> bool:
        return bool(s["bbox"]["y0"] <= m["bbox"]["y0"] and m["bbox"]["y1"] <= s["bbox"]["y1"])

    container = next(
        (
            s
            for s in all_secs
            if s["level"] == target_level - 1
            and _contains(s, match)
            and (second is None or _contains(s, second))
        ),
        None,
    )
    if container is not None:
        return [
            s
            for s in all_secs
            if s["level"] == target_level
            and s["bbox"]["y0"] >= container["bbox"]["y0"]
            and s["bbox"]["y1"] <= container["bbox"]["y1"]
        ]
    return [s for s in all_secs if s["level"] == target_level]


def _swap_sections(
    pdf_path: str, section_a: str, section_b: str, output_path: str, page: int
) -> dict[str, object]:
    det = _detect_sections(pdf_path, page, include_text=True)
    all_secs = _flatten(det["sections"])
    if not all_secs:
        raise PDFEditError("No sections detected in the document")

    match_a = _resolve_section(section_a, all_secs)
    match_b = _resolve_section(section_b, all_secs)
    if match_a is match_b:
        raise PDFEditError(f"Both names match the same section: '{match_a['title'][:50]}'")

    siblings = _container_and_siblings(match_a, all_secs, second=match_b)

    # Save link annotations from ALL siblings BEFORE the swap.
    saved_annots = {
        sib["title"]: _get_link_annotations_in_bbox(pdf_path, page, sib["bbox"]) for sib in siblings
    }

    replacements: list[tuple[tuple[float, float, float, float], str]] = []
    for sib in siblings:
        if sib["title"] == match_a["title"]:
            replacements.append((_bbox_tuple(sib["bbox"]), match_b["text"]))
        elif sib["title"] == match_b["title"]:
            replacements.append((_bbox_tuple(sib["bbox"]), match_a["text"]))
        else:
            replacements.append((_bbox_tuple(sib["bbox"]), sib["text"]))

    # Atomic: write to a sibling temp path; only rename to output after BOTH the
    # block re-render and the annotation rewrite succeed.
    temp_path = output_path + ".swap_tmp"
    if os.path.exists(temp_path):
        try:
            os.unlink(temp_path)
        except OSError:
            pass

    finalized = False
    total_annots = 0
    try:
        results = engine.batch_replace_block(pdf_path, page, replacements, temp_path)
        total_annots = _rewrite_link_annotations_for_swap(temp_path, page, siblings, saved_annots)
        try:
            os.replace(temp_path, output_path)
            finalized = True
        except OSError as e:
            raise PDFEditError(f"Failed to finalize swap output: {e}") from e
    finally:
        if not finalized and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass

    return {
        "success": all(r.success for r in results),
        "swapped": [match_a["title"][:50], match_b["title"][:50]],
        "siblings_rerendered": len(siblings),
        "annotations_transferred": total_annots,
        "output_path": output_path,
    }


def _replace_section(
    pdf_path: str, section: str, new_text: str, output_path: str, page: int
) -> dict[str, object]:
    det = _detect_sections(pdf_path, page, include_text=True)
    all_secs = _flatten(det["sections"])
    if not all_secs:
        raise PDFEditError("No sections detected in the document")

    match = _resolve_section(section, all_secs)
    siblings = _container_and_siblings(match, all_secs)

    replacements: list[tuple[tuple[float, float, float, float], str]] = []
    for sib in siblings:
        text = new_text if sib["title"] == match["title"] else sib["text"]
        replacements.append((_bbox_tuple(sib["bbox"]), text))

    results = engine.batch_replace_block(pdf_path, page, replacements, output_path)
    return {
        "success": all(r.success for r in results),
        "replaced": match["title"][:50],
        "siblings_rerendered": len(siblings),
        "output_path": output_path,
    }


@mcp.tool(annotations=READ_ONLY)
def pdf_detect_sections(
    pdf_path: PdfPath, page: int = 0, include_text: bool = True
) -> dict[str, object]:
    """Detect document sections via font hierarchy (universal — no text patterns).

    Returns a section tree (title, level, bbox, optional text) plus the detected
    body + heading fonts. Drives pdf_swap_sections / pdf_replace_section.
    """
    with engine_guard():
        return _detect_sections(pdf_path, page, include_text)


@mcp.tool(annotations=WRITE)
def pdf_swap_sections(
    pdf_path: PdfPath,
    section_a: _SectionName,
    section_b: _SectionName,
    output_path: OutputPath,
    page: int = 0,
) -> dict[str, object]:
    """Swap two sections by (fuzzy) name. Detects structure, re-renders all
    siblings, and transfers link annotations. Ambiguous names are refused (not
    guessed), and the output is written atomically — a failure leaves no file."""
    with engine_guard():
        return _swap_sections(pdf_path, section_a, section_b, output_path, page)


@mcp.tool(annotations=WRITE)
def pdf_replace_section(
    pdf_path: PdfPath,
    section: _SectionName,
    new_text: Annotated[str, Field(min_length=1, max_length=MAX_REPLACEMENT_TEXT)],
    output_path: OutputPath,
    page: int = 0,
) -> dict[str, object]:
    """Replace one section's content by (fuzzy) name; re-renders all siblings."""
    with engine_guard():
        return _replace_section(pdf_path, section, new_text, output_path, page)
