import { z } from "zod";
import {
  MAX_PATH_LENGTH,
  MAX_SEARCH_TEXT,
  MAX_REPLACEMENT_TEXT,
  MAX_EDITS_PER_BATCH,
  MAX_FONT_NAME,
  MAX_URI,
  MAX_TITLE,
  MAX_SECTION_NAME,
  MAX_METADATA_VALUE,
  MAX_FORM_FIELD_VALUE,
  MAX_INSERT_TEXT,
  MAX_COORDINATE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  DEFAULT_FONT_SIZE,
  MIN_LINE_HEIGHT,
  MAX_LINE_HEIGHT,
  MAX_REPLACEMENTS_PER_BATCH,
  MAX_PDFS_PER_MERGE,
  MAX_PAGE_INDICES,
  MAX_HIGHLIGHT_VALUES,
  MIN_HIGHLIGHT_VALUES,
  MAX_METADATA_KEYS,
  MAX_FORM_FIELDS,
  MAX_PASSWORD,
} from "./constants.js";

// Re-export for downstream consumers (tests, external imports).
export { MAX_REPLACEMENT_TEXT } from "./constants.js";

// ── Path safety (B-1 + S-2 root fix) ─────────────────────────────────
//
// Single source of truth for "what is a safe path?" for this MCP. Every
// path-shaped field in every schema reuses pdfPathSchema or
// outputPathSchema, which apply the FULL list of checks below. Adding a
// new check here covers every consumer for free; pre-fix, each schema
// re-rolled its own .refine() chain and they drifted (the audit found
// 50K vs 100K text caps drifting the same way).
//
// Bridge.py mirrors this list verbatim in `_validate_path()` (B-1) so
// the bridge stays defended even when invoked directly (test harness,
// alternate clients) without going through Zod.

const ABSOLUTE_PATH_RE = /^[A-Za-z]:[/\\]|^\//;
const TRAVERSAL_RE = /(^|[\\/])\.\.([\\/]|$)/;
const CONTROL_CHARS_RE = /[\x00-\x1f]/;
const TRAILING_DOT_OR_SPACE_RE = /[. ]$/;
// Windows reserved device names — opening these silently writes to the
// null device / console / printer port instead of a file.
const WINDOWS_RESERVED_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

interface PathCheck {
  test: (p: string) => boolean;
  message: string;
}

const PATH_CHECKS: readonly PathCheck[] = [
  { test: (p) => p.length >= 1, message: "Path must not be empty" },
  { test: (p) => p.length <= MAX_PATH_LENGTH, message: `Path exceeds maximum length (${MAX_PATH_LENGTH})` },
  { test: (p) => ABSOLUTE_PATH_RE.test(p), message: "Path must be absolute" },
  { test: (p) => p.toLowerCase().endsWith(".pdf"), message: "Path must end with .pdf" },
  { test: (p) => !TRAVERSAL_RE.test(p), message: "Path must not contain directory traversal (..)" },
  { test: (p) => !CONTROL_CHARS_RE.test(p), message: "Path must not contain control characters (NUL, etc.)" },
  {
    test: (p) => {
      const basename = p.split(/[/\\]/).pop() ?? "";
      return !TRAILING_DOT_OR_SPACE_RE.test(basename);
    },
    message: "Path basename must not end with '.' or ' ' (Windows treats these as truncated)",
  },
  {
    test: (p) => {
      const basename = p.split(/[/\\]/).pop() ?? "";
      return !WINDOWS_RESERVED_RE.test(basename);
    },
    message: "Path must not use a Windows reserved device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9)",
  },
];

/** Universal path-safety predicate. Returns the first failing check's
 *  message, or null when the path is safe. Exported so bridge-side and
 *  test-side code can reuse the same definition. */
export function pathSafetyError(p: string): string | null {
  for (const { test, message } of PATH_CHECKS) {
    if (!test(p)) return message;
  }
  return null;
}

/** Build a Zod string schema applying every PATH_CHECKS entry. */
function buildPathSchema(description: string) {
  let schema = z.string();
  for (const { test, message } of PATH_CHECKS) {
    schema = schema.refine(test, { message }) as unknown as z.ZodString;
  }
  return schema.describe(description);
}

/** Absolute path to a PDF file (Windows or Unix). Applies the full
 *  PATH_CHECKS list. */
export const pdfPathSchema = buildPathSchema("Absolute path to the PDF file");

/** Absolute path for PDF output (Windows or Unix). Applies the full
 *  PATH_CHECKS list. */
