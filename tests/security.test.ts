import { describe, it, expect } from "vitest";
import {
  pdfPathSchema,
  outputPathSchema,
  searchSchema,
  editSchema,
  editsArraySchema,
  bboxSchema,
  addHighlightInputSchema,
  mergeInputSchema,
  encryptInputSchema,
  addHyperlinkInputSchema,
  addAnnotationInputSchema,
  updateAnnotationInputSchema,
  replaceBlockInputSchema,
  insertTextBlockInputSchema,
  extractBboxTextInputSchema,
  fillFormInputSchema,
  editMetadataInputSchema,
  addBookmarkInputSchema,
  swapSectionsInputSchema,
  replaceSectionInputSchema,
} from "../src/schemas.js";

// ── Phase 1: Input Bounds ────────────────────────────────────────────

describe("String length limits", () => {
  it("searchSchema rejects string over 10,000 chars", () => {
    const result = searchSchema.safeParse("x".repeat(10_001));
    expect(result.success).toBe(false);
  });

  it("searchSchema accepts string of 10,000 chars", () => {
    const result = searchSchema.safeParse("x".repeat(10_000));
    expect(result.success).toBe(true);
  });

  it("pdfPathSchema rejects path over 4096 chars", () => {
    const long = "C:/" + "a".repeat(4090) + ".pdf";
    const result = pdfPathSchema.safeParse(long);
    expect(result.success).toBe(false);
  });

  it("outputPathSchema rejects path over 4096 chars", () => {
    const long = "C:/" + "a".repeat(4090) + ".pdf";
    const result = outputPathSchema.safeParse(long);
    expect(result.success).toBe(false);
  });

  it("editSchema.find rejects string over 10,000 chars", () => {
    const result = editSchema.safeParse({
      find: "x".repeat(10_001),
      replace: "y",
    });
    expect(result.success).toBe(false);
  });

  it("editSchema.replace rejects string over 50,000 chars", () => {
    const result = editSchema.safeParse({
      find: "x",
      replace: "y".repeat(50_001),
    });
    expect(result.success).toBe(false);
  });

  it("encryptInputSchema rejects password over 128 chars", () => {
    const result = encryptInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      owner_password: "x".repeat(129),
      user_password: "",
      output_path: "C:/out.pdf",
    });
    expect(result.success).toBe(false);
  });

  it("addBookmarkInputSchema rejects title over 500 chars", () => {
    const result = addBookmarkInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      title: "x".repeat(501),
      page: 0,
      output_path: "C:/out.pdf",
    });
    expect(result.success).toBe(false);
  });

  it("swapSectionsInputSchema rejects section name over 500 chars", () => {
    const result = swapSectionsInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      section_a: "x".repeat(501),
      section_b: "Section B",
      output_path: "C:/out.pdf",
    });
    expect(result.success).toBe(false);
  });

  it("replaceSectionInputSchema rejects new_text over 100,000 chars", () => {
    const result = replaceSectionInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      section: "Intro",
      new_text: "x".repeat(100_001),
      output_path: "C:/out.pdf",
    });
    expect(result.success).toBe(false);
  });

  it("URI fields reject URLs over 2048 chars", () => {
    const longUri = "https://example.com/" + "a".repeat(2030);
    const result = addHyperlinkInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      page: 0,
      bbox: { x0: 0, y0: 0, x1: 100, y1: 100 },
      uri: longUri,
      output_path: "C:/out.pdf",
    });
    expect(result.success).toBe(false);
  });

  it("editMetadataInputSchema rejects metadata values over 1000 chars", () => {
    const result = editMetadataInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      metadata: { title: "x".repeat(1001) },
      output_path: "C:/out.pdf",
    });
    expect(result.success).toBe(false);
  });

  it("fillFormInputSchema rejects field values over 10,000 chars", () => {
    const result = fillFormInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      field_values: { name: "x".repeat(10_001) },
      output_path: "C:/out.pdf",
    });
    expect(result.success).toBe(false);
  });
});

