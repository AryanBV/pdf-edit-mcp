#!/usr/bin/env python3
"""JSON-RPC 2.0 bridge between TypeScript MCP server and pdf-edit-engine.

Reads JSON-RPC requests from stdin (one per line), dispatches to
pdf-edit-engine functions, writes JSON-RPC responses to stdout.

CRITICAL: stdout is the IPC channel. NEVER use print() — all logging
goes to stderr. Responses use _stdout.write() exclusively.
"""

import json
import sys
import io

# Wrap stdin/stdout in UTF-8 BEFORE saving references (Windows defaults to cp1252)
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
_stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stdout = sys.stderr  # Redirect accidental prints to stderr

try:
    import pikepdf
    from pdf_edit_engine import (
        find,
        replace,
        get_text,
        get_text_layout,
        get_fonts,
        extract_bbox_text,
        replace_all,
        batch_replace,
        detect_paragraphs,
        analyze_subset,
        Edit,
    )
    from pdf_edit_engine.errors import PDFEditError, FontNotFoundError
    from pdf_edit_engine.structural import (
        replace_block,
        insert_text_block,
        delete_block,
        batch_replace_block,
    )
    from pdf_edit_engine.wrapper import (
        merge_pdfs,
        split_pdf,
        reorder_pages,
        rotate_pages,
        delete_pages,
        crop_pages,
        edit_metadata,
        add_bookmark,
        encrypt_pdf,
        decrypt_pdf,
        add_hyperlink,
        add_highlight,
        flatten_annotations,
        fill_form,
        add_watermark,
    )
    from pdf_edit_engine.annotations import (
        get_annotations,
        add_annotation,
        update_annotation_uri,
        delete_annotation as engine_delete_annotation,
        move_annotation,
        Annotation,
    )
except ImportError as e:
    print(
        json.dumps({"error": f"pdf-edit-engine not installed: {e}"}),
        file=sys.stderr,
    )
    sys.exit(1)


# ── Response helpers ──────────────────────────────────────────────────

def respond_success(req_id, result):
    """Write a JSON-RPC success response to stdout."""
    response = {"jsonrpc": "2.0", "id": req_id, "result": result}
    _stdout.write(json.dumps(response) + "\n")
    _stdout.flush()


def respond_error(req_id, code, message):
    """Write a JSON-RPC error response to stdout."""
    response = {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": code, "message": message},
    }
    _stdout.write(json.dumps(response) + "\n")
    _stdout.flush()


def _serialize_edit_result(result):
    """Convert an EditResult dataclass to a JSON-serializable dict."""
    return {
        "success": result.success,
        "original_text": result.original_text,
        "new_text": result.new_text,
        "font_action": result.font_action,
        "warnings": result.warnings,
        "fidelity": {
            "font_preserved": result.fidelity_report.font_preserved,
            "font_substituted": result.fidelity_report.font_substituted,
            "overflow_detected": result.fidelity_report.overflow_detected,
            "reflow_applied": result.fidelity_report.reflow_applied,
            "glyphs_missing": result.fidelity_report.glyphs_missing,
        },
    }


# ── Method handlers ───────────────────────────────────────────────────

def handle_get_text(params):
    pdf_path = params["pdf_path"]
    text = get_text(pdf_path)
    with pikepdf.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
    return {"text": text, "page_count": page_count}


def handle_find_text(params):
    pdf_path = params["pdf_path"]
    search = params["search"]
    case_sensitive = params.get("case_sensitive", True)
    matches = find(pdf_path, search, case_sensitive=case_sensitive)
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


def handle_replace_text(params):
    pdf_path = params["pdf_path"]
    search = params["search"]
    replacement = params["replacement"]
    output_path = params["output_path"]

    results = replace_all(pdf_path, search, replacement, output_path)

    if not results:
        return {
            "success": False,
            "edits_applied": 0,
            "message": "No matches found",
            "fidelity": {"font_preserved": True, "overflow_detected": False},
        }

    succeeded = [r for r in results if r.success]
    return {
        "success": len(succeeded) > 0,
        "edits_applied": len(succeeded),
        "fidelity": {
            "font_preserved": all(
                r.fidelity_report.font_preserved for r in results
            ),
            "overflow_detected": any(
                r.fidelity_report.overflow_detected for r in results
            ),
        },
    }