export const outputPathSchema = buildPathSchema("Absolute path for the output PDF file");

/** Non-empty search text. */
export const searchSchema = z
  .string()
  .min(1, "Search text must not be empty")
  .max(MAX_SEARCH_TEXT, `Search text exceeds maximum length (${MAX_SEARCH_TEXT} chars)`)
  .describe("Text to search for in the PDF");

/** A single find/replace edit pair. */
export const editSchema = z
  .object({
    find: z.string().min(1, "Find text must not be empty").max(MAX_SEARCH_TEXT),
    replace: z.string().max(MAX_REPLACEMENT_TEXT),
  })
  .strict();

/** Array of edit pairs for batch operations. */
export const editsArraySchema = z
  .array(editSchema)
  .min(1, "At least one edit is required")
  .max(MAX_EDITS_PER_BATCH, `Maximum ${MAX_EDITS_PER_BATCH} edits per batch`);

// ── Tool input schemas ───────────────────────────────────────────────

export const getTextInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Limit extraction to this 0-indexed page. Omit to extract all pages."),
  })
  .strict();

export const findTextInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    search: searchSchema,
    case_sensitive: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether the search is case-sensitive (default: true)"),
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Limit search to this 0-indexed page. Omit to search all pages."),
  })
  .strict();

export const replaceTextInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    search: searchSchema,
    replacement: z.string().max(MAX_REPLACEMENT_TEXT).describe("Replacement text"),
    output_path: outputPathSchema,
    reflow: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to reflow text if replacement is wider (default: true)"),
    dry_run: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, simulate the edit and return the EditResult without writing the output PDF. " +
          "Use to preview fidelity (font_substituted, glyphs_missing, warnings) before committing. " +
          "output_path is still required by schema but its file is not written."
      ),
  })
  .strict();

export const batchReplaceInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    edits: editsArraySchema,
    output_path: outputPathSchema,
    dry_run: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, simulate all edits and return the per-edit EditResult list without writing. " +
          "Useful for previewing batch fidelity before committing. output_path is still required."
      ),
  })
  .strict();

export const getFontsInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Limit listing to this 0-indexed page. Omit to list fonts across the whole PDF."),
  })
  .strict();

export const detectParagraphsInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("0-indexed page number (default: 0)"),
  })
  .strict();

export const analyzeSubsetInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    text: z
      .string()
      .min(1, "Text must not be empty")
      .max(MAX_SEARCH_TEXT)
      .describe("Text to check for glyph availability"),
    font_name: z
      .string()
      .max(MAX_FONT_NAME)
      .optional()
      .describe(
        "Font name as it appears in the PDF (e.g. 'F1'). If omitted, uses the first font found."
      ),
  })
  .strict();

export const replaceSingleInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    search: searchSchema,
    match_index: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("Index of the match to replace (default: 0, the first match)"),
    replacement: z.string().max(MAX_REPLACEMENT_TEXT).describe("Replacement text"),
    output_path: outputPathSchema,
    reflow: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to reflow text if replacement is wider (default: true)"),
    dry_run: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, simulate the edit and return the EditResult without writing the output PDF. " +
          "output_path is still required by schema but its file is not written."
      ),
  })
  .strict();

export const inspectInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    include_layout: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Include raw text blocks with positions and fonts (default: false). " +
          "Enable when you need block-level layout data for section detection or bbox computation."
      ),
  })
  .strict();

export const updateAnnotationInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .describe("0-indexed page number containing the annotation"),
    annotation_index: z
      .number()
      .int()
      .min(0)
      .describe("Index of the annotation on the page (from pdf_inspect)"),
    url: z
      .string()
      .min(1, "URL must not be empty")
      .max(MAX_URI)
      .describe("New URL for the link annotation"),
    output_path: outputPathSchema,
  })
  .strict();

// ── Block operation schemas ─────────────────────────────────────────

export const bboxSchema = z
  .object({
    x0: z.number().min(-MAX_COORDINATE).max(MAX_COORDINATE).describe("Left edge x-coordinate"),
    y0: z.number().min(-MAX_COORDINATE).max(MAX_COORDINATE).describe("Bottom edge y-coordinate"),
    x1: z.number().min(-MAX_COORDINATE).max(MAX_COORDINATE).describe("Right edge x-coordinate"),
    y1: z.number().min(-MAX_COORDINATE).max(MAX_COORDINATE).describe("Top edge y-coordinate"),
  })
  .strict();

