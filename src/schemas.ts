import { z } from "zod";

/** Absolute path to a PDF file (Windows or Unix). */
export const pdfPathSchema = z
  .string()
  .min(1, "Path must not be empty")
  .max(4096, "Path exceeds maximum length")
  .refine((p) => /^[A-Za-z]:[/\\]|^\//.test(p), {
    message: "Path must be absolute",
  })
  .refine((p) => p.toLowerCase().endsWith(".pdf"), {
    message: "Path must end with .pdf",
  })
  .refine((p) => !/(^|[\\/])\.\.([\\/]|$)/.test(p), {
    message: "Path must not contain directory traversal (..)",
  })
  .describe("Absolute path to the PDF file");

/** Absolute path for PDF output (Windows or Unix). */
export const outputPathSchema = z
  .string()
  .min(1, "Path must not be empty")
  .max(4096, "Path exceeds maximum length")
  .refine((p) => /^[A-Za-z]:[/\\]|^\//.test(p), {
    message: "Path must be absolute",
  })
  .refine((p) => p.toLowerCase().endsWith(".pdf"), {
    message: "Path must end with .pdf",
  })
  .refine((p) => !/(^|[\\/])\.\.([\\/]|$)/.test(p), {
    message: "Path must not contain directory traversal (..)",
  })
  .describe("Absolute path for the output PDF file");

/** Non-empty search text. */
export const searchSchema = z
  .string()
  .min(1, "Search text must not be empty")
  .max(10_000, "Search text exceeds maximum length (10,000 chars)")
  .describe("Text to search for in the PDF");

/** A single find/replace edit pair. */
export const editSchema = z
  .object({
    find: z.string().min(1, "Find text must not be empty").max(10_000),
    replace: z.string().max(50_000),
  })
  .strict();

/** Array of edit pairs for batch operations. */
export const editsArraySchema = z
  .array(editSchema)
  .min(1, "At least one edit is required")
  .max(500, "Maximum 500 edits per batch");

// ── Tool input schemas ───────────────────────────────────────────────

export const getTextInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
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
  })
  .strict();

export const replaceTextInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    search: searchSchema,
    replacement: z.string().max(50_000).describe("Replacement text"),
    output_path: outputPathSchema,
    reflow: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to reflow text if replacement is wider (default: true)"),
  })
  .strict();

export const batchReplaceInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    edits: editsArraySchema,
    output_path: outputPathSchema,
  })
  .strict();

export const getFontsInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
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
      .max(10_000)
      .describe("Text to check for glyph availability"),
    font_name: z
      .string()
      .max(200)
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
    replacement: z.string().max(50_000).describe("Replacement text"),
    output_path: outputPathSchema,
    reflow: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to reflow text if replacement is wider (default: true)"),
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
      .max(2048)
      .describe("New URL for the link annotation"),
    output_path: outputPathSchema,
  })
  .strict();

// ── Block operation schemas ─────────────────────────────────────────

export const bboxSchema = z
  .object({
    x0: z.number().min(-10_000).max(10_000).describe("Left edge x-coordinate"),
    y0: z.number().min(-10_000).max(10_000).describe("Bottom edge y-coordinate"),
    x1: z.number().min(-10_000).max(10_000).describe("Right edge x-coordinate"),
    y1: z.number().min(-10_000).max(10_000).describe("Top edge y-coordinate"),
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
      .max(100_000)
      .describe("New text content for the block"),
    output_path: outputPathSchema,
    font_name: z
      .string()
      .max(200)
      .optional()
      .describe("Font name override (uses detected font if omitted)"),
    font_size: z
      .number()
      .min(0.5)
      .max(1000)
      .optional()
      .describe("Font size override (uses detected size if omitted)"),
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
    x: z.number().min(-10_000).max(10_000).describe("X-coordinate for text insertion"),
    y: z.number().min(-10_000).max(10_000).describe("Y-coordinate for text insertion"),
    text: z
      .string()
      .min(1, "Text must not be empty")
      .max(100_000)
      .describe("Text content to insert"),
    output_path: outputPathSchema,
    font_name: z
      .string()
      .max(200)
      .optional()
      .describe("Font name (uses default if omitted)"),
    font_size: z
      .number()
      .min(0.5)
      .max(1000)
      .optional()
      .default(12.0)
      .describe("Font size in points (default: 12)"),
    max_width: z
      .number()
      .min(1)
      .max(10_000)
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
      .max(100_000)
      .describe("New text content for the block"),
  })
  .strict();

export const batchReplaceBlockInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page_number: z
      .number()
      .int()
      .min(0)
      .describe("0-indexed page number"),
    replacements: z
      .array(blockReplacementSchema)
      .min(1, "At least one replacement is required")
      .max(50, "Maximum 50 replacements per batch")
      .describe("Array of {bbox, new_text} replacements to apply"),
    output_path: outputPathSchema,
  })
  .strict();

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
      .max(500)
      .describe(
        "Name or partial name of the first section to swap (fuzzy matched against detected section titles)"
      ),
    section_b: z
      .string()
      .min(1)
      .max(500)
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
      .max(500)
      .describe(
        "Name or partial name of the section to replace (fuzzy matched against detected section titles)"
      ),
    new_text: z
      .string()
      .min(1)
      .max(100_000)
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

/** Absolute directory path. */
const dirPathSchema = z
  .string()
  .min(1, "Path must not be empty")
  .max(4096, "Path exceeds maximum length")
  .refine((p) => /^[A-Za-z]:[/\\]|^\//.test(p), {
    message: "Path must be absolute",
  })
  .refine((p) => !/(^|[\\/])\.\.([\\/]|$)/.test(p), {
    message: "Path must not contain directory traversal (..)",
  })
  .describe("Absolute directory path");

export const mergeInputSchema = z
  .object({
    pdf_paths: z
      .array(pdfPathSchema)
      .min(2, "At least 2 PDFs required to merge")
      .max(100, "Maximum 100 PDFs per merge"),
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
      .max(10_000)
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
      .max(10_000)
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
      .max(10_000)
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
      .record(z.string().max(1000))
      .describe("Metadata fields to set (e.g. {title, author, subject, creator})"),
    output_path: outputPathSchema,
  })
  .strict();

export const addBookmarkInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    title: z.string().min(1).max(500).describe("Bookmark title"),
    page: z.number().int().min(0).describe("0-indexed target page"),
    output_path: outputPathSchema,
  })
  .strict();

export const encryptInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    owner_password: z.string().min(1).max(128).describe("Owner password"),
    user_password: z.string().max(128).describe("User password (can be empty for no user password)"),
    output_path: outputPathSchema,
  })
  .strict();

export const decryptInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    password: z.string().min(1).max(128).describe("Password to decrypt the PDF"),
    output_path: outputPathSchema,
  })
  .strict();

export const addHyperlinkInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z.number().int().min(0).describe("0-indexed page number"),
    bbox: bboxSchema.describe("Link region bounding box"),
    uri: z.string().min(1).max(2048).describe("Target URL"),
    output_path: outputPathSchema,
  })
  .strict();

export const addHighlightInputSchema = z
  .object({
    pdf_path: pdfPathSchema,
    page: z.number().int().min(0).describe("0-indexed page number"),
    quad_points: z
      .array(z.number())
      .min(8, "At least 8 values (one quad) required")
      .max(800, "Maximum 100 quads (800 values)")
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
      .record(z.string().max(10_000))
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
    uri: z.string().min(1).max(2048).describe("Link target URL"),
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