def handle_batch_replace(params):
    pdf_path = params["pdf_path"]
    edits = [Edit(find=e["find"], replace=e["replace"]) for e in params["edits"]]
    output_path = params["output_path"]

    results = batch_replace(pdf_path, edits, output_path)

    mapped = []
    for r in results:
        mapped.append({
            "success": r.success,
            "original_text": r.original_text,
            "new_text": r.new_text,
            "font_action": r.font_action,
            "warnings": r.warnings,
            "fidelity": {
                "font_preserved": r.fidelity_report.font_preserved,
                "overflow_detected": r.fidelity_report.overflow_detected,
                "reflow_applied": r.fidelity_report.reflow_applied,
            },
        })

    succeeded = sum(1 for r in results if r.success)

    # Auto-verification: read output and check replacements appear
    verification = {
        "output_text_preview": "",
        "all_replacements_confirmed": True,
        "unconfirmed": [],
    }
    try:
        output_text = get_text(output_path)
        verification["output_text_preview"] = output_text[:500]
        for edit in params["edits"]:
            replace_str = edit["replace"]
            if not replace_str:
                continue  # Empty replacement — skip
            if replace_str not in output_text:
                verification["all_replacements_confirmed"] = False
                verification["unconfirmed"].append(replace_str)
    except Exception as e:
        print(f"Verification warning: {e}", file=sys.stderr)
        verification["all_replacements_confirmed"] = False

    return {
        "results": mapped,
        "summary": {
            "total": len(results),
            "succeeded": succeeded,
            "failed": len(results) - succeeded,
        },
        "verification": verification,
    }


def handle_get_fonts(params):
    pdf_path = params["pdf_path"]
    fonts = get_fonts(pdf_path)
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


def handle_detect_paragraphs(params):
    pdf_path = params["pdf_path"]
    page = params.get("page", 0)
    paragraphs = detect_paragraphs(pdf_path, page=page)
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
            for p in paragraphs
        ]
    }


def handle_analyze_subset(params):
    pdf_path = params["pdf_path"]
    text = params["text"]
    font_name = params.get("font_name")

    # If no font_name provided, use first font from the PDF
    if not font_name:
        fonts = get_fonts(pdf_path)
        if not fonts:
            raise PDFEditError("No fonts found in PDF")
        font_name = fonts[0].name

    info = analyze_subset(pdf_path, font_name)

    # Check which characters of text are available in the font's cmap
    missing = []
    if info.font_cmap is not None:
        available_chars = set(info.font_cmap.values())
        for char in text:
            if char not in available_chars and char.strip():
                if char not in missing:
                    missing.append(char)
    else:
        # No cmap available — cannot verify, assume available
        print(
            f"Warning: No cmap for font {font_name}, cannot verify glyphs",
            file=sys.stderr,
        )

    return {
        "available": len(missing) == 0,
        "missing_glyphs": missing,
        "font_name": info.name,
        "glyph_count": info.glyph_count,
    }


def handle_inspect(params):
    pdf_path = params["pdf_path"]
    include_layout = params.get("include_layout", False)

    # Reuse existing engine functions
    text = get_text(pdf_path)
    fonts_raw = get_fonts(pdf_path)

    # Serialize fonts (slim: name, encoding, is_subset)
    fonts = [
        {
            "name": f.name,
            "encoding_type": f.encoding_type,
            "is_subset": f.is_subset,
        }
        for f in fonts_raw
    ]

    # Get page count
    with pikepdf.open(pdf_path) as pdf:
        page_count = len(pdf.pages)

    # Detect paragraphs on ALL pages (max 20 to prevent timeouts)
    max_pages = min(page_count, 20)
    paragraphs = []
    for page_idx in range(max_pages):
        try:
            page_paragraphs = detect_paragraphs(pdf_path, page=page_idx)
        except Exception:
            continue
        for p in page_paragraphs:
            paragraphs.append({
                "text": p.full_text,
                "bbox": {
                    "x0": p.left_margin,
                    "y0": p.first_line_y - (p.line_count - 1) * p.line_height,
                    "x1": p.left_margin + p.paragraph_width,
                    "y1": p.first_line_y + p.line_height,
                },
                "font_name": p.font_name,
                "font_size": p.font_size,
                "page": page_idx,
            })

    # Annotations via engine API (not pikepdf directly)
    annots_raw = get_annotations(pdf_path)
    annotations = []
    for a in annots_raw:
        entry = {
            "index": a.index,
            "subtype": a.subtype,
            "rect": {
                "x0": a.rect[0], "y0": a.rect[1],
                "x1": a.rect[2], "y1": a.rect[3],
            },
            "page": a.page,
        }
        # Backward compat: Link annotations expose 'url' (old) + 'uri' (new)
        if a.uri:
            entry["url"] = a.uri
            entry["uri"] = a.uri
        if a.text:
            entry["text"] = a.text
        annotations.append(entry)

    result = {
        "page_count": page_count,
        "text": text,
        "fonts": fonts,
        "paragraphs": paragraphs,
        "annotations": annotations,
    }

    # Optional: include raw text layout blocks
    if include_layout:
        layout = []
        for page_idx in range(max_pages):
            try:
                blocks = get_text_layout(pdf_path, page=page_idx)
            except Exception:
                continue
            for b in blocks:
                layout.append({
                    "text": b.text,
                    "x": b.x,
                    "y": b.y,
                    "width": b.width,
                    "height": b.height,
                    "font_name": b.font_name,
                    "font_size": b.font_size,
                    "page": b.page,
                })
        result["text_layout"] = layout

    return result


