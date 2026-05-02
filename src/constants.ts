// Centralized limits and defaults for pdf-edit-mcp.
//
// CR-2 (post-audit re-audit): every magic number used to live inline in
// schemas.ts. That made it easy for two semantically-identical fields to
// drift apart (the original 50K vs 100K replacement-text cap that the
// audit flagged). Constants below are the single source of truth.

// ── Text length caps ─────────────────────────────────────────────────

/** Max characters in a search string. */
export const MAX_SEARCH_TEXT = 10_000;

/** Max characters in any replacement / new-text field across every tool. */
export const MAX_REPLACEMENT_TEXT = 100_000;

/** Max characters in a font name (PDF /Name objects + safety margin). */
export const MAX_FONT_NAME = 200;

/** Max characters in any path (Windows extended-length cap). */
export const MAX_PATH_LENGTH = 4_096;

/** Max length of a metadata value (single field), an annotation URI, etc. */
export const MAX_METADATA_VALUE = 1_000;

/** Max length of a form-field value when filling forms. */
export const MAX_FORM_FIELD_VALUE = 10_000;

/** Max length of an annotation URI. */
export const MAX_URI = 2_048;

/** Max length of a bookmark or annotation title. */
export const MAX_TITLE = 500;

/** Max length of a section name passed to swap_sections / replace_section. */
export const MAX_SECTION_NAME = 200;

/** Max characters of inserted free text. */
export const MAX_INSERT_TEXT = MAX_REPLACEMENT_TEXT;

// ── Coordinate / geometry caps ───────────────────────────────────────

/** Max absolute coordinate (PDF points). Real PDFs cap around 14_400 (200in). */
export const MAX_COORDINATE = 10_000;

/** Min font size in points. */
export const MIN_FONT_SIZE = 0.5;
/** Max font size in points. */
export const MAX_FONT_SIZE = 1_000;

/** Default font size when none is specified. */
export const DEFAULT_FONT_SIZE = 12.0;

/** Min line height in points. */
export const MIN_LINE_HEIGHT = 0.5;
/** Max line height in points. */
export const MAX_LINE_HEIGHT = 1_000;

// ── Collection caps (DoS bounds) ─────────────────────────────────────

/** Max edit pairs in a single batch_replace call. */
export const MAX_EDITS_PER_BATCH = 500;

/** Max replacements in a single batch_replace_block call. */
export const MAX_REPLACEMENTS_PER_BATCH = 50;

/** Max PDFs in a single merge_pdfs call. */
export const MAX_PDFS_PER_MERGE = 100;

/** Max page indices in reorder/rotate/delete page lists. */
export const MAX_PAGE_INDICES = 10_000;

/** Max highlight quad values (8 floats per quad → 100 quads max). */
export const MAX_HIGHLIGHT_VALUES = 800;
/** Min highlight quad values (one quad). */
export const MIN_HIGHLIGHT_VALUES = 8;

/** Max keys in a metadata dict. */
export const MAX_METADATA_KEYS = 50;

/** Max keys in a form-fields dict. */
export const MAX_FORM_FIELDS = 500;

// ── Password / security caps ─────────────────────────────────────────

/** Max length of an encrypt/decrypt password (PDF spec recommends ≤127). */
export const MAX_PASSWORD = 128;

// ── Engine version pin ──────────────────────────────────────────────

/** Minimum required pdf-edit-engine version. CR-5: bridge.py hard-fails on
 *  older engines because v0.1.2-only fields (font_substituted,
 *  glyphs_missing) drive several MCP-surfaced behaviors. */
export const MIN_ENGINE_VERSION = "0.1.2";
