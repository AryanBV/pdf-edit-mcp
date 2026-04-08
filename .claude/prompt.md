# M8 — Build pdf-edit-mcp MCP Server

## Context
- Project: pdf-edit-mcp — NEW TypeScript MCP server wrapping pdf-edit-engine (Python)
- Linear project: PDF Edit Engine, milestone M8, issue ARY-257
- Repo: github.com/AryanBV/pdf-edit-mcp (cloned locally, contains only .gitignore, LICENSE, README.md)
- Parent engine: pdf-edit-engine (Python, v0.1.0, 579 tests) installed at `C:\New Project\pdf-edit-engine`
- Engine is importable system-wide: `python -c "from pdf_edit_engine import find; print('OK')"` works
- Python executable: `C:\Python312\python.exe`
- Sibling project for reference: `C:\New Project\pdf-toolkit-mcp` — an existing MCP server by the same author (TypeScript, @modelcontextprotocol/sdk, stdio transport, 16 tools). Study its patterns but do NOT copy code — pdf-edit-mcp has a fundamentally different architecture (Python subprocess bridge vs pure TS).
- Platform: Windows PowerShell, Node >= 18
- npm scope: @aryanbv/pdf-edit-mcp

## Architecture

```
Claude / AI Agent
    ↓ MCP protocol (stdio, JSON-RPC)
index.ts (TypeScript MCP server)
    ↓ spawns once at startup, communicates via stdin/stdout
bridge.py (long-running Python process)
    ↓ direct import
pdf-edit-engine (Python library)
```

**IPC protocol between TS and Python:**
- JSON-RPC 2.0 over stdin/stdout of a long-running child process
- TS spawns `python bridge.py` ONCE at server startup, keeps it alive
- Each MCP tool call → TS sends JSON-RPC request to bridge.py's stdin
- bridge.py processes, calls pdf-edit-engine, sends JSON-RPC response to stdout
- Serialized: one request at a time, no concurrent calls to Python
- bridge.py must NEVER print anything to stdout except JSON-RPC responses (use stderr for logs)

## Task

### Phase 1: Project setup

Initialize the TypeScript project:

- package.json:
  - name: `@aryanbv/pdf-edit-mcp`
  - version: `0.1.0`
  - type: `module`
  - bin: `{ "pdf-edit-mcp": "./dist/index.js" }`
  - scripts: build, test, inspect (MCP Inspector)
  - dependencies: `@modelcontextprotocol/sdk`, `zod`
  - devDependencies: `typescript`, `vitest`, `@types/node`
- tsconfig.json: strict, ESM, target ES2022, outDir dist
- The compiled `dist/index.js` must start with `#!/usr/bin/env node` for npx to work. Either add it via a build script or prepend it in the source index.ts.
- .npmignore: src/, tests/, tsconfig.json, *.ts (ship only dist/ and bridge.py)
- CLAUDE.md: project context for this repo — what it is, the architecture, key rules:
  - bridge.py stdout is the IPC channel — NEVER use print(), only sys.stderr for logs
  - All PDF paths from MCP tool calls must be validated (absolute, exists, .pdf extension)
  - The Python process is spawned ONCE and reused — handle its unexpected death gracefully
  - Reference pdf-toolkit-mcp's CLAUDE.md for MCP SDK patterns but note the architecture difference

### Phase 2: bridge.py (Python side)

Create `bridge.py` in the project root. This is the long-running Python process.

Requirements:
- Read JSON-RPC 2.0 requests from stdin, one per line
- Dispatch to pdf-edit-engine functions based on `method` field
- Write JSON-RPC 2.0 responses to stdout, one per line
- ALL logging goes to stderr, NEVER stdout
- Handle these methods:
  - `get_text` → params: `{pdf_path}` → returns `{text, page_count}`
  - `find_text` → params: `{pdf_path, search, case_sensitive?}` → returns `{matches: [{text, page, position}...]}`
  - `replace_text` → params: `{pdf_path, search, replacement, output_path, reflow?}` → returns `{success, fidelity: {font_preserved, overflow_detected}}`
  - `batch_replace` → params: `{pdf_path, edits: [{find, replace}...], output_path}` → returns `{results: [{success, fidelity}...], summary: {total, succeeded, failed}}`
  - `get_fonts` → params: `{pdf_path}` → returns `{fonts: [{name, encoding_type, is_subset}...]}`
- Error handling: catch PDFEditError and return JSON-RPC error with code -32000 and descriptive message. Catch unexpected exceptions with code -32603.
- At startup (before the read loop), validate that pdf-edit-engine is importable:
  ```python
  try:
      from pdf_edit_engine import find, replace, get_text, get_fonts, batch_replace
  except ImportError:
      print('{"error": "pdf-edit-engine not installed. Run: pip install pdf-edit-engine"}', file=sys.stderr)
      sys.exit(1)
  ```
- Flush stdout after every response
- Run in an infinite loop reading stdin until EOF

Test bridge.py standalone (note: PowerShell requires double quotes with escaping):
```powershell
'{"jsonrpc":"2.0","id":1,"method":"get_text","params":{"pdf_path":"C:/New Project/pdf-edit-engine/tests/corpus/reportlab_simple.pdf"}}' | python bridge.py
```

### Phase 3: TypeScript MCP server (index.ts)

Create `src/index.ts` — the MCP server that:

1. Spawns `python bridge.py` as a child process at startup using the Python found at `C:\Python312\python.exe` (but make this configurable via `PDF_EDIT_PYTHON` environment variable, defaulting to `python`)
2. Validates bridge.py startup: bridge.py itself checks `import pdf_edit_engine` at startup and exits with a clear stderr message if missing. The TS server should detect this exit (non-zero exit code) and fail with: "pdf-edit-engine is not installed. Run: pip install pdf-edit-engine"
3. Registers 5 MCP tools with the SDK:

**pdf_get_text**
- Input: `{ pdf_path: string }`
- Calls bridge method `get_text`
- Returns the text content and page count

**pdf_find_text**
- Input: `{ pdf_path: string, search: string, case_sensitive?: boolean }`
- Calls bridge method `find_text`
- Returns match list with text, page numbers, positions

**pdf_replace_text**
- Input: `{ pdf_path: string, search: string, replacement: string, output_path: string, reflow?: boolean }`
- Calls bridge method `replace_text`
- Returns success status and fidelity report

**pdf_batch_replace**
- Input: `{ pdf_path: string, edits: Array<{find: string, replace: string}>, output_path: string }`
- Calls bridge method `batch_replace`
- Returns per-edit results and summary

**pdf_get_fonts**
- Input: `{ pdf_path: string }`
- Calls bridge method `get_fonts`
- Returns font list with name, encoding, subset status

4. Each tool: validates input with Zod, sends JSON-RPC to bridge, parses response, returns MCP result. Validation rules for ALL tools:
   - `pdf_path`: must be absolute path, must end with .pdf
   - `output_path`: must be absolute, must end with .pdf. Warn (not block) if same as pdf_path.
   - `search`: must be non-empty string
   - `edits` array: must be non-empty, max 500 items
5. Handle bridge process death: if the Python process exits unexpectedly, attempt ONE restart. If restart fails, return MCP error.
6. Graceful shutdown: on SIGTERM/SIGINT, kill the Python child process
7. **Resolving bridge.py path**: bridge.py ships in the package root, dist/index.js is in dist/. Use `import.meta.url` and `path.resolve(dirname, '..', 'bridge.py')` to find it relative to the compiled JS file.

### Phase 4: Tests

Create tests using vitest:

1. **bridge.py tests** (integration — spawn bridge.py, send JSON-RPC, verify response):
   - get_text on a known PDF → returns text containing expected strings
   - find_text with a known string → returns matches with correct page numbers
   - replace_text → output file exists, fidelity report present
   - batch_replace with 2 edits → both succeed
   - get_fonts → returns at least one font with name and encoding
   - Error case: non-existent PDF → JSON-RPC error response (not crash)
   - Error case: invalid method → JSON-RPC method-not-found error

2. **Tool validation tests** (unit — test Zod schemas):
   - Missing pdf_path → validation error
   - Relative path → validation error
   - Non-.pdf extension → validation error
   - Empty search string → validation error
   - output_path same as pdf_path → warning in response (not a hard error)

3. Use a test PDF from the engine's corpus. Copy `C:\New Project\pdf-edit-engine\tests\corpus\reportlab_simple.pdf` into `tests/fixtures/` in this repo. Commit it with the tests.

### Phase 5: README and npm prep

Write README.md:
- Title: pdf-edit-mcp
- One-line: "MCP server for format-preserving PDF text editing"
- Install: `npx -y @aryanbv/pdf-edit-mcp`
- Prerequisites: Python 3.12+, `pip install pdf-edit-engine`
- Configuration: Claude Desktop JSON config block, Claude Code CLI config
- Tools table: all 5 tools with input/output descriptions
- Architecture diagram (ASCII): show the TS → bridge.py → engine flow
- Comparison with pdf-toolkit-mcp (creates PDFs) vs pdf-edit-mcp (edits existing PDFs)
- License: MIT

Create server.json for MCP Registry submission (follow the format from pdf-toolkit-mcp if available).

### Phase 6: Build, test, commit

1. `npm install`
2. `npm run build` — must succeed with 0 TypeScript errors
3. `npm test` — all tests pass
4. Test with MCP Inspector: `npx @modelcontextprotocol/inspector node dist/index.js`
   - Call pdf_get_text with the test fixture PDF
   - Verify the response contains text
5. `git status` — review changed files, ensure no unintended files (node_modules, dist/ should be in .gitignore)
6. `git add` only source files, config files, bridge.py, tests, README, CLAUDE.md. Do NOT `git add -A` blindly.
7. `git commit -m "feat: initial MCP server with 5 tools and Python bridge"`
8. `git push origin main`

## Constraints
- TypeScript strict mode, ESM only, no `any`, no `unknown` without assertion
- bridge.py must work with Python 3.12+ — no third-party dependencies beyond pdf-edit-engine
- Do NOT install pdf-edit-engine as a dependency in package.json — it's a Python package
- Do NOT bundle bridge.py in dist/ — it ships alongside dist/ in the npm package root
- stdout in bridge.py is SACRED — only JSON-RPC responses. Use stderr for all logging.
- The MCP server uses stdio transport (same as pdf-toolkit-mcp) — NOT HTTP
- Do NOT read pdf-toolkit-mcp source code and copy it. Study its package.json and CLAUDE.md for SDK patterns only. The architecture is fundamentally different.
- Aim for conciseness: bridge.py ~150-200 lines, index.ts ~300-400 lines. Don't sacrifice error handling for line count — these are guidelines, not hard limits.

## Verification
- `npm run build` — 0 errors
- `npm test` — all tests pass
- MCP Inspector: pdf_get_text returns text from test fixture
- bridge.py responds correctly to a JSON-RPC request piped via stdin (use PowerShell-compatible syntax)
- bridge.py never prints to stdout except JSON-RPC responses
- All tool inputs validated by Zod schemas
- Python child process spawns and stays alive across multiple tool calls

## Linear Update
- Mark ARY-257 as Done
- Update project summary: "M8 complete — MCP server built and tested"