export const replaceBlockInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .describe("0-indexed page number"),
    bbox: bboxSchema.describe("Bounding box of the block to replace"),
    new_text: z
      .string()
      .min(1, "Replacement text must not be empty")
      .max(MAX_REPLACEMENT_TEXT)
      .describe("New text content for the block"),
    output_path: outputPathSchema,
    font_name: z
      .string()
      .max(MAX_FONT_NAME)
      .optional()
      .describe("Font name override (uses detected font if omitted)"),
    font_size: z
      .number()
      .min(MIN_FONT_SIZE)
      .max(MAX_FONT_SIZE)
      .optional()
      .describe("Font size override (uses detected size if omitted)"),
    line_height: z
      .number()
      .min(MIN_LINE_HEIGHT)
      .max(MAX_LINE_HEIGHT)
      .optional()
      .describe(
        "Explicit line-height for the rewritten block in PDF points (engine v0.1.2+). " +
          "Overrides the auto-calculated line height. Use to enforce uniform spacing " +
          "across sibling blocks."
      ),
  })
  .strict();

export const insertTextBlockInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .describe("0-indexed page number"),
    x: z.number().min(-MAX_COORDINATE).max(MAX_COORDINATE).describe("X-coordinate for text insertion"),
    y: z.number().min(-MAX_COORDINATE).max(MAX_COORDINATE).describe("Y-coordinate for text insertion"),
    text: z
      .string()
      .min(1, "Text must not be empty")
      .max(MAX_INSERT_TEXT)
      .describe("Text content to insert"),
    output_path: outputPathSchema,
    font_name: z
      .string()
      .max(MAX_FONT_NAME)
      .optional()
      .describe("Font name (uses default if omitted)"),
    font_size: z
      .number()
      .min(MIN_FONT_SIZE)
      .max(MAX_FONT_SIZE)
      .optional()
      .default(DEFAULT_FONT_SIZE)
      .describe("Font size in points (default: 12)"),
    max_width: z
      .number()
      .min(1)
      .max(MAX_COORDINATE)
      .optional()
      .describe("Maximum width for text wrapping (no wrapping if omitted)"),
  })
  .strict();

/** A single replacement in a batch_replace_block call. */
export const blockReplacementSchema = z
  .object({
    bbox: bboxSchema.describe("Bounding box of the block to replace"),
    new_text: z
      .string()
      .min(1, "Replacement text must not be empty")
      .max(MAX_REPLACEMENT_TEXT)
      .describe("New text content for the block"),
  })
  .strict();

export const batchReplaceBlockInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    // CR-9: `page` is the canonical name; `page_number` is a deprecated
    // alias kept for v0.1.0 callers. At least one must be supplied; if
    // both are, `page` wins. Aim is to converge to `page` only in v0.2.x.
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("0-indexed page number (preferred name)"),
    page_number: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "0-indexed page number (DEPRECATED alias for `page` — kept for " +
          "v0.1.0 backward compatibility, will be removed in v0.2.0)"
      ),
    replacements: z
      .array(blockReplacementSchema)
      .min(1, "At least one replacement is required")
      .max(MAX_REPLACEMENTS_PER_BATCH, `Maximum ${MAX_REPLACEMENTS_PER_BATCH} replacements per batch`)
      .describe("Array of {bbox, new_text} replacements to apply"),
    output_path: outputPathSchema,
    line_height: z
      .number()
      .min(MIN_LINE_HEIGHT)
      .max(MAX_LINE_HEIGHT)
      .optional()
      .describe(
        "Explicit line-height for every rewritten block in PDF points (engine v0.1.2+). " +
          "Use to enforce uniform line spacing across sibling sections being swapped."
      ),
    section_gap: z
      .number()
      .min(0)
      .max(MAX_LINE_HEIGHT)
      .optional()
      .describe(
        "Vertical gap (in PDF points) between consecutive replaced sections " +
          "(engine v0.1.2+). Overrides the original inter-section gap; useful " +
          "when section heights change after replacement."
      ),
  })
  .strict()
  .refine((d) => d.page !== undefined || d.page_number !== undefined, {
    message: "Either `page` (preferred) or `page_number` (deprecated) is required",
    path: ["page"],
  });

export const deleteBlockInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .describe("0-indexed page number"),
    bbox: bboxSchema.describe("Bounding box of the block to delete"),
    output_path: outputPathSchema,
    close_gap: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to close the gap left by deletion (default: true)"),
  })
  .strict();