def handle_update_annotation(params):
    pdf_path = params["pdf_path"]
    page_num = params["page"]
    annotation_index = params["annotation_index"]
    new_url = params["url"]
    output_path = params["output_path"]

    with pikepdf.open(pdf_path) as pdf:
        if page_num < 0 or page_num >= len(pdf.pages):
            raise PDFEditError(
                f"Page {page_num} out of range (PDF has {len(pdf.pages)} pages)"
            )
        page = pdf.pages[page_num]
        annots = page.get("/Annots")
        if annots is None:
            raise PDFEditError("Page has no annotations")
        if annotation_index < 0 or annotation_index >= len(annots):
            raise PDFEditError(
                f"Annotation index {annotation_index} out of range "
                f"(page has {len(annots)} annotations)"
            )
        annot = annots[annotation_index]
        if hasattr(annot, "resolve"):
            annot = annot.resolve()
        a_dict = annot.get("/A")
        if a_dict is None:
            raise PDFEditError("Annotation has no /A dictionary")
        if hasattr(a_dict, "resolve"):
            a_dict = a_dict.resolve()
        old_url = str(a_dict.get("/URI", ""))
        a_dict[pikepdf.Name("/URI")] = pikepdf.String(new_url)
        pdf.save(output_path)

    return {"success": True, "old_url": old_url, "new_url": new_url}


def handle_replace_single(params):
    pdf_path = params["pdf_path"]
    search = params["search"]
    match_index = params.get("match_index", 0)
    replacement = params["replacement"]
    output_path = params["output_path"]
    reflow = params.get("reflow", True)

    matches = find(pdf_path, search)
    if not matches:
        return {
            "success": False,
            "message": "No matches found",
            "fidelity": {"font_preserved": True, "overflow_detected": False},
        }

    if match_index < 0 or match_index >= len(matches):
        raise PDFEditError(
            f"match_index {match_index} out of range "
            f"(found {len(matches)} match{'es' if len(matches) != 1 else ''})"
        )

    result = replace(pdf_path, matches[match_index], replacement, output_path, reflow=reflow)

    return {
        "success": result.success,
        "fidelity": {
            "font_preserved": result.fidelity_report.font_preserved,
            "overflow_detected": result.fidelity_report.overflow_detected,
        },
    }


def handle_replace_block(params):
    pdf_path = params["pdf_path"]
    page = int(params["page"])
    bbox = params["bbox"]
    bbox_tuple = (bbox["x0"], bbox["y0"], bbox["x1"], bbox["y1"])
    new_text = params["new_text"]
    output_path = params["output_path"]

    kwargs = {}
    if params.get("font_name") is not None:
        kwargs["font_name"] = params["font_name"]
    if params.get("font_size") is not None:
        kwargs["font_size"] = params["font_size"]

    result = replace_block(pdf_path, page, bbox_tuple, new_text, output_path, **kwargs)
    return _serialize_edit_result(result)


def handle_insert_text_block(params):
    pdf_path = params["pdf_path"]
    page = int(params["page"])
    x = params["x"]
    y = params["y"]
    text = params["text"]
    output_path = params["output_path"]

    kwargs = {}
    if params.get("font_name") is not None:
        kwargs["font_name"] = params["font_name"]
    if params.get("font_size") is not None:
        kwargs["font_size"] = params["font_size"]
    if params.get("max_width") is not None:
        kwargs["max_width"] = params["max_width"]

    result = insert_text_block(pdf_path, page, x, y, text, output_path, **kwargs)
    return _serialize_edit_result(result)


def handle_batch_replace_block(params):
    pdf_path = params["pdf_path"]
    page_number = int(params["page_number"])
    output_path = params["output_path"]

    replacements = []
    for r in params["replacements"]:
        bbox = r["bbox"]
        bbox_tuple = (bbox["x0"], bbox["y0"], bbox["x1"], bbox["y1"])
        replacements.append((bbox_tuple, r["new_text"]))

    results = batch_replace_block(pdf_path, page_number, replacements, output_path)
    return {
        "results": [_serialize_edit_result(r) for r in results],
        "summary": {
            "total": len(results),
            "succeeded": sum(1 for r in results if r.success),
            "failed": sum(1 for r in results if not r.success),
        },
    }


def handle_delete_block(params):
    pdf_path = params["pdf_path"]
    page = int(params["page"])
    bbox = params["bbox"]
    bbox_tuple = (bbox["x0"], bbox["y0"], bbox["x1"], bbox["y1"])
    output_path = params["output_path"]
    close_gap = params.get("close_gap", True)

    result = delete_block(pdf_path, page, bbox_tuple, output_path, close_gap=close_gap)
    return _serialize_edit_result(result)


def handle_get_text_layout(params):
    pdf_path = params["pdf_path"]
    page = params.get("page", 0)
    blocks = get_text_layout(pdf_path, page=page)
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
                "page": b.page,
            }
            for b in blocks
        ]
    }


