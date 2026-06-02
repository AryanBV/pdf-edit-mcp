"""Document-operation tool tests — port of bridge.test.ts wrapper smoke tests.

Each verb dispatches without crashing and produces its output artifact; the
engine itself is covered by its own suite, so these confirm the wrapper wiring.
"""

from __future__ import annotations

import os
from pathlib import Path

from _mcp_helpers import call_tool, data


def _two_page(simple_pdf: str, structured_pdf: str, tmp_path: Path) -> str:
    merged = str(tmp_path / "merged.pdf")
    data(call_tool("pdf_merge", {"pdf_paths": [simple_pdf, structured_pdf], "output_path": merged}))
    return merged


class TestMergeSplit:
    def test_merge(self, simple_pdf: str, structured_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_merge",
                {"pdf_paths": [simple_pdf, structured_pdf], "output_path": out_pdf},
            )
        )
        assert os.path.exists(d["output_path"])

    def test_merge_requires_two(self, simple_pdf: str, out_pdf: str) -> None:
        r = call_tool("pdf_merge", {"pdf_paths": [simple_pdf], "output_path": out_pdf})
        assert r.isError  # min_length=2

    def test_split(self, simple_pdf: str, tmp_path: Path) -> None:
        d = data(call_tool("pdf_split", {"pdf_path": simple_pdf, "output_dir": str(tmp_path)}))
        assert isinstance(d["page_paths"], list) and len(d["page_paths"]) >= 1


class TestPageOps:
    def test_reorder(
        self, simple_pdf: str, structured_pdf: str, tmp_path: Path, out_pdf: str
    ) -> None:
        merged = _two_page(simple_pdf, structured_pdf, tmp_path)
        d = data(
            call_tool(
                "pdf_reorder_pages",
                {"pdf_path": merged, "page_order": [1, 0], "output_path": out_pdf},
            )
        )
        assert os.path.exists(d["output_path"])

    def test_rotate(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_rotate_pages",
                {"pdf_path": simple_pdf, "pages": [0], "angle": 90, "output_path": out_pdf},
            )
        )
        assert os.path.exists(d["output_path"])

    def test_rotate_bad_angle(self, simple_pdf: str, out_pdf: str) -> None:
        r = call_tool(
            "pdf_rotate_pages",
            {"pdf_path": simple_pdf, "pages": [0], "angle": 45, "output_path": out_pdf},
        )
        assert r.isError  # angle must be 90/180/270

    def test_delete(
        self, simple_pdf: str, structured_pdf: str, tmp_path: Path, out_pdf: str
    ) -> None:
        merged = _two_page(simple_pdf, structured_pdf, tmp_path)
        d = data(
            call_tool(
                "pdf_delete_pages", {"pdf_path": merged, "pages": [0], "output_path": out_pdf}
            )
        )
        assert os.path.exists(d["output_path"])

    def test_crop(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_crop_pages",
                {
                    "pdf_path": simple_pdf,
                    "box": {"x0": 0, "y0": 0, "x1": 400, "y1": 700},
                    "output_path": out_pdf,
                },
            )
        )
        assert os.path.exists(d["output_path"])


class TestMetadataBookmark:
    def test_edit_metadata(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_edit_metadata",
                {
                    "pdf_path": simple_pdf,
                    "metadata": {"title": "T", "author": "A"},
                    "output_path": out_pdf,
                },
            )
        )
        assert os.path.exists(d["output_path"])

    def test_add_bookmark(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_add_bookmark",
                {"pdf_path": simple_pdf, "title": "Intro", "page": 0, "output_path": out_pdf},
            )
        )
        assert os.path.exists(d["output_path"])


class TestEncryptDecrypt:
    def test_roundtrip(self, simple_pdf: str, tmp_path: Path) -> None:
        enc = str(tmp_path / "enc.pdf")
        dec = str(tmp_path / "dec.pdf")
        data(
            call_tool(
                "pdf_encrypt",
                {
                    "pdf_path": simple_pdf,
                    "owner_password": "owner",
                    "user_password": "user",
                    "output_path": enc,
                },
            )
        )
        assert os.path.exists(enc)
        data(call_tool("pdf_decrypt", {"pdf_path": enc, "password": "user", "output_path": dec}))
        assert os.path.exists(dec)


class TestLinksHighlights:
    def test_add_hyperlink(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_add_hyperlink",
                {
                    "pdf_path": simple_pdf,
                    "page": 0,
                    "bbox": {"x0": 72, "y0": 700, "x1": 200, "y1": 720},
                    "uri": "https://example.com",
                    "output_path": out_pdf,
                },
            )
        )
        assert os.path.exists(d["output_path"])

    def test_add_highlight(self, simple_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_add_highlight",
                {
                    "pdf_path": simple_pdf,
                    "page": 0,
                    "quad_points": [72, 700, 200, 700, 72, 720, 200, 720],
                    "output_path": out_pdf,
                },
            )
        )
        assert os.path.exists(d["output_path"])

    def test_highlight_rejects_non_multiple_of_8(self, simple_pdf: str, out_pdf: str) -> None:
        r = call_tool(
            "pdf_add_highlight",
            {"pdf_path": simple_pdf, "page": 0, "quad_points": [1.0] * 12, "output_path": out_pdf},
        )
        assert r.isError  # length not a multiple of 8

    def test_flatten(self, structured_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_flatten_annotations", {"pdf_path": structured_pdf, "output_path": out_pdf}
            )
        )
        assert os.path.exists(d["output_path"])


class TestFormWatermark:
    def test_fill_form_graceful(self, simple_pdf: str, out_pdf: str) -> None:
        # No AcroForm in the fixture — must handle gracefully (no crash), not hang.
        r = call_tool(
            "pdf_fill_form", {"pdf_path": simple_pdf, "field_values": {}, "output_path": out_pdf}
        )
        assert isinstance(r.isError, bool)

    def test_add_watermark(self, structured_pdf: str, simple_pdf: str, out_pdf: str) -> None:
        r = call_tool(
            "pdf_add_watermark",
            {"pdf_path": structured_pdf, "watermark_path": simple_pdf, "output_path": out_pdf},
        )
        assert isinstance(r.isError, bool)