export const getTextLayoutInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("0-indexed page number (default: 0)"),
  })
  .strict();

export const extractBboxTextInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    bbox: bboxSchema.describe("Bounding box region to extract text from"),
    page: z
      .number()
      .int()
      .min(0)
      .describe("0-indexed page number"),
    tolerance: z
      .number()
      .min(0)
      .max(500)
      .optional()
      .default(0)
      .describe(
        "Extra margin in points for bbox overlap matching (default: 0). Use 0 for exact bbox extraction, 2+ for loose matching."
      ),
  })
  .strict();

export const swapSectionsInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    section_a: z
      .string()
      .min(1)
      .max(MAX_SECTION_NAME)
      .describe(
        "Name or partial name of the first section to swap (fuzzy matched against detected section titles)"
      ),
    section_b: z
      .string()
      .min(1)
      .max(MAX_SECTION_NAME)
      .describe(
        "Name or partial name of the second section to swap (fuzzy matched)"
      ),
    output_path: outputPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("0-indexed page number (default: 0)"),
  })
  .strict();

export const replaceSectionInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    section: z
      .string()
      .min(1)
      .max(MAX_SECTION_NAME)
      .describe(
        "Name or partial name of the section to replace (fuzzy matched against detected section titles)"
      ),
    new_text: z
      .string()
      .min(1)
      .max(MAX_REPLACEMENT_TEXT)
      .describe("New text content for the section (replaces title, tech stack, bullets — everything)"),
    output_path: outputPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("0-indexed page number (default: 0)"),
  })
  .strict();

export const detectSectionsInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("0-indexed page number (default: 0)"),
    include_text: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Whether to extract text for each section (default: true). Set false for faster structure-only detection."
      ),
  })
  .strict();

// ── Wrapper operation schemas ───────────────────────────────────────

/** Absolute directory path. Reuses a subset of PATH_CHECKS — no .pdf
 *  suffix requirement, but every other safety check applies. */
const dirPathSchema = z
  .string()
  .min(1, "Path must not be empty")
  .max(MAX_PATH_LENGTH, `Path exceeds maximum length (${MAX_PATH_LENGTH})`)
  .refine((p) => ABSOLUTE_PATH_RE.test(p), { message: "Path must be absolute" })
  .refine((p) => !TRAVERSAL_RE.test(p), {
    message: "Path must not contain directory traversal (..)",
  })
  .refine((p) => !CONTROL_CHARS_RE.test(p), {
    message: "Path must not contain control characters (NUL, etc.)",
  })
  .refine((p) => {
    const basename = p.split(/[/\\]/).pop() ?? "";
    return !TRAILING_DOT_OR_SPACE_RE.test(basename);
  }, {
    message: "Path basename must not end with '.' or ' ' (Windows treats these as truncated)",
  })
  .refine((p) => {
    const basename = p.split(/[/\\]/).pop() ?? "";
    return !WINDOWS_RESERVED_RE.test(basename);
  }, {
    message: "Path must not use a Windows reserved device name",
  })
  .describe("Absolute directory path");

export const mergeInputSchema = z
  .object({
    pdf_paths: z
      .array(pdfPathSchema)
      .min(2, "At least 2 PDFs required to merge")
      .max(MAX_PDFS_PER_MERGE, `Maximum ${MAX_PDFS_PER_MERGE} PDFs per merge`),
    output_path: outputPathSchema,
  })
  .strict();

export const splitInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    output_dir: dirPathSchema.describe("Directory to write individual page PDFs"),
  })
  .strict();

export const reorderPagesInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page_order: z
      .array(z.number().int().min(0))
      .min(1, "At least one page index required")
      .max(MAX_PAGE_INDICES)
      .describe("New page order as 0-indexed page numbers"),
    output_path: outputPathSchema,
  })
  .strict();

export const rotatePagesInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    pages: z
      .array(z.number().int().min(0))
      .min(1, "At least one page index required")
      .max(MAX_PAGE_INDICES)
      .describe("0-indexed page numbers to rotate"),
    angle: z
      .number()
      .int()
      .refine((a) => [90, 180, 270].includes(a), {
        message: "Angle must be 90, 180, or 270",
      })
      .describe("Rotation angle in degrees (90, 180, or 270)"),
    output_path: outputPathSchema,
  })
  .strict();

