"""Console entry point: engine-version gate, stdio serve, and tool registration.

The FastMCP instance + the engine lock live in ``pdf_edit_mcp.app`` (a dependency
leaf) to avoid an import cycle. Importing THIS module registers every tool/prompt
on that instance (via the bottom-of-file imports), so ``from pdf_edit_mcp.server
import mcp`` yields a fully-populated server for the console script and the tests.
"""

from __future__ import annotations

import json
import sys

from pdf_edit_mcp.app import mcp
from pdf_edit_mcp.constants import MIN_ENGINE_VERSION

__all__ = ["main", "mcp"]


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
# `app.mcp` is an import leaf, so importing the tool modules here does not cycle
# back through `server`. Added incrementally as each build phase lands.
from pdf_edit_mcp import (  # noqa: E402
    tools_annotations,  # noqa: F401
    tools_document,  # noqa: F401
    tools_edit,  # noqa: F401
    tools_read,  # noqa: F401
    tools_sections,  # noqa: F401
)
# (P6) from pdf_edit_mcp import prompts           # noqa: E402,F401
