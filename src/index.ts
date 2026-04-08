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
      "Extract all text from a PDF file and return the page count. " +
      "Use this to read PDF content before editing.",
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
      "Search for text in a PDF and return matches with page numbers " +
      "and bounding box positions. Useful for locating text before replacing.",
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
      "Find and replace all occurrences of text in a PDF, preserving " +
      "fonts and layout. Returns fidelity report on font preservation.",
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
      "Apply multiple find-and-replace operations to a PDF in a single " +
      "pass. More efficient than multiple individual replacements. " +
      "Max 500 edits per call.",
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
      "List all fonts used in a PDF with encoding and subset details. " +
      "Useful for understanding font constraints before editing.",
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
      "Detect paragraph blocks on a page of a PDF. Returns text content, " +
      "bounding box, font info, and line count for each paragraph. " +
      "Useful for understanding document structure before editing.",
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
      "Check whether a font embedded in a PDF can render specific text. " +
      "Returns which glyphs are available and which are missing. " +
      "Use before replacing text to verify the font supports the new characters.",
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
      "Replace a single occurrence of text in a PDF by match index. " +
      "Use pdf_find_text first to see all matches and pick the index. " +
      "Supports disabling reflow for precise control.",
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