def handle_extract_bbox_text(params):
    pdf_path = params["pdf_path"]
    bbox = params["bbox"]
    bbox_tuple = (bbox["x0"], bbox["y0"], bbox["x1"], bbox["y1"])
    page = int(params["page"])
    tolerance = params.get("tolerance", 0.0)
    text = extract_bbox_text(pdf_path, bbox=bbox_tuple, page=page, tolerance=tolerance)
    return {"text": text}


def handle_detect_sections(params):
    """Universal section detection via font hierarchy — no text patterns."""
    from collections import Counter

    pdf_path = params["pdf_path"]
    page = params.get("page", 0)
    include_text = params.get("include_text", True)

    blocks = get_text_layout(pdf_path, page=page)
    all_visible = [b for b in blocks if b.text.strip()]
    if not all_visible:
        return {"sections": [], "body_font": None, "heading_fonts": []}

    # For font frequency, only count multi-char blocks (skip markers like • —)
    multi_char = [b for b in all_visible if len(b.text.strip()) > 1]
    if not multi_char:
        return {"sections": [], "body_font": None, "heading_fonts": []}

    # ── Step 1: Identify font hierarchy from frequency ───────────
    font_freq = Counter(
        (b.font_name, round(b.font_size, 1)) for b in multi_char
    )
    body_font, body_size = font_freq.most_common(1)[0][0]

    # Heading = non-body font names (or same font at different size)
    heading_font_names = {
        fn for fn, fs in font_freq if fn != body_font
    }
    # Fallback: single-font doc, use size differences
    if not heading_font_names:
        sizes = sorted(set(round(b.font_size, 1) for b in multi_char), reverse=True)
        if len(sizes) > 1:
            heading_font_names = {body_font}
        else:
            return {"sections": [], "body_font": body_font, "heading_fonts": []}

    page_x0 = min(b.x for b in all_visible)
    page_x1 = max(b.x + b.width for b in all_visible)
    MARGIN_TOL = 5.0

    # ── Step 2: Group heading-font blocks into visual lines ──────
    # Use all_visible (including single-char blocks) for title joining
    lines_by_y = {}
    for b in all_visible:
        if b.font_name in heading_font_names:
            y_key = round(b.y * 2) / 2
            lines_by_y.setdefault(y_key, []).append(b)

    heading_lines = []
    for y_key in sorted(lines_by_y.keys(), reverse=True):
        line_blocks = sorted(lines_by_y[y_key], key=lambda b: b.x)
        # Check margin using first multi-char block (skip lone markers)
        first_sig = next((b for b in line_blocks if len(b.text.strip()) > 1), None)
        if first_sig is None:
            continue
        if abs(first_sig.x - page_x0) > MARGIN_TOL:
            continue
        joined = "".join(b.text for b in line_blocks).strip()
        if not joined:
            continue
        font_size = round(line_blocks[0].font_size, 1)
        # Skip if this is body-font at body-size (only relevant in
        # single-font fallback where heading_font_names == {body_font}).
        # Use first multi-char block for font classification.
        sig_blocks = [b for b in line_blocks if len(b.text.strip()) > 1]
        if not sig_blocks:
            continue
        if sig_blocks[0].font_name == body_font and font_size <= body_size:
            continue
        heading_lines.append({
            "y": y_key, "title": joined,
            "font_name": line_blocks[0].font_name,
            "font_size": font_size,
        })

    if not heading_lines:
        return {
            "sections": [],
            "body_font": body_font,
            "heading_fonts": list(heading_font_names),
        }

    # ── Step 3: Assign hierarchy levels by font size ─────────────
    distinct_sizes = sorted(
        set(h["font_size"] for h in heading_lines), reverse=True
    )
    size_to_level = {s: i for i, s in enumerate(distinct_sizes)}
    for h in heading_lines:
        h["level"] = size_to_level[h["font_size"]]

    # ── Step 4: Build tree + compute bboxes ──────────────────────
    # Bbox rules:
    #   y1 (top) = heading_y + font_size + 0.5
    #   y0 (bottom) = next same-or-higher-level heading's (y + font_size + 0.5)
    #   If last section, y0 = minimum y of any visible block on page
    #   x0/x1 = page-wide
    page_bottom = min(b.y for b in all_visible) - 1.0

    sections = []
    for i, h in enumerate(heading_lines):
        y1 = h["y"] + h["font_size"] + 0.5
        # Find next heading at same or higher (lower number) level
        y0 = page_bottom
        for j in range(i + 1, len(heading_lines)):
            if heading_lines[j]["level"] <= h["level"]:
                nxt = heading_lines[j]
                y0 = nxt["y"] + nxt["font_size"] + 0.5
                break

        bbox = {"x0": page_x0, "y0": y0, "x1": page_x1, "y1": y1}

        section = {
            "title": h["title"],
            "level": h["level"],
            "bbox": bbox,
            "font_name": h["font_name"],
            "font_size": h["font_size"],
            "page": page,
        }

        if include_text:
            try:
                section["text"] = extract_bbox_text(
                    pdf_path,
                    bbox=(bbox["x0"], bbox["y0"], bbox["x1"], bbox["y1"]),
                    page=page,
                    tolerance=0,
                )
            except Exception:
                section["text"] = ""

        sections.append(section)

    # ── Step 5: Nest children under parents ──────────────────────
    # Level 0 sections contain level 1+ sections whose bbox is inside
    top_level = [s for s in sections if s["level"] == 0]
    for parent in top_level:
        parent["children"] = [
            s for s in sections
            if s["level"] > parent["level"]
            and s["bbox"]["y0"] >= parent["bbox"]["y0"]
            and s["bbox"]["y1"] <= parent["bbox"]["y1"]
        ]

    return {
        "sections": top_level if top_level else sections,
        "body_font": body_font,
        "heading_fonts": list(heading_font_names),
    }


