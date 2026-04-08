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
