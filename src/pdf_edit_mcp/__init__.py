"""pdf-edit-mcp: a Model Context Protocol server for format-preserving PDF editing.

Single-process Python (FastMCP) server that exposes the ``pdf_edit_engine``
library as MCP tools. As of v0.2.0 the engine is imported in-process — there is
no Python subprocess and no Node.js runtime (this replaces the v0.1.x TypeScript
MCP server + ``bridge.py`` architecture).
"""

from __future__ import annotations

__version__ = "0.2.0"
