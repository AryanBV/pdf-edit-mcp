# pdf-edit-mcp

MCP server for editing text in existing PDFs through content-stream surgery. Targets fidelity preservation (original font, exact position, in-place operators) and reports — honestly — when fidelity has to break.

[![npm version](https://img.shields.io/npm/v/@aryanbv/pdf-edit-mcp)](https://www.npmjs.com/package/@aryanbv/pdf-edit-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/AryanBV/pdf-edit-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/AryanBV/pdf-edit-mcp/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Python](https://img.shields.io/badge/python-%3E%3D3.12-blue)

## How it works

Most PDF editors use a redact-and-replace approach — they white out the original text and stamp new text on top, usually with a substitute font. The result looks different from the original.

pdf-edit-mcp takes a different approach. It modifies the original PDF content stream operators directly, preserving the exact font, size, color, and position of the text being edited — when the embedded font already contains the glyphs you need.

| | Traditional approach | pdf-edit-mcp |
|---|---|---|
| **Method** | Redact old text, stamp new text | Modify content stream operators in place |
| **Font** | Substituted (often Helvetica) | Original font when possible; metric-equivalent fallback (e.g. Carlito for Calibri) when not |
| **Position** | Re-calculated | Exact original coordinates |
| **Quality feedback** | None | FidelityReport on every edit (font_substituted, glyphs_missing, overflow_detected, warnings) |

Powered by [pdf-edit-engine](https://github.com/AryanBV/pdf-edit-engine) — a Python library for PDF content stream surgery with two-tier font subset extension.

## When fidelity is exact, and when it isn't

This matters more than the headline claim. The engine has three fidelity tiers, and every edit's `FidelityReport` tells you which one fired:

- **Tier 1 — exact** (`font_preserved=true`, `font_substituted=null`): the embedded font already had every glyph the replacement needs. Output is byte-identical at the operator layer.
- **Tier 1.5 — in-place injection** (`font_preserved=true`, glyph appended to embedded font): glyph wasn't in the embedded font but was in your system font with the same `unitsPerEm`. The original CIDs are preserved; only new glyphs are appended at fresh GIDs. Visual: indistinguishable from Tier 1.
- **Metric-equivalent fallback** (`font_preserved=false`, `font_substituted="Carlito-Regular"` or similar): the original font isn't installed system-wide, so an open-source font with matching metrics substitutes for the new glyphs. Visual: very close but not pixel-perfect; spacing is right because metrics match.

What straight-up fails (the engine raises, the MCP returns a structured error):
- The font is CFF / Type 1 / Type 3 (`FontNotFoundError` — TrueType only for Tier 1.5 today).
- The `unitsPerEm` of the system font differs from the embedded font (rescaling out of scope).
- The replacement is wider than the available bbox AND there's no room to reflow downward (`OverflowError` surfaced via `EditResult.warnings`).
- Multi-codepoint emoji or scripts the system fonts don't carry.

If you need fidelity guarantees for a specific PDF, run `pdf_analyze_subset` first to see what tier you'll land in.

## Features

- **38 tools** across 7 categories (reading, text editing, block ops, section ops, annotations, document manipulation, metadata & security)
- **3 built-in MCP prompts** that guide the editing workflow step by step
- **Fidelity reporting** on every edit: `font_preserved`, `font_substituted`, `overflow_detected`, `reflow_applied`, `glyphs_missing`, plus a `warnings` list (auto-includes overflow notices)
- **`dry_run` preview** on `pdf_replace_text`, `pdf_replace_single`, `pdf_batch_replace` — return the FidelityReport without writing the output PDF, so you can verify font/glyph coverage before committing
- **Per-page filtering** on `pdf_find_text`, `pdf_get_text`, `pdf_get_fonts` — restrict reads to a single 0-indexed page on multi-page PDFs
- **Layout overrides** on `pdf_replace_block` and `pdf_batch_replace_block` — explicit `line_height` and `section_gap` for uniform spacing across sibling sections
- **Batch operations** — up to 500 find-and-replace edits per call, up to 50 block replacements per page, with auto-verification on the output
- **Section intelligence** — detects document structure by font hierarchy, swaps sections by fuzzy title match (raises on ambiguous match rather than silently picking)
- **Atomic write** — section-swap operations write to a temp file and rename only on full success; failures leave your output path untouched
- **Engine-version pin enforced at startup** — bridge hard-fails if `pdf-edit-engine < 0.1.3` is installed, so missing fidelity fields can't masquerade as `null`
- **Structured error codes** — engine errors map to specific JSON-RPC codes (`-32001` stale match, `-32002` encoding, `-32003` reflow, `-32004` font-not-found) with embedded recovery hints
- **Runs entirely local** — no external APIs, no network calls, no API keys

## Quick Start

### Prerequisites

- **Node.js** 20+
- **Python** 3.12+
- **pdf-edit-engine** ≥ 0.1.3, < 0.2.0: `pip install "pdf-edit-engine>=0.1.3,<0.2.0"`

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pdf-edit-mcp": {
      "command": "npx",
      "args": ["-y", "@aryanbv/pdf-edit-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add pdf-edit-mcp -- npx -y @aryanbv/pdf-edit-mcp
```

### Other MCP clients (Cursor, Windsurf, etc.)

```bash
npx -y @aryanbv/pdf-edit-mcp
```

### Custom Python path

If `python` isn't in your PATH or you need a specific version:

```json
{
  "mcpServers": {
    "pdf-edit-mcp": {
      "command": "npx",
      "args": ["-y", "@aryanbv/pdf-edit-mcp"],
      "env": {
        "PDF_EDIT_PYTHON": "/path/to/python3.12"
      }
    }
  }
}
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
| `pdf_replace_block` | Replace all content within a bounding box with new text |
| `pdf_batch_replace_block` | Replace content in multiple bounding boxes atomically with cumulative shift tracking |
| `pdf_insert_text_block` | Insert text at a position, shift existing content down to make room |
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

Three built-in MCP prompts guide the editing process.

### `comprehensive-pdf-edit`

For structural changes — section swaps, rewrites, multi-field updates:

1. **Inspect** — Call `pdf_inspect` to get the full document overview
2. **Understand structure** — Use `pdf_detect_sections` for section tree, `pdf_find_text` for simple text matches, or `pdf_get_text_layout` for raw block positions
3. **Pre-check** — Call `pdf_analyze_subset` if replacement text has unusual characters (bullets, em-dashes, non-Latin scripts)
4. **Execute** — Use `pdf_batch_replace` for text changes, `pdf_swap_sections` or `pdf_replace_section` for structural changes, then `pdf_update_annotation` if link URLs changed
5. **Verify** — Call `pdf_get_text` on the output. Check for duplicates, missing content, and spurious spaces

### `section-swap`

For swapping two sections by name:

1. Call `pdf_detect_sections` to get the section tree
2. Identify both sections by title match
3. Call `pdf_batch_replace_block` with **all** sibling sections (not just the two being swapped) — unchanged siblings get their original text for uniform spacing
4. Verify with `pdf_get_text`

### `quick-pdf-edit`

For simple text changes — typos, dates, names:

1. Call `pdf_find_text` to locate the text
2. Call `pdf_replace_text` or `pdf_replace_single`
3. Check `font_preserved` in the fidelity report

## Architecture

```
AI Agent (Claude, GPT, etc.)
    ↓  MCP protocol (stdio)
index.ts — TypeScript MCP server
    ↓  JSON-RPC 2.0 over stdin/stdout
bridge.py — long-running Python subprocess
    ↓  direct import
pdf-edit-engine — Python library (pikepdf + fonttools + pdfminer)
```

- The TypeScript server spawns `bridge.py` once at startup and keeps it alive for all tool calls, avoiding Python startup overhead on every request.
- All inputs are validated by Zod schemas before reaching the Python layer.
- `stdout` is the IPC channel — all logging goes to `stderr`.

## Tested PDF generators

| Generator | Encoding | Character agreement | Notes |
|-----------|----------|-------------------|-------|
| Chrome (Print to PDF) | Identity-H | 100% | Narrow font subsets exercise Tier 1.5 in-place glyph injection |
| Google Docs export | Identity-H | 100% | |
| Microsoft Word | Identity-H (Calibri) | 100% with Carlito metric-equivalent installed | `font_substituted` set when fallback fires |
| reportlab (Python) | WinAnsi | 100% | Synthetic test fixture |

## Limitations

What v0.1.1 does **not** support:

- **Cross-page reflow** — text expanding past a page boundary is not redistributed; you'll see an `overflow_detected: true` and a warning
- **CFF / Type 1 / Type 3 fonts** — Tier 1.5 in-place glyph injection is TrueType only (`FontFile2` ↔ `glyf` table). Edits that need new glyphs in a CFF font return `FontNotFoundError` with code `-32004`
- **`unitsPerEm` mismatch** — if the embedded font and your installed system font use different `unitsPerEm`, glyph rescaling is out of scope; the engine raises rather than ship distorted output
- **Image editing or generation** — text-only
- **Table structure detection** — text and bbox extraction work, but no table semantics
- **Encodings beyond Identity-H and WinAnsi** — `MacRoman` and custom `/Differences` are decoded for reading but not exercised by the test fixtures
- **Right-to-left text** — bidi reordering is not handled
- **Multi-codepoint emoji / complex script glyphs** that aren't in your system fonts — recorded as `glyphs_missing` in the FidelityReport

## Error codes

JSON-RPC error codes the bridge can return (in addition to standard `-32600`/`-32601`/`-32602`):

| Code | Class | Hint |
|---|---|---|
| `-32000` | `PDFEditError` (generic) | Inspect the message for context |
| `-32001` | `OperatorError` | TextMatch is stale — re-run `pdf_find_text` and retry |
| `-32002` | `EncodingError` | Run `pdf_analyze_subset` to see which characters can't encode |
| `-32003` | `ReflowError` | Replacement may be too wide for the bbox — try shorter text |
| `-32004` | `FontNotFoundError` | Install the original font system-wide, or accept metric-equivalent fallback |
| `-32603` | Internal error | Bug — please report at the issue tracker |

## Troubleshooting

**"Python not found"** — Set `PDF_EDIT_PYTHON` to your Python 3.12+ path (see [Custom Python path](#custom-python-path)).

**"No module named pdf_edit_engine"** — Install the engine: `pip install pdf-edit-engine`

**Bridge process crashes on startup** — Verify Python >=3.12 (`python --version`) and check stderr for import errors.

**Characters not rendering after replacement** — Call `pdf_analyze_subset` before editing to check if the embedded font supports the new characters.

**"Path must be absolute"** — All `pdf_path` and `output_path` values must be absolute paths ending in `.pdf`.

## Development

```bash
git clone https://github.com/AryanBV/pdf-edit-mcp.git
cd pdf-edit-mcp
npm install && npm run build
```

```bash
npm test              # validation + security + integration tests
npm run inspect       # launch MCP Inspector for manual testing
npm run audit         # security audit
```

Integration tests require Python 3.12+, pdf-edit-engine, and reportlab (`pip install pdf-edit-engine reportlab`).

CI runs in two stages: unit tests (TypeScript validation and security) → integration tests (Python bridge with generated fixtures).

## License

[MIT](LICENSE)
