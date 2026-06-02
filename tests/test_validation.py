"""Validation-layer tests — port of the v0.1.x validation.test.ts + security.test.ts.

Pins the path-safety predicate, the shared Pydantic models (BBox/EditItem/
BlockReplacement), and their strictness/bounds against the same input→outcome
contract the TypeScript Zod schemas enforced.
"""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from pdf_edit_mcp.constants import MAX_PATH_LENGTH, MAX_REPLACEMENT_TEXT, MAX_SEARCH_TEXT
from pdf_edit_mcp.validation import (
    BBox,
    BlockReplacement,
    DirPath,
    EditItem,
    OutputPath,
    PdfPath,
    path_safety_error,
)

_pdf = TypeAdapter(PdfPath)
_out = TypeAdapter(OutputPath)
_dir = TypeAdapter(DirPath)


class TestPathSafetyPredicate:
    @pytest.mark.parametrize(
        "path",
        [
            "C:/documents/file.pdf",
            "C:\\documents\\file.pdf",
            "/home/user/file.pdf",
            "C:/docs/FILE.PDF",  # case-insensitive .pdf
            "/home/user/documents/report.pdf",
        ],
    )
    def test_accepts_clean_absolute_pdf(self, path: str) -> None:
        assert path_safety_error(path) is None
        assert _pdf.validate_python(path) == path

    @pytest.mark.parametrize(
        ("path", "fragment"),
        [
            ("", "empty"),
            ("docs/file.pdf", "absolute"),
            ("C:/docs/file.txt", ".pdf"),
            ("C:/Users/docs/../../windows/system32/evil.pdf", "traversal"),
            ("/tmp/../../../etc/shadow.pdf", "traversal"),
            ("C:/Users/docs/..\\..\\evil.pdf", "traversal"),
        ],
    )
    def test_rejects(self, path: str, fragment: str) -> None:
        err = path_safety_error(path)
        assert err is not None and fragment in err.lower()
        with pytest.raises(ValidationError):
            _pdf.validate_python(path)

    def test_length_boundary(self) -> None:
        at_cap = "C:/" + "a" * (MAX_PATH_LENGTH - len("C:/.pdf")) + ".pdf"
        assert len(at_cap) == MAX_PATH_LENGTH
        assert path_safety_error(at_cap) is None
        over = "C:/" + "a" * MAX_PATH_LENGTH + ".pdf"
        assert path_safety_error(over) is not None and "length" in path_safety_error(over).lower()

    def test_control_char_rejected(self) -> None:
        assert path_safety_error("C:/docs/fi\x00le.pdf") is not None

    def test_trailing_dot_or_space_rejected_on_dir(self) -> None:
        # Trailing-space basenames surface on dir paths (no .pdf gate first).
        assert path_safety_error("C:/docs/sub ", require_pdf_extension=False) is not None
        assert path_safety_error("C:/docs/sub.", require_pdf_extension=False) is not None

    @pytest.mark.parametrize("name", ["CON", "PRN", "AUX", "NUL", "COM1", "LPT9"])
    def test_windows_reserved_basename_rejected(self, name: str) -> None:
        assert path_safety_error(f"C:/docs/{name}.pdf") is not None

    def test_output_path_same_rules(self) -> None:
        assert _out.validate_python("C:/output/result.pdf") == "C:/output/result.pdf"
        with pytest.raises(ValidationError):
            _out.validate_python("C:/output/../../../windows/evil.pdf")

    def test_dir_path_allows_no_pdf_suffix(self) -> None:
        assert _dir.validate_python("C:/output/folder") == "C:/output/folder"
        with pytest.raises(ValidationError):
            _dir.validate_python("relative/folder")  # not absolute
        with pytest.raises(ValidationError):
            _dir.validate_python("C:/output/../escape")  # traversal


class TestBBox:
    def test_accepts_typical_and_negative(self) -> None:
        assert BBox(x0=0, y0=0, x1=612, y1=792).as_tuple() == (0.0, 0.0, 612.0, 792.0)
        assert BBox(x0=-100, y0=-200, x1=500, y1=800).as_tuple() == (-100.0, -200.0, 500.0, 800.0)

    def test_rejects_out_of_range(self) -> None:
        with pytest.raises(ValidationError):
            BBox(x0=0, y0=0, x1=100_000, y1=792)

    def test_rejects_string_coordinate(self) -> None:
        with pytest.raises(ValidationError):
            BBox(x0="0", y0=0, x1=612, y1=792)  # type: ignore[arg-type]

    def test_rejects_missing_field(self) -> None:
        with pytest.raises(ValidationError):
            BBox(x0=0, y0=0, x1=612)  # type: ignore[call-arg]

    def test_rejects_extra_field(self) -> None:
        with pytest.raises(ValidationError):
            BBox(x0=0, y0=0, x1=612, y1=792, z=1)  # type: ignore[call-arg]


class TestEditItem:
    def test_accepts(self) -> None:
        e = EditItem(find="old", replace="new")
        assert (e.find, e.replace) == ("old", "new")

    def test_replace_accepts_exactly_max(self) -> None:
        EditItem(find="x", replace="y" * MAX_REPLACEMENT_TEXT)

    def test_rejects_empty_find(self) -> None:
        with pytest.raises(ValidationError):
            EditItem(find="", replace="new")

    def test_rejects_oversize(self) -> None:
        with pytest.raises(ValidationError):
            EditItem(find="x" * (MAX_SEARCH_TEXT + 1), replace="new")
        with pytest.raises(ValidationError):
            EditItem(find="x", replace="y" * (MAX_REPLACEMENT_TEXT + 1))

    def test_rejects_extra_field(self) -> None:
        with pytest.raises(ValidationError):
            EditItem(find="a", replace="b", extra=1)  # type: ignore[call-arg]


class TestBlockReplacement:
    def test_accepts(self) -> None:
        br = BlockReplacement(bbox=BBox(x0=0, y0=0, x1=10, y1=10), new_text="hi")
        assert br.new_text == "hi" and br.bbox.as_tuple() == (0.0, 0.0, 10.0, 10.0)

    def test_rejects_missing_bbox(self) -> None:
        with pytest.raises(ValidationError):
            BlockReplacement(new_text="hi")  # type: ignore[call-arg]

    def test_rejects_empty_new_text(self) -> None:
        with pytest.raises(ValidationError):
            BlockReplacement(bbox=BBox(x0=0, y0=0, x1=10, y1=10), new_text="")
