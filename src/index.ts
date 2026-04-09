#!/usr/bin/env node

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

const server = new McpServer({
  name: "pdf-edit-mcp",
  version: "0.1.0",
});

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
      "Replace ALL occurrences of a search string. For edits involving 2+ changes " +
      "(titles, descriptions, tech stacks), use pdf_batch_replace instead. " +
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
      "Apply multiple text replacements in one atomic operation. PREFERRED tool for any " +
      "edit involving 2+ related changes — section rewrites, project swaps, template fills. " +
      "Include ALL related changes in one call. Never split related edits across multiple calls.",
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
      "List fonts with encoding details. Use pdf_inspect for a combined view.",
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
      "Detect paragraph boundaries with bounding boxes. Use pdf_inspect for a combined view.",
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
      const result = await bridge.call("detect_paragraphs", {
        pdf_path,
        page,
      });
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
      "editing operation. Returns everything needed to plan comprehensive edits.",
    inputSchema: inspectInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ pdf_path }) => {
    try {
      const result = await bridge.call("inspect", { pdf_path });
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
      "Replacements are processed top-to-bottom with cumulative vertical shift tracking — " +
      "if one replacement overflows its bbox, subsequent replacements auto-adjust. " +
      "Use pdf_inspect or pdf_detect_paragraphs first to get bounding boxes. " +
      "PREFERRED tool for section swaps or multi-block rewrites on the same page.",
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
            "STEP 1 — READ: Call pdf_inspect to get the full document overview.\n" +
            "Summarize sections, headings, content blocks, fonts, and links.\n\n" +
            "STEP 2 — PLAN: Identify EVERY text change needed. Present as a table:\n" +
            "| # | Current text (first 60 chars) | Replacement text | Section |\n" +
            "Include titles, subtitles, tech stacks, descriptions, bullet points.\n" +
            "List link URL updates separately.\n" +
            "Ask the user to confirm before proceeding.\n\n" +
            "STEP 3 — PRE-CHECK: For replacement text with unusual characters,\n" +
            "call pdf_analyze_subset to verify font support.\n\n" +
            "STEP 4 — EXECUTE:\n" +
            "  For single-line text swaps (names, dates, titles): use pdf_batch_replace.\n" +
            "  For multi-line paragraph rewrites: use pdf_replace_block with bbox from pdf_detect_paragraphs.\n" +
            "    (Content below the bbox is auto-shifted when replacement text overflows.)\n" +
            "  For swapping/rewriting multiple sections on the same page: use pdf_batch_replace_block\n" +
            "    (handles cumulative vertical shift automatically across replacements).\n" +
            "  For adding new content: use pdf_insert_text_block at the target position.\n" +
            "  For removing a section: use pdf_delete_block with the paragraph bbox.\n" +
            "Then update annotation URLs via pdf_update_annotation if needed.\n\n" +
            "STEP 5 — VERIFY: Check the verification data in the batch_replace response.\n" +
            "If any replacements are unconfirmed, call pdf_get_text on the output.\n\n" +
            "RULES:\n" +
            '- "Swap" or "replace" a section means ALL its content — title, subtitle,\n' +
            "  tech stack, every bullet point, links.\n" +
            "- Never edit without completing Steps 1-2 first.\n" +
            "- Never execute without user confirmation.\n" +
            "- Keep replacement text similar in length to original when possible.",
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
