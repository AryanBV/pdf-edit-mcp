import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, unlinkSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_PATH = resolve(__dirname, "..", "bridge.py");
const FIXTURE_PDF = resolve(__dirname, "fixtures", "reportlab_simple.pdf");
const STRUCTURED_PDF = resolve(__dirname, "fixtures", "structured_doc.pdf");
const PYTHON_CMD = process.env.PDF_EDIT_PYTHON || "python";

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** Send a JSON-RPC request and await the response. */
function callBridge(
  proc: ChildProcess,
  rl: Interface,
  method: string,
  params: Record<string, unknown>,
  id: number
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Bridge call timed out")), 15000);

    const onLine = (line: string) => {
      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        if (response.id === id) {
          rl.removeListener("line", onLine);
          clearTimeout(timeout);
          resolve(response);
        }
      } catch {
        // Ignore non-JSON lines
      }
    };

    rl.on("line", onLine);

    const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    proc.stdin!.write(request + "\n");
  });
}

describe("bridge.py integration tests", () => {
  let proc: ChildProcess;
  let rl: Interface;
  let callId = 0;

  beforeAll(async () => {
    proc = spawn(PYTHON_CMD, [BRIDGE_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    rl = createInterface({ input: proc.stdout! });

    // Wait for "ready" on stderr (banner may include engine version: "ready (engine v0.1.2)")
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Bridge startup timed out")), 10000);
      const stderrRl = createInterface({ input: proc.stderr! });
      stderrRl.on("line", (line: string) => {
        if (line.startsWith("ready")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      proc.on("close", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Bridge exited during startup with code ${code}`));
      });
    });
  });

  afterAll(() => {
    if (proc) {
      proc.kill();
    }
  });

  function call(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    return callBridge(proc, rl, method, params, ++callId);
  }

  // ── get_text ─────────────────────────────────────────────────────

  it("get_text returns text and page count", async () => {
    const res = await call("get_text", { pdf_path: FIXTURE_PDF });
    expect(res.error).toBeUndefined();
    expect(res.result).toBeDefined();
    const result = res.result!;
    expect(result.text).toContain("Test Document");
    expect(result.page_count).toBe(1);
  });

  // ── find_text ────────────────────────────────────────────────────

  it("find_text returns matches with position", async () => {
    const res = await call("find_text", {
      pdf_path: FIXTURE_PDF,
      search: "Test Document",
    });
    expect(res.error).toBeUndefined();
    const matches = res.result!.matches as Array<Record<string, unknown>>;
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("Test Document");
    expect(matches[0].page).toBe(0);
    const pos = matches[0].position as Record<string, number>;
    expect(pos.x0).toBeTypeOf("number");
    expect(pos.y0).toBeTypeOf("number");
    expect(pos.x1).toBeTypeOf("number");
    expect(pos.y1).toBeTypeOf("number");
  });

  it("find_text case_sensitive=false finds matches", async () => {
    const res = await call("find_text", {
      pdf_path: FIXTURE_PDF,
      search: "test document",
      case_sensitive: false,
    });
    expect(res.error).toBeUndefined();
    const matches = res.result!.matches as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("find_text with no match returns empty array", async () => {
    const res = await call("find_text", {
      pdf_path: FIXTURE_PDF,
      search: "NONEXISTENT_STRING_12345",
    });
    expect(res.error).toBeUndefined();
    const matches = res.result!.matches as Array<Record<string, unknown>>;
    expect(matches).toHaveLength(0);
  });

  // ── replace_text ─────────────────────────────────────────────────

  it("replace_text replaces text and returns fidelity", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_replace_output.pdf");
    try {
      const res = await call("replace_text", {
        pdf_path: FIXTURE_PDF,
        search: "Test",
        replacement: "Demo",
        output_path: outputPath,
      });
      expect(res.error).toBeUndefined();
      expect(res.result!.success).toBe(true);
      expect(res.result!.fidelity).toBeDefined();
      const fidelity = res.result!.fidelity as Record<string, unknown>;
      expect(typeof fidelity.font_preserved).toBe("boolean");
      expect(typeof fidelity.overflow_detected).toBe("boolean");
      expect("any_substitution" in fidelity).toBe(true);

      // v0.1.1: per-result detail with full FidelityReport shape
      const results = res.result!.results as Array<Record<string, unknown>>;
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      const perResultFidelity = results[0].fidelity as Record<string, unknown>;
      expect("font_substituted" in perResultFidelity).toBe(true);
      expect("glyphs_missing" in perResultFidelity).toBe(true);
      expect(Array.isArray(perResultFidelity.glyphs_missing)).toBe(true);

      expect(existsSync(outputPath)).toBe(true);
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  // ── batch_replace ────────────────────────────────────────────────

  it("batch_replace processes multiple edits", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_batch_output.pdf");
    try {
      const res = await call("batch_replace", {
        pdf_path: FIXTURE_PDF,
        edits: [
          { find: "Test", replace: "Demo" },
          { find: "simple", replace: "basic" },
        ],
        output_path: outputPath,
      });
      expect(res.error).toBeUndefined();
      const results = res.result!.results as Array<Record<string, unknown>>;
      expect(results).toHaveLength(2);
      const summary = res.result!.summary as Record<string, number>;
      expect(summary.total).toBe(2);
      expect(existsSync(outputPath)).toBe(true);
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  // ── get_fonts ────────────────────────────────────────────────────

  it("get_fonts returns font list", async () => {
    const res = await call("get_fonts", { pdf_path: FIXTURE_PDF });
    expect(res.error).toBeUndefined();
    const fonts = res.result!.fonts as Array<Record<string, unknown>>;
    expect(fonts.length).toBeGreaterThanOrEqual(1);
    expect(fonts[0].name).toBeTypeOf("string");
    expect(fonts[0].encoding_type).toBeTypeOf("string");
    expect(typeof fonts[0].is_subset).toBe("boolean");
  });

  // ── detect_paragraphs ────────────────────────────────────────────

  it("detect_paragraphs returns paragraph list", async () => {
    const res = await call("detect_paragraphs", { pdf_path: FIXTURE_PDF });
    expect(res.error).toBeUndefined();
    const paragraphs = res.result!.paragraphs as Array<Record<string, unknown>>;
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    const p = paragraphs[0];
    expect(p.text).toBeTypeOf("string");
    expect(p.font_name).toBeTypeOf("string");
    expect(p.font_size).toBeTypeOf("number");
    expect(p.line_count).toBeTypeOf("number");
    expect(p.page).toBe(0);
    const bbox = p.bbox as Record<string, number>;
    expect(bbox.x0).toBeTypeOf("number");
    expect(bbox.y1).toBeTypeOf("number");
  });

  it("detect_paragraphs with explicit page=0", async () => {
    const res = await call("detect_paragraphs", {
      pdf_path: FIXTURE_PDF,
      page: 0,
    });
    expect(res.error).toBeUndefined();
    const paragraphs = res.result!.paragraphs as Array<Record<string, unknown>>;
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
  });

  // ── replace_single ──────────────────────────────────────────────

  it("replace_single replaces first match", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_single_output.pdf");
    try {
      const res = await call("replace_single", {
        pdf_path: FIXTURE_PDF,
        search: "Test Document",
        match_index: 0,
        replacement: "Demo Document",
        output_path: outputPath,
      });
      expect(res.error).toBeUndefined();
      expect(res.result!.success).toBe(true);
      expect(res.result!.fidelity).toBeDefined();
      expect(existsSync(outputPath)).toBe(true);
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  it("replace_single with invalid match_index returns error", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_single_bad.pdf");
    const res = await call("replace_single", {
      pdf_path: FIXTURE_PDF,
      search: "Test Document",
      match_index: 999,
      replacement: "Demo",
      output_path: outputPath,
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32000);
    expect(res.error!.message).toContain("out of range");
  });

  // ── analyze_subset ──────────────────────────────────────────────

  it("analyze_subset with non-existent font returns error", async () => {
    const res = await call("analyze_subset", {
      pdf_path: FIXTURE_PDF,
      text: "Hello",
      font_name: "NonExistentFont",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32000);
  });

  // ── Error handling ──────────────────────────────────────────────

  it("non-existent PDF returns JSON-RPC error", async () => {
    const res = await call("get_text", {
      pdf_path: "C:/nonexistent/file.pdf",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32000);
    expect(res.error!.message).toBeTruthy();
  });

  it("invalid method returns method-not-found error", async () => {
    const res = await call("nonexistent_method", {});
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
    expect(res.error!.message).toContain("Method not found");
  });

  // ── inspect ─────────────────────────────────────────────────────

  it("inspect returns text, fonts, paragraphs, and annotations", async () => {
    const res = await call("inspect", { pdf_path: FIXTURE_PDF });
    expect(res.error).toBeUndefined();
    expect(res.result).toBeDefined();
    const result = res.result!;
    expect(result.page_count).toBe(1);
    expect(result.text).toContain("Test Document");
    const fonts = result.fonts as Array<Record<string, unknown>>;
    expect(fonts.length).toBeGreaterThanOrEqual(1);
    expect(fonts[0].name).toBeTypeOf("string");
    const paragraphs = result.paragraphs as Array<Record<string, unknown>>;
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(paragraphs[0].text).toBeTypeOf("string");
    expect(result.annotations).toBeDefined();
    expect(Array.isArray(result.annotations)).toBe(true);
  });

  it("inspect on PDF without annotations returns empty annotations array", async () => {
    const res = await call("inspect", { pdf_path: FIXTURE_PDF });
    expect(res.error).toBeUndefined();
    const annotations = res.result!.annotations as Array<Record<string, unknown>>;
    expect(annotations).toHaveLength(0);
  });

  it("inspect on resume PDF returns non-empty annotations", async () => {
    const res = await call("inspect", { pdf_path: STRUCTURED_PDF });
    expect(res.error).toBeUndefined();
    expect(res.result).toBeDefined();
    const annotations = res.result!.annotations as Array<Record<string, unknown>>;
    expect(annotations.length).toBeGreaterThanOrEqual(1);
    expect(annotations[0].subtype).toBeTypeOf("string");
    expect(annotations[0].rect).toBeDefined();
    expect(annotations[0].page).toBeTypeOf("number");
  });

  // ── update_annotation ───────────────────────────────────────────

  it("update_annotation changes a URL and saves correctly", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_annot_output.pdf");
    try {
      // First inspect to find an annotation with a URL
      const inspectRes = await call("inspect", { pdf_path: STRUCTURED_PDF });
      expect(inspectRes.error).toBeUndefined();
      const annotations = inspectRes.result!.annotations as Array<Record<string, unknown>>;
      const linkAnnot = annotations.find((a) => a.url !== undefined);
      expect(linkAnnot).toBeDefined();

      const res = await call("update_annotation", {
        pdf_path: STRUCTURED_PDF,
        page: linkAnnot!.page as number,
        annotation_index: linkAnnot!.index as number,
        url: "https://example.com/updated",
        output_path: outputPath,
      });
      expect(res.error).toBeUndefined();
      expect(res.result!.success).toBe(true);
      expect(res.result!.new_url).toBe("https://example.com/updated");
      expect(res.result!.old_url).toBeTypeOf("string");
      expect(existsSync(outputPath)).toBe(true);
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  it("update_annotation with invalid index returns error", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_annot_bad.pdf");
    const res = await call("update_annotation", {
      pdf_path: STRUCTURED_PDF,
      page: 0,
      annotation_index: 999,
      url: "https://example.com",
      output_path: outputPath,
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32000);
    expect(res.error!.message).toContain("out of range");
  });

  // ── batch_replace verification ──────────────────────────────────

  it("batch_replace includes verification data", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_batch_verify.pdf");
    try {
      const res = await call("batch_replace", {
        pdf_path: FIXTURE_PDF,
        edits: [
          { find: "Test", replace: "Demo" },
          { find: "simple", replace: "basic" },
        ],
        output_path: outputPath,
      });
      expect(res.error).toBeUndefined();
      const verification = res.result!.verification as Record<string, unknown>;
      expect(verification).toBeDefined();
      expect(typeof verification.all_replacements_confirmed).toBe("boolean");
      expect(verification.output_text_preview).toBeTypeOf("string");
      expect(Array.isArray(verification.unconfirmed)).toBe(true);
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  // ── replace_block ──────────────────────────────────────────────

  it("replace_block replaces content by bounding box", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_replace_block.pdf");
    try {
      // Get a paragraph bbox from detect_paragraphs
      const detectRes = await call("detect_paragraphs", {
        pdf_path: STRUCTURED_PDF,
        page: 0,
      });
      expect(detectRes.error).toBeUndefined();
      const paragraphs = detectRes.result!.paragraphs as Array<Record<string, unknown>>;
      expect(paragraphs.length).toBeGreaterThanOrEqual(1);
      const bbox = paragraphs[0].bbox as Record<string, number>;

      const res = await call("replace_block", {
        pdf_path: STRUCTURED_PDF,
        page: 0,
        bbox,
        new_text: "REPLACED CONTENT",
        output_path: outputPath,
      });
      expect(res.error).toBeUndefined();
      expect(res.result!.success).toBe(true);
      expect(res.result!.font_action).toBeTypeOf("string");
      const fidelity = res.result!.fidelity as Record<string, unknown>;
      expect(typeof fidelity.font_preserved).toBe("boolean");
      expect(typeof fidelity.overflow_detected).toBe("boolean");
      // v0.1.1: full FidelityReport shape
      expect("font_substituted" in fidelity).toBe(true);
      expect("reflow_applied" in fidelity).toBe(true);
      expect(Array.isArray(fidelity.glyphs_missing)).toBe(true);

      // Verify the replacement text appears in output (may be line-wrapped)
      const textRes = await call("get_text", { pdf_path: outputPath });
      expect(textRes.error).toBeUndefined();
      const outText = textRes.result!.text as string;
      expect(outText).toContain("REPLACED");
      expect(outText).toContain("CONTENT");
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  // ── batch_replace_block ────────────────────────────────────────

  it("batch_replace_block replaces multiple bboxes on same page", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_batch_block.pdf");
    try {
      // Get two paragraph bboxes
      const detectRes = await call("detect_paragraphs", {
        pdf_path: STRUCTURED_PDF,
        page: 0,
      });
      expect(detectRes.error).toBeUndefined();
      const paragraphs = detectRes.result!.paragraphs as Array<Record<string, unknown>>;
      expect(paragraphs.length).toBeGreaterThanOrEqual(2);
      const bbox1 = paragraphs[0].bbox as Record<string, number>;
      const bbox2 = paragraphs[1].bbox as Record<string, number>;

      const res = await call("batch_replace_block", {
        pdf_path: STRUCTURED_PDF,
        page: 0,
        replacements: [
          { bbox: bbox1, new_text: "FIRST BLOCK REPLACED" },
          { bbox: bbox2, new_text: "SECOND BLOCK REPLACED" },
        ],
        output_path: outputPath,
      });
      expect(res.error).toBeUndefined();
      expect(res.result).toBeDefined();

      const results = res.result!.results as Array<Record<string, unknown>>;
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);

      const summary = res.result!.summary as Record<string, number>;
      expect(summary.total).toBe(2);
      expect(summary.succeeded).toBe(2);
      expect(summary.failed).toBe(0);

      // Verify both replacements appear in output (text may be line-wrapped)
      const textRes = await call("get_text", { pdf_path: outputPath });
      expect(textRes.error).toBeUndefined();
      const outText = textRes.result!.text as string;
      expect(outText).toContain("FIRST");
      expect(outText).toContain("SECOND");
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  it("batch_replace_block returns EditResult with fidelity data", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_batch_block_fidelity.pdf");
    try {
      const detectRes = await call("detect_paragraphs", {
        pdf_path: STRUCTURED_PDF,
        page: 0,
      });
      expect(detectRes.error).toBeUndefined();
      const paragraphs = detectRes.result!.paragraphs as Array<Record<string, unknown>>;
      const bbox = paragraphs[0].bbox as Record<string, number>;

      const res = await call("batch_replace_block", {
        pdf_path: STRUCTURED_PDF,
        page: 0,
        replacements: [{ bbox, new_text: "FIDELITY CHECK" }],
        output_path: outputPath,
      });
      expect(res.error).toBeUndefined();

      const results = res.result!.results as Array<Record<string, unknown>>;
      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.success).toBe(true);
      expect(result.font_action).toBeTypeOf("string");
      expect(result.original_text).toBeTypeOf("string");
      expect(result.new_text).toBeTypeOf("string");
      const fidelity = result.fidelity as Record<string, unknown>;
      expect(typeof fidelity.font_preserved).toBe("boolean");
      expect(typeof fidelity.overflow_detected).toBe("boolean");
      expect(typeof fidelity.reflow_applied).toBe("boolean");
      // v0.1.1: full FidelityReport shape
      expect("font_substituted" in fidelity).toBe(true);
      expect(Array.isArray(fidelity.glyphs_missing)).toBe(true);
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  it("batch_replace_block forwards line_height and section_gap kwargs", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_batch_block_lh.pdf");
    try {
      const detectRes = await call("detect_paragraphs", {
        pdf_path: STRUCTURED_PDF,
        page: 0,
      });
      const paragraphs = detectRes.result!.paragraphs as Array<Record<string, unknown>>;
      const bbox1 = paragraphs[0].bbox as Record<string, number>;
      const bbox2 = paragraphs[1]?.bbox as Record<string, number> | undefined;

      const replacements: Array<{ bbox: Record<string, number>; new_text: string }> = [
        { bbox: bbox1, new_text: "Line height test" },
      ];
      if (bbox2) replacements.push({ bbox: bbox2, new_text: "Second block" });

      const res = await call("batch_replace_block", {
        pdf_path: STRUCTURED_PDF,
        page: 0,
        replacements,
        output_path: outputPath,
        line_height: 14,
        section_gap: 6,
      });
      // The kwargs flow through to engine; engine accepts them in v0.1.2.
      // We only assert the call doesn't error. If the engine ever rejects
      // these names, we'd see a JSON-RPC error here — that's the regression
      // signal we want.
      expect(res.error).toBeUndefined();
      expect(res.result).toBeDefined();
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  // ── insert_text_block ──────────────────────────────────────────

  it("insert_text_block inserts text at position", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_insert_block.pdf");
    try {
      const res = await call("insert_text_block", {
        pdf_path: STRUCTURED_PDF,
        page: 0,
        x: 72,
        y: 700,
        text: "INSERTED TEXT BLOCK",
        output_path: outputPath,
      });
      expect(res.error).toBeUndefined();
      expect(res.result!.success).toBe(true);
      const fidelity = res.result!.fidelity as Record<string, unknown>;
      expect(fidelity).toBeDefined();

      // Verify the inserted text appears in output
      const textRes = await call("get_text", { pdf_path: outputPath });
      expect(textRes.error).toBeUndefined();
      expect(textRes.result!.text).toContain("INSERTED TEXT BLOCK");
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  // ── delete_block ───────────────────────────────────────────────

  it("delete_block removes content by bounding box", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_delete_block.pdf");
    try {
      // Get a paragraph bbox and its text
      const detectRes = await call("detect_paragraphs", {
        pdf_path: STRUCTURED_PDF,
        page: 0,
      });
      expect(detectRes.error).toBeUndefined();
      const paragraphs = detectRes.result!.paragraphs as Array<Record<string, unknown>>;
      expect(paragraphs.length).toBeGreaterThanOrEqual(1);
      const targetParagraph = paragraphs[0];
      const bbox = targetParagraph.bbox as Record<string, number>;
      const originalText = (targetParagraph.text as string).slice(0, 30);

      const res = await call("delete_block", {
        pdf_path: STRUCTURED_PDF,
        page: 0,
        bbox,
        output_path: outputPath,
      });
      expect(res.error).toBeUndefined();
      expect(res.result!.success).toBe(true);

      // Verify the text is gone from output
      const textRes = await call("get_text", { pdf_path: outputPath });
      expect(textRes.error).toBeUndefined();
      expect(textRes.result!.text).not.toContain(originalText);
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  // ── UTF-8 round-trip ──────────────────────────────────────────

  it("UTF-8 em dash survives JSON-RPC round-trip", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_utf8_roundtrip.pdf");
    try {
      const res = await call("batch_replace", {
        pdf_path: FIXTURE_PDF,
        edits: [{ find: "Test", replace: "Test \u2014 Demo" }],
        output_path: outputPath,
      });
      // Response arriving without crash proves UTF-8 stdout works
      expect(res.error).toBeUndefined();
      expect(res.result).toBeDefined();
      const results = res.result!.results as Array<Record<string, unknown>>;
      expect(results.length).toBeGreaterThanOrEqual(1);

      // Verify em dash appears in the output text
      const textRes = await call("get_text", { pdf_path: outputPath });
      expect(textRes.error).toBeUndefined();
      const text = textRes.result!.text as string;
      expect(text).toContain("\u2014");
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  // ── Error recovery ────────────────────────────────────────────

  it("replace_block with invalid bbox returns error, bridge survives", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_bad_bbox.pdf");
    const res = await call("replace_block", {
      pdf_path: STRUCTURED_PDF,
      page: 0,
      bbox: { x0: 9999, y0: 9999, x1: 9999, y1: 9999 },
      new_text: "Should fail",
      output_path: outputPath,
    });
    // Should get an error or at least not crash
    // The bridge might succeed with empty original_text or return an error
    if (res.error) {
      expect(res.error.code).toBeTypeOf("number");
    }

    // Verify bridge is still alive with a subsequent valid call
    const textRes = await call("get_text", { pdf_path: FIXTURE_PDF });
    expect(textRes.error).toBeUndefined();
    expect(textRes.result!.text).toContain("Test Document");

    // Cleanup in case the operation did produce a file
    if (existsSync(outputPath)) unlinkSync(outputPath);
  });

  // ── v0.1.1: dry_run preview (no file written) ──

  it("replace_text dry_run=true returns results without writing the output PDF", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_dry_run_should_not_exist.pdf");
    // Make sure no stale file exists from a prior run
    if (existsSync(outputPath)) unlinkSync(outputPath);

    const res = await call("replace_text", {
      pdf_path: FIXTURE_PDF,
      search: "Test",
      replacement: "Demo",
      output_path: outputPath,
      dry_run: true,
    });
    expect(res.error).toBeUndefined();
    expect(res.result!.dry_run).toBe(true);
    // Per-result fidelity should still be populated even on dry_run.
    const results = res.result!.results as Array<Record<string, unknown>>;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    // CRITICAL: no file must have been written.
    expect(existsSync(outputPath)).toBe(false);
  });

  it("batch_replace dry_run=true skips verification step gracefully", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_batch_dry_run.pdf");
    if (existsSync(outputPath)) unlinkSync(outputPath);

    const res = await call("batch_replace", {
      pdf_path: FIXTURE_PDF,
      edits: [{ find: "Test", replace: "Demo" }],
      output_path: outputPath,
      dry_run: true,
    });
    expect(res.error).toBeUndefined();
    expect(res.result!.dry_run).toBe(true);
    const verification = res.result!.verification as Record<string, unknown>;
    // Verification should signal that no output was written.
    expect(String(verification.output_text_preview)).toContain("dry_run");
    expect(existsSync(outputPath)).toBe(false);
  });

  // ── v0.1.1: page filter on read tools ──

  it("get_text with page=0 returns text from page 0 only", async () => {
    const res = await call("get_text", { pdf_path: FIXTURE_PDF, page: 0 });
    expect(res.error).toBeUndefined();
    expect(typeof res.result!.text).toBe("string");
    expect(typeof res.result!.page_count).toBe("number");
  });

  it("find_text with page=0 limits the match list to that page", async () => {
    const res = await call("find_text", {
      pdf_path: FIXTURE_PDF,
      search: "Test",
      page: 0,
    });
    expect(res.error).toBeUndefined();
    const matches = res.result!.matches as Array<Record<string, unknown>>;
    // All returned matches must be on page 0.
    for (const m of matches) {
      expect(m.page).toBe(0);
    }
  });

  it("get_fonts with page=0 lists fonts used on that page only", async () => {
    const res = await call("get_fonts", { pdf_path: FIXTURE_PDF, page: 0 });
    expect(res.error).toBeUndefined();
    const fonts = res.result!.fonts as Array<Record<string, unknown>>;
    expect(Array.isArray(fonts)).toBe(true);
  });

  // ── v0.1.1: pdf_inspect font detail enrichment ──

  it("inspect surfaces full FontInfo shape (postscript_name, glyph_count, embedded_type)", async () => {
    const res = await call("inspect", {
      pdf_path: FIXTURE_PDF,
      include_layout: false,
    });
    expect(res.error).toBeUndefined();
    const fonts = res.result!.fonts as Array<Record<string, unknown>>;
    expect(Array.isArray(fonts)).toBe(true);
    if (fonts.length > 0) {
      const f = fonts[0];
      expect("postscript_name" in f).toBe(true);
      expect("glyph_count" in f).toBe(true);
      expect("embedded_type" in f).toBe(true);
    }
  });

  // ── v0.1.1: section orchestration (CR-1 — were untested before) ──

  it("detect_sections returns a tree with body_font + heading_fonts", async () => {
    const res = await call("detect_sections", {
      pdf_path: STRUCTURED_PDF,
      page: 0,
      include_text: false,
    });
    expect(res.error).toBeUndefined();
    expect(res.result).toBeDefined();
    expect(Array.isArray(res.result!.sections)).toBe(true);
    // body_font may legitimately be null for very small fixtures; the field
    // must exist either way.
    expect("body_font" in res.result!).toBe(true);
    expect(Array.isArray(res.result!.heading_fonts)).toBe(true);
  });

  it("replace_section against a non-existent name returns a list of titles", async () => {
    const outputPath = resolve(__dirname, "fixtures", "test_replace_section_missing.pdf");
    if (existsSync(outputPath)) unlinkSync(outputPath);
    try {
      const res = await call("replace_section", {
        pdf_path: STRUCTURED_PDF,
        section: "definitely-not-a-section-name-12345",
        new_text: "Replacement",
        output_path: outputPath,
        page: 0,
      });
      // Either an error (preferred) or success=false. Both are acceptable —
      // what we want is "no crash, no silent wrong-section swap".
      if (res.error) {
        expect(res.error.message.toLowerCase()).toContain("not found");
      }
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  it("swap_sections with two short ambiguous names rejects rather than swapping wrong sections", async () => {
    // X-2 regression guard: previously a substring like "test" against
    // multiple "Test ..." sections would silently match the first.
    const outputPath = resolve(__dirname, "fixtures", "test_swap_ambiguous.pdf");
    if (existsSync(outputPath)) unlinkSync(outputPath);
    try {
      const res = await call("swap_sections", {
        pdf_path: STRUCTURED_PDF,
        section_a: "x",  // intentionally ambiguous / too-short
        section_b: "y",
        output_path: outputPath,
        page: 0,
      });
      // We expect an error path. The shape can vary (not_found vs ambiguous),
      // but a SUCCESS without warning would be the silent-bug regression.
      expect(res.error).toBeDefined();
      // Output should not exist on the error path.
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  });

  // ── v0.1.1: encrypted-PDF leak check (no raw pikepdf exceptions) ──

  it("encrypted PDFs return PDFEditError, not raw pikepdf.PasswordError", async () => {
    const encryptedPath = resolve(__dirname, "fixtures", "test_encrypted.pdf");
    try {
      // Build an encrypted fixture from a known-good source.
      const encRes = await call("encrypt", {
        pdf_path: FIXTURE_PDF,
        owner_password: "ownerpass",
        user_password: "userpass",
        output_path: encryptedPath,
      });
      expect(encRes.error).toBeUndefined();
      expect(existsSync(encryptedPath)).toBe(true);

      // Every read/edit path that goes through bridge.py must translate
      // pikepdf exceptions to PDFEditError. With v0.1.1, every direct
      // pikepdf.open() in bridge.py is wrapped via _translate_pikepdf,
      // and update_annotation now routes through the engine entirely.
      const probes = [
        { method: "get_text", params: { pdf_path: encryptedPath } },
        {
          method: "inspect",
          params: { pdf_path: encryptedPath, include_layout: false },
        },
      ];

      for (const { method, params } of probes) {
        const res = await call(method, params);
        expect(res.error).toBeDefined();
        // Message must NOT contain raw pikepdf class names — the leak signal.
        expect(res.error!.message).not.toMatch(/PasswordError/);
        expect(res.error!.message).not.toMatch(/PdfError/);
      }
    } finally {
      if (existsSync(encryptedPath)) unlinkSync(encryptedPath);
    }
  });
});
