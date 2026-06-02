"""Input validation: path-safety predicate, validated path types, shared models.

Ports the v0.1.x ``src/schemas.ts`` ``PATH_CHECKS`` and shared Zod sub-schemas to
Pydantic. The path predicate is a security boundary (absolute + ``.pdf`` + no
``..`` traversal + no control chars + no Windows reserved/truncated basenames),
layered in front of the engine's own ``_pathutil`` symlink/junction checks.

The old TS layer and ``bridge.py`` each enforced this list independently to stay
defended; the single Python server collapses that into one implementation here.
"""

from __future__ import annotations

import re
from typing import Annotated

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field

from pdf_edit_mcp.constants import (
    MAX_COORDINATE,
    MAX_PATH_LENGTH,
    MAX_REPLACEMENT_TEXT,
    MAX_SEARCH_TEXT,
)

# --- Path safety (ordered checks; first failure wins) ----------------------
# Regexes mirror the v0.1.x schema + bridge verbatim.
_ABSOLUTE_RE = re.compile(r"^[A-Za-z]:[/\\]|^/")
_TRAVERSAL_RE = re.compile(r"(^|[/\\])\.\.([/\\]|$)")
_CONTROL_RE = re.compile(r"[\x00-\x1f]")
_TRAILING_DOT_OR_SPACE_RE = re.compile(r"[. ]$")
_WINDOWS_RESERVED_RE = re.compile(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)", re.IGNORECASE)


def path_safety_error(value: object, *, require_pdf_extension: bool = True) -> str | None:
    """Return the first path-safety violation message, or ``None`` if safe.

    Args:
        value: The candidate path.
        require_pdf_extension: When True, the path must end with ``.pdf``
            (case-insensitive). Set False for directory paths (e.g. ``output_dir``).

    Returns:
        A human-readable error string for the first failing check, or ``None``.
    """
    if not isinstance(value, str) or len(value) < 1:
        return "Path must not be empty"
    if len(value) > MAX_PATH_LENGTH:
        return f"Path exceeds maximum length ({MAX_PATH_LENGTH})"
    if not _ABSOLUTE_RE.search(value):
        return "Path must be absolute"
    if require_pdf_extension and not value.lower().endswith(".pdf"):
        return "Path must end with .pdf"
    if _TRAVERSAL_RE.search(value):
        return "Path must not contain directory traversal (..)"
    if _CONTROL_RE.search(value):
        return "Path must not contain control characters (NUL, etc.)"
    basename = re.split(r"[/\\]", value)[-1]
    if _TRAILING_DOT_OR_SPACE_RE.search(basename):
        return "Path basename must not end with '.' or ' ' (Windows treats these as truncated)"
    if _WINDOWS_RESERVED_RE.search(basename):
        return (
            "Path must not use a Windows reserved device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9)"
        )
    return None


def _validate_pdf_path(v: str) -> str:
    err = path_safety_error(v, require_pdf_extension=True)
    if err is not None:
        raise ValueError(err)
    return v


def _validate_dir_path(v: str) -> str:
    err = path_safety_error(v, require_pdf_extension=False)
    if err is not None:
        raise ValueError(err)
    return v


# Validated path types for use as tool parameter annotations.
PdfPath = Annotated[str, AfterValidator(_validate_pdf_path)]
OutputPath = Annotated[str, AfterValidator(_validate_pdf_path)]
DirPath = Annotated[str, AfterValidator(_validate_dir_path)]


# --- Numeric coordinate: accept int/float, reject strings (Zod z.number()) --
def _reject_string_number(v: object) -> object:
    if isinstance(v, str):
        raise ValueError("must be a number, not a string")
    return v


_Num = Annotated[float, BeforeValidator(_reject_string_number)]


# --- Shared models (Zod .strict() -> extra="forbid") -----------------------
class BBox(BaseModel):
    """A bounding box ``{x0, y0, x1, y1}`` in PDF coordinates."""

    model_config = ConfigDict(extra="forbid")

    x0: _Num = Field(ge=-MAX_COORDINATE, le=MAX_COORDINATE, description="Left edge x-coordinate")
    y0: _Num = Field(ge=-MAX_COORDINATE, le=MAX_COORDINATE, description="Bottom edge y-coordinate")
    x1: _Num = Field(ge=-MAX_COORDINATE, le=MAX_COORDINATE, description="Right edge x-coordinate")
    y1: _Num = Field(ge=-MAX_COORDINATE, le=MAX_COORDINATE, description="Top edge y-coordinate")

    def as_tuple(self) -> tuple[float, float, float, float]:
        """Return the box as the ``(x0, y0, x1, y1)`` tuple the engine expects."""
        return (self.x0, self.y0, self.x1, self.y1)


class EditItem(BaseModel):
    """One find/replace pair for ``pdf_batch_replace``."""

    model_config = ConfigDict(extra="forbid")

    find: str = Field(min_length=1, max_length=MAX_SEARCH_TEXT, description="Text to find")
    replace: str = Field(max_length=MAX_REPLACEMENT_TEXT, description="Replacement text")


class BlockReplacement(BaseModel):
    """One bbox + replacement for ``pdf_batch_replace_block``."""

    model_config = ConfigDict(extra="forbid")

    bbox: BBox = Field(description="Target region")
    new_text: str = Field(
        min_length=1, max_length=MAX_REPLACEMENT_TEXT, description="New text for the block"
    )
