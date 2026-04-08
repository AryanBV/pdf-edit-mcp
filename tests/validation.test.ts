import { describe, it, expect } from "vitest";
import {
  pdfPathSchema,
  outputPathSchema,
  searchSchema,
  editsArraySchema,
  getTextInputSchema,
  findTextInputSchema,
  replaceTextInputSchema,
  batchReplaceInputSchema,
  detectParagraphsInputSchema,
  analyzeSubsetInputSchema,
  replaceSingleInputSchema,
  inspectInputSchema,
  updateAnnotationInputSchema,
  bboxSchema,
  replaceBlockInputSchema,
  insertTextBlockInputSchema,
  deleteBlockInputSchema,
} from "../src/schemas.js";

describe("Zod schema validation", () => {
  // ── pdfPathSchema ──────────────────────────────────────────────

  describe("pdfPathSchema", () => {
    it("rejects empty string", () => {
      const result = pdfPathSchema.safeParse("");
      expect(result.success).toBe(false);
    });

    it("rejects relative path", () => {
      const result = pdfPathSchema.safeParse("docs/file.pdf");
      expect(result.success).toBe(false);
    });

    it("rejects non-pdf extension", () => {
      const result = pdfPathSchema.safeParse("C:/docs/file.txt");
      expect(result.success).toBe(false);
    });

    it("accepts Windows absolute path", () => {
      const result = pdfPathSchema.safeParse("C:/documents/file.pdf");
      expect(result.success).toBe(true);
    });

    it("accepts Windows backslash path", () => {
      const result = pdfPathSchema.safeParse("C:\\documents\\file.pdf");
      expect(result.success).toBe(true);
    });

    it("accepts Unix absolute path", () => {
      const result = pdfPathSchema.safeParse("/home/user/file.pdf");
      expect(result.success).toBe(true);
    });

    it("accepts uppercase .PDF extension", () => {
      const result = pdfPathSchema.safeParse("C:/docs/FILE.PDF");
      expect(result.success).toBe(true);
    });
  });

  // ── searchSchema ───────────────────────────────────────────────

  describe("searchSchema", () => {
    it("rejects empty string", () => {
      const result = searchSchema.safeParse("");
      expect(result.success).toBe(false);
    });

    it("accepts non-empty string", () => {
      const result = searchSchema.safeParse("hello");
      expect(result.success).toBe(true);
    });
  });

  // ── editsArraySchema ───────────────────────────────────────────

  describe("editsArraySchema", () => {
    it("rejects empty array", () => {
      const result = editsArraySchema.safeParse([]);
      expect(result.success).toBe(false);
    });

    it("rejects array with 501 items", () => {
      const edits = Array.from({ length: 501 }, (_, i) => ({
        find: `text${i}`,
        replace: `new${i}`,
      }));
      const result = editsArraySchema.safeParse(edits);
      expect(result.success).toBe(false);
    });

    it("accepts array with 500 items", () => {
      const edits = Array.from({ length: 500 }, (_, i) => ({
        find: `text${i}`,
        replace: `new${i}`,
      }));
      const result = editsArraySchema.safeParse(edits);
      expect(result.success).toBe(true);
    });

    it("rejects edit with empty find", () => {
      const result = editsArraySchema.safeParse([{ find: "", replace: "x" }]);
      expect(result.success).toBe(false);
    });

    it("accepts valid edit pair", () => {
      const result = editsArraySchema.safeParse([
        { find: "old", replace: "new" },
      ]);
      expect(result.success).toBe(true);
    });
  });

  // ── Full tool input schemas ────────────────────────────────────

  describe("getTextInputSchema", () => {
    it("rejects missing pdf_path", () => {
      const result = getTextInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("accepts valid input", () => {
      const result = getTextInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
      });
      expect(result.success).toBe(true);
    });

    it("rejects extra properties (strict)", () => {
      const result = getTextInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        extra: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("findTextInputSchema", () => {
    it("rejects empty search", () => {
      const result = findTextInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        search: "",
      });
      expect(result.success).toBe(false);
    });

    it("defaults case_sensitive to true", () => {
      const result = findTextInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        search: "hello",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.case_sensitive).toBe(true);
      }
    });
  });

  describe("replaceTextInputSchema", () => {
    it("validates full input", () => {
      const result = replaceTextInputSchema.safeParse({
        pdf_path: "C:/docs/input.pdf",
        search: "old",
        replacement: "new",
        output_path: "C:/docs/output.pdf",
      });
      expect(result.success).toBe(true);
    });

    it("rejects relative output_path", () => {
      const result = replaceTextInputSchema.safeParse({
        pdf_path: "C:/docs/input.pdf",
        search: "old",
        replacement: "new",
        output_path: "output.pdf",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("batchReplaceInputSchema", () => {
    it("validates full input", () => {
      const result = batchReplaceInputSchema.safeParse({
        pdf_path: "C:/docs/input.pdf",
        edits: [{ find: "old", replace: "new" }],
        output_path: "C:/docs/output.pdf",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("detectParagraphsInputSchema", () => {
    it("defaults page to 0", () => {
      const result = detectParagraphsInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(0);
      }
    });

    it("rejects negative page", () => {
      const result = detectParagraphsInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        page: -1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("analyzeSubsetInputSchema", () => {
    it("requires text", () => {
      const result = analyzeSubsetInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
      });
      expect(result.success).toBe(false);
    });

    it("accepts without font_name", () => {
      const result = analyzeSubsetInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        text: "Hello",
      });
      expect(result.success).toBe(true);
    });

    it("accepts with font_name", () => {
      const result = analyzeSubsetInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        text: "Hello",
        font_name: "F1",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("replaceSingleInputSchema", () => {
    it("defaults match_index to 0", () => {
      const result = replaceSingleInputSchema.safeParse({
        pdf_path: "C:/docs/input.pdf",
        search: "old",
        replacement: "new",
        output_path: "C:/docs/output.pdf",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.match_index).toBe(0);
      }
    });

    it("rejects negative match_index", () => {
      const result = replaceSingleInputSchema.safeParse({
        pdf_path: "C:/docs/input.pdf",
        search: "old",
        match_index: -1,
        replacement: "new",
        output_path: "C:/docs/output.pdf",
      });
      expect(result.success).toBe(false);
    });
  });

  // ── inspectInputSchema ────────────────────────────────────────

  describe("inspectInputSchema", () => {
    it("rejects missing pdf_path", () => {
      const result = inspectInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("accepts valid input", () => {
      const result = inspectInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
      });
      expect(result.success).toBe(true);
    });

    it("rejects extra properties (strict)", () => {
      const result = inspectInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        extra: true,
      });
      expect(result.success).toBe(false);
    });
  });

  // ── updateAnnotationInputSchema ───────────────────────────────

  describe("updateAnnotationInputSchema", () => {
    it("validates full input", () => {
      const result = updateAnnotationInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        page: 0,
        annotation_index: 0,
        url: "https://example.com",
        output_path: "C:/docs/output.pdf",
      });
      expect(result.success).toBe(true);
    });

    it("rejects negative page", () => {
      const result = updateAnnotationInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        page: -1,
        annotation_index: 0,
        url: "https://example.com",
        output_path: "C:/docs/output.pdf",
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative annotation_index", () => {
      const result = updateAnnotationInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        page: 0,
        annotation_index: -1,
        url: "https://example.com",
        output_path: "C:/docs/output.pdf",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing url", () => {
      const result = updateAnnotationInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        page: 0,
        annotation_index: 0,
        output_path: "C:/docs/output.pdf",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty url", () => {
      const result = updateAnnotationInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        page: 0,
        annotation_index: 0,
        url: "",
        output_path: "C:/docs/output.pdf",
      });
      expect(result.success).toBe(false);
    });

    it("rejects extra properties (strict)", () => {
      const result = updateAnnotationInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        page: 0,
        annotation_index: 0,
        url: "https://example.com",
        output_path: "C:/docs/output.pdf",
        extra: true,
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing output_path", () => {
      const result = updateAnnotationInputSchema.safeParse({
        pdf_path: "C:/docs/file.pdf",
        page: 0,
        annotation_index: 0,
        url: "https://example.com",
      });
      expect(result.success).toBe(false);
    });
  });

  // ── bboxSchema ──────────────────────────────────────────────────

  describe("bboxSchema", () => {
    it("accepts valid bbox", () => {
      const result = bboxSchema.safeParse({ x0: 0, y0: 0, x1: 100, y1: 50 });
      expect(result.success).toBe(true);
    });

    it("rejects missing field", () => {
      const result = bboxSchema.safeParse({ x0: 0, y0: 0, x1: 100 });
      expect(result.success).toBe(false);
    });

    it("rejects extra field (strict)", () => {
      const result = bboxSchema.safeParse({ x0: 0, y0: 0, x1: 100, y1: 50, extra: 1 });
      expect(result.success).toBe(false);
    });

    it("accepts negative coordinates", () => {
      const result = bboxSchema.safeParse({ x0: -10, y0: -20, x1: 100, y1: 50 });
      expect(result.success).toBe(true);
    });

    it("rejects non-number values", () => {
      const result = bboxSchema.safeParse({ x0: "0", y0: 0, x1: 100, y1: 50 });
      expect(result.success).toBe(false);
    });
  });

  // ── replaceBlockInputSchema ─────────────────────────────────────

  describe("replaceBlockInputSchema", () => {
    const validInput = {
      pdf_path: "C:/docs/input.pdf",
      page: 0,
      bbox: { x0: 50, y0: 100, x1: 500, y1: 200 },
      new_text: "Replacement paragraph",
      output_path: "C:/docs/output.pdf",
    };

    it("accepts valid input", () => {
      const result = replaceBlockInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("rejects missing bbox", () => {
      const { bbox: _, ...rest } = validInput;
      const result = replaceBlockInputSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects empty new_text", () => {
      const result = replaceBlockInputSchema.safeParse({ ...validInput, new_text: "" });
      expect(result.success).toBe(false);
    });

    it("rejects negative page", () => {
      const result = replaceBlockInputSchema.safeParse({ ...validInput, page: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer page", () => {
      const result = replaceBlockInputSchema.safeParse({ ...validInput, page: 1.5 });
      expect(result.success).toBe(false);
    });

    it("accepts optional font_name and font_size", () => {
      const result = replaceBlockInputSchema.safeParse({
        ...validInput,
        font_name: "Helvetica",
        font_size: 14,
      });
      expect(result.success).toBe(true);
    });

    it("rejects extra properties (strict)", () => {
      const result = replaceBlockInputSchema.safeParse({ ...validInput, extra: true });
      expect(result.success).toBe(false);
    });
  });

  // ── insertTextBlockInputSchema ──────────────────────────────────

  describe("insertTextBlockInputSchema", () => {
    const validInput = {
      pdf_path: "C:/docs/input.pdf",
      page: 0,
      x: 72,
      y: 700,
      text: "New paragraph text",
      output_path: "C:/docs/output.pdf",
    };

    it("accepts valid input", () => {
      const result = insertTextBlockInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("defaults font_size to 12", () => {
      const result = insertTextBlockInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.font_size).toBe(12);
      }
    });

    it("rejects empty text", () => {
      const result = insertTextBlockInputSchema.safeParse({ ...validInput, text: "" });
      expect(result.success).toBe(false);
    });

    it("rejects missing x coordinate", () => {
      const { x: _, ...rest } = validInput;
      const result = insertTextBlockInputSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("accepts optional max_width", () => {
      const result = insertTextBlockInputSchema.safeParse({ ...validInput, max_width: 400 });
      expect(result.success).toBe(true);
    });

    it("rejects extra properties (strict)", () => {
      const result = insertTextBlockInputSchema.safeParse({ ...validInput, extra: true });
      expect(result.success).toBe(false);
    });
  });

  // ── deleteBlockInputSchema ──────────────────────────────────────

  describe("deleteBlockInputSchema", () => {
    const validInput = {
      pdf_path: "C:/docs/input.pdf",
      page: 0,
      bbox: { x0: 50, y0: 100, x1: 500, y1: 200 },
      output_path: "C:/docs/output.pdf",
    };

    it("accepts valid input", () => {
      const result = deleteBlockInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("defaults close_gap to true", () => {
      const result = deleteBlockInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.close_gap).toBe(true);
      }
    });

    it("accepts explicit close_gap: false", () => {
      const result = deleteBlockInputSchema.safeParse({ ...validInput, close_gap: false });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.close_gap).toBe(false);
      }
    });

    it("rejects negative page", () => {
      const result = deleteBlockInputSchema.safeParse({ ...validInput, page: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects extra properties (strict)", () => {
      const result = deleteBlockInputSchema.safeParse({ ...validInput, extra: true });
      expect(result.success).toBe(false);
    });
  });
});