export const deletePagesInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    pages: z
      .array(z.number().int().min(0))
      .min(1, "At least one page index required")
      .max(MAX_PAGE_INDICES)
      .describe("0-indexed page numbers to delete"),
    output_path: outputPathSchema,
  })
  .strict();

export const cropPagesInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    box: bboxSchema.describe("Crop box (x0, y0, x1, y1) in PDF coordinates"),
    output_path: outputPathSchema,
  })
  .strict();

export const editMetadataInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    metadata: z
      .record(z.string().max(MAX_METADATA_VALUE))
      .refine((obj) => Object.keys(obj).length <= MAX_METADATA_KEYS, {
        message: `metadata may have at most ${MAX_METADATA_KEYS} keys`,
      })
      .describe("Metadata fields to set (e.g. {title, author, subject, creator})"),
    output_path: outputPathSchema,
  })
  .strict();

export const addBookmarkInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    title: z.string().min(1).max(MAX_TITLE).describe("Bookmark title"),
    page: z.number().int().min(0).describe("0-indexed target page"),
    output_path: outputPathSchema,
  })
  .strict();

export const encryptInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    owner_password: z.string().min(1).max(MAX_PASSWORD).describe("Owner password"),
    user_password: z.string().max(MAX_PASSWORD).describe("User password (can be empty for no user password)"),
    output_path: outputPathSchema,
  })
  .strict();

export const decryptInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    password: z.string().min(1).max(MAX_PASSWORD).describe("Password to decrypt the PDF"),
    output_path: outputPathSchema,
  })
  .strict();

export const addHyperlinkInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z.number().int().min(0).describe("0-indexed page number"),
    bbox: bboxSchema.describe("Link region bounding box"),
    uri: z.string().min(1).max(MAX_URI).describe("Target URL"),
    output_path: outputPathSchema,
  })
  .strict();

export const addHighlightInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z.number().int().min(0).describe("0-indexed page number"),
    quad_points: z
      .array(z.number())
      .min(MIN_HIGHLIGHT_VALUES, `At least ${MIN_HIGHLIGHT_VALUES} values (one quad) required`)
      .max(MAX_HIGHLIGHT_VALUES, `Maximum ${MAX_HIGHLIGHT_VALUES / 8} quads (${MAX_HIGHLIGHT_VALUES} values)`)
      .refine((arr) => arr.length % 8 === 0, {
        message: "QuadPoints must contain complete quads (8 floats per quad)",
      })
      .describe("QuadPoints array — 8 floats per highlight quad (x1,y1,...,x4,y4)"),
    output_path: outputPathSchema,
  })
  .strict();

export const flattenAnnotationsInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    output_path: outputPathSchema,
  })
  .strict();

export const fillFormInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    field_values: z
      .record(z.string().max(MAX_FORM_FIELD_VALUE))
      .refine((obj) => Object.keys(obj).length <= MAX_FORM_FIELDS, {
        message: `field_values may have at most ${MAX_FORM_FIELDS} fields`,
      })
      .describe("Map of form field names to values"),
    output_path: outputPathSchema,
  })
  .strict();

export const addWatermarkInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    watermark_path: pdfPathSchema.describe("Absolute path to the watermark PDF"),
    output_path: outputPathSchema,
  })
  .strict();

// ── Annotation operation schemas ────────────────────────────────────

export const getAnnotationsInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("0-indexed page number (omit for all pages)"),
  })
  .strict();

export const addAnnotationInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z.number().int().min(0).describe("0-indexed page number"),
    rect: bboxSchema.describe("Annotation position (x0, y0, x1, y1)"),
    uri: z.string().min(1).max(MAX_URI).describe("Link target URL"),
    output_path: outputPathSchema,
    border_style: z
      .string()
      .max(20)
      .optional()
      .default("none")
      .describe("Border style: 'none' (default) or 'underline'"),
  })
  .strict();

export const deleteAnnotationInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z.number().int().min(0).describe("0-indexed page number"),
    annotation_index: z
      .number()
      .int()
      .min(0)
      .describe("Index of the annotation on the page"),
    output_path: outputPathSchema,
  })
  .strict();

export const moveAnnotationInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z.number().int().min(0).describe("0-indexed page number"),
    annotation_index: z
      .number()
      .int()
      .min(0)
      .describe("Index of the annotation on the page"),
    new_rect: bboxSchema.describe("New position (x0, y0, x1, y1)"),
    output_path: outputPathSchema,
  })
  .strict();
