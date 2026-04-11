#!/usr/bin/env node

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getTextInputSchema,
  findTextInputSchema,
  replaceTextInputSchema,
  batchReplaceInputSchema,
  getFontsInputSchema,
  detectParagraphsInputSchema,
  analyzeSubsetInputSchema,
  replaceSingleInputSchema,
  inspectInputSchema,
  updateAnnotationInputSchema,
  replaceBlockInputSchema,
  insertTextBlockInputSchema,
  deleteBlockInputSchema,
  batchReplaceBlockInputSchema,
  getTextLayoutInputSchema,
  extractBboxTextInputSchema,
  swapSectionsInputSchema,
  replaceSectionInputSchema,
  detectSectionsInputSchema,
  mergeInputSchema,
  splitInputSchema,
  reorderPagesInputSchema,
  rotatePagesInputSchema,
  deletePagesInputSchema,
  cropPagesInputSchema,
  editMetadataInputSchema,
  addBookmarkInputSchema,
  encryptInputSchema,
  decryptInputSchema,
  addHyperlinkInputSchema,
  addHighlightInputSchema,
  flattenAnnotationsInputSchema,
  fillFormInputSchema,
  addWatermarkInputSchema,
  getAnnotationsInputSchema,
  addAnnotationInputSchema,
  deleteAnnotationInputSchema,
  moveAnnotationInputSchema,
} from "./schemas.js";

// ── Constants ────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_PATH = resolve(__dirname, "..", "bridge.py");
const PYTHON_CMD = process.env.PDF_EDIT_PYTHON || "python";

// ── Types ────────────────────────────────────────────────────────────

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── BridgeProcess ────────────────────────────────────────────────────

class BridgeProcess {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private hasRestarted = false;
  private callQueue: Promise<unknown> = Promise.resolve();

  async spawn(): Promise<void> {
    return new Promise<void>((resolveSpawn, rejectSpawn) => {
      const proc = spawn(PYTHON_CMD, [BRIDGE_PATH], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let startupResolved = false;

      proc.on("error", (err: Error) => {
        if (!startupResolved) {
          startupResolved = true;
          rejectSpawn(
            new Error(
              `Failed to start Python: ${err.message}. ` +
                `Set PDF_EDIT_PYTHON to the path of your Python 3.12+ executable.`
            )
          );
        }
      });

      proc.on("close", (code: number | null) => {
        if (!startupResolved) {
          startupResolved = true;
          rejectSpawn(
            new Error(
              `bridge.py exited during startup (code ${code}). ` +
                `Is pdf-edit-engine installed? Run: pip install pdf-edit-engine`
            )
          );
          return;
        }
        this.handleDeath(code);
      });

      // Parse JSON-RPC responses from stdout
      const rl = createInterface({ input: proc.stdout! });
      rl.on("line", (line: string) => {
        let response: JsonRpcResponse;
        try {
          response = JSON.parse(line) as JsonRpcResponse;
        } catch {
          console.error(`bridge.py: invalid JSON on stdout: ${line}`);
          return;
        }
        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      });

      // Listen for "ready" on stderr
      const stderrRl = createInterface({ input: proc.stderr! });
      stderrRl.on("line", (line: string) => {
        if (line === "ready" && !startupResolved) {
          startupResolved = true;
          this.process = proc;
          this.readline = rl;
          resolveSpawn();
          return;
        }
        // Log bridge stderr messages
        console.error(`bridge.py: ${line}`);
      });
    });
  }

  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    // Serialize calls — only one in-flight at a time
    const result = this.callQueue.then(() => this.doCall(method, params));
    this.callQueue = result.catch(() => {});
    return result;
  }

