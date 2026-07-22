# pdf-edit-mcp

> 💼 Available for freelance MCP/AI integration work — DM [@aryansalian03](https://x.com/aryansalian03) or via [aryanbv.com](https://aryanbv.com)

MCP server for editing text in existing PDFs through content-stream surgery. Targets fidelity preservation (original font, exact position, in-place operators) and reports — honestly — when fidelity has to break.

[![PyPI version](https://img.shields.io/pypi/v/pdf-edit-mcp)](https://pypi.org/project/pdf-edit-mcp/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/AryanBV/pdf-edit-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/AryanBV/pdf-edit-mcp/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/python-%3E%3D3.10-blue)

> **v0.2.0 is a native Python (FastMCP) server.** Earlier 0.1.x releases were a TypeScript MCP server that shelled out to a Python `bridge.py`; v0.2.0 imports the engine in-process — **one runtime, no Node.js**, distributed on PyPI. See [Migrating from 0.1.x](#migrating-from-01x-npm).

## How it works

Most PDF editors use a redact-and-replace approach — they white out the original text and stamp new text on top, usually with a substitute font. The result looks different from the original.

pdf-edit-mcp takes a different approach. It modifies the original PDF content stream operators directly, preserving the exact font, size, color, and position of the text being edited — when the embedded font already contains the glyphs you need.

| | Traditional approach | pdf-edit-mcp |
|---|---|---|
| **Method** | Redact old text, stamp new text | Modify content stream operators in place |
| **Font** | Substituted (often Helvetica) | Original font when possible; metric-equivalent fallback (e.g. Carlito for Calibri) when not |
| **Position** | Re-calculated | Exact original coordinates |
| **Quality feedback** | None | FidelityReport on every edit (`font_preserved`, `font_substituted`, `glyphs_missing`, `overflow_detected`, typed `degradations`) |

Powered by [pdf-edit-engine](https://github.com/AryanBV/pdf-edit-engine) — a Python library for PDF content stream surgery with in-place font subset extension.

## When fidelity is exact, and when it isn't

This matters more than the headline claim. Every edit's fidelity report tells you which tier fired:

- **Tier 1 — exact** (`font_preserved=true`, `font_substituted=null`): the embedded font already had every glyph the replacement needs. Output is byte-identical at the operator layer.
- **Tier 1.5 — in-place injection** (`font_preserved=true`): the glyph wasn't embedded but was in your system font with matching `unitsPerEm`. Original CIDs are preserved; only new glyphs are appended. Visually indistinguishable from Tier 1. Covers TrueType (`glyf`) **and**, as of engine v0.2.0, CID-keyed (Type0) CFF / Type1C fonts.
- **Metric-equivalent fallback** (`font_preserved=false`, `font_substituted="Carlito-Regular"` or similar): the original font isn't installed, so an open-source font with matching metrics is used for the new glyphs. Very close, spacing correct, not pixel-perfect.

What still refuses honestly (a typed `font_extension_failed` / clear error rather than silent corruption):

- CFF shapes the injector doesn't cover — simple-font (non-CID) CFF, CFF2, name-keyed CFF, multi-FD CID, composite donors.
- Type 3 (procedural) fonts.
- `unitsPerEm` mismatch between embedded and system font (rescaling out of scope).
- A replacement wider than the bbox with no room to reflow (`overflow_detected=true` + a warning).
- Multi-codepoint emoji / scripts your system fonts don't carry (`glyphs_missing`).

Run `pdf_analyze_subset` first if you need to know the tier up front.

## Features

- **38 tools** across 7 categories (reading, text editing, block ops, section ops, annotations, document manipulation, metadata & security) + **3 built-in MCP prompts** that guide the editing workflow.
- **Edit encrypted PDFs** — pass `password=` to the read/edit tools to work on a password-protected PDF; the output is **re-encrypted** with the same password (engine A2.3).
- **Shrink-to-fit** — `fit="shrink"` on `pdf_replace_block` / `pdf_batch_replace_block` shrinks the font to fit a fixed-height region (engine E.8).
- **Fidelity reporting** on every edit: `font_preserved`, `font_substituted`, `overflow_detected`, `reflow_applied`, `glyphs_missing`, a `warnings` list, and a typed `degradations` array (30 engine degradation kinds, each `{kind, detail, severity}`) so callers can gate on quality.
- **`dry_run` preview** on `pdf_replace_text` / `pdf_replace_single` / `pdf_batch_replace` — get the fidelity report without writing the output.
- **Per-page filtering** on `pdf_find_text` / `pdf_get_text` / `pdf_get_fonts`.
- **Batch operations** — up to 500 find-and-replace edits per call, up to 50 block replacements per page, with output auto-verification on `pdf_batch_replace`.
- **Section intelligence** — detects structure by font hierarchy, swaps sections by fuzzy title match and **refuses ambiguous matches** rather than silently picking the first.
- **Atomic write** — `pdf_swap_sections` writes to a temp file and renames only on full success; a failure leaves your output path untouched.
- **Engine-version gate at startup** — refuses to serve against `pdf-edit-engine < 0.2.0`, so missing fidelity fields can't masquerade as `null`.
- **Path-safety boundary** — every path is validated (absolute, `.pdf`, no `..` traversal, no control chars, no Windows reserved/truncated basenames) before reaching the engine.
- **Runs entirely local** — no external APIs, no network calls, no API keys.

## Quick Start

### Prerequisites

- **Python** 3.10+ (3.12 recommended).
- That's it — [`pdf-edit-engine`](https://pypi.org/project/pdf-edit-engine/) installs automatically as a dependency. (`uvx` fetches everything on first run; no manual install.)

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pdf-edit": {
      "command": "uvx",
      "args": ["pdf-edit-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add pdf-edit -- uvx pdf-edit-mcp
```

### Other MCP clients (Cursor, Windsurf, etc.)

Run via `uvx pdf-edit-mcp`, or install it and use the console script:

```bash
pip install pdf-edit-mcp
pdf-edit-mcp          # or: python -m pdf_edit_mcp
```

## Tools

### Reading & Analysis

| Tool | Description |
|------|-------------|
| `pdf_inspect` | Complete document overview — text, fonts, paragraphs, annotations in one call. Start here before editing. |
| `pdf_get_text` | Extract all text from a PDF |
| `pdf_find_text` | Find all occurrences of a string with page numbers and bounding box positions |
| `pdf_get_fonts` | List fonts with encoding type, glyph count, PostScript name, subset status |
| `pdf_get_text_layout` | Get every text block with exact position, font, and size |
| `pdf_extract_bbox_text` | Extract text from a bounding box region with gap-aware joining |
| `pdf_detect_paragraphs` | Detect paragraph boundaries with bounding boxes on a page |
| `pdf_detect_sections` | Analyze document structure — section tree with titles, bounding boxes, and text |
| `pdf_analyze_subset` | Check if an embedded font can render specific characters before editing |

### Text Editing

| Tool | Description |
|------|-------------|
| `pdf_replace_text` | Replace all occurrences of a string (names, dates, typos, labels) |
| `pdf_replace_single` | Replace one specific occurrence by match index |
| `pdf_batch_replace` | Multiple find-and-replace edits in one atomic operation (up to 500 edits) |

### Block Operations

| Tool | Description |
|------|-------------|
| `pdf_replace_block` | Replace all content within a bounding box with new text (`fit="shrink"` to shrink-to-fit) |
| `pdf_batch_replace_block` | Replace content in multiple bounding boxes atomically |
| `pdf_insert_text_block` | Insert text at a position |
| `pdf_delete_block` | Delete content in a bounding box, optionally close the gap |

### Section Operations

| Tool | Description |
|------|-------------|
| `pdf_swap_sections` | Swap two sections by fuzzy title match — re-renders all siblings for uniform spacing |
| `pdf_replace_section` | Replace a section's entire content by fuzzy title match |

### Annotations & Links

| Tool | Description |
|------|-------------|
| `pdf_get_annotations` | List all annotations with positions, types, and URLs |
| `pdf_add_annotation` | Add a link annotation at a position on a page |
| `pdf_update_annotation` | Update a link annotation's target URL |
| `pdf_delete_annotation_v2` | Delete an annotation by page and index |
| `pdf_move_annotation` | Move an annotation to a new position |
| `pdf_add_hyperlink` | Add a clickable hyperlink to a page region |
| `pdf_add_highlight` | Add a highlight annotation with QuadPoints |
| `pdf_flatten_annotations` | Flatten all annotations into page content (non-editable) |

### Document Manipulation

| Tool | Description |
|------|-------------|
| `pdf_merge` | Merge multiple PDFs into one document |
| `pdf_split` | Split a PDF into individual page files |
| `pdf_reorder_pages` | Reorder pages by 0-indexed page number array |
| `pdf_rotate_pages` | Rotate pages by 90, 180, or 270 degrees |
| `pdf_delete_pages` | Delete specific pages (0-indexed) |
| `pdf_crop_pages` | Crop all pages to a bounding box |
| `pdf_add_watermark` | Overlay a watermark PDF on all pages |

### Metadata & Security

| Tool | Description |
|------|-------------|
| `pdf_edit_metadata` | Edit title, author, subject, creator, producer |
| `pdf_add_bookmark` | Add a navigation bookmark pointing to a page |
| `pdf_encrypt` | Encrypt with owner and user passwords |
| `pdf_decrypt` | Decrypt a password-protected PDF |
| `pdf_fill_form` | Fill form fields by name-value pairs |

## Workflows

Three built-in MCP prompts guide the editing process: **`comprehensive-pdf-edit`** (structural changes — inspect → understand structure → pre-check → execute → verify), **`section-swap`** (swap two sections, re-rendering all siblings for uniform spacing), and **`quick-pdf-edit`** (simple typo/date/name changes with a fidelity check).

## Architecture

```
AI Agent (Claude, GPT, etc.)
    ↓  MCP protocol (stdio)
pdf_edit_mcp — Python FastMCP server (this package)
    ↓  in-process import
pdf-edit-engine — Python library (pikepdf + fonttools + pdfminer)
```

- Single process: the engine is imported directly — no subprocess, no JSON-RPC bridge, no Node.js.
- Inputs are validated by Pydantic models (path safety, bounds, strict object shapes) before reaching the engine.
- Engine calls are serialized under a lock (the engine is not thread-safe) and `PDFEditError`s are translated to clean tool errors with recovery hints.
- `stdout` is the MCP transport — all diagnostics go to `stderr`.

Layout: `server.py` (entry + version gate), `app.py` (FastMCP instance + lock), `validation.py`, `serialize.py`, `_runtime.py`, and `tools_*.py` / `prompts.py` (the tool + prompt surface).

## Limitations

- **Cross-page reflow** — text expanding past a page boundary is not redistributed (`overflow_detected=true` + a warning).
- **Some CFF shapes** — CID-keyed (Type0) CFF/Type1C is supported; simple-font CFF, CFF2, name-keyed CFF, multi-FD CID, and composite donors refuse honestly (`font_extension_failed`).
- **`unitsPerEm` mismatch** between embedded and system font — out of scope; refuses rather than distort.
- **Image editing / table semantics** — text-only.
- **Right-to-left / complex-script shaping** — bidi reordering is not handled; CJK line-breaking is supported (engine E.7).
- **Multi-codepoint emoji** not in your system fonts — recorded as `glyphs_missing`.

## Errors

Engine failures surface as MCP tool errors (`isError`) carrying a classified message **and a recovery hint** — for example:

- `OperatorError` → *"TextMatch is stale — re-run pdf_find_text and retry."*
- `EncodingError` → *"…run pdf_analyze_subset to check coverage."*
- `ReflowError` → *"Replacement may be too wide — try shorter text or a different bbox."*
- `FontNotFoundError` → *"Run pdf_get_fonts, or install the required font / accept a fallback."*

Raw pikepdf exceptions (e.g. on an encrypted PDF opened without a password) are never leaked — you get a clean "password-protected" message instead.

## Migrating from 0.1.x (npm)

The 0.1.x npm package `@aryanbv/pdf-edit-mcp` is deprecated. Replace the npm/`npx` launch config with the `uvx` config above. The tool names, inputs, and outputs are unchanged, so prompts and integrations keep working; you no longer need Node.js, and the `PDF_EDIT_PYTHON` env var is gone (the engine runs in-process).

## Development

```bash
git clone https://github.com/AryanBV/pdf-edit-mcp.git
cd pdf-edit-mcp
python -m venv .venv && . .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

```bash
ruff check src/ tests/        # lint
mypy src/pdf_edit_mcp         # type-check (strict)
pytest tests/ -q              # tests (fixtures auto-generated via reportlab)
```

## License

[MIT](LICENSE)
