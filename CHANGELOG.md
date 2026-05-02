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

### Internal

- The bridge's `_serialize_edit_result` helper is now used by every
  EditResult-returning tool, including `pdf_replace_text`,
  `pdf_replace_single`, `pdf_batch_replace`, `pdf_replace_block`,
  `pdf_batch_replace_block`. Field allowlist remains explicit (not
  `dataclasses.asdict`) so future engine fields require a deliberate
  bridge audit before reaching MCP clients.

## [0.1.0] — 2026-04-25

Initial release. 38 MCP tools wrapping `pdf-edit-engine` v0.1.0.
