"""FastMCP server instance, engine-version gate, and console entry point.

The engine (pikepdf / fontTools) is imported in-process by the tool modules.
Tool/prompt modules register themselves on the module-level ``mcp`` instance via
``@mcp.tool`` / ``@mcp.prompt`` decorators; they are imported at the bottom of
this module so that importing ``pdf_edit_mcp.server`` makes the full tool surface
available (e.g. to the in-memory test client) without running the version gate.
"""

from __future__ import annotations

import json
import sys
import threading

from mcp.server.fastmcp import FastMCP

from pdf_edit_mcp import __version__
from pdf_edit_mcp.constants import MIN_ENGINE_VERSION

INSTRUCTIONS = (
    "pdf-edit-mcp edits text in existing PDFs while preserving fonts and layout.\n"
    "\n"
    "TOOL GUIDE:\n"
    "Section operations (swap, rewrite, move sections): "
    "pdf_swap_sections, pdf_replace_section\n"
    "Text operations (names, dates, typos, labels): pdf_replace_text, pdf_batch_replace\n"
    "Structure analysis (understand sections, fonts, layout): "
    "pdf_inspect, pdf_detect_sections\n"
    "Document operations (merge, split, rotate, encrypt): "
    "pdf_merge, pdf_split, pdf_rotate_pages, pdf_encrypt\n"
    "Annotations (links, highlights, bookmarks): pdf_get_annotations, pdf_add_annotation\n"
    "\n"
    "Always output to a NEW file path — never overwrite the input PDF.\n"
)

mcp = FastMCP(name="pdf-edit-mcp", instructions=INSTRUCTIONS)
# FastMCP's constructor takes no `version`; the version lives on the underlying
# low-level Server and is surfaced in the MCP `initialize` handshake
# (serverInfo.version). Set it there.
mcp._mcp_server.version = __version__

# The engine is NOT thread-safe (see pdf-edit-engine LIMITATIONS.md): its caches,
# the pikepdf.Pdf handle, and fontTools instances are single-threaded. FastMCP may
# dispatch sync tool callables on a worker thread, so this lock serialises ALL
# engine work — replicating the single-flight guarantee the old TS bridge provided
# via its JSON-RPC call queue.
engine_lock = threading.Lock()


def _check_engine_version() -> None:
    """Refuse to serve against an engine too old for the features we rely on.

    Mirrors the v0.1.x ``bridge.py`` startup gate: a clear stderr message and a
    distinct non-zero exit code so the launching client surfaces an actionable
    error instead of silently returning degraded results. Never writes to stdout
    (the MCP transport owns it).
    """
    import importlib.metadata as md

    try:
        ver = md.version("pdf-edit-engine")
    except md.PackageNotFoundError:
        print(json.dumps({"error": "pdf-edit-engine is not installed"}), file=sys.stderr)
        sys.exit(1)

    try:
        parts = tuple(int(p) for p in ver.split(".")[:3])
    except ValueError:
        # A dev / pre-release tag (e.g. "0.3.0.dev1") — skip the numeric gate.
        print(f"pdf-edit-mcp: engine version {ver!r} not numeric; skipping gate", file=sys.stderr)
        return

    if parts < MIN_ENGINE_VERSION:
        floor = ".".join(str(p) for p in MIN_ENGINE_VERSION)
        print(
            f"pdf-edit-mcp requires pdf-edit-engine >= {floor}, found {ver}. "
            "Run: pip install --upgrade pdf-edit-engine",
            file=sys.stderr,
        )
        sys.exit(2)

    print(f"pdf-edit-mcp ready (engine v{ver})", file=sys.stderr)


def main() -> None:
    """Console-script entry point: gate on the engine version, then serve over stdio."""
    _check_engine_version()
    mcp.run()


if __name__ == "__main__":
    main()

# --- Tool / prompt registration (decorator side-effects) -------------------
# Added incrementally as each build phase lands. These imports run AFTER `mcp`
# and `engine_lock` are defined above, so the tool modules can import them
# without a circular-import failure.
# (P2) from pdf_edit_mcp import tools_read       # noqa: E402,F401
# (P3) from pdf_edit_mcp import tools_edit        # noqa: E402,F401
# (P4) from pdf_edit_mcp import tools_sections    # noqa: E402,F401
# (P5) from pdf_edit_mcp import tools_document, tools_annotations  # noqa: E402,F401
# (P6) from pdf_edit_mcp import prompts           # noqa: E402,F401