def _get_link_annotations_in_bbox(pdf_path, page, bbox):
    """Get Link annotations whose CENTER is within a bbox."""
    annots = get_annotations(pdf_path, page=page)
    result = []
    for a in annots:
        if a.subtype != "Link" or not a.uri:
            continue
        # Use center-point containment (not overlap) to avoid boundary bleed
        cy = (a.rect[1] + a.rect[3]) / 2
        cx = (a.rect[0] + a.rect[2]) / 2
        if (bbox["y0"] < cy < bbox["y1"] and bbox["x0"] < cx < bbox["x1"]):
            result.append({"rect": a.rect, "uri": a.uri})
    return result


def _transfer_annotations(output_path, page, bbox_a, bbox_b, annots_a, annots_b):
    """Remove annotations in both bboxes, re-add them at swapped positions."""
    y_offset = bbox_a["y1"] - bbox_b["y1"]  # b→a: shift up by this

    with pikepdf.open(output_path, allow_overwriting_input=True) as pdf:
        page_obj = pdf.pages[page]
        annots_key = pikepdf.Name("/Annots")
        rect_key = pikepdf.Name("/Rect")

        # Step 1: Remove annotations whose center is in either section bbox
        if annots_key in page_obj:
            kept = []
            for annot_ref in list(page_obj[annots_key]):
                remove = False
                try:
                    annot = annot_ref
                    if hasattr(annot, "resolve"):
                        annot = annot.resolve()
                    if isinstance(annot, pikepdf.Dictionary) and rect_key in annot:
                        r = annot[rect_key]
                        cy = (float(r[1]) + float(r[3])) / 2
                        cx = (float(r[0]) + float(r[2])) / 2
                        in_a = (bbox_a["y0"] < cy < bbox_a["y1"]
                                and bbox_a["x0"] < cx < bbox_a["x1"])
                        in_b = (bbox_b["y0"] < cy < bbox_b["y1"]
                                and bbox_b["x0"] < cx < bbox_b["x1"])
                        remove = in_a or in_b
                except Exception as e:
                    print(f"Annotation removal skip: {e}", file=sys.stderr)
                if not remove:
                    kept.append(annot_ref)
            page_obj[annots_key] = pikepdf.Array(kept) if kept else pikepdf.Array()

        # Step 2: Re-add saved annotations at swapped positions
        if annots_key not in page_obj:
            page_obj[annots_key] = pikepdf.Array()

        def _make_link(rect_tuple, uri):
            action = pikepdf.Dictionary({
                "/S": pikepdf.Name("/URI"),
                "/URI": pikepdf.String(uri),
            })
            return pdf.make_indirect(pikepdf.Dictionary({
                "/Type": pikepdf.Name("/Annot"),
                "/Subtype": pikepdf.Name("/Link"),
                "/Rect": pikepdf.Array([float(v) for v in rect_tuple]),
                "/Border": pikepdf.Array([0, 0, 0]),
                "/A": action,
            }))

        # annots_a (from bbox_a) → go to bbox_b position: shift down
        for a in annots_a:
            new_rect = (a["rect"][0], a["rect"][1] - y_offset,
                        a["rect"][2], a["rect"][3] - y_offset)
            page_obj[annots_key].append(_make_link(new_rect, a["uri"]))

        # annots_b (from bbox_b) → go to bbox_a position: shift up
        for a in annots_b:
            new_rect = (a["rect"][0], a["rect"][1] + y_offset,
                        a["rect"][2], a["rect"][3] + y_offset)
            page_obj[annots_key].append(_make_link(new_rect, a["uri"]))

        pdf.save(output_path)


