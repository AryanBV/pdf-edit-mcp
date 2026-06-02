"""Integration tests for v0.2.0 headline behaviors through the MCP layer.

Encrypted-PDF editing (the A2.3 `password` kwarg), the encrypted-read no-leak
invariant (raw pikepdf exception names never surface), and round-trip
re-encryption preservation — exercised end-to-end via the in-memory client.
"""

from __future__ import annotations

import os
from pathlib import Path

from _mcp_helpers import call_tool, data


def _encrypt(simple_pdf: str, tmp_path: Path) -> str:
    enc = str(tmp_path / "enc.pdf")
    data(
        call_tool(
            "pdf_encrypt",
            {
                "pdf_path": simple_pdf,
                "owner_password": "owner",
                "user_password": "userpw",
                "output_path": enc,
            },
        )
    )
    assert os.path.exists(enc)
    return enc


class TestEncryptedPdfEditing:
    def test_read_without_password_errors_without_leaking(
        self, simple_pdf: str, tmp_path: Path
    ) -> None:
        enc = _encrypt(simple_pdf, tmp_path)
        r = call_tool("pdf_get_text", {"pdf_path": enc})  # no password
        assert r.isError
        msg = r.content[0].text  # type: ignore[union-attr]
        # No-leak invariant: never surface raw pikepdf exception class names.
        assert "PasswordError" not in msg and "PdfError" not in msg
        assert "password" in msg.lower()

    def test_read_with_password(self, simple_pdf: str, tmp_path: Path) -> None:
        enc = _encrypt(simple_pdf, tmp_path)
        d = data(call_tool("pdf_get_text", {"pdf_path": enc, "password": "userpw"}))
        assert "Test Document" in d["text"]

    def test_edit_with_password_preserves_encryption(self, simple_pdf: str, tmp_path: Path) -> None:
        enc = _encrypt(simple_pdf, tmp_path)
        out = str(tmp_path / "edited.pdf")
        d = data(
            call_tool(
                "pdf_replace_text",
                {
                    "pdf_path": enc,
                    "search": "Test Document",
                    "replacement": "Edited Title",
                    "output_path": out,
                    "password": "userpw",
                },
            )
        )
        assert d["success"] is True
        assert os.path.exists(out)
        # A2.3: the edited output is STILL encrypted (re-encryption preserved).
        r = call_tool("pdf_get_text", {"pdf_path": out})
        assert r.isError
        # ...and the edit landed, readable with the password.
        d2 = data(call_tool("pdf_get_text", {"pdf_path": out, "password": "userpw"}))
        assert "Edited Title" in d2["text"]
        assert "Test Document" not in d2["text"]
