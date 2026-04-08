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
| `pdf_inspect` | Full document overview (text, fonts, paragraphs, annotations) | `pdf_path` |
| `pdf_get_text` | Extract all text from a PDF | `pdf_path` |
| `pdf_find_text` | Search for text with page/position info | `pdf_path`, `search`, `case_sensitive?` |
| `pdf_replace_text` | Find and replace all occurrences | `pdf_path`, `search`, `replacement`, `output_path` |
| `pdf_replace_single` | Replace a specific match by index | `pdf_path`, `search`, `match_index?`, `replacement`, `output_path`, `reflow?` |
| `pdf_batch_replace` | Multiple find/replace in one pass (with auto-verification) | `pdf_path`, `edits[]`, `output_path` |
| `pdf_update_annotation` | Update a link URL in a PDF annotation | `pdf_path`, `page`, `annotation_index`, `url`, `output_path` |
| `pdf_get_fonts` | List fonts with encoding details | `pdf_path` |
| `pdf_detect_paragraphs` | Detect paragraph blocks on a page | `pdf_path`, `page?` |
| `pdf_analyze_subset` | Check if a font can render specific text | `pdf_path`, `text`, `font_name?` |

### Tool details

**pdf_inspect** — Returns `{ page_count, text, fonts, paragraphs, annotations }`. Your first call before any editing — gives a complete document overview in one round-trip. Annotations include link URLs and positions for correlation with paragraph text.

**pdf_get_text** — Returns `{ text, page_count }`. Use to read PDF content before editing. For a combined view, use `pdf_inspect` instead.

**pdf_find_text** — Returns `{ matches: [{ text, page, position: { x0, y0, x1, y1 } }] }`. Page numbers are 0-indexed. Positions are in PDF user space units.

**pdf_replace_text** — Finds and replaces all occurrences. Returns `{ success, edits_applied, fidelity: { font_preserved, overflow_detected } }`. The fidelity report indicates whether fonts were preserved and if any text overflowed its bounding box.

**pdf_replace_single** — Replaces one specific match. Use `pdf_find_text` first to see all matches, then pass `match_index` (default: 0) to choose which one to replace. Supports `reflow: false` to disable text reflow.

**pdf_batch_replace** — Applies up to 500 find/replace operations in a single pass. More efficient than multiple individual calls. Returns per-edit results, a summary, and auto-verification data confirming each replacement appears in the output.

**pdf_update_annotation** — Updates a link URL in a PDF annotation. Use `pdf_inspect` first to find annotation indices. Only changes the link target — visible text changes use `pdf_replace_text` or `pdf_batch_replace`. Always do text edits before annotation updates.

**pdf_get_fonts** — Lists all fonts with name, encoding type (WinAnsi, Identity-H, etc.), subset status, and glyph count.

**pdf_detect_paragraphs** — Detects paragraph blocks on a specific page (default: page 0). Returns text, bounding box, font, and line count for each paragraph.

**pdf_analyze_subset** — Checks whether an embedded font can render specific text. Returns `{ available, missing_glyphs, font_name, glyph_count }`. Use before replacing text to verify the font supports the new characters.

## Workflow

Two built-in MCP prompts guide the edit workflow:

**Comprehensive edit** (`comprehensive-pdf-edit`) — For structural changes like section swaps, rewrites, or multi-field updates:

1. **Read** — Call `pdf_inspect` to get the full document overview
2. **Plan** — Identify every text change, present as a table, confirm with user
3. **Pre-check** — Call `pdf_analyze_subset` for unusual characters
4. **Execute** — Send all text edits in one `pdf_batch_replace` call, then update annotation URLs
5. **Verify** — Check the auto-verification data in the response

**Quick edit** (`quick-pdf-edit`) — For simple changes like typos, dates, or names:

1. Call `pdf_find_text` to locate the text
2. Call `pdf_replace_text` or `pdf_replace_single`
3. Check `font_preserved` in the fidelity report

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