def handle_swap_sections(params):
    """Swap two sections by name — detects structure, finds siblings, swaps."""
    pdf_path = params["pdf_path"]
    section_a = params["section_a"]
    section_b = params["section_b"]
    output_path = params["output_path"]
    page = params.get("page", 0)

    # Detect sections
    det = handle_detect_sections({
        "pdf_path": pdf_path, "page": page, "include_text": True,
    })

    # Flatten section tree
    all_secs = []
    for s in det["sections"]:
        all_secs.append(s)
        for c in s.get("children", []):
            all_secs.append(c)

    if not all_secs:
        raise PDFEditError("No sections detected in the document")

    # Fuzzy-match by title
    def find_sec(name):
        low = name.lower()
        return next((s for s in all_secs if low in s["title"].lower()), None)

    match_a = find_sec(section_a)
    match_b = find_sec(section_b)
    if not match_a:
        titles = [s["title"][:40] for s in all_secs]
        raise PDFEditError(f"Section '{section_a}' not found. Available: {titles}")
    if not match_b:
        titles = [s["title"][:40] for s in all_secs]
        raise PDFEditError(f"Section '{section_b}' not found. Available: {titles}")
    if match_a is match_b:
        raise PDFEditError(f"Both names match the same section: '{match_a['title'][:50]}'")

    # Find the nearest containing section (one level up) by bbox geometry
    target_level = match_a["level"]
    container = next(
        (s for s in all_secs
         if s["level"] == target_level - 1
         and match_a["bbox"]["y0"] >= s["bbox"]["y0"]
         and match_a["bbox"]["y1"] <= s["bbox"]["y1"]
         and match_b["bbox"]["y0"] >= s["bbox"]["y0"]
         and match_b["bbox"]["y1"] <= s["bbox"]["y1"]),
        None,
    )

    # Siblings = same-level sections within the container's bbox
    if container:
        siblings = [
            s for s in all_secs
            if s["level"] == target_level
            and s["bbox"]["y0"] >= container["bbox"]["y0"]
            and s["bbox"]["y1"] <= container["bbox"]["y1"]
        ]
    else:
        siblings = [s for s in all_secs if s["level"] == target_level]

    # Save annotations from ALL sibling sections BEFORE the swap
    # (engine's _sync_annotations_in_bbox may remove them during batch_replace_block)
    saved_annots = {}  # title → list of {rect, uri}
    for sib in siblings:
        saved_annots[sib["title"]] = _get_link_annotations_in_bbox(
            pdf_path, page, sib["bbox"]
        )
    annots_a = saved_annots.get(match_a["title"], [])
    annots_b = saved_annots.get(match_b["title"], [])

    # Build replacements: swap a↔b, keep rest unchanged
    replacements = []
    for sib in siblings:
        if sib["title"] == match_a["title"]:
            replacements.append({"bbox": sib["bbox"], "new_text": match_b["text"]})
        elif sib["title"] == match_b["title"]:
            replacements.append({"bbox": sib["bbox"], "new_text": match_a["text"]})
        else:
            replacements.append({"bbox": sib["bbox"], "new_text": sib["text"]})

    result = handle_batch_replace_block({
        "pdf_path": pdf_path, "page_number": page,
        "replacements": replacements, "output_path": output_path,
    })

    # Restore all annotations: swap pair at swapped positions, siblings at original
    total_annots = sum(len(v) for v in saved_annots.values())
    if total_annots > 0:
        y_offset = match_a["bbox"]["y1"] - match_b["bbox"]["y1"]

        with pikepdf.open(output_path, allow_overwriting_input=True) as pdf:
            page_obj = pdf.pages[page]
            annots_key = pikepdf.Name("/Annots")
            rect_key = pikepdf.Name("/Rect")

            # Remove all annotations in ALL sibling bboxes (clean slate)
            if annots_key in page_obj:
                kept = []
                for annot_ref in list(page_obj[annots_key]):
                    remove = False
                    try:
                        annot = annot_ref
                        if hasattr(annot, "resolve"):
                            annot = annot.resolve()
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

            # Re-add all saved annotations at correct positions
            if annots_key not in page_obj:
                page_obj[annots_key] = pikepdf.Array()

            def _make_link(rect_tuple, uri):
                action = pikepdf.Dictionary({
                    "/S": pikepdf.Name("/URI"),
                    "/URI": pikepdf.String(uri),
                })
                return pdf.make_indirect(pikepdf.Dictionary({
                    "/Type": pikepdf.Name("/Annot"),
                    "/Subtype": pikepdf.Name("/Link"),
                    "/Rect": pikepdf.Array([float(v) for v in rect_tuple]),
                    "/Border": pikepdf.Array([0, 0, 0]),
                    "/A": action,
                }))

            for sib in siblings:
                annots_for_sib = saved_annots.get(sib["title"], [])
                for a in annots_for_sib:
                    if sib["title"] == match_a["title"]:
                        # a's annotations go to b's position
                        new_rect = (a["rect"][0], a["rect"][1] - y_offset,
                                    a["rect"][2], a["rect"][3] - y_offset)
                    elif sib["title"] == match_b["title"]:
                        # b's annotations go to a's position
                        new_rect = (a["rect"][0], a["rect"][1] + y_offset,
                                    a["rect"][2], a["rect"][3] + y_offset)
                    else:
                        # Unchanged siblings: restore at original position
                        new_rect = a["rect"]
                    page_obj[annots_key].append(_make_link(new_rect, a["uri"]))

            pdf.save(output_path)

    return {
        "success": all(r["success"] for r in result["results"]),
        "swapped": [match_a["title"][:50], match_b["title"][:50]],
        "siblings_rerendered": len(siblings),
        "annotations_transferred": total_annots,
        "output_path": output_path,
    }


