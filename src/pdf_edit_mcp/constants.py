"""Input bounds and limits — the single source of truth for tool validation.

Ported verbatim from the v0.1.x ``src/constants.ts`` (DoS bounds, length caps,
geometry limits). Keeping these centralised mirrors the wrapper's anti-drift
convention: never inline a magic number; reference the constant.
"""

from __future__ import annotations

# --- Text length caps ---
MAX_SEARCH_TEXT = 10_000
MAX_REPLACEMENT_TEXT = 100_000
MAX_FONT_NAME = 200
MAX_PATH_LENGTH = 4_096
MAX_METADATA_VALUE = 1_000
MAX_FORM_FIELD_VALUE = 10_000
MAX_URI = 2_048
MAX_TITLE = 500
MAX_SECTION_NAME = 200
MAX_INSERT_TEXT = MAX_REPLACEMENT_TEXT

# --- Coordinate / geometry caps ---
MAX_COORDINATE = 10_000
MIN_FONT_SIZE = 0.5
MAX_FONT_SIZE = 1_000.0
DEFAULT_FONT_SIZE = 12.0
MIN_LINE_HEIGHT = 0.5
MAX_LINE_HEIGHT = 1_000.0

# --- Collection caps (DoS bounds) ---
MAX_EDITS_PER_BATCH = 500
MAX_REPLACEMENTS_PER_BATCH = 50
MAX_PDFS_PER_MERGE = 100
MAX_PAGE_INDICES = 10_000
MAX_HIGHLIGHT_VALUES = 800  # 8 floats/quad -> 100 quads max
MIN_HIGHLIGHT_VALUES = 8
MAX_METADATA_KEYS = 50
MAX_FORM_FIELDS = 500

# --- Password caps ---
MAX_PASSWORD = 128

# --- Engine version pin ---
# Bumped from the stale "0.1.2"/"0.1.3" of the v0.1.x wrapper: v0.2.0 relies on
# the engine's password= kwargs (A2.3), fit="shrink" (E.8), and the 30-kind
# Degradation taxonomy. Enforced in server.main() before serving.
MIN_ENGINE_VERSION = (0, 2, 0)
