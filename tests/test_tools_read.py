"""Read/analysis tool tests — port of bridge.test.ts Theme D (read tools).

Exercises each read tool through the real in-memory MCP session and pins the
return shapes (the wire contract the v0.1.x bridge guaranteed).
"""

from __future__ import annotations

from _mcp_helpers import call_tool, data


class TestGetText:
    def test_returns_text_and_page_count(self, simple_pdf: str) -> None:
        r = call_tool("pdf_get_text", {"pdf_path": simple_pdf})
        assert not r.isError
        d = data(r)
        assert "Test Document" in d["text"]
        assert d["page_count"] == 1

    def test_page_filter(self, simple_pdf: str) -> None:
        d = data(call_tool("pdf_get_text", {"pdf_path": simple_pdf, "page": 0}))
        assert isinstance(d["text"], str) and isinstance(d["page_count"], int)


class TestFindText:
    def test_finds_match(self, simple_pdf: str) -> None:
        d = data(call_tool("pdf_find_text", {"pdf_path": simple_pdf, "search": "Test Document"}))
        assert len(d["matches"]) == 1
        m = d["matches"][0]
        assert m["text"] == "Test Document"
        assert m["page"] == 0
        assert set(m["position"]) == {"x0", "y0", "x1", "y1"}

    def test_case_insensitive(self, simple_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_find_text",
                {"pdf_path": simple_pdf, "search": "test document", "case_sensitive": False},
            )
        )
        assert len(d["matches"]) >= 1

    def test_no_match(self, simple_pdf: str) -> None:
        d = data(call_tool("pdf_find_text", {"pdf_path": simple_pdf, "search": "zzz-not-present"}))
        assert d["matches"] == []


class TestGetFonts:
    def test_lists_fonts(self, simple_pdf: str) -> None:
        d = data(call_tool("pdf_get_fonts", {"pdf_path": simple_pdf}))
        assert len(d["fonts"]) >= 1
        f = d["fonts"][0]
        assert isinstance(f["name"], str) and isinstance(f["encoding_type"], str)
        assert {"postscript_name", "glyph_count", "embedded_type", "is_subset"} <= set(f)


class TestDetectParagraphs:
    def test_detects(self, simple_pdf: str) -> None:
        d = data(call_tool("pdf_detect_paragraphs", {"pdf_path": simple_pdf}))
        assert len(d["paragraphs"]) >= 1
        p = d["paragraphs"][0]
        assert isinstance(p["text"], str)
        assert p["page"] == 0
        assert set(p["bbox"]) == {"x0", "y0", "x1", "y1"}


class TestAnalyzeSubset:
    def test_base14_font_surfaces_clean_error(self, simple_pdf: str) -> None:
        # The reportlab fixture uses base-14 Helvetica (no embedded FontDescriptor),
        # which analyze_subset cannot introspect — the tool must surface a clean,
        # classified error (with hint) rather than crash.
        r = call_tool("pdf_analyze_subset", {"pdf_path": simple_pdf, "text": "Test"})
        assert r.isError
        msg = r.content[0].text  # type: ignore[union-attr]
        assert "FontNotFoundError" in msg or "FontDescriptor" in msg
        assert "hint:" in msg.lower()


class TestGetTextLayout:
    def test_blocks(self, simple_pdf: str) -> None:
        d = data(call_tool("pdf_get_text_layout", {"pdf_path": simple_pdf}))
        assert len(d["blocks"]) >= 1
        b = d["blocks"][0]
        assert {"text", "x", "y", "width", "height", "font_name", "font_size", "page"} <= set(b)


class TestExtractBboxText:
    def test_extracts(self, simple_pdf: str) -> None:
        r = call_tool(
            "pdf_extract_bbox_text",
            {"pdf_path": simple_pdf, "bbox": {"x0": 0, "y0": 0, "x1": 612, "y1": 792}, "page": 0},
        )
        assert not r.isError
        assert isinstance(data(r)["text"], str)


class TestInspect:
    def test_simple(self, simple_pdf: str) -> None:
        d = data(call_tool("pdf_inspect", {"pdf_path": simple_pdf}))
        assert d["page_count"] == 1
        assert "Test Document" in d["text"]
        assert len(d["fonts"]) >= 1
        assert "postscript_name" in d["fonts"][0]
        assert isinstance(d["paragraphs"], list)
        assert d["annotations"] == []

    def test_structured_has_annotations(self, structured_pdf: str) -> None:
        d = data(call_tool("pdf_inspect", {"pdf_path": structured_pdf}))
        assert len(d["annotations"]) >= 1
        a = d["annotations"][0]
        assert "subtype" in a and "rect" in a and "page" in a


class TestValidationRejects:
    def test_relative_path_rejected(self, simple_pdf: str) -> None:
        r = call_tool("pdf_get_text", {"pdf_path": "relative.pdf"})
        assert r.isError

    def test_nonexistent_file(self) -> None:
        r = call_tool("pdf_get_text", {"pdf_path": "C:/nonexistent/missing.pdf"})
        assert r.isError
