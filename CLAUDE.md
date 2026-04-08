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
