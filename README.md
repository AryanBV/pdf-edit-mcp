# pdf-edit-mcp

MCP server for format-preserving PDF text editing — find, replace, and batch-edit text in existing PDFs while preserving fonts, layout, and visual fidelity. Powered by [pdf-edit-engine](https://github.com/AryanBV/pdf-edit-engine).

## Install

```bash
npx -y @aryanbv/pdf-edit-mcp
```

### Prerequisites

- **Node.js** 18+
- **Python** 3.12+
- **pdf-edit-engine**: `pip install pdf-edit-engine`

## Configuration

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

### Custom Python path

If `python` isn't in your PATH or you need a specific version:

```json
{
  "mcpServers": {
    "pdf-edit-mcp": {
      "command": "npx",
      "args": ["-y", "@aryanbv/pdf-edit-mcp"],
      "env": {
        "PDF_EDIT_PYTHON": "C:\\Python312\\python.exe"
      }
    }
  }
}
```

## Architecture

```
Claude / AI Agent
    |  MCP protocol (stdio)
    v
index.ts (TypeScript MCP server)
    |  JSON-RPC 2.0 over stdin/stdout
    v
bridge.py (long-running Python process)
    |  direct import
    v
pdf-edit-engine (Python library)
```

The TypeScript server spawns `bridge.py` once at startup and keeps it alive. Each tool call sends a JSON-RPC request to bridge.py, which calls pdf-edit-engine and returns the result. This architecture avoids Python startup overhead on every call.

## Tools

| Tool | Description | Input |
|------|-------------|-------|
| `pdf_get_text` | Extract all text from a PDF | `pdf_path` |
| `pdf_find_text` | Search for text with page/position info | `pdf_path`, `search`, `case_sensitive?` |
| `pdf_replace_text` | Find and replace all occurrences | `pdf_path`, `search`, `replacement`, `output_path` |
| `pdf_replace_single` | Replace a specific match by index | `pdf_path`, `search`, `match_index?`, `replacement`, `output_path`, `reflow?` |
| `pdf_batch_replace` | Multiple find/replace in one pass | `pdf_path`, `edits[]`, `output_path` |
| `pdf_get_fonts` | List fonts with encoding details | `pdf_path` |
| `pdf_detect_paragraphs` | Detect paragraph blocks on a page | `pdf_path`, `page?` |
| `pdf_analyze_subset` | Check if a font can render specific text | `pdf_path`, `text`, `font_name?` |

### Tool details

**pdf_get_text** — Returns `{ text, page_count }`. Use to read PDF content before editing.

**pdf_find_text** — Returns `{ matches: [{ text, page, position: { x0, y0, x1, y1 } }] }`. Page numbers are 0-indexed. Positions are in PDF user space units.

**pdf_replace_text** — Finds and replaces all occurrences. Returns `{ success, edits_applied, fidelity: { font_preserved, overflow_detected } }`. The fidelity report indicates whether fonts were preserved and if any text overflowed its bounding box.

**pdf_replace_single** — Replaces one specific match. Use `pdf_find_text` first to see all matches, then pass `match_index` (default: 0) to choose which one to replace. Supports `reflow: false` to disable text reflow.

**pdf_batch_replace** — Applies up to 500 find/replace operations in a single pass. More efficient than multiple individual calls. Returns per-edit results and a summary.

**pdf_get_fonts** — Lists all fonts with name, encoding type (WinAnsi, Identity-H, etc.), subset status, and glyph count.

**pdf_detect_paragraphs** — Detects paragraph blocks on a specific page (default: page 0). Returns text, bounding box, font, and line count for each paragraph.

**pdf_analyze_subset** — Checks whether an embedded font can render specific text. Returns `{ available, missing_glyphs, font_name, glyph_count }`. Use before replacing text to verify the font supports the new characters.

## pdf-edit-mcp vs pdf-toolkit-mcp

| | pdf-edit-mcp | pdf-toolkit-mcp |
|---|---|---|
| **Purpose** | Edit existing PDFs | Create new PDFs |
| **Operations** | Find, replace, batch-edit text | Merge, split, create from Markdown, watermark |
| **Preserves** | Fonts, layout, visual fidelity | N/A (creates from scratch) |
| **Engine** | pdf-edit-engine (Python) | pdf-lib (JavaScript) |
| **Use when** | You need to modify text in an existing PDF | You need to create, merge, or restructure PDFs |

They are complementary — use both together for full PDF workflows.

## License

MIT
