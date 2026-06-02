"""MCP prompts (3): workflow guidance surfaced to the client.

Bodies ported verbatim from the v0.1.x ``src/index.ts`` ``registerPrompt`` calls.
FastMCP uses the ``name=`` kwarg for the wire name (hyphenated, unlike the Python
function names); a returned ``str`` becomes a single user-role text message.
"""

from __future__ import annotations

from pdf_edit_mcp.app import mcp

_COMPREHENSIVE = (
    "When editing a PDF document, follow this workflow:\n\n"
    "STEP 1 — INSPECT\n"
    "Call pdf_inspect to get the full document overview (text, fonts,\n"
    "paragraphs, annotations). Read the full text to understand the document.\n\n"
    "STEP 2 — UNDERSTAND STRUCTURE\n"
    "For section-level operations (swap, move, replace titled sections):\n"
    "  → Call pdf_detect_sections for a structured section tree with bboxes and text.\n"
    "  → Sections are grouped by font hierarchy (level 0 = largest headings).\n"
    "For specific text positions:\n"
    "  → Call pdf_get_text_layout for individual blocks with font/position data.\n"
    "For simple text replacement:\n"
    "  → Call pdf_find_text to locate all occurrences.\n\n"
    "STEP 3 — PRE-CHECK\n"
    "If replacement text has unusual characters (bullets •, em-dashes —, non-Latin):\n"
    "  → Call pdf_analyze_subset to verify font support.\n"
    "For destructive edits you want to verify before committing to disk:\n"
    "  → Call pdf_replace_text / pdf_replace_single / pdf_batch_replace with\n"
    "    dry_run=true. The response includes the full per-result fidelity report\n"
    "    (font_substituted, glyphs_missing, warnings) without writing the output.\n"
    "    Re-run with dry_run=false (or omitted) once you're satisfied.\n\n"
    "STEP 4 — EXECUTE\n"
    "Section swaps/rewrites:\n"
    "  Use pdf_batch_replace_block with ALL sibling sections at the same level.\n"
    "  Include unchanged siblings with their original text for uniform spacing.\n"
    "  By default omit line_height/section_gap — the engine auto-detects.\n"
    "  Pass them only when sibling replacements differ in length and you need\n"
    "  uniform spacing locked in (engine v0.1.2+).\n"
    "Single block edits:\n"
    "  Use pdf_replace_block with the section's bbox.\n"
    "Text find-and-replace:\n"
    "  Use pdf_batch_replace for 2+ related changes (preferred).\n"
    "  Use pdf_replace_text for global search-replace.\n"
    "Adding new content:\n"
    "  Use pdf_insert_text_block at the target position.\n"
    "Removing a section:\n"
    "  Use pdf_delete_block with the section's bbox.\n"
    "Then: pdf_update_annotation if link URLs changed.\n\n"
    "STEP 5 — VERIFY\n"
    "Call pdf_get_text on the output PDF. Check for:\n"
    "  - No duplicate headers or content\n"
    "  - No missing sections\n"
    "  - No spurious spaces ('month ly', 'full - stack')\n"
    "  - All replacement text appears in expected regions\n"
    "Also inspect every edit's fidelity report:\n"
    "  - font_substituted: non-null means a metric-equivalent font was used\n"
    "    (e.g. 'Carlito-Regular' for Calibri); the visual is close but not exact.\n"
    "  - glyphs_missing: any non-empty list means those characters won't render.\n"
    "  - warnings: an 'overflow' entry means the replacement extended past\n"
    "    available space; investigate and consider shorter text or reflow=true.\n\n"
    "FALLBACK — If pdf_detect_sections returns empty or unexpected results:\n"
    "  1. Call pdf_get_text_layout for raw block data\n"
    "  2. Identify heading blocks by font (bold font at left margin)\n"
    "  3. Compute bboxes: y1 = title_y + font_size + 0.5, y0 = next_title_y + size + 0.5\n"
    "  4. Extract text via pdf_extract_bbox_text(tolerance=0)\n"
    "  5. Proceed with pdf_batch_replace_block\n\n"
    "RULES:\n"
    '- "Swap" a section means ALL its content — title, tech stack, every bullet.\n'
    "- When swapping, replace ALL sibling sections (not just the two being swapped).\n"
    "- Pass line_height/section_gap only when explicitly needed for uniform spacing.\n"
    "- Do text edits BEFORE annotation edits (text edits may shift indices).\n"
    "- An OperatorError 'TextMatch is stale' means re-run pdf_find_text and retry."
)

_SECTION_SWAP = (
    "Swapping sections in a PDF:\n\n"
    "1. Call pdf_detect_sections(pdf_path, page) to get the section tree.\n"
    "2. Find the two sections to swap by matching titles (fuzzy match OK).\n"
    "3. Identify ALL sibling sections at the same level under the same parent.\n"
    "4. Call pdf_batch_replace_block with ALL siblings:\n"
    "   - Swapped sections get each other's text.\n"
    "   - Unchanged siblings get their original text (re-rendered for uniform spacing).\n"
    "   - Default: omit line_height/section_gap — engine auto-detects.\n"
    "   - Pass them only if sibling lengths differ markedly and you need\n"
    "     locked-in uniform spacing (engine v0.1.2+).\n"
    "5. Verify with pdf_get_text on the output — check no duplication, no missing content.\n"
    "6. Inspect each per-result fidelity report for font_substituted (font fallback),\n"
    "   glyphs_missing (unrenderable characters), and warnings.\n\n"
    "IMPORTANT: Always include ALL siblings, not just the two being swapped.\n"
    "This ensures uniform spacing across the entire parent section."
)

_QUICK = (
    "For simple text changes:\n"
    "1. Call pdf_find_text to locate and confirm the text exists\n"
    "2. Call pdf_replace_text or pdf_replace_single\n"
    "3. Inspect each result's fidelity report:\n"
    "   - font_preserved: false means the original font wasn't used end-to-end\n"
    "   - font_substituted: non-null = metric-equivalent fallback (e.g. Carlito for Calibri)\n"
    "   - glyphs_missing: any non-empty list = characters that won't render\n"
    "   - warnings: an 'overflow' entry = replacement extended past available space\n"
    "If an OperatorError surfaces with 'TextMatch is stale' — that's a v0.1.2 guard:\n"
    "the matches you used were invalidated by a prior edit. Re-call pdf_find_text\n"
    "and retry with the fresh matches."
)


@mcp.prompt(
    name="comprehensive-pdf-edit",
    description="Workflow for structural PDF edits — section swaps, rewrites, multi-field updates",
)
def comprehensive_pdf_edit() -> str:
    return _COMPREHENSIVE


@mcp.prompt(
    name="section-swap",
    description="Swap two sections in a PDF by name — detects structure and handles all siblings",
)
def section_swap() -> str:
    return _SECTION_SWAP


@mcp.prompt(
    name="quick-pdf-edit",
    description="Quick single-text replacement — typos, dates, names",
)
def quick_pdf_edit() -> str:
    return _QUICK
