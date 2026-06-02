"""Prompt tests — the 3 MCP prompts register with their hyphenated names + bodies."""

from __future__ import annotations

import asyncio
from typing import Any

from mcp.shared.memory import create_connected_server_and_client_session

from pdf_edit_mcp.server import mcp


def _list_and_get(name: str) -> tuple[Any, Any]:
    async def _run() -> tuple[Any, Any]:
        async with create_connected_server_and_client_session(mcp) as client:
            listed = await client.list_prompts()
            got = await client.get_prompt(name)
            return listed, got

    return asyncio.run(_run())


def test_three_prompts_registered() -> None:
    listed, _ = _list_and_get("quick-pdf-edit")
    names = {p.name for p in listed.prompts}
    assert {"comprehensive-pdf-edit", "section-swap", "quick-pdf-edit"} <= names


def test_quick_prompt_body() -> None:
    _, got = _list_and_get("quick-pdf-edit")
    text = got.messages[0].content.text
    assert "For simple text changes:" in text
    assert "pdf_find_text" in text


def test_comprehensive_prompt_body() -> None:
    _, got = _list_and_get("comprehensive-pdf-edit")
    text = got.messages[0].content.text
    assert "STEP 1 — INSPECT" in text
    assert "FALLBACK" in text
