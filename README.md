# pdf-edit-mcp

MCP server for format-preserving PDF text editing. Edit text in existing PDFs while preserving the original fonts, layout, and visual fidelity.

[![npm version](https://img.shields.io/npm/v/@aryanbv/pdf-edit-mcp)](https://www.npmjs.com/package/@aryanbv/pdf-edit-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/AryanBV/pdf-edit-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/AryanBV/pdf-edit-mcp/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Python](https://img.shields.io/badge/python-%3E%3D3.12-blue)

## How it works

Most PDF editors use a redact-and-replace approach — they white out the original text and stamp new text on top, usually with a substitute font. The result looks different from the original.

pdf-edit-mcp takes a different approach. It modifies the original PDF content stream operators directly, preserving the exact font, size, color, and position of the text being edited.

| | Traditional approach | pdf-edit-mcp |
|---|---|---|
| **Method** | Redact old text, stamp new text | Modify content stream operators in place |
| **Font** | Substituted (often Helvetica) | Original font preserved |
| **Position** | Re-calculated | Exact original coordinates |
| **Quality feedback** | None | FidelityReport on every edit |

Powered by [pdf-edit-engine](https://github.com/AryanBV/pdf-edit-engine) — a Python library for PDF content stream surgery with two-tier font subset extension.

## Features

- 38 tools across 7 categories (reading, text editing, block ops, section ops, annotations, document manipulation, metadata & security)
- 3 built-in MCP prompts that guide the editing workflow step by step
- Fidelity reporting — every edit returns whether fonts were preserved, overflow detected, and reflow applied
- Batch operations — up to 500 find-and-replace edits in a single atomic call with auto-verification
- Section intelligence — detects document structure by font hierarchy, swaps sections by fuzzy title match
- Full document manipulation — merge, split, rotate, reorder, crop, watermark, encrypt, decrypt, fill forms
- Runs entirely local — no external APIs, no network calls, no API keys

## Quick Start

### Prerequisites

- **Node.js** 20+
- **Python** 3.12+
- **pdf-edit-engine**: `pip install pdf-edit-engine`

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

| Generator | Encoding | Character agreement |
|-----------|----------|-------------------|
| Chrome (Print to PDF) | Identity-H | 100% |
| Google Docs export | Identity-H | 100% |
| reportlab (Python) | WinAnsi | 100% |

## Limitations

What v0.1.0 does not support:

- Cross-page reflow (text expanding beyond a page boundary)
- Image editing or generation
- Table structure detection
- Encodings beyond Identity-H and WinAnsi
- Right-to-left text

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