  private doCall(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    return new Promise<unknown>((resolveCall, rejectCall) => {
      if (!this.process || !this.process.stdin) {
        rejectCall(new Error("Bridge process is not running"));
        return;
      }

      const id = ++this.requestId;
      const request = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`Bridge call timed out after 30s: ${method}`));
      }, 30000);

      this.pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      this.process.stdin.write(request + "\n");
    });
  }

  private handleDeath(code: number | null): void {
    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Bridge process died (code ${code})`));
      this.pending.delete(id);
    }
    this.process = null;
    this.readline = null;

    if (!this.hasRestarted) {
      this.hasRestarted = true;
      console.error("bridge.py died unexpectedly, attempting restart...");
      this.spawn().catch((err: Error) => {
        console.error(`Failed to restart bridge.py: ${err.message}`);
      });
    }
  }

  shutdown(): void {
    if (this.process) {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Bridge shutting down"));
        this.pending.delete(id);
      }
      this.process.kill();
      this.process = null;
      this.readline = null;
    }
  }
}

// ── Response helpers ─────────────────────────────────────────────────

function toolSuccess(data: unknown) {
  const text =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function toolError(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

// ── Server setup ─────────────────────────────────────────────────────

const server = new McpServer(
  {
    name: "pdf-edit-mcp",
    version: "0.1.0",
  },
  {
    instructions:
      "pdf-edit-mcp edits text in existing PDFs while preserving fonts and layout.\n\n" +
      "TOOL GUIDE:\n" +
      "Section operations (swap, rewrite, move sections): pdf_swap_sections, pdf_replace_section\n" +
      "Text operations (names, dates, typos, labels): pdf_replace_text, pdf_batch_replace\n" +
      "Structure analysis (understand sections, fonts, layout): pdf_inspect, pdf_detect_sections\n" +
      "Document operations (merge, split, rotate, encrypt): pdf_merge, pdf_split, pdf_rotate_pages, pdf_encrypt\n" +
      "Annotations (links, highlights, bookmarks): pdf_get_annotations, pdf_add_annotation\n\n" +
      "Always output to a NEW file path — never overwrite the input PDF.",
  }
);

const bridge = new BridgeProcess();

// ── Tool: pdf_get_text ───────────────────────────────────────────────

server.registerTool(
  "pdf_get_text",
  {
    description:
      "Extract all text from a PDF. For comprehensive understanding before editing, " +
      "use pdf_inspect instead — it returns text, fonts, structure, and annotations in one call.",
    inputSchema: getTextInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ pdf_path }) => {
    try {
      const result = await bridge.call("get_text", { pdf_path });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_find_text ──────────────────────────────────────────────

server.registerTool(
  "pdf_find_text",
  {
    description:
      "Find all occurrences of a search string with positions and page numbers. " +
      "Use to verify text exists before a targeted edit.",
    inputSchema: findTextInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, search, case_sensitive }) => {
    try {
      const result = await bridge.call("find_text", {
        pdf_path,
        search,
        case_sensitive,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_replace_text ───────────────────────────────────────────

server.registerTool(
  "pdf_replace_text",
  {
    description:
      "Replace ALL occurrences of a text string — for simple changes like names, " +
      "dates, typos, or labels. For 2+ related changes, use pdf_batch_replace. " +
      "Do NOT use for swapping or rewriting entire sections — use " +
      "pdf_swap_sections or pdf_replace_section instead. " +
      "Call pdf_inspect first to understand the document.",
    inputSchema: replaceTextInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, search, replacement, output_path, reflow }) => {
    try {
      const warnings: string[] = [];
      if (output_path === pdf_path) {
        warnings.push(
          "Warning: output_path is the same as pdf_path. The original file will be overwritten."
        );
      }
      const result = await bridge.call("replace_text", {
        pdf_path,
        search,
        replacement,
        output_path,
        reflow,
      });
      if (warnings.length > 0) {
        const data = result as Record<string, unknown>;
        data.warnings = warnings;
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_batch_replace ──────────────────────────────────────────

server.registerTool(
  "pdf_batch_replace",
  {
    description:
      "Apply multiple find-and-replace text edits in one atomic operation. " +
      "PREFERRED for 2+ simple text changes in one call — renaming, dates, labels, " +
      "template fields. Do NOT use for swapping or rewriting entire sections — " +
      "use pdf_swap_sections or pdf_replace_section instead. " +
      "Include ALL related text changes in one call.",
    inputSchema: batchReplaceInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, edits, output_path }) => {
    try {
      const warnings: string[] = [];
      if (output_path === pdf_path) {
        warnings.push(
          "Warning: output_path is the same as pdf_path. The original file will be overwritten."
        );
      }
      const result = await bridge.call("batch_replace", {
        pdf_path,
        edits,
        output_path,
      });
      if (warnings.length > 0) {
        const data = result as Record<string, unknown>;
        data.warnings = warnings;
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_get_fonts ──────────────────────────────────────────────

server.registerTool(
  "pdf_get_fonts",
  {
    description:
      "List fonts with full details — encoding type, glyph count, PostScript name, " +
      "embedded type, subset status. Use pdf_inspect for a quick overview, this tool " +
      "for detailed font analysis.",
    inputSchema: getFontsInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ pdf_path }) => {
    try {
      const result = await bridge.call("get_fonts", { pdf_path });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_detect_paragraphs ──────────────────────────────────────

server.registerTool(
  "pdf_detect_paragraphs",
  {
    description:
      "Detect paragraph boundaries with bounding boxes on a single page. " +
      "Use pdf_inspect for a combined view across all pages, or this tool for " +
      "lightweight single-page analysis.",
    inputSchema: detectParagraphsInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, page }) => {
    try {
      const result = await bridge.call("detect_paragraphs", { pdf_path, page });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_analyze_subset ─────────────────────────────────────────

server.registerTool(
  "pdf_analyze_subset",
  {
    description:
      "Check if a font can render specific text before editing. Call this when " +
      "replacement text contains unusual characters, symbols, or non-Latin scripts.",
    inputSchema: analyzeSubsetInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, text, font_name }) => {
    try {
      const params: Record<string, unknown> = { pdf_path, text };
      if (font_name !== undefined) {
        params.font_name = font_name;
      }
      const result = await bridge.call("analyze_subset", params);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_replace_single ─────────────────────────────────────────

server.registerTool(
  "pdf_replace_single",
  {
    description:
      "Replace only one specific occurrence by match index. Call pdf_find_text first " +
      "to see all matches and choose the right index.",
    inputSchema: replaceSingleInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, search, match_index, replacement, output_path, reflow }) => {
    try {
      const warnings: string[] = [];
      if (output_path === pdf_path) {
        warnings.push(
          "Warning: output_path is the same as pdf_path. The original file will be overwritten."
        );
      }
      const result = await bridge.call("replace_single", {
        pdf_path,
        search,
        match_index,
        replacement,
        output_path,
        reflow,
      });
      if (warnings.length > 0) {
        const data = result as Record<string, unknown>;
        data.warnings = warnings;
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_inspect ────────────────────────────────────────────────

server.registerTool(
  "pdf_inspect",
  {
    description:
      "Get a complete overview of a PDF — text, fonts, paragraph structure, and " +
      "annotations (links, bookmarks). This should be your FIRST call before any " +
      "editing operation. Returns everything needed to plan comprehensive edits. " +
      "Set include_layout=true to also get raw text blocks with positions and fonts " +
      "(useful for section detection and bbox computation).",
    inputSchema: inspectInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, include_layout }) => {
    try {
      const result = await bridge.call("inspect", { pdf_path, include_layout });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_update_annotation ─────────────────────────────────────

server.registerTool(
  "pdf_update_annotation",
  {
    description:
      "Update a link URL in a PDF annotation. Use pdf_inspect first to find annotation " +
      "indices and current URLs. This only changes the link target — to change the visible " +
      "link text, use pdf_replace_text or pdf_batch_replace. Always do text edits BEFORE " +
      "annotation updates, as text edits may shift annotation indices.",
    inputSchema: updateAnnotationInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, page, annotation_index, url, output_path }) => {
    try {
      const warnings: string[] = [];
      if (output_path === pdf_path) {
        warnings.push(
          "Warning: output_path is the same as pdf_path. The original file will be overwritten."
        );
      }
      const result = await bridge.call("update_annotation", {
        pdf_path,
        page,
        annotation_index,
        url,
        output_path,
      });
      if (warnings.length > 0) {
        const data = result as Record<string, unknown>;
        data.warnings = warnings;
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_replace_block ─────────────────────────────────────────

server.registerTool(
  "pdf_replace_block",
  {
    description:
      "Replace all content within a bounding box with new text. Use pdf_inspect or " +
      "pdf_detect_paragraphs first to get bounding boxes. This is the PREFERRED tool " +
      "for multi-line edits — it replaces by position, not by string matching, so it " +
      "handles em dashes, ligatures, and line breaks correctly. If the replacement " +
      "text overflows the bbox vertically, content below is automatically shifted down.",
    inputSchema: replaceBlockInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, page, bbox, new_text, output_path, font_name, font_size }) => {
    try {
      const warnings: string[] = [];
      if (output_path === pdf_path) {
        warnings.push(
          "Warning: output_path is the same as pdf_path. The original file will be overwritten."
        );
      }
      const params: Record<string, unknown> = {
        pdf_path,
        page,
        bbox,
        new_text,
        output_path,
      };
      if (font_name !== undefined) params.font_name = font_name;
      if (font_size !== undefined) params.font_size = font_size;
      const result = await bridge.call("replace_block", params);
      if (warnings.length > 0) {
        const data = result as Record<string, unknown>;
        data.warnings = warnings;
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_batch_replace_block ──────────────────────────────────

server.registerTool(
  "pdf_batch_replace_block",
  {
    description:
      "Replace content in multiple bounding boxes in one atomic operation on a single page. " +
      "For section swaps use pdf_swap_sections instead (simpler). " +
      "For rewriting one section use pdf_replace_section instead (simpler). " +
      "Use this tool for advanced multi-block edits where you have explicit bboxes. " +
      "Replacements are processed top-to-bottom with cumulative vertical shift tracking.",
    inputSchema: batchReplaceBlockInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, page_number, replacements, output_path }) => {
    try {
      const warnings: string[] = [];
      if (output_path === pdf_path) {
        warnings.push(
          "Warning: output_path is the same as pdf_path. The original file will be overwritten."
        );
      }
      const result = await bridge.call("batch_replace_block", {
        pdf_path,
        page_number,
        replacements,
        output_path,
      });
      if (warnings.length > 0) {
        const data = result as Record<string, unknown>;
        data.warnings = warnings;
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_insert_text_block ────────────────────────────────────

server.registerTool(
  "pdf_insert_text_block",
  {
    description:
      "Insert new text at a position and shift existing content down to make room. " +
      "Use pdf_inspect to find the right coordinates. The font is auto-detected from " +
      "the page. Use max_width to enable automatic text wrapping for multi-line content.",
    inputSchema: insertTextBlockInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, page, x, y, text, output_path, font_name, font_size, max_width }) => {
    try {
      const warnings: string[] = [];
      if (output_path === pdf_path) {
        warnings.push(
          "Warning: output_path is the same as pdf_path. The original file will be overwritten."
        );
      }
      const params: Record<string, unknown> = {
        pdf_path,
        page,
        x,
        y,
        text,
        output_path,
      };
      if (font_name !== undefined) params.font_name = font_name;
      if (font_size !== undefined) params.font_size = font_size;
      if (max_width !== undefined) params.max_width = max_width;
      const result = await bridge.call("insert_text_block", params);
      if (warnings.length > 0) {
        const data = result as Record<string, unknown>;
        data.warnings = warnings;
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_delete_block ─────────────────────────────────────────

server.registerTool(
  "pdf_delete_block",
  {
    description:
      "Delete all content within a bounding box. When close_gap is true (default), " +
      "content below shifts up to fill the space. Use pdf_inspect or " +
      "pdf_detect_paragraphs to get bounding boxes.",
    inputSchema: deleteBlockInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, page, bbox, output_path, close_gap }) => {
    try {
      const warnings: string[] = [];
      if (output_path === pdf_path) {
        warnings.push(
          "Warning: output_path is the same as pdf_path. The original file will be overwritten."
        );
      }
      const result = await bridge.call("delete_block", {
        pdf_path,
        page,
        bbox,
        output_path,
        close_gap,
      });
      if (warnings.length > 0) {
        const data = result as Record<string, unknown>;
        data.warnings = warnings;
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_get_text_layout ──────────────────────────────────────

server.registerTool(
  "pdf_get_text_layout",
  {
    description:
      "Get every text block on a page with its exact position, font, and size. " +
      "Each block represents one text operator's output (TJ/Tj). Use this to " +
      "identify section boundaries by font differences, compute bboxes for " +
      "block operations, or understand the document's visual structure. " +
      "For a pre-grouped view, use pdf_detect_paragraphs instead.",
    inputSchema: getTextLayoutInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, page }) => {
    try {
      const result = await bridge.call("get_text_layout", { pdf_path, page });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_extract_bbox_text ───────────────────────────────────

server.registerTool(
  "pdf_extract_bbox_text",
  {
    description:
      "Extract text from a bounding box region with gap-aware joining. " +
      "Uses position analysis to avoid inserting spurious spaces (e.g., " +
      "'monthly' stays 'monthly', not 'month ly'). Use tolerance=0 for " +
      "exact bbox matching (recommended for section extraction), or " +
      "tolerance=2+ for loose matching. Lines are separated by newlines.",
    inputSchema: extractBboxTextInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, bbox, page, tolerance }) => {
    try {
      const result = await bridge.call("extract_bbox_text", {
        pdf_path,
        bbox,
        page,
        tolerance,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Tool: pdf_detect_sections ─────────────────────────────────────

server.registerTool(
  "pdf_detect_sections",
  {
    description:
      "Analyze document structure — returns a tree of sections with titles, " +
      "bounding boxes, and extracted text. For swapping sections use " +
      "pdf_swap_sections instead (simpler). For rewriting a section use " +
      "pdf_replace_section instead (simpler). Use this tool when you need " +
      "raw structural data for custom operations. Works on resumes, papers, " +
      "legal docs, reports. Level 0 = top-level headings, Level 1+ = subsections. " +
      "If empty, fall back to pdf_get_text_layout.",
    inputSchema: detectSectionsInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, page, include_text }) => {
    try {
      const result = await bridge.call("detect_sections", {
        pdf_path,
        page,
        include_text,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Carpenter tools (high-level, intent-matching) ───────────────────

server.registerTool(
  "pdf_swap_sections",
  {
    description:
      "Swap two document sections by name. Automatically detects section " +
      "structure, identifies both sections by fuzzy title match, and swaps " +
      "all content (titles, tech stacks, bullet points) between the two " +
      "positions. All sibling sections are re-rendered for uniform spacing. " +
      "Example: 'AJSP' matches 'AJSP Manager — Business Management System'.",
    inputSchema: swapSectionsInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, section_a, section_b, output_path, page }) => {
    try {
      const result = await bridge.call("swap_sections", {
        pdf_path,
        section_a,
        section_b,
        output_path,
        page,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

server.registerTool(
  "pdf_replace_section",
  {
    description:
      "Replace an entire document section's content by name. Automatically " +
      "detects section structure, finds the section by fuzzy title match, " +
      "and replaces all content (title, tech stack, bullets — everything) " +
      "with the provided new text. All sibling sections are re-rendered for " +
      "uniform spacing.",
    inputSchema: replaceSectionInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, section, new_text, output_path, page }) => {
    try {
      const result = await bridge.call("replace_section", {
        pdf_path,
        section,
        new_text,
        output_path,
        page,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

// ── Wrapper tools (document operations) ─────────────────────────────

// Helper for simple write tools that follow the same bridge-call pattern.
// Uses `as never` cast because server.registerTool's strict type inference
// doesn't propagate through generic wrappers — runtime types are correct.
function registerWriteTool(
  name: string,
  desc: string,
  schema: z.ZodType,
  bridgeMethod: string,
  paramsFn: (args: Record<string, unknown>) => Record<string, unknown>
) {
  (server.registerTool as Function)(
    name,
    {
      description: desc,
      inputSchema: schema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await bridge.call(bridgeMethod, paramsFn(args));
        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

registerWriteTool(
  "pdf_merge",
  "Merge multiple PDFs into a single document. Pages are appended in order.",
  mergeInputSchema,
  "merge",
  (a) => ({ pdf_paths: a.pdf_paths, output_path: a.output_path })
);

registerWriteTool(
  "pdf_split",
  "Split a PDF into individual page files. Each page becomes a separate PDF in the output directory.",
  splitInputSchema,
  "split",
  (a) => ({ pdf_path: a.pdf_path, output_dir: a.output_dir })
);

registerWriteTool(
  "pdf_reorder_pages",
  "Reorder pages in a PDF. Provide the new page order as 0-indexed page numbers.",
  reorderPagesInputSchema,
  "reorder_pages",
  (a) => ({ pdf_path: a.pdf_path, page_order: a.page_order, output_path: a.output_path })
);

registerWriteTool(
  "pdf_rotate_pages",
  "Rotate specified pages by 90, 180, or 270 degrees.",
  rotatePagesInputSchema,
  "rotate_pages",
  (a) => ({ pdf_path: a.pdf_path, pages: a.pages, angle: a.angle, output_path: a.output_path })
);

registerWriteTool(
  "pdf_delete_pages",
  "Delete specified pages from a PDF. Pages are 0-indexed.",
  deletePagesInputSchema,
  "delete_pages",
  (a) => ({ pdf_path: a.pdf_path, pages: a.pages, output_path: a.output_path })
);

registerWriteTool(
  "pdf_crop_pages",
  "Crop all pages to the specified bounding box. Coordinates in PDF points.",
  cropPagesInputSchema,
  "crop_pages",
  (a) => ({ pdf_path: a.pdf_path, box: a.box, output_path: a.output_path })
);

registerWriteTool(
  "pdf_edit_metadata",
  "Edit PDF document metadata. Common fields: title, author, subject, creator, producer.",
  editMetadataInputSchema,
  "edit_metadata",
  (a) => ({ pdf_path: a.pdf_path, metadata: a.metadata, output_path: a.output_path })
);

registerWriteTool(
  "pdf_add_bookmark",
  "Add a bookmark (outline/navigation entry) pointing to a specific page.",
  addBookmarkInputSchema,
  "add_bookmark",
  (a) => ({ pdf_path: a.pdf_path, title: a.title, page: a.page, output_path: a.output_path })
);

registerWriteTool(
  "pdf_encrypt",
  "Encrypt a PDF with owner and user passwords. Owner password controls permissions, user password controls access.",
  encryptInputSchema,
  "encrypt",
  (a) => ({
    pdf_path: a.pdf_path,
    owner_password: a.owner_password,
    user_password: a.user_password,
    output_path: a.output_path,
  })
);

registerWriteTool(
  "pdf_decrypt",
  "Decrypt a password-protected PDF.",
  decryptInputSchema,
  "decrypt",
  (a) => ({ pdf_path: a.pdf_path, password: a.password, output_path: a.output_path })
);

registerWriteTool(
  "pdf_add_hyperlink",
  "Add a clickable hyperlink annotation to a page region. Use pdf_inspect to find coordinates.",
  addHyperlinkInputSchema,
  "add_hyperlink",
  (a) => ({
    pdf_path: a.pdf_path, page: a.page, bbox: a.bbox, uri: a.uri, output_path: a.output_path,
  })
);

registerWriteTool(
  "pdf_add_highlight",
  "Add a highlight annotation. Provide QuadPoints (8 floats per highlighted region).",
  addHighlightInputSchema,
  "add_highlight",
  (a) => ({
    pdf_path: a.pdf_path, page: a.page, quad_points: a.quad_points, output_path: a.output_path,
  })
);

registerWriteTool(
  "pdf_flatten_annotations",
  "Flatten all annotations into page content. Annotations become non-editable.",
  flattenAnnotationsInputSchema,
  "flatten_annotations",
  (a) => ({ pdf_path: a.pdf_path, output_path: a.output_path })
);

registerWriteTool(
  "pdf_fill_form",
  "Fill form fields in a PDF. Provide field names and values as key-value pairs.",
  fillFormInputSchema,
  "fill_form",
  (a) => ({ pdf_path: a.pdf_path, field_values: a.field_values, output_path: a.output_path })
);

registerWriteTool(
  "pdf_add_watermark",
  "Add a watermark from another PDF to all pages. The watermark PDF's first page is overlaid.",
  addWatermarkInputSchema,
  "add_watermark",
  (a) => ({ pdf_path: a.pdf_path, watermark_path: a.watermark_path, output_path: a.output_path })
);

// ── Annotation tools (engine API) ───────────────────────────────────

server.registerTool(
  "pdf_get_annotations",
  {
    description:
      "List all annotations in a PDF with their positions, types, and URLs. " +
      "Optionally filter by page. Use this instead of pdf_inspect when you " +
      "only need annotation data.",
    inputSchema: getAnnotationsInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ pdf_path, page }) => {
    try {
      const result = await bridge.call("get_annotations", { pdf_path, page });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }
);

registerWriteTool(
  "pdf_add_annotation",
  "Add a link annotation at a specific position on a page.",
  addAnnotationInputSchema,
  "add_annotation",
  (a) => ({
    pdf_path: a.pdf_path, page: a.page, rect: a.rect, uri: a.uri,
    output_path: a.output_path, border_style: a.border_style,
  })
);

registerWriteTool(
  "pdf_delete_annotation_v2",
  "Delete an annotation by page and index. Use pdf_get_annotations to find indices. " +
    "This replaces the older pdf_update_annotation approach for deletions.",
  deleteAnnotationInputSchema,
  "delete_annotation_v2",
  (a) => ({
    pdf_path: a.pdf_path, page: a.page, annotation_index: a.annotation_index,
    output_path: a.output_path,
  })
);

registerWriteTool(
  "pdf_move_annotation",
  "Move an annotation to a new position. Use pdf_get_annotations to find the annotation index.",
  moveAnnotationInputSchema,
  "move_annotation",
  (a) => ({
    pdf_path: a.pdf_path, page: a.page, annotation_index: a.annotation_index,
    new_rect: a.new_rect, output_path: a.output_path,
  })
);

// ── MCP Prompts ─────────────────────────────────────────────────────

server.registerPrompt(
  "comprehensive-pdf-edit",
  {
    description:
      "Workflow for structural PDF edits — section swaps, rewrites, multi-field updates",
  },
  async () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text:
            "When editing a PDF document, follow this workflow:\n\n" +
            "STEP 1 — INSPECT\n" +
            "Call pdf_inspect to get the full document overview (text, fonts,\n" +
            "paragraphs, annotations). Read the full text to understand the document.\n\n" +
            "STEP 2 — UNDERSTAND STRUCTURE\n" +
            "For section-level operations (swap, move, replace titled sections):\n" +
            "  → Call pdf_detect_sections for a structured section tree with bboxes and text.\n" +
            "  → Sections are grouped by font hierarchy (level 0 = largest headings).\n" +
            "For specific text positions:\n" +
            "  → Call pdf_get_text_layout for individual blocks with font/position data.\n" +
            "For simple text replacement:\n" +
            "  → Call pdf_find_text to locate all occurrences.\n\n" +
            "STEP 3 — PRE-CHECK\n" +
            "If replacement text has unusual characters (bullets •, em-dashes —, non-Latin):\n" +
            "  → Call pdf_analyze_subset to verify font support.\n\n" +
            "STEP 4 — EXECUTE\n" +
            "Section swaps/rewrites:\n" +
            "  Use pdf_batch_replace_block with ALL sibling sections at the same level.\n" +
            "  Include unchanged siblings with their original text for uniform spacing.\n" +
            "  Do NOT pass line_height or section_gap — the engine auto-detects.\n" +
            "Single block edits:\n" +
            "  Use pdf_replace_block with the section's bbox.\n" +
            "Text find-and-replace:\n" +
            "  Use pdf_batch_replace for 2+ related changes (preferred).\n" +
            "  Use pdf_replace_text for global search-replace.\n" +
            "Adding new content:\n" +
            "  Use pdf_insert_text_block at the target position.\n" +
            "Removing a section:\n" +
            "  Use pdf_delete_block with the section's bbox.\n" +
            "Then: pdf_update_annotation if link URLs changed.\n\n" +
            "STEP 5 — VERIFY\n" +
            "Call pdf_get_text on the output PDF. Check for:\n" +
            "  - No duplicate headers or content\n" +
            "  - No missing sections\n" +
            "  - No spurious spaces ('month ly', 'full - stack')\n" +
            "  - All replacement text appears in expected regions\n\n" +
            "FALLBACK — If pdf_detect_sections returns empty or unexpected results:\n" +
            "  1. Call pdf_get_text_layout for raw block data\n" +
            "  2. Identify heading blocks by font (bold font at left margin)\n" +
            "  3. Compute bboxes: y1 = title_y + font_size + 0.5, y0 = next_title_y + size + 0.5\n" +
            "  4. Extract text via pdf_extract_bbox_text(tolerance=0)\n" +
            "  5. Proceed with pdf_batch_replace_block\n\n" +
            "RULES:\n" +
            '- "Swap" a section means ALL its content — title, tech stack, every bullet.\n' +
            "- When swapping, replace ALL sibling sections (not just the two being swapped).\n" +
            "- Never pass line_height or section_gap to batch_replace_block unless asked.\n" +
            "- Do text edits BEFORE annotation edits (text edits may shift indices).",
        },
      },
    ],
  })
);

server.registerPrompt(
  "section-swap",
  {
    description:
      "Swap two sections in a PDF by name — detects structure and handles all siblings",
  },
  async () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text:
            "Swapping sections in a PDF:\n\n" +
            "1. Call pdf_detect_sections(pdf_path, page) to get the section tree.\n" +
            "2. Find the two sections to swap by matching titles (fuzzy match OK).\n" +
            "3. Identify ALL sibling sections at the same level under the same parent.\n" +
            "4. Call pdf_batch_replace_block with ALL siblings:\n" +
            "   - Swapped sections get each other's text.\n" +
            "   - Unchanged siblings get their original text (re-rendered for uniform spacing).\n" +
            "   - Do NOT pass line_height or section_gap.\n" +
            "5. Verify with pdf_get_text on the output — check no duplication, no missing content.\n\n" +
            "IMPORTANT: Always include ALL siblings, not just the two being swapped.\n" +
            "This ensures uniform spacing across the entire parent section.",
        },
      },
    ],
  })
);

server.registerPrompt(
  "quick-pdf-edit",
  {
    description: "Quick single-text replacement — typos, dates, names",
  },
  async () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text:
            "For simple text changes:\n" +
            "1. Call pdf_find_text to locate and confirm the text exists\n" +
            "2. Call pdf_replace_text or pdf_replace_single\n" +
            "3. Check font_preserved in the fidelity report",
        },
      },
    ],
  })
);

// ── Startup ──────────────────────────────────────────────────────────

const transport = new StdioServerTransport();

(async () => {
  await bridge.spawn();
  await server.connect(transport);
})().catch((error: unknown) => {
  console.error("Fatal error starting pdf-edit-mcp:", error);
  process.exit(1);
});

// ── Graceful shutdown ────────────────────────────────────────────────

process.on("SIGINT", () => {
  bridge.shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  bridge.shutdown();
  process.exit(0);
});

process.on("exit", () => {
  bridge.shutdown();
});
