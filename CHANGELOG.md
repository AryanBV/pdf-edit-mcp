# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] — 2026-05-02

Tracks `pdf-edit-engine` v0.1.2 — surfaces the new fidelity richness
(metric-equivalent font substitution, missing glyphs, auto-overflow
warnings) and exposes the new layout knobs.

### Added

- **`dry_run` parameter on `pdf_replace_text`, `pdf_replace_single`, and
  `pdf_batch_replace`.** Set `dry_run: true` to simulate the edit and
  receive the full per-result fidelity report (font_substituted,
  glyphs_missing, warnings) WITHOUT writing the output PDF. Use to
  preview risky edits before committing them to disk. `output_path` is
  still required by the schema but no file is written when dry_run is
  on. The response includes a top-level `dry_run` field so callers can
  confirm the mode they got.
- **`page` filter on `pdf_find_text`, `pdf_get_text`, `pdf_get_fonts`.**
  Optional 0-indexed page number that limits the read to a single page.
  Useful for multi-page PDFs where you want to constrain the search or
  extraction. Omit to scan the whole PDF (existing behavior).
- `line_height` parameter on `pdf_replace_block`. Sets explicit
  line-height in points for the rewritten block; lets callers lock in
  uniform spacing when sibling blocks are being swapped (engine v0.1.2+).
- `line_height` and `section_gap` parameters on
  `pdf_batch_replace_block`. Same purpose, applied across every
  replacement in the batch.
- Engine version logged at bridge startup
  (`ready (engine v<VERSION>)`). Soft warning emitted to stderr if the
  installed engine is older than v0.1.2 — older engines still work for
  basic edits but lack `font_substituted` and `glyphs_missing` data.
- `pdf_inspect` font output now exposes the full 6-field FontInfo
  shape (added `postscript_name`, `glyph_count`, `embedded_type`).
  Previously dropped 3 of 6 fields.
- New regression tests in `tests/bridge.test.ts`: dry_run
  preview-without-write check, page filter check across find/get_text/
  get_fonts, inspect-fonts shape check, encrypted-PDF leak check,
  line_height/section_gap kwarg forwarding.

### Changed

- All edit tools now surface the full FidelityReport shape on every
  per-result entry: `font_preserved`, `font_substituted`,
  `overflow_detected`, `reflow_applied`, `glyphs_missing`, plus
  `warnings`. Previously `pdf_replace_text`, `pdf_replace_single`, and
  `pdf_batch_replace` per-result dropped 2-3 fields. Existing
  aggregate-`fidelity` shape is preserved for backward compatibility.
- `pdf_replace_text` response now includes a `results` array with
  per-match detail in addition to the aggregate fidelity summary.
- `pdf_update_annotation` now routes through the engine's
  `update_annotation_uri` instead of opening the PDF with `pikepdf`
  directly. Closes the only remaining bridge-side leak path for
  password-protected PDFs.
- All remaining direct `pikepdf.open()` call sites in `bridge.py`
  (`get_text` page-count, `inspect` page-count, section-swap annotation
  surgery) translate `pikepdf.PasswordError` and `pikepdf.PdfError` to
  `PDFEditError` via a new `_translate_pikepdf` context manager.
- Tool descriptions and the three MCP prompts (`comprehensive-pdf-edit`,
  `section-swap`, `quick-pdf-edit`) updated to guide callers to inspect
  `font_substituted`, `glyphs_missing`, and `warnings` after edits, and
  to handle the new `OperatorError` "TextMatch is stale" hint by
  re-running `pdf_find_text`.

### Required engine

- `pdf-edit-engine >= 0.1.2`. README install instruction updated.
  Older engines emit a soft warning at startup; they still function for
  basic edits but cannot supply `font_substituted` or `glyphs_missing`.

### CI

- `.github/workflows/ci.yml` now installs the engine from PyPI
  (`pip install "pdf-edit-engine>=0.1.2"`) instead of from the GitHub
  main branch. Tests run against the actually-published artifact, which
  is what end users get from `pip install pdf-edit-engine`.
- `prepublishOnly` upgraded to run the **full** test suite
  (`npm test`), not just unit. Possible because `tests/bridge.test.ts`
  now auto-bootstraps fixtures via `generate_fixtures.py` when they're
  missing.

### Security & robustness (audit pass)

Two adversarial reviews ran before publish — a security audit and a
code-quality review. 24 findings surfaced; 16 fixed pre-publish, 8
deferred to v0.1.2 with explicit tracking. After a senior re-audit,
all 16 were re-graded; the remaining patches/partials were converted
into root fixes.

- **Bridge stdin DoS hardening** — line-size cap of 16 MiB; a daemon
  reader thread feeds an internal queue so the main loop never blocks
  on a malformed half-line. If no bytes arrive for 5 minutes the
  bridge exits `sys.exit(3)` and the Node parent's restart logic
  recovers automatically.
- **Unified path validation** — bridge mirrors the schema's
  `PATH_CHECKS` exactly via `_validate_path()`. Path validation
  rejects: directory traversal, control characters, trailing dot/space
  (Windows truncation surface), Windows reserved device names (CON,
  PRN, AUX, NUL, COM1-9, LPT1-9), absolute-path violations, length
  beyond 4096. Both layers refuse identical inputs.