describe("Numeric upper bounds", () => {
  it("bboxSchema rejects coordinates over 10,000", () => {
    const result = bboxSchema.safeParse({
      x0: 99_999,
      y0: 0,
      x1: 100_000,
      y1: 100,
    });
    expect(result.success).toBe(false);
  });

  it("bboxSchema accepts coordinates within bounds", () => {
    const result = bboxSchema.safeParse({
      x0: 0,
      y0: 0,
      x1: 612,
      y1: 792,
    });
    expect(result.success).toBe(true);
  });

  it("bboxSchema accepts negative coordinates within bounds", () => {
    const result = bboxSchema.safeParse({
      x0: -100,
      y0: -200,
      x1: 500,
      y1: 800,
    });
    expect(result.success).toBe(true);
  });

  it("quad_points rejects array over 800 elements", () => {
    const result = addHighlightInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      page: 0,
      quad_points: Array(808).fill(0), // 101 quads
      output_path: "C:/out.pdf",
    });
    expect(result.success).toBe(false);
  });

  it("quad_points accepts exactly 800 elements (100 quads)", () => {
    const result = addHighlightInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      page: 0,
      quad_points: Array(800).fill(0),
      output_path: "C:/out.pdf",
    });
    expect(result.success).toBe(true);
  });

  it("mergeInputSchema rejects array of over 100 paths", () => {
    const paths = Array(101)
      .fill(null)
      .map((_, i) => `C:/file${i}.pdf`);
    const result = mergeInputSchema.safeParse({
      pdf_paths: paths,
      output_path: "C:/merged.pdf",
    });
    expect(result.success).toBe(false);
  });

  it("replaceBlockInputSchema rejects font_size over 1000", () => {
    const result = replaceBlockInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      page: 0,
      bbox: { x0: 0, y0: 0, x1: 100, y1: 100 },
      new_text: "Hello",
      output_path: "C:/out.pdf",
      font_size: 1001,
    });
    expect(result.success).toBe(false);
  });

  it("extractBboxTextInputSchema rejects tolerance over 500", () => {
    const result = extractBboxTextInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      bbox: { x0: 0, y0: 0, x1: 100, y1: 100 },
      page: 0,
      tolerance: 501,
    });
    expect(result.success).toBe(false);
  });

  it("insertTextBlockInputSchema rejects max_width over 10,000", () => {
    const result = insertTextBlockInputSchema.safeParse({
      pdf_path: "C:/test.pdf",
      page: 0,
      x: 50,
      y: 700,
      text: "Hello",
      output_path: "C:/out.pdf",
      max_width: 10_001,
    });
    expect(result.success).toBe(false);
  });
});

// ── Phase 2: Path Traversal Protection ───────────────────────────────

describe("Path traversal protection", () => {
  it("pdfPathSchema rejects Windows path traversal", () => {
    const result = pdfPathSchema.safeParse(
      "C:/Users/docs/../../windows/system32/evil.pdf"
    );
    expect(result.success).toBe(false);
  });

  it("pdfPathSchema rejects Unix path traversal", () => {
    const result = pdfPathSchema.safeParse(
      "/tmp/../../../etc/shadow.pdf"
    );
    expect(result.success).toBe(false);
  });

  it("pdfPathSchema rejects mixed separator traversal", () => {
    const result = pdfPathSchema.safeParse(
      "C:/Users/docs/..\\..\\evil.pdf"
    );
    expect(result.success).toBe(false);
  });

  it("pdfPathSchema accepts clean Windows path", () => {
    const result = pdfPathSchema.safeParse("C:/Users/docs/file.pdf");
    expect(result.success).toBe(true);
  });

  it("pdfPathSchema accepts clean Unix path", () => {
    const result = pdfPathSchema.safeParse(
      "/home/user/documents/report.pdf"
    );
    expect(result.success).toBe(true);
  });

  it("outputPathSchema rejects path traversal", () => {
    const result = outputPathSchema.safeParse(
      "C:/output/../../../windows/evil.pdf"
    );
    expect(result.success).toBe(false);
  });

  it("outputPathSchema accepts clean path", () => {
    const result = outputPathSchema.safeParse("C:/output/result.pdf");
    expect(result.success).toBe(true);
  });
});
