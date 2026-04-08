import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, unlinkSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_PATH = resolve(__dirname, "..", "bridge.py");
const FIXTURE_PDF = resolve(__dirname, "fixtures", "reportlab_simple.pdf");
const RESUME_PDF = resolve(__dirname, "fixtures", "resume_aryan.pdf");
const PYTHON_CMD = process.env.PDF_EDIT_PYTHON || "C:/Python312/python.exe";

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

    // Wait for "ready" on stderr
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Bridge startup timed out")), 10000);
      const stderrRl = createInterface({ input: proc.stderr! });
      stderrRl.on("line", (line: string) => {
        if (line === "ready") {
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
    const res = await call("inspect", { pdf_path: RESUME_PDF });
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
      const inspectRes = await call("inspect", { pdf_path: RESUME_PDF });
      expect(inspectRes.error).toBeUndefined();
      const annotations = inspectRes.result!.annotations as Array<Record<string, unknown>>;
      const linkAnnot = annotations.find((a) => a.url !== undefined);
      expect(linkAnnot).toBeDefined();

      const res = await call("update_annotation", {
        pdf_path: RESUME_PDF,
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
      pdf_path: RESUME_PDF,
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
});