- **Bounded record schemas** — `metadata` capped at 50 keys,
  `field_values` at 500 keys. Previously unbounded `z.record()` was a
  memory-exhaustion vector.
- **Atomic section swap** — `pdf_swap_sections` writes both phases
  (text replacement + annotation surgery) to a sibling `.swap_tmp`
  file and only `os.replace`s to the user's `output_path` on full
  success. A try/finally guarantees temp-file cleanup on failure;
  pre-fix, a Phase-2 raise would leave a half-mutated PDF at the
  user's output path.
- **Ambiguous section-name guard** — `_resolve_section()` raises
  `PDFEditError` with the candidate list when a fuzzy match resolves
  to more than one section. Previously the first substring match won
  silently.
- **Bridge "permanently dead" flag** — after `MAX_RESTARTS` the bridge
  marks itself dead and every subsequent `call()` rejects with a
  deterministic fatal error. Prevents LLM agents from retrying a
  silently-degraded server forever.
- **Encrypted-PDF leak plug** — `handle_update_annotation` now routes
  through the engine instead of `pikepdf.open()` directly. Combined
  with `_translate_pikepdf` wrapping the four remaining direct
  `pikepdf.open()` sites (page-count reads + section-swap annotation
  surgery), no raw `pikepdf.PasswordError` or `PdfError` reaches a
  JSON-RPC client.
- **Engine version pinned at startup** — bridge hard-fails
  (`sys.exit(2)`) if `pdf-edit-engine < 0.1.2`. Older engines silently
  return `null` for `font_substituted` / `glyphs_missing`, which would
  contradict the v0.1.1 feature claims. Hard-fail is honest.

### Quality

- **Centralized constants** — `src/constants.ts` is the single source
  of truth for every cap and limit (text length, coordinate bounds,
  font-size range, collection caps, password length, engine version
  pin). Pre-fix, magic numbers were inline in `schemas.ts` and had
  drifted (replacement-text was 50K in some fields and 100K in
  others). Now structurally impossible.
- **Structured error codes with recovery hints** — engine error
  classes flow through `_ERROR_REGISTRY`: `OperatorError` → -32001,
  `EncodingError` → -32002, `ReflowError` → -32003,
  `FontNotFoundError` → -32004. Each error message embeds a
  `(hint: ...)` suffix that AI agents can parse for self-recovery
  (e.g. "re-run pdf_find_text" for stale matches).
- **Annotation-rewrite helper extracted** — `pdf_swap_sections`'
  90-line inline annotation surgery moved into
  `_rewrite_link_annotations_for_swap()`. Removed dead duplicate
  function `_transfer_annotations()` that was never called.
- **`pdf_batch_replace_block` field rename** — canonical name is now
  `page` (matching every other tool); `page_number` retained as a
  deprecated alias for v0.1.0 callers, removed in v0.2.0.
- **18 integration smoke tests added** for previously untested
  wrapper / annotation tools (`merge`, `split`, `reorder_pages`,
  `rotate_pages`, `delete_pages`, `crop_pages`, `edit_metadata`,
  `add_bookmark`, `decrypt`, `add_hyperlink`, `add_highlight`,
  `flatten_annotations`, `fill_form`, `add_watermark`,
  `get_annotations`, `add_annotation`, `delete_annotation_v2`,
  `move_annotation`).
- **`registerWriteTool` helper** — generic on the schema's raw shape
  so `paramsFn`'s `args` is fully type-safe at the callsite via
  `z.infer<>`. Previous `as Function` cast (banned in strict lint)
  replaced by a single narrow callback-only cast that is documented
  as an irreducible MCP-SDK typing limit.
- **CLAUDE.md conventions** — naming rules (`page` not
  `page_number`), constant-module reuse, path-schema reuse, error
  registry rules — anchored as project conventions to prevent the
  kind of drift the audit caught.

### Internal

- The bridge's `_serialize_edit_result` helper is now used by every
  EditResult-returning tool, including `pdf_replace_text`,
  `pdf_replace_single`, `pdf_batch_replace`, `pdf_replace_block`,
  `pdf_batch_replace_block`. Field allowlist remains explicit (not
  `dataclasses.asdict`) so future engine fields require a deliberate
  bridge audit before reaching MCP clients.

### Deferred to v0.1.2 / v0.2.0

Documented as known-and-tracked rather than silently shelved:

- **Section detector pushdown into engine** — `handle_detect_sections`
  is 150 lines of font-frequency heuristic that lives in `bridge.py`.
  This belongs in `pdf_edit_engine.structural`. Cross-repo work,
  tracked in `CLAUDE.md`.
- **Page-by-page LLM behavior signal** — no real-world telemetry yet
  on whether AI agents actually use `dry_run`, `page` filters, or the
  structured error hints. Will collect after publish.
- **Real-PDF golden-file tests** — current integration tests are
  smoke-level (dispatch + output exists). Behavior coverage requires
  golden Chrome / Word / Office-365 fixtures.
- **Test coverage matrix expansion** — Linux-only CI today; macOS and
  Windows matrix would catch additional cross-platform issues.
- **Error-message PII sanitizer** — engine error messages sometimes
  embed full filesystem paths the user didn't supply. Low risk for
  local deployments; matters for any hosted relay.

## [0.1.0] — 2026-04-25

Initial release. 38 MCP tools wrapping `pdf-edit-engine` v0.1.0.
