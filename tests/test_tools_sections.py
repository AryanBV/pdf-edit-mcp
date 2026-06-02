"""Section-tool tests — port of bridge.test.ts section orchestration.

Pins the highest-risk invariants of the verbatim algorithm port: structure
detection, fuzzy-name resolution, ambiguous-name REFUSAL (no silent first-match),
and no-output-file-on-failure (the atomic swap + pre-write resolution guards).
"""

from __future__ import annotations

import os

from _mcp_helpers import call_tool, data


def _all_titles(sections: list) -> list[str]:
    titles: list[str] = []
    for s in sections:
        titles.append(s["title"])
        titles.extend(c["title"] for c in s.get("children", []))
    return titles


class TestDetectSections:
    def test_detects_structure(self, structured_pdf: str) -> None:
        d = data(call_tool("pdf_detect_sections", {"pdf_path": structured_pdf}))
        assert isinstance(d["sections"], list) and d["sections"]
        assert "body_font" in d and "heading_fonts" in d
        joined = " ".join(_all_titles(d["sections"]))
        assert "Experience" in joined and "Education" in joined and "Skills" in joined


class TestSwapSections:
    def test_swaps(self, structured_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_swap_sections",
                {
                    "pdf_path": structured_pdf,
                    "section_a": "Experience",
                    "section_b": "Education",
                    "output_path": out_pdf,
                },
            )
        )
        assert os.path.exists(out_pdf)
        assert d["swapped"] == ["Experience", "Education"]
        assert d["siblings_rerendered"] >= 2
        # the swap temp file must not linger
        assert not os.path.exists(out_pdf + ".swap_tmp")

    def test_ambiguous_refused_no_output(self, structured_pdf: str, out_pdf: str) -> None:
        # "e" matches Jane Smith / Experience / Education / Projects -> ambiguous.
        r = call_tool(
            "pdf_swap_sections",
            {
                "pdf_path": structured_pdf,
                "section_a": "e",
                "section_b": "Skills",
                "output_path": out_pdf,
            },
        )
        assert r.isError
        assert "ambiguous" in r.content[0].text.lower()  # type: ignore[union-attr]
        assert not os.path.exists(out_pdf)

    def test_not_found_no_output(self, structured_pdf: str, out_pdf: str) -> None:
        r = call_tool(
            "pdf_swap_sections",
            {
                "pdf_path": structured_pdf,
                "section_a": "zzz-absent",
                "section_b": "yyy-absent",
                "output_path": out_pdf,
            },
        )
        assert r.isError
        assert "not found" in r.content[0].text.lower()  # type: ignore[union-attr]
        assert not os.path.exists(out_pdf)


class TestReplaceSection:
    def test_replaces(self, structured_pdf: str, out_pdf: str) -> None:
        d = data(
            call_tool(
                "pdf_replace_section",
                {
                    "pdf_path": structured_pdf,
                    "section": "Skills",
                    "new_text": "Skills\nUpdated skill list.",
                    "output_path": out_pdf,
                },
            )
        )
        assert os.path.exists(out_pdf)
        assert d["replaced"] == "Skills"
        assert d["siblings_rerendered"] >= 2

    def test_not_found_no_output(self, structured_pdf: str, out_pdf: str) -> None:
        r = call_tool(
            "pdf_replace_section",
            {
                "pdf_path": structured_pdf,
                "section": "zzz-absent",
                "new_text": "x",
                "output_path": out_pdf,
            },
        )
        assert r.isError
        assert not os.path.exists(out_pdf)
