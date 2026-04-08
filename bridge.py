#!/usr/bin/env python3
"""JSON-RPC 2.0 bridge between TypeScript MCP server and pdf-edit-engine.

Reads JSON-RPC requests from stdin (one per line), dispatches to
pdf-edit-engine functions, writes JSON-RPC responses to stdout.

CRITICAL: stdout is the IPC channel. NEVER use print() — all logging
goes to stderr. Responses use _stdout.write() exclusively.
"""

import json
import sys

# Save original stdout BEFORE any imports that might print
_stdout = sys.stdout
sys.stdout = sys.stderr  # Redirect accidental prints to stderr

try:
    import pikepdf
    from pdf_edit_engine import (
        find,
        replace,
        get_text,
        get_fonts,
        replace_all,
        batch_replace,
        detect_paragraphs,
        analyze_subset,
        Edit,
    )
    from pdf_edit_engine.errors import PDFEditError, FontNotFoundError
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
    return {
        "results": mapped,
        "summary": {
            "total": len(results),
            "succeeded": succeeded,
            "failed": len(results) - succeeded,
        },
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
