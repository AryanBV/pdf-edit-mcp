"""The FastMCP application instance and the shared engine lock.

Dependency LEAF: this module imports nothing from the tool layer or ``server``,
so ``_runtime`` and every ``tools_*`` module can import ``mcp`` / ``engine_lock``
from here without an import cycle. (Putting these in ``server`` — which must import
the tool modules to register them — would create one.)
"""

from __future__ import annotations

import threading

from mcp.server.fastmcp import FastMCP

from pdf_edit_mcp import __version__

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
# low-level Server and is surfaced in the MCP `initialize` handshake.
mcp._mcp_server.version = __version__

# The engine (pikepdf / fontTools) is NOT thread-safe (see pdf-edit-engine
# LIMITATIONS.md). FastMCP may dispatch sync tool callables on a worker thread, so
# this lock serialises ALL engine work — the single-flight guarantee the old TS
# bridge provided via its JSON-RPC call queue.
engine_lock = threading.Lock()
