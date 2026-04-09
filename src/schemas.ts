import { z } from "zod";

/** Absolute path to a PDF file (Windows or Unix). */
export const pdfPathSchema = z
  .string()
  .min(1, "Path must not be empty")
  .refine((p) => /^[A-Za-z]:[/\\]|^\//.test(p), {
    message: "Path must be absolute",
  })
  .refine((p) => p.toLowerCase().endsWith(".pdf"), {
    message: "Path must end with .pdf",
  })
  .describe("Absolute path to the PDF file");

/** Absolute path for PDF output (Windows or Unix). */
export const outputPathSchema = z
  .string()
  .min(1, "Path must not be empty")
  .refine((p) => /^[A-Za-z]:[/\\]|^\//.test(p), {
    message: "Path must be absolute",
  })
  .refine((p) => p.toLowerCase().endsWith(".pdf"), {
    message: "Path must end with .pdf",
  })
  .describe("Absolute path for the output PDF file");

/** Non-empty search text. */
export const searchSchema = z
  .string()
  .min(1, "Search text must not be empty")
  .describe("Text to search for in the PDF");

/** A single find/replace edit pair. */
export const editSchema = z
  .object({
    find: z.string().min(1, "Find text must not be empty"),
    replace: z.string(),
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
    replacement: z.string().describe("Replacement text"),
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
      .describe("Text to check for glyph availability"),
    font_name: z
      .string()
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
    replacement: z.string().describe("Replacement text"),
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
      .describe("New URL for the link annotation"),
    output_path: outputPathSchema,
  })
  .strict();

// ── Block operation schemas ─────────────────────────────────────────

export const bboxSchema = z
  .object({
    x0: z.number().describe("Left edge x-coordinate"),
    y0: z.number().describe("Bottom edge y-coordinate"),
    x1: z.number().describe("Right edge x-coordinate"),
    y1: z.number().describe("Top edge y-coordinate"),
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
      .describe("New text content for the block"),
    output_path: outputPathSchema,
    font_name: z
      .string()
      .optional()
      .describe("Font name override (uses detected font if omitted)"),
    font_size: z
      .number()
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
    x: z.number().describe("X-coordinate for text insertion"),
    y: z.number().describe("Y-coordinate for text insertion"),
    text: z
      .string()
      .min(1, "Text must not be empty")
      .describe("Text content to insert"),
    output_path: outputPathSchema,
    font_name: z
      .string()
      .optional()
      .describe("Font name (uses default if omitted)"),
    font_size: z
      .number()
      .optional()
      .default(12.0)
      .describe("Font size in points (default: 12)"),
    max_width: z
      .number()
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