def handle_replace_section(params):
    """Replace one section's content by name — re-renders all siblings."""
    pdf_path = params["pdf_path"]
    section_name = params["section"]
    new_text = params["new_text"]
    output_path = params["output_path"]
    page = params.get("page", 0)

    det = handle_detect_sections({
        "pdf_path": pdf_path, "page": page, "include_text": True,
    })

    all_secs = []
    for s in det["sections"]:
        all_secs.append(s)
        for c in s.get("children", []):
            all_secs.append(c)

    if not all_secs:
        raise PDFEditError("No sections detected in the document")

    low = section_name.lower()
    match = next((s for s in all_secs if low in s["title"].lower()), None)
    if not match:
        titles = [s["title"][:40] for s in all_secs]
        raise PDFEditError(f"Section '{section_name}' not found. Available: {titles}")

    # Find the nearest containing section (one level up) by bbox geometry
    target_level = match["level"]
    container = next(
        (s for s in all_secs
         if s["level"] == target_level - 1
         and match["bbox"]["y0"] >= s["bbox"]["y0"]
         and match["bbox"]["y1"] <= s["bbox"]["y1"]),
        None,
    )

    if container:
        siblings = [
            s for s in all_secs
            if s["level"] == target_level
            and s["bbox"]["y0"] >= container["bbox"]["y0"]
            and s["bbox"]["y1"] <= container["bbox"]["y1"]
        ]
    else:
        siblings = [s for s in all_secs if s["level"] == target_level]

    # Build replacements: target gets new text, siblings keep original
    replacements = []
    for sib in siblings:
        if sib["title"] == match["title"]:
            replacements.append({"bbox": sib["bbox"], "new_text": new_text})
        else:
            replacements.append({"bbox": sib["bbox"], "new_text": sib["text"]})

    result = handle_batch_replace_block({
        "pdf_path": pdf_path, "page_number": page,
        "replacements": replacements, "output_path": output_path,
    })

    return {
        "success": all(r["success"] for r in result["results"]),
        "replaced": match["title"][:50],
        "siblings_rerendered": len(siblings),
        "output_path": output_path,
    }


# ── Wrapper handlers (15 document operations) ────────────────────────

def handle_merge(params):
    result = merge_pdfs(params["pdf_paths"], params["output_path"])
    return {"output_path": result}


def handle_split(params):
    pages = split_pdf(params["pdf_path"], params["output_dir"])
    return {"page_paths": pages}


def handle_reorder_pages(params):
    result = reorder_pages(
        params["pdf_path"], params["page_order"], params["output_path"]
    )
    return {"output_path": result}


def handle_rotate_pages(params):
    result = rotate_pages(
        params["pdf_path"], params["pages"], params["angle"], params["output_path"]
    )
    return {"output_path": result}


def handle_delete_pages(params):
    result = delete_pages(
        params["pdf_path"], params["pages"], params["output_path"]
    )
    return {"output_path": result}


def handle_crop_pages(params):
    box = params["box"]
    result = crop_pages(
        params["pdf_path"],
        (box["x0"], box["y0"], box["x1"], box["y1"]),
        params["output_path"],
    )
    return {"output_path": result}


def handle_edit_metadata(params):
    result = edit_metadata(
        params["pdf_path"], params["metadata"], params["output_path"]
    )
    return {"output_path": result}


def handle_add_bookmark(params):
    result = add_bookmark(
        params["pdf_path"], params["title"], params["page"], params["output_path"]
    )
    return {"output_path": result}


def handle_encrypt(params):
    result = encrypt_pdf(
        params["pdf_path"],
        params["owner_password"],
        params["user_password"],
        params["output_path"],
    )
    return {"output_path": result}


def handle_decrypt(params):
    result = decrypt_pdf(
        params["pdf_path"], params["password"], params["output_path"]
    )
    return {"output_path": result}


def handle_add_hyperlink(params):
    bbox = params["bbox"]
    result = add_hyperlink(
        params["pdf_path"],
        params["page"],
        (bbox["x0"], bbox["y0"], bbox["x1"], bbox["y1"]),
        params["uri"],
        params["output_path"],
    )
    return {"output_path": result}


def handle_add_highlight(params):
    result = add_highlight(
        params["pdf_path"],
        params["page"],
        params["quad_points"],
        params["output_path"],
    )
    return {"output_path": result}


def handle_flatten_annotations(params):
    result = flatten_annotations(params["pdf_path"], params["output_path"])
    return {"output_path": result}


def handle_fill_form(params):
    result = fill_form(
        params["pdf_path"], params["field_values"], params["output_path"]
    )
    return {"output_path": result}


