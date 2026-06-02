"""Enable ``python -m pdf_edit_mcp`` as an alternative to the console script."""

from __future__ import annotations

from pdf_edit_mcp.server import main

if __name__ == "__main__":
    main()
