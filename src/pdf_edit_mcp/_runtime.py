"""Shared runtime: tool-annotation profiles, engine-error translation, engine guard.

The engine (pikepdf / fontTools) is NOT thread-safe, so every engine call runs
under ``engine_lock`` (held by ``engine_guard``). Engine ``PDFEditError`` subclasses
are translated to ``ToolError`` with the actionable hint preserved; raw pikepdf,
filesystem, and unexpected errors are translated or redacted so they never leak.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import pikepdf
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from pdf_edit_engine.errors import (
    EncodingError,
    FontNotFoundError,
    OperatorError,
    PDFEditError,
    ReflowError,
)

from pdf_edit_mcp.server import engine_lock

# Two annotation profiles, ported from the v0.1.x TS read-only vs write hints.
READ_ONLY = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=False,
)
WRITE = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=True,
    idempotentHint=False,
    openWorldHint=False,
)

_HINTS: list[tuple[type[PDFEditError], str]] = [
    (OperatorError, "TextMatch is stale — re-run pdf_find_text and retry with the fresh matches."),
    (EncodingError, "Some glyphs may be unmappable — run pdf_analyze_subset to check coverage."),
    (ReflowError, "Replacement may be too wide — try shorter text or a different bbox."),
    (FontNotFoundError, "Run pdf_get_fonts, or install the required font / accept a fallback."),
]


def classify_engine_error(exc: PDFEditError) -> str:
    """Render an engine error as a caller-facing message + actionable hint.

    Ports the v0.1.x ``_ERROR_REGISTRY`` hints. The numeric JSON-RPC codes the TS
    bridge attached were a transport artifact and do not survive FastMCP's
    ``isError`` tool-result model; the hint (what the agent reads) is preserved.
    """
    for exc_type, hint in _HINTS:
        if isinstance(exc, exc_type):
            return f"{type(exc).__name__}: {exc} (hint: {hint})"
    return f"{type(exc).__name__}: {exc}"


@contextmanager
def engine_guard() -> Iterator[None]:
    """Serialise + guard a block of engine work.

    Acquires the global engine lock (the engine is not thread-safe) and translates
    exceptions: engine ``PDFEditError`` subclasses -> ``ToolError`` (+ hint); raw
    pikepdf password/parse errors from the wrapper's own direct opens -> a safe
    message (never leaks ``PasswordError`` / ``PdfError``); filesystem errors -> a
    clear message; anything unexpected -> a redacted ``Internal error``.
    """
    with engine_lock:
        try:
            yield
        except (OperatorError, EncodingError, ReflowError, FontNotFoundError, PDFEditError) as e:
            raise ToolError(classify_engine_error(e)) from e
        except pikepdf.PasswordError as e:
            raise ToolError("PDF is password-protected (supply the correct password).") from e
        except pikepdf.PdfError as e:
            raise ToolError("Failed to open or parse the PDF.") from e
        except FileNotFoundError as e:
            raise ToolError(f"File not found: {e.filename or 'unknown'}") from e
        except PermissionError as e:
            raise ToolError("Permission denied.") from e
        except Exception as e:
            raise ToolError(f"Internal error: {type(e).__name__}") from e


def page_count(pdf_path: str, *, password: str | None = None) -> int:
    """Return the number of pages via a direct pikepdf open.

    Mirrors the v0.1.x bridge (the engine exposes no page-count verb). Must be
    called inside ``engine_guard()`` so pikepdf errors are translated.
    """
    with pikepdf.open(pdf_path, password=password or "") as pdf:
        return len(pdf.pages)
