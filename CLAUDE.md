# pdf-edit-mcp

MCP server for format-preserving PDF text editing, powered by
[pdf-edit-engine](https://github.com/AryanBV/pdf-edit-engine) (Python). As of
v0.2.0 this is a **single-process Python (FastMCP) server** — the engine is
imported in-process. (The v0.1.x TypeScript server + `bridge.py` subprocess are
gone; see git history / CHANGELOG.)

## Architecture

```
Claude / AI Agent
    ↓ MCP protocol (stdio)
pdf_edit_mcp (FastMCP server, this package)
    ↓ in-process import
pdf-edit-engine (Python library: pikepdf + fonttools + pdfminer)
```

## Module layout (dependency order)

```
__init__.py      __version__
app.py           FastMCP `mcp` instance + `engine_lock`  ← dependency LEAF
constants.py     input bounds (single source of truth)
validation.py    path_safety_error + PdfPath/OutputPath/DirPath + BBox/EditItem/BlockReplacement
serialize.py     serialize_edit_result + aggregate_fidelity (exact wire shapes)
_runtime.py      engine_guard (lock + error translation), READ_ONLY/WRITE annotations, page_count
tools_read.py    9 read tools        tools_edit.py     7 edit tools
tools_sections.py 3 section tools     tools_document.py 15 document tools
tools_annotations.py 5 annotation tools  prompts.py     3 prompts
server.py        version gate + main(); imports the tool/prompt modules to register them
```

**Import-cycle rule:** `mcp` and `engine_lock` live in `app.py` (a leaf). Tool
modules import them from `app`, never from `server`. `server` imports the tool
modules at the bottom for decorator side-effects. Do not move `mcp`/`engine_lock`
back into `server` — that reintroduces the `server → tools_* → _runtime → server`
cycle.

## Critical rules

1. **stdout is the MCP transport** — never `print()` to stdout; diagnostics go to
   `stderr` (the engine version gate already does this).
2. **The engine is NOT thread-safe** — every engine call goes through
   `_runtime.engine_guard()`, which holds the module-level `engine_lock`. New tools
   must wrap their engine work in `with engine_guard():`.
3. **Path validation is a security boundary** — path parameters use the `PdfPath` /
   `OutputPath` / `DirPath` validated types from `validation.py` (absolute, `.pdf`,
   no `..` traversal, no control chars, no Windows reserved/truncated basenames).
   Never accept a bare `str` for a path.
4. **Error model** — engine `PDFEditError` subclasses are translated by
   `engine_guard` into `ToolError` with a classified message + recovery hint. Raise
   `PDFEditError` for in-tool validation; do not leak raw pikepdf exceptions.
5. **Engine version gate** — `server._check_engine_version()` exits non-zero if the
   installed `pdf-edit-engine < 0.2.0` (relies on the `password=` kwargs, `fit=`,
   and the 30-kind degradation taxonomy).
6. **mypy --strict + ruff clean** — `mypy src/pdf_edit_mcp` and `ruff check src/ tests/`
   must pass. `server.py` has a per-file E402 ignore (intentional bottom-of-file
   registration imports).

## Conventions

- **Tool function names ARE the wire names** — `pdf_*` exactly (e.g.
  `pdf_delete_annotation_v2`). Prompts use `@mcp.prompt(name="...")` for the
  hyphenated wire names.
- **Page parameters are named `page`**, 0-indexed. `pdf_batch_replace_block` keeps
  `page_number` as a deprecated alias (prefer `page`; both → error if neither set).
- **Bounds come from `constants.py`** — never inline a magic number.
- **`password=`** is exposed only on the direct-verb read/edit tools whose engine
  call accepts it — NOT on composite tools (`pdf_inspect`, the section tools) or
  the document wrappers (the engine wrapper functions don't take it).
- **Return shapes are pinned** by the test suite — preserve `serialize_edit_result`'s
  exact dict shape and each tool's documented return keys.

## Section detection lives in tools_sections.py

`_detect_sections` / `_swap_sections` / `_replace_section` are an MCP-side
font-hierarchy heuristic + orchestration ported verbatim from the old `bridge.py`
(detect output is byte-identical, verified by differential). This logic could move
into `pdf_edit_engine.structural` so non-MCP callers reuse it; tracked for a future
release. Do not extend the MCP-side detector with significant new logic — push new
work into the engine first.

## Development

```bash
pip install -e ".[dev]"
ruff check src/ tests/
mypy src/pdf_edit_mcp
pytest tests/ -q          # fixtures auto-generated via reportlab (tests/conftest.py)
```

Distribution: PyPI (`uvx pdf-edit-mcp`). Build with `python -m build`; publish with
`twine` (manual, mirroring the engine's release process).