def handle_add_watermark(params):
    result = add_watermark(
        params["pdf_path"], params["watermark_path"], params["output_path"]
    )
    return {"output_path": result}


# ── Annotation handlers (engine API) ─────────────────────────────────

def handle_get_annotations(params):
    pdf_path = params["pdf_path"]
    page = params.get("page")
    annots = get_annotations(pdf_path, page=page)
    return {
        "annotations": [
            {
                "index": a.index,
                "page": a.page,
                "subtype": a.subtype,
                "rect": {
                    "x0": a.rect[0], "y0": a.rect[1],
                    "x1": a.rect[2], "y1": a.rect[3],
                },
                "uri": a.uri,
                "text": a.text,
            }
            for a in annots
        ]
    }


def handle_add_annotation(params):
    rect = params["rect"]
    add_annotation(
        params["pdf_path"],
        params["page"],
        (rect["x0"], rect["y0"], rect["x1"], rect["y1"]),
        params["uri"],
        params["output_path"],
        border_style=params.get("border_style", "none"),
    )
    return {"success": True, "output_path": params["output_path"]}


def handle_delete_annotation_engine(params):
    pdf_path = params["pdf_path"]
    page = params["page"]
    index = params["annotation_index"]
    annots = get_annotations(pdf_path, page=page)
    if index < 0 or index >= len(annots):
        raise PDFEditError(
            f"Annotation index {index} out of range (page has {len(annots)})"
        )
    engine_delete_annotation(pdf_path, annots[index], params["output_path"])
    return {"success": True, "output_path": params["output_path"]}


def handle_move_annotation(params):
    pdf_path = params["pdf_path"]
    page = params["page"]
    index = params["annotation_index"]
    new_rect = params["new_rect"]
    annots = get_annotations(pdf_path, page=page)
    if index < 0 or index >= len(annots):
        raise PDFEditError(
            f"Annotation index {index} out of range (page has {len(annots)})"
        )
    move_annotation(
        pdf_path,
        annots[index],
        (new_rect["x0"], new_rect["y0"], new_rect["x1"], new_rect["y1"]),
        params["output_path"],
    )
    return {"success": True, "output_path": params["output_path"]}


# ── Dispatch table ────────────────────────────────────────────────────

METHODS = {
    "get_text": handle_get_text,
    "find_text": handle_find_text,
    "replace_text": handle_replace_text,
    "batch_replace": handle_batch_replace,
    "get_fonts": handle_get_fonts,
    "detect_paragraphs": handle_detect_paragraphs,
    "analyze_subset": handle_analyze_subset,
    "replace_single": handle_replace_single,
    "inspect": handle_inspect,
    "update_annotation": handle_update_annotation,
    "replace_block": handle_replace_block,
    "batch_replace_block": handle_batch_replace_block,
    "insert_text_block": handle_insert_text_block,
    "delete_block": handle_delete_block,
    "get_text_layout": handle_get_text_layout,
    "extract_bbox_text": handle_extract_bbox_text,
    "detect_sections": handle_detect_sections,
    "swap_sections": handle_swap_sections,
    "replace_section": handle_replace_section,
    # Wrapper operations
    "merge": handle_merge,
    "split": handle_split,
    "reorder_pages": handle_reorder_pages,
    "rotate_pages": handle_rotate_pages,
    "delete_pages": handle_delete_pages,
    "crop_pages": handle_crop_pages,
    "edit_metadata": handle_edit_metadata,
    "add_bookmark": handle_add_bookmark,
    "encrypt": handle_encrypt,
    "decrypt": handle_decrypt,
    "add_hyperlink": handle_add_hyperlink,
    "add_highlight": handle_add_highlight,
    "flatten_annotations": handle_flatten_annotations,
    "fill_form": handle_fill_form,
    "add_watermark": handle_add_watermark,
    # Annotation operations (engine API)
    "get_annotations": handle_get_annotations,
    "add_annotation": handle_add_annotation,
    "delete_annotation_v2": handle_delete_annotation_engine,
    "move_annotation": handle_move_annotation,
}


# ── Main loop ─────────────────────────────────────────────────────────

def main():
    print("ready", file=sys.stderr, flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            respond_error(None, -32700, f"Parse error: {e}")
            continue

        req_id = request.get("id")
        method = request.get("method")

        if method not in METHODS:
            respond_error(req_id, -32601, f"Method not found: {method}")
            continue

        try:
            result = METHODS[method](request.get("params", {}))
            respond_success(req_id, result)
        except (PDFEditError, FontNotFoundError) as e:
            respond_error(req_id, -32000, f"{type(e).__name__}: {e}")
        except FileNotFoundError as e:
            respond_error(req_id, -32000, f"File not found: {e}")
        except Exception as e:
            print(f"Unexpected error: {type(e).__name__}: {e}", file=sys.stderr)
            respond_error(req_id, -32603, f"Internal error: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
