# pdf-edit-mcp

MCP server for format-preserving PDF text editing, powered by pdf-edit-engine (Python).

## Architecture

```
Claude / AI Agent
    ↓ MCP protocol (stdio, JSON-RPC)
src/index.ts (TypeScript MCP server)
    ↓ spawns once at startup, JSON-RPC 2.0 over stdin/stdout
bridge.py (long-running Python process)
    ↓ direct import
pdf-edit-engine (Python library)
```

## Critical Rules

1. **bridge.py stdout is the IPC channel** — NEVER use `print()` in bridge.py. All logging goes to `sys.stderr`. The original stdout is saved as `_stdout` and used exclusively for JSON-RPC responses.

2. **Python process is spawned ONCE** — bridge.py is started at server startup and kept alive for all tool calls. If it dies unexpectedly, the TS server attempts ONE restart. If restart fails, tools return errors.

3. **PDF path validation** — All `pdf_path` and `output_path` inputs must be absolute paths ending with `.pdf`. Validated by Zod schemas in the TS server before reaching bridge.py.

4. **No `any` or `unknown`** — TypeScript strict mode, ESM only. All types must be explicit.

5. **Serialized bridge calls** — Only one JSON-RPC request is in-flight at a time. The TS server queues requests.

6. **Engine version pin** — `bridge.py` hard-fails (`sys.exit(2)`) at startup if the installed `pdf-edit-engine` is older than `0.1.2`. The MCP relies on `FidelityReport.font_substituted` and `glyphs_missing` fields that older engines do not populate.

7. **Naming conventions** (anchor these to prevent the kind of drift the v0.1.1 audit caught):
   - **Page parameters are always named `page`** — 0-indexed integer. Never `page_number`, `page_idx`, `pg`, `page_num`. (`pdf_batch_replace_block` keeps `page_number` as a deprecated alias for v0.1.0 callers; will be dropped in v0.2.0.)
   - **Replacement-text length cap is `MAX_REPLACEMENT_TEXT = 100_000`** in `src/schemas.ts`. New text-replacement fields must use that constant, not an inline `.max(50_000)` or other magic number.
   - **Path schemas** (`pdfPathSchema`, `outputPathSchema`) are the only sources of truth for path validation. New tools accepting paths reuse these — never re-roll path-shape `.refine()` chains.
   - **Engine error codes** (`-32001`..`-32004`) are reserved by `_ERROR_REGISTRY` in `bridge.py` for `OperatorError`, `EncodingError`, `ReflowError`, `FontNotFoundError` respectively. New engine error classes get their own code + recovery hint in the registry, not an ad-hoc except clause.

## Tech debt — section detection lives in bridge.py

`bridge.py:handle_detect_sections` (~150 LOC) implements an MCP-side font-frequency heuristic to build a section tree from `get_text_layout`. This logic could plausibly belong in `pdf_edit_engine.structural` instead — pushing it down would let non-MCP callers reuse it, and the MCP would shrink to a thin wrapper. Tracked for v0.2.x. Do not extend this MCP-side detector with significant new logic; if changes are needed, push the work into the engine first.

`handle_swap_sections` and `handle_replace_section` follow the same pattern (MCP-side orchestration around engine primitives). They use `_resolve_section` for unique-match resolution (raises on ambiguous), and `handle_swap_sections` writes its output to a `.swap_tmp` sibling and atomically renames on full success.

## Configuration

- `PDF_EDIT_PYTHON` env var: path to Python executable (default: `"python"`)
- Python 3.12+ required with `pdf-edit-engine` installed

## MCP SDK Patterns

- Import `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- Import `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
- Tools registered via `server.registerTool(id, {description, inputSchema, annotations}, handler)`
- Zod schemas use `.strict()` — no extra properties allowed
- No `outputSchema` on tools (Claude Code drops tools that have it)
- `console.error` only — stdout is the MCP transport channel

## File Layout

- `bridge.py` — Python JSON-RPC process (project root, ships with npm package)
- `src/index.ts` — MCP server entry point
- `src/schemas.ts` — Zod validation schemas (shared with tests)
- `dist/` — compiled output (gitignored)
- `tests/` — vitest tests
