"""Annotation-tool tests — port of bridge.test.ts annotation behaviors."""

from __future__ import annotations

import os

from _mcp_helpers import call_tool, data


class TestGetAnnotations:
    def test_structured_has_link(self, structured_pdf: str) -> None:
        d = data(call_tool("pdf_get_annotations", {"pdf_path": structured_pdf}))
        assert len(d["annotations"]) >= 1
        a = d["annotations"][0]
        assert {"index", "page", "subtype", "rect", "uri", "text"} <= set(a)

    def test_simple_empty(self, simple_pdf: str) -> None:
        d = data(call_tool("pdf_get_annotations", {"pdf_path": simple_pdf}))
        assert d["annotations"] == []


class TestAddAnnotation:
    def test_add(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_add_annotation",
                {
                    "pdf_path": simple_pdf,
                    "page": 0,
                    "rect": {"x0": 72, "y0": 700, "x1": 200, "y1": 720},
                    "uri": "https://example.com",
                    "output_path": out_pdf,
                },
            )
        )
        assert d["success"] is True
        assert os.path.exists(out_pdf)


class TestUpdateAnnotation:
    def test_update(self, structured_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_update_annotation",
                {
                    "pdf_path": structured_pdf,
                    "page": 0,
                    "annotation_index": 0,
                    "url": "https://example.com/updated",
                    "output_path": out_pdf,
                },
            )
        )
        assert d["success"] is True
        assert d["new_url"] == "https://example.com/updated"
        assert "old_url" in d

    def test_out_of_range(self, structured_pdf: str, out_pdf: str) -> None:
        r = call_tool(
            "pdf_update_annotation",
            {
                "pdf_path": structured_pdf,
                "page": 0,
                "annotation_index": 999,
                "url": "https://x.com",
                "output_path": out_pdf,
            },
        )
        assert r.isError
        assert "out of range" in r.content[0].text.lower()  # type: ignore[union-attr]


class TestDeleteAnnotation:
    def test_delete(self, structured_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_delete_annotation_v2",
                {
                    "pdf_path": structured_pdf,
                    "page": 0,
                    "annotation_index": 0,
                    "output_path": out_pdf,
                },
            )
        )
        assert d["success"] is True
        assert os.path.exists(out_pdf)

    def test_out_of_range(self, structured_pdf: str, out_pdf: str) -> None:
        r = call_tool(
            "pdf_delete_annotation_v2",
            {
                "pdf_path": structured_pdf,
                "page": 0,
                "annotation_index": 999,
                "output_path": out_pdf,
            },
        )
        assert r.isError


class TestMoveAnnotation:
    def test_move(self, structured_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_move_annotation",
                {
                    "pdf_path": structured_pdf,
                    "page": 0,
                    "annotation_index": 0,
                    "new_rect": {"x0": 100, "y0": 100, "x1": 250, "y1": 120},
                    "output_path": out_pdf,
                },
            )
        )
        assert d["success"] is True
        assert os.path.exists(out_pdf)
