"""In-memory MCP client helpers for tests (exercises the real server, no subprocess)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from mcp.shared.memory import create_connected_server_and_client_session
from mcp.types import CallToolResult

from pdf_edit_mcp.server import mcp


def call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
    """Invoke a tool through the real in-memory client<->server session."""

    async def _run() -> CallToolResult:
        async with create_connected_server_and_client_session(mcp) as client:
            return await client.call_tool(name, arguments)

    return asyncio.run(_run())


def data(result: CallToolResult) -> dict[str, Any]:
    """Return the structured dict a tool produced (falls back to parsing text)."""
    if result.structuredContent is not None:
        return result.structuredContent
    block = result.content[0]
    return json.loads(block.text)  # type: ignore[union-attr]
