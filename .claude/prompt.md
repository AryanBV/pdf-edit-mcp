# Session 2: MCP Expose batch_replace_block + Resume Swap Retest

## Context
- Project: pdf-edit-mcp (`C:\New Project\pdf-edit-mcp`)
- Linear milestone: M8 — MCP Server Wrapper (currently 33%)
- Dependency: pdf-edit-engine (`C:\New Project\pdf-edit-engine`) — ARY-265 + ARY-266 fixes committed. 620 tests pass. New export: `batch_replace_block` in `structural.py`, exposed via `__init__.py`.
- Current MCP state: 13 tools, 2 prompts, 87 tests. `pdf_replace_block` tool exists. No `pdf_batch_replace_block` tool yet.
- Branch: `main`

## Engine Changes to Know (Session 1 results)

1. `replace_block` now auto-calls `_shift_content_below_inplace()` when replacement text overflows the bbox vertically. No API signature change.
2. New `batch_replace_block(pdf_path, page_number, replacements, output_path)` — takes `list[tuple[bbox, new_text]]`, sorts by y1 descending, maintains cumulative_shift, returns `list[EditResult]` in original input order.
3. `can_encode()` now uses greedy longest-match aligned with `encode()`.

## Task

### Phase 1: Add pdf_batch_replace_block MCP tool

Wrap `batch_replace_block` as a new MCP tool. Input schema:
```json
{
  "pdf_path": "string",
  "page_number": "integer (0-indexed)",
  "replacements": [{"bbox": [x0, y0, x1, y1], "new_text": "string"}],
  "output_path": "string"
}
```
Returns: array of per-replacement results. Discover the existing tool registration pattern from other Level 3-4 tools (e.g., `pdf_replace_block`) and follow it exactly. Add to the bridge protocol if `batch_replace_block` isn't already bridged.

### Phase 2: Update pdf_replace_block tool description

Update the tool's description and annotations to state that content below the bbox is automatically shifted when replacement text overflows. One-line metadata change — no logic changes.

### Phase 3: Resume swap retest

**Bridge restart:** The bridge.py subprocess caches the engine at spawn time. Kill any running Python bridge process before testing. After the first MCP tool call, verify the bridge loaded the updated engine by checking that `batch_replace_block` is callable — if the tool returns "unknown function," the bridge has stale code.

Test procedure:
1. Extract text from `C:\New Project\pdf-edit-engine\tests\corpus\resume_aryan.pdf` to identify the exact bboxes for Position 1 (AJSP Manager title + 3 bullets) and Position 3 (SMART_MED title + 3 bullets). Discover bboxes from the PDF — do NOT hardcode assumed coordinates.
2. Extract the original Position 1 text content (title + bullets) for reuse in step 3.
3. Call `pdf_batch_replace_block` with two replacements:
   - Position 1 bbox → "PDF Edit Engine\nFormat-preserving text editing for existing PDFs\nFont subset extension with CMap and fonttools\nIdentity-H CIDFont encoding with bidirectional mapping"
   - Position 3 bbox → the original AJSP Manager text extracted in step 2
4. Output: `C:\New Project\pdf-edit-mcp\demo_output\resume_swapped.pdf`
5. Extract text from the output PDF. Verify:
   - Position 1 region contains "PDF Edit Engine" content
   - Position 3 region contains AJSP Manager content
   - Position 2 (Lumina Crafts) is untouched
   - No interleaved or garbled text anywhere

**If the resume swap still shows garbling or interleaving:** dump the raw content stream operators around the affected region and report findings. Do NOT attempt further engine fixes — that's a separate session.

### Phase 4: Update MCP prompts (if needed)

Check the 2 existing MCP prompts. If either references `replace_block` behavior, update to reflect content shifting. If neither does, skip this phase entirely.

## Constraints
- Do NOT modify any files in `C:\New Project\pdf-edit-engine`.
- All existing 87 MCP tests must still pass.
- Write at least 2 new tests for the `pdf_batch_replace_block` tool.

## Verification
- After Phase 1: new tool registers in MCP Inspector. New tests pass. Existing 87 tests pass.
- After Phase 2: tool description updated. No test regressions.
- After Phase 3: `resume_swapped.pdf` text extraction shows correct content per position, no garbling. If verification fails, report instead of fixing.
- Final: full MCP test suite passes.

## Linear Update
- Update M8 milestone progress after completion.
- If new issues discovered, create them under M8.