"""Edit-tool tests — port of bridge.test.ts Theme D (write tools).

Each test performs a real edit on a synthetic fixture and verifies the output
file + the returned wire shape (success, fidelity, dry_run semantics, error
classification, the page_number alias).
"""

from __future__ import annotations

import os

from _mcp_helpers import call_tool, data

_BODY_BBOX = {"x0": 60, "y0": 650, "x1": 545, "y1": 695}  # the two body lines


class TestReplaceText:
    def test_replaces_and_writes(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_replace_text",
                {
                    "pdf_path": simple_pdf,
                    "search": "Test Document",
                    "replacement": "Edited Title",
                    "output_path": out_pdf,
                },
            )
        )
        assert d["success"] is True
        assert d["edits_applied"] >= 1
        assert os.path.exists(out_pdf)
        assert "degradation_kinds" in d["fidelity"]
        gt = data(call_tool("pdf_get_text", {"pdf_path": out_pdf}))
        assert "Edited Title" in gt["text"]
        assert "Test Document" not in gt["text"]

    def test_dry_run_writes_nothing(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_replace_text",
                {
                    "pdf_path": simple_pdf,
                    "search": "Test Document",
                    "replacement": "X",
                    "output_path": out_pdf,
                    "dry_run": True,
                },
            )
        )
        assert d["dry_run"] is True
        assert len(d["results"]) >= 1
        assert not os.path.exists(out_pdf)

    def test_no_match(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_replace_text",
                {
                    "pdf_path": simple_pdf,
                    "search": "zzz-absent",
                    "replacement": "X",
                    "output_path": out_pdf,
                },
            )
        )
        assert d["success"] is False
        assert d["edits_applied"] == 0

    def test_utf8_roundtrip(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_replace_text",
                {
                    "pdf_path": simple_pdf,
                    "search": "Test Document",
                    "replacement": "Test — Demo",
                    "output_path": out_pdf,
                },
            )
        )
        assert d["success"] is True
        gt = data(call_tool("pdf_get_text", {"pdf_path": out_pdf}))
        assert "—" in gt["text"]


class TestReplaceSingle:
    def test_replaces(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_replace_single",
                {
                    "pdf_path": simple_pdf,
                    "search": "Test Document",
                    "replacement": "First",
                    "output_path": out_pdf,
                },
            )
        )
        assert d["success"] is True
        assert os.path.exists(out_pdf)

    def test_match_index_out_of_range(self, simple_pdf: str, out_pdf: str) -> None:
        r = call_tool(
            "pdf_replace_single",
            {
                "pdf_path": simple_pdf,
                "search": "Test Document",
                "replacement": "X",
                "output_path": out_pdf,
                "match_index": 999,
            },
        )
        assert r.isError
        assert "out of range" in r.content[0].text.lower()  # type: ignore[union-attr]


class TestBatchReplace:
    def test_two_edits(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_batch_replace",
                {
                    "pdf_path": simple_pdf,
                    "edits": [
                        {"find": "simple", "replace": "EASY"},
                        {"find": "basic", "replace": "CORE"},
                    ],
                    "output_path": out_pdf,
                },
            )
        )
        assert d["summary"]["total"] >= 1
        assert "verification" in d
        assert os.path.exists(out_pdf)

    def test_dry_run_preview(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_batch_replace",
                {
                    "pdf_path": simple_pdf,
                    "edits": [{"find": "simple", "replace": "EASY"}],
                    "output_path": out_pdf,
                    "dry_run": True,
                },
            )
        )
        assert "dry_run" in d["verification"]["output_text_preview"]
        assert not os.path.exists(out_pdf)


class TestReplaceBlock:
    def test_replaces_region(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_replace_block",
                {
                    "pdf_path": simple_pdf,
                    "page": 0,
                    "bbox": _BODY_BBOX,
                    "new_text": "REPLACED CONTENT",
                    "output_path": out_pdf,
                },
            )
        )
        assert d["success"] is True
        assert os.path.exists(out_pdf)
        gt = data(call_tool("pdf_get_text", {"pdf_path": out_pdf}))
        assert "REPLACED" in gt["text"]

    def test_shrink_fit(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_replace_block",
                {
                    "pdf_path": simple_pdf,
                    "page": 0,
                    "bbox": _BODY_BBOX,
                    "new_text": "shrink to fit me",
                    "output_path": out_pdf,
                    "fit": "shrink",
                },
            )
        )
        assert d["success"] is True


class TestBatchReplaceBlock:
    def test_page_number_alias(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_batch_replace_block",
                {
                    "pdf_path": simple_pdf,
                    "output_path": out_pdf,
                    "page_number": 0,
                    "replacements": [{"bbox": _BODY_BBOX, "new_text": "BLOCK ONE"}],
                },
            )
        )
        assert d["summary"]["total"] >= 1

    def test_requires_page(self, simple_pdf: str, out_pdf: str) -> None:
        r = call_tool(
            "pdf_batch_replace_block",
            {
                "pdf_path": simple_pdf,
                "output_path": out_pdf,
                "replacements": [{"bbox": _BODY_BBOX, "new_text": "X"}],
            },
        )
        assert r.isError
        assert "page" in r.content[0].text.lower()  # type: ignore[union-attr]


class TestInsertTextBlock:
    def test_inserts(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_insert_text_block",
                {
                    "pdf_path": simple_pdf,
                    "page": 0,
                    "x": 72,
                    "y": 400,
                    "text": "INSERTED LINE",
                    "output_path": out_pdf,
                },
            )
        )
        assert d["success"] is True
        gt = data(call_tool("pdf_get_text", {"pdf_path": out_pdf}))
        assert "INSERTED" in gt["text"]


class TestDeleteBlock:
    def test_deletes(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_delete_block",
                {
                    "pdf_path": simple_pdf,
                    "page": 0,
                    "bbox": _BODY_BBOX,
                    "output_path": out_pdf,
                },
            )
        )
        assert d["success"] is True
        assert os.path.exists(out_pdf)
