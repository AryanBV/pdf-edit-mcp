#!/usr/bin/env python3
"""Ultimate stress test for pdf-edit-mcp bridge.

Tests adversarial inputs, edge-case PDFs, state ordering, serialization
boundaries, and detect_sections failure modes — not just happy paths.
"""

from __future__ import annotations

import sys
import io
import os
import shutil
import traceback
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pikepdf
from bridge import (
    handle_get_text, handle_find_text, handle_replace_text,
    handle_batch_replace, handle_get_fonts, handle_detect_paragraphs,
    handle_analyze_subset, handle_replace_single, handle_inspect,
    handle_update_annotation, handle_replace_block,
    handle_batch_replace_block, handle_insert_text_block,
    handle_delete_block, handle_get_text_layout, handle_extract_bbox_text,
    handle_detect_sections, handle_merge, handle_split,
    handle_reorder_pages, handle_rotate_pages, handle_delete_pages,
    handle_crop_pages, handle_edit_metadata, handle_add_bookmark,
    handle_encrypt, handle_decrypt, handle_add_hyperlink,
    handle_add_highlight, handle_flatten_annotations, handle_fill_form,
    handle_add_watermark, handle_get_annotations, handle_add_annotation,
    handle_delete_annotation_engine, handle_move_annotation,
)
from pdf_edit_engine.errors import PDFEditError

RESUME = "C:/New Project/pdf-edit-engine/tests/corpus/Aryan_BV_Resume_2026.pdf"
OUT = os.path.join(os.path.dirname(__file__), "stress_output")

# ── Infrastructure ───────────────────────────────────────────────────

passed = 0
failed = 0
errors_list: list[str] = []


def out(name: str) -> str:
    return os.path.join(OUT, name).replace("\\", "/")


def assert_(cond, msg="assertion failed"):
    if not cond:
        raise AssertionError(msg)


def expect_error(fn, msg="Expected error"):
    try:
        fn()
        raise AssertionError(msg)
    except AssertionError:
        raise
    except Exception:
        pass  # Any exception is acceptable


def test(name: str, fn):
    global passed, failed
    try:
        fn()
        print(f"  PASS  {name}")
        passed += 1
    except Exception as e:
        tag = "FAIL" if isinstance(e, AssertionError) else "ERR "
        print(f"  {tag}  {name}: {e}")
        failed += 1
        errors_list.append(f"{name}: {e}")


# ── PDF Generators ───────────────────────────────────────────────────

def gen_empty_pdf():
    """PDF with one blank page — no text, no fonts."""
    pdf = pikepdf.Pdf.new()
    page = pikepdf.Page(pikepdf.Dictionary(
        Type=pikepdf.Name("/Page"),
        MediaBox=[0, 0, 612, 792],
    ))
    pdf.pages.append(page)
    p = out("gen_empty.pdf")
    pdf.save(p)
    return p


def gen_single_font_sizes():
    """PDF using ONE font at 3 different sizes — tests same-font hierarchy."""
    pdf = pikepdf.Pdf.new()
    page_dict = pikepdf.Dictionary(
        Type=pikepdf.Name("/Page"),
        MediaBox=[0, 0, 612, 792],
        Resources=pikepdf.Dictionary(
            Font=pikepdf.Dictionary(
                F1=pikepdf.Dictionary(
                    Type=pikepdf.Name("/Font"),
                    Subtype=pikepdf.Name("/Type1"),
                    BaseFont=pikepdf.Name("/Helvetica"),
                ),
            ),
        ),
    )
    stream = (
        b"BT /F1 18 Tf 72 700 Td (Document Title) Tj ET\n"
        b"BT /F1 14 Tf 72 660 Td (Section One Heading) Tj ET\n"
        b"BT /F1 10 Tf 72 640 Td (Body text paragraph one is here with details.) Tj ET\n"
        b"BT /F1 10 Tf 72 625 Td (Another line of body text in the section.) Tj ET\n"
        b"BT /F1 14 Tf 72 590 Td (Section Two Heading) Tj ET\n"
        b"BT /F1 10 Tf 72 570 Td (More body text in section two.) Tj ET\n"
    )
    page_dict[pikepdf.Name("/Contents")] = pdf.make_stream(stream)
    pdf.pages.append(pikepdf.Page(page_dict))
    p = out("gen_single_font.pdf")
    pdf.save(p)
    return p


def gen_no_heading_font():
    """PDF where all text is the same font AND size — no hierarchy."""
    pdf = pikepdf.Pdf.new()
    page_dict = pikepdf.Dictionary(
        Type=pikepdf.Name("/Page"),
        MediaBox=[0, 0, 612, 792],
        Resources=pikepdf.Dictionary(
            Font=pikepdf.Dictionary(
                F1=pikepdf.Dictionary(
                    Type=pikepdf.Name("/Font"),
                    Subtype=pikepdf.Name("/Type1"),
                    BaseFont=pikepdf.Name("/Helvetica"),
                ),
            ),
        ),
    )
    stream = (
        b"BT /F1 12 Tf 72 700 Td (All same font) Tj ET\n"
        b"BT /F1 12 Tf 72 680 Td (And same size everywhere) Tj ET\n"
        b"BT /F1 12 Tf 72 660 Td (No heading hierarchy at all) Tj ET\n"
    )
    page_dict[pikepdf.Name("/Contents")] = pdf.make_stream(stream)
    pdf.pages.append(pikepdf.Page(page_dict))
    p = out("gen_no_heading.pdf")
    pdf.save(p)
    return p


def gen_garbled_stream():
    """PDF with garbage content stream bytes."""
    pdf = pikepdf.Pdf.new()
    page_dict = pikepdf.Dictionary(
        Type=pikepdf.Name("/Page"),
        MediaBox=[0, 0, 612, 792],
    )
    page_dict[pikepdf.Name("/Contents")] = pdf.make_stream(b"\xff\xfe\x00\x01\xab\xcd")
    pdf.pages.append(pikepdf.Page(page_dict))
    p = out("gen_garbled.pdf")
    pdf.save(p)
    return p


def gen_multipage(n=5):
    """N-page PDF with distinct text per page."""
    pdf = pikepdf.Pdf.new()
    for i in range(n):
        page_dict = pikepdf.Dictionary(
            Type=pikepdf.Name("/Page"),
            MediaBox=[0, 0, 612, 792],
            Resources=pikepdf.Dictionary(
                Font=pikepdf.Dictionary(
                    F1=pikepdf.Dictionary(
                        Type=pikepdf.Name("/Font"),
                        Subtype=pikepdf.Name("/Type1"),
                        BaseFont=pikepdf.Name("/Helvetica"),
                    ),
                ),
            ),
        )
        text = f"Page {i} content unique_{i:04d}".encode()
        page_dict[pikepdf.Name("/Contents")] = pdf.make_stream(
            b"BT /F1 12 Tf 72 700 Td (" + text + b") Tj ET\n"
        )
        pdf.pages.append(pikepdf.Page(page_dict))
    p = out(f"gen_{n}page.pdf")
    pdf.save(p)
    return p


# ── Setup ────────────────────────────────────────────────────────────

if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

print("=" * 70)
print("ULTIMATE STRESS TEST — pdf-edit-mcp")
print("=" * 70)

# ── Category 1: Carpenter Workflow (golden path) ─────────────────────

print("\n--- Cat 1: Carpenter Workflow ---")


def test_golden_swap():
    r = handle_detect_sections({"pdf_path": RESUME, "page": 0, "include_text": True})
    top = r["sections"][0]
    projects = [c for c in top["children"] if "PROJECTS" in c["title"]]
    assert_(len(projects) == 1, "No PROJECTS section")
    kids = [c for c in top["children"]
            if c["level"] == 2
            and c["bbox"]["y0"] >= projects[0]["bbox"]["y0"]
            and c["bbox"]["y1"] <= projects[0]["bbox"]["y1"]]
    assert_(len(kids) == 3, f"Expected 3 projects, got {len(kids)}")
    ajsp, lumina, smart = kids
    result = handle_batch_replace_block({
        "pdf_path": RESUME, "page_number": 0,
        "replacements": [
            {"bbox": ajsp["bbox"], "new_text": smart["text"]},
            {"bbox": lumina["bbox"], "new_text": lumina["text"]},
            {"bbox": smart["bbox"], "new_text": ajsp["text"]},
        ],
        "output_path": out("golden_swap.pdf"),
    })
    assert_(all(r["success"] for r in result["results"]))
    text = handle_get_text({"pdf_path": out("golden_swap.pdf")})["text"]
    assert_(text.count("Aryan B V") == 1, "Duplicate header")
    assert_(text.find("SMART_MED") < text.find("Lumina"), "Wrong order")
    assert_(text.find("AJSP") > text.find("Lumina"), "Wrong order")


def test_custom_text_with_bullets():
    r = handle_detect_sections({"pdf_path": RESUME, "page": 0, "include_text": True})
    top = r["sections"][0]
    proj = [c for c in top["children"] if "PROJECTS" in c["title"]][0]
    kids = [c for c in top["children"]
            if c["level"] == 2
            and c["bbox"]["y0"] >= proj["bbox"]["y0"]
            and c["bbox"]["y1"] <= proj["bbox"]["y1"]]
    ajsp, lumina, smart = kids
    custom = (
        "PDF Edit Engine \u2014 Format-Preserving Library\n"
        "Python 3.12+, pikepdf, fonttools\n"
        "\u2022 Built a Python library for PDF editing\n"
        "\u2022 Implemented two-tier font extension\n"
        "\u2022 Built FidelityReport validation"
    )
    result = handle_batch_replace_block({
        "pdf_path": RESUME, "page_number": 0,
        "replacements": [
            {"bbox": ajsp["bbox"], "new_text": custom},
            {"bbox": lumina["bbox"], "new_text": lumina["text"]},
            {"bbox": smart["bbox"], "new_text": ajsp["text"]},
        ],
        "output_path": out("golden_custom.pdf"),
    })
    assert_(all(r["success"] for r in result["results"]))
    text = handle_get_text({"pdf_path": out("golden_custom.pdf")})["text"]
    assert_("PDF Edit Engine" in text, "Custom text missing")


def test_detect_extract_roundtrip():
    """detect_sections text must exactly match extract_bbox_text for same bbox."""
    r = handle_detect_sections({"pdf_path": RESUME, "page": 0, "include_text": True})
    top = r["sections"][0]
    for child in top.get("children", []):
        if not child.get("text"):
            continue
        extracted = handle_extract_bbox_text({
            "pdf_path": RESUME, "bbox": child["bbox"], "page": 0, "tolerance": 0,
        })
        assert_(extracted["text"] == child["text"],
                f"Mismatch for '{child['title'][:30]}': "
                f"detect={len(child['text'])}chars vs extract={len(extracted['text'])}chars")


test("1.1 golden swap via detect_sections", test_golden_swap)
test("1.2 custom text with U+2022 bullets", test_custom_text_with_bullets)
test("1.3 detect/extract text roundtrip for ALL sections", test_detect_extract_roundtrip)

# ── Category 2: detect_sections Edge Cases ───────────────────────────

print("\n--- Cat 2: detect_sections Edge Cases ---")

test("2.1 empty PDF (no text)", lambda: (
    p := gen_empty_pdf(),
    r := handle_detect_sections({"pdf_path": p, "page": 0}),
    assert_(r["sections"] == [], f"Expected empty, got {len(r['sections'])} sections"),
))

test("2.2 single font, multiple sizes (hierarchy by size only)", lambda: (
    p := gen_single_font_sizes(),
    r := handle_detect_sections({"pdf_path": p, "page": 0, "include_text": False}),
    # Should detect heading hierarchy from size differences alone
    assert_(len(r["sections"]) > 0, "No sections found — same-font hierarchy broken"),
))

test("2.3 uniform font (no hierarchy) returns empty", lambda: (
    p := gen_no_heading_font(),
    r := handle_detect_sections({"pdf_path": p, "page": 0}),
    assert_(r["sections"] == [], f"Expected empty, got {len(r['sections'])}"),
))

test("2.4 garbled content stream → clean error", lambda: expect_error(
    lambda: handle_detect_sections({"pdf_path": gen_garbled_stream(), "page": 0}),
    "Garbled PDF should raise, not return data"
))

test("2.5 include_text=false omits text field", lambda: (
    r := handle_detect_sections({"pdf_path": RESUME, "page": 0, "include_text": False}),
    top := r["sections"][0],
    [assert_("text" not in c, f"text present in {c['title'][:20]}")
     for c in top.get("children", [])],
))

test("2.6 all level-2 sections nest under exactly one parent", lambda: (
    r := handle_detect_sections({"pdf_path": RESUME, "page": 0, "include_text": False}),
    top := r["sections"][0],
    level1 := [c for c in top.get("children", []) if c["level"] == 1],
    level2 := [c for c in top.get("children", []) if c["level"] == 2],
    [assert_(
        sum(1 for p in level1
            if c["bbox"]["y0"] >= p["bbox"]["y0"]
            and c["bbox"]["y1"] <= p["bbox"]["y1"]) == 1,
        f"'{c['title'][:30]}' has wrong parent count"
    ) for c in level2],
))

test("2.7 out-of-range page → clean error", lambda: expect_error(
    lambda: handle_detect_sections({"pdf_path": RESUME, "page": 99}),
    "Page 99 on 1-page PDF should raise"
))

# ── Category 3: Adversarial Inputs ───────────────────────────────────

print("\n--- Cat 3: Adversarial Inputs ---")

test("3.1 non-existent PDF", lambda: expect_error(
    lambda: handle_get_text({"pdf_path": "C:/nonexistent/fake.pdf"})
))

test("3.2 empty search string → empty matches (not error)", lambda: (
    r := handle_find_text({"pdf_path": RESUME, "search": ""}),
    assert_(isinstance(r["matches"], list), "Should return list"),
))

test("3.3 very long replacement (10k chars)", lambda: (
    handle_replace_block({
        "pdf_path": RESUME, "page": 0,
        "bbox": {"x0": 14, "y0": 309, "x1": 580, "y1": 446},
        "new_text": "A" * 10000,
        "output_path": out("long_replace.pdf"),
    }),
    # Should succeed or fail gracefully — not crash
))

test("3.4 inverted bbox (y0 > y1)", lambda: (
    r := handle_extract_bbox_text({
        "pdf_path": RESUME,
        "bbox": {"x0": 14, "y0": 500, "x1": 580, "y1": 100},  # inverted
        "page": 0, "tolerance": 0,
    }),
    # Engine should return empty or handle gracefully
    assert_(isinstance(r["text"], str), "Should return string"),
))

test("3.5 negative annotation index", lambda: expect_error(
    lambda: handle_delete_annotation_engine({
        "pdf_path": RESUME, "page": 0, "annotation_index": -1,
        "output_path": out("neg_idx.pdf"),
    })
))

test("3.6 annotation index out of range", lambda: expect_error(
    lambda: handle_delete_annotation_engine({
        "pdf_path": RESUME, "page": 0, "annotation_index": 9999,
        "output_path": out("big_idx.pdf"),
    })
))

test("3.7 empty replacement string", lambda: (
    # Empty string replacement should work or fail cleanly
    handle_replace_text({
        "pdf_path": RESUME, "search": "Bangalore",
        "replacement": "", "output_path": out("empty_replace.pdf"),
    }),
))

test("3.8 replace_single with no matches → success=False", lambda: (
    r := handle_replace_single({
        "pdf_path": RESUME, "search": "XYZNONEXISTENT",
        "match_index": 0, "replacement": "test",
        "output_path": out("no_match.pdf"),
    }),
    assert_(r["success"] is False, "Should be success=False, not error"),
))

test("3.9 garbled PDF with get_text → clean error", lambda: expect_error(
    lambda: handle_get_text({"pdf_path": gen_garbled_stream()}),
    "Garbled PDF should raise on get_text"
))

test("3.10 garbled PDF with find_text → clean error", lambda: expect_error(
    lambda: handle_find_text({"pdf_path": gen_garbled_stream(), "search": "anything"}),
    "Garbled PDF should raise on find_text"
))

# ── Category 4: Document Operations Stress ───────────────────────────

print("\n--- Cat 4: Document Operations ---")


def test_merge_split_roundtrip():
    mp = gen_multipage(3)
    # Merge with itself
    handle_merge({"pdf_paths": [mp, mp], "output_path": out("merged6.pdf")})
    r = handle_get_text({"pdf_path": out("merged6.pdf")})
    assert_(r["page_count"] == 6, f"Expected 6 pages, got {r['page_count']}")
    # Split
    split_dir = os.path.join(OUT, "split")
    os.makedirs(split_dir, exist_ok=True)
    sr = handle_split({"pdf_path": out("merged6.pdf"), "output_dir": split_dir.replace("\\", "/")})
    assert_(len(sr["page_paths"]) == 6, f"Expected 6 files, got {len(sr['page_paths'])}")


def test_reorder_with_duplicates():
    """Duplicate page indices in reorder — engine should duplicate pages."""
    mp = gen_multipage(3)
    handle_reorder_pages({
        "pdf_path": mp, "page_order": [0, 0, 1, 2],
        "output_path": out("reorder_dup.pdf"),
    })
    r = handle_get_text({"pdf_path": out("reorder_dup.pdf")})
    assert_(r["page_count"] == 4, f"Expected 4 pages, got {r['page_count']}")


def test_encrypt_decrypt_roundtrip():
    handle_encrypt({
        "pdf_path": RESUME, "owner_password": "own", "user_password": "usr",
        "output_path": out("enc.pdf"),
    })
    handle_decrypt({
        "pdf_path": out("enc.pdf"), "password": "usr",
        "output_path": out("dec.pdf"),
    })
    text = handle_get_text({"pdf_path": out("dec.pdf")})["text"]
    assert_("Aryan B V" in text, "Decrypted text corrupted")


def test_encrypt_wrong_password():
    handle_encrypt({
        "pdf_path": RESUME, "owner_password": "own", "user_password": "usr",
        "output_path": out("enc2.pdf"),
    })
    expect_error(lambda: handle_decrypt({
        "pdf_path": out("enc2.pdf"), "password": "WRONG",
        "output_path": out("dec2.pdf"),
    }), "Wrong password should fail")


def test_rotate_then_get_text():
    handle_rotate_pages({
        "pdf_path": RESUME, "pages": [0], "angle": 180,
        "output_path": out("rot180.pdf"),
    })
    r = handle_get_text({"pdf_path": out("rot180.pdf")})
    assert_(len(r["text"]) > 100, "Rotated page text missing")


def test_crop_extreme():
    """Crop to a tiny area — should still produce valid PDF."""
    handle_crop_pages({
        "pdf_path": RESUME,
        "box": {"x0": 0, "y0": 780, "x1": 100, "y1": 800},
        "output_path": out("tiny_crop.pdf"),
    })
    r = handle_get_text({"pdf_path": out("tiny_crop.pdf")})
    assert_(isinstance(r["text"], str))


def test_delete_all_but_one_page():
    mp = gen_multipage(3)
    handle_delete_pages({
        "pdf_path": mp, "pages": [1, 2],
        "output_path": out("one_page.pdf"),
    })
    r = handle_get_text({"pdf_path": out("one_page.pdf")})
    assert_(r["page_count"] == 1)


def test_metadata_special_chars():
    handle_edit_metadata({
        "pdf_path": RESUME,
        "metadata": {"title": "Test & <special> \"chars\"", "author": "Aryan"},
        "output_path": out("metadata_special.pdf"),
    })
    assert_(os.path.exists(out("metadata_special.pdf")))


def test_add_bookmark_out_of_range():
    """Bookmark to page 999 on 1-page PDF — engine rejects."""
    expect_error(
        lambda: handle_add_bookmark({
            "pdf_path": RESUME, "title": "Ghost", "page": 999,
            "output_path": out("bm999.pdf"),
        }),
        "Bookmark to page 999 should raise"
    )


test("4.1 merge+split roundtrip (6 pages)", test_merge_split_roundtrip)
test("4.2 reorder with duplicate indices", test_reorder_with_duplicates)
test("4.3 encrypt/decrypt roundtrip", test_encrypt_decrypt_roundtrip)
test("4.4 decrypt with wrong password", test_encrypt_wrong_password)
test("4.5 rotate 180 then get_text", test_rotate_then_get_text)
test("4.6 crop to tiny area", test_crop_extreme)
test("4.7 delete pages (3→1)", test_delete_all_but_one_page)
test("4.8 metadata with special chars", test_metadata_special_chars)
test("4.9 bookmark to non-existent page", test_add_bookmark_out_of_range)

# ── Category 5: Annotation Stress ────────────────────────────────────

print("\n--- Cat 5: Annotation Operations ---")


def test_add_then_delete_annotation():
    handle_add_annotation({
        "pdf_path": RESUME, "page": 0,
        "rect": {"x0": 100, "y0": 100, "x1": 200, "y1": 120},
        "uri": "https://example.com",
        "output_path": out("annot_added.pdf"),
    })
    before = handle_get_annotations({"pdf_path": out("annot_added.pdf"), "page": 0})
    assert_(len(before["annotations"]) == 7, f"Expected 7, got {len(before['annotations'])}")
    handle_delete_annotation_engine({
        "pdf_path": out("annot_added.pdf"), "page": 0, "annotation_index": 6,
        "output_path": out("annot_deleted.pdf"),
    })
    after = handle_get_annotations({"pdf_path": out("annot_deleted.pdf"), "page": 0})
    assert_(len(after["annotations"]) == 6, f"Expected 6, got {len(after['annotations'])}")


def test_move_annotation_verify():
    handle_move_annotation({
        "pdf_path": RESUME, "page": 0, "annotation_index": 0,
        "new_rect": {"x0": 300, "y0": 300, "x1": 400, "y1": 320},
        "output_path": out("annot_moved.pdf"),
    })
    r = handle_get_annotations({"pdf_path": out("annot_moved.pdf"), "page": 0})
    moved = r["annotations"][0]
    assert_(abs(moved["rect"]["x0"] - 300) < 1, "Not moved")


def test_flatten_removes_all():
    handle_flatten_annotations({
        "pdf_path": RESUME, "output_path": out("flat.pdf"),
    })
    r = handle_get_annotations({"pdf_path": out("flat.pdf")})
    assert_(len(r["annotations"]) == 0, f"Still has {len(r['annotations'])}")


test("5.1 add then delete annotation", test_add_then_delete_annotation)
test("5.2 move annotation and verify position", test_move_annotation_verify)
test("5.3 flatten removes all annotations", test_flatten_removes_all)

# ── Category 6: State Ordering / Tool Sequences ─────────────────────

print("\n--- Cat 6: State Ordering ---")


def test_edit_then_detect():
    """After editing a PDF, detect_sections should reflect the edit."""
    # Replace AJSP Manager text
    handle_replace_block({
        "pdf_path": RESUME, "page": 0,
        "bbox": {"x0": 14, "y0": 309, "x1": 580, "y1": 446},
        "new_text": "REPLACED SECTION\nNew content here",
        "output_path": out("edited_for_detect.pdf"),
    })
    # detect_sections on the EDITED PDF
    r = handle_detect_sections({
        "pdf_path": out("edited_for_detect.pdf"), "page": 0, "include_text": True,
    })
    # Should NOT find AJSP Manager in the edited PDF
    all_text = " ".join(
        c.get("text", "") for s in r["sections"]
        for c in s.get("children", [])
    )
    assert_("AJSP Manager" not in all_text, "Stale: AJSP still in edited PDF sections")


def test_write_then_read():
    """Write to a PDF, then immediately read it."""
    handle_replace_text({
        "pdf_path": RESUME, "search": "Bangalore",
        "replacement": "STATETEST", "output_path": out("state_wr.pdf"),
    })
    r = handle_get_text({"pdf_path": out("state_wr.pdf")})
    assert_("STATETEST" in r["text"], "Write then read failed")


def test_chained_edits():
    """5 sequential edits on the same PDF, each building on the previous."""
    p = RESUME
    for i, (old, new) in enumerate([
        ("Bangalore", "City_A"),
        ("India", "Country_B"),
        ("2025", "Year_C"),
    ]):
        o = out(f"chain_{i}.pdf")
        handle_replace_text({"pdf_path": p, "search": old, "replacement": new, "output_path": o})
        p = o
    text = handle_get_text({"pdf_path": p})["text"]
    assert_("City_A" in text, "Chain edit 0 lost")
    assert_("Country_B" in text, "Chain edit 1 lost")
    assert_("Year_C" in text, "Chain edit 2 lost")


test("6.1 edit PDF then detect_sections on edited version", test_edit_then_detect)
test("6.2 write then immediate read", test_write_then_read)
test("6.3 chained edits (3 sequential)", test_chained_edits)

# ── Category 7: Inspect Stress ───────────────────────────────────────

print("\n--- Cat 7: Inspect Stress ---")


def test_inspect_full():
    r = handle_inspect({"pdf_path": RESUME})
    assert_(r["page_count"] == 1)
    assert_(len(r["text"]) > 1000)
    assert_(len(r["fonts"]) == 6)
    assert_(len(r["paragraphs"]) > 10)
    assert_(len(r["annotations"]) == 6)
    assert_("text_layout" not in r)


def test_inspect_with_layout():
    r = handle_inspect({"pdf_path": RESUME, "include_layout": True})
    assert_("text_layout" in r)
    assert_(len(r["text_layout"]) > 200)


def test_inspect_empty_pdf():
    p = gen_empty_pdf()
    r = handle_inspect({"pdf_path": p})
    assert_(r["page_count"] == 1)
    assert_(isinstance(r["text"], str))
    assert_(isinstance(r["fonts"], list))
    assert_(isinstance(r["paragraphs"], list))


def test_inspect_garbled_pdf():
    """Garbled PDF raises on inspect — engine can't parse content stream."""
    p = gen_garbled_stream()
    expect_error(
        lambda: handle_inspect({"pdf_path": p}),
        "Garbled PDF should raise on inspect"
    )


def test_inspect_multipage():
    p = gen_multipage(5)
    r = handle_inspect({"pdf_path": p, "include_layout": True})
    assert_(r["page_count"] == 5)
    # Should have layout blocks from multiple pages
    pages_seen = set(b["page"] for b in r["text_layout"])
    assert_(len(pages_seen) >= 3, f"Only saw pages {pages_seen}")


test("7.1 inspect full (default)", test_inspect_full)
test("7.2 inspect with include_layout", test_inspect_with_layout)
test("7.3 inspect empty PDF", test_inspect_empty_pdf)
test("7.4 inspect garbled PDF", test_inspect_garbled_pdf)
test("7.5 inspect 5-page PDF with layout", test_inspect_multipage)

# ── Category 8: Read Tool Edge Cases ─────────────────────────────────

print("\n--- Cat 8: Read Tool Edge Cases ---")

test("8.1 get_text_layout on empty PDF", lambda: (
    p := gen_empty_pdf(),
    r := handle_get_text_layout({"pdf_path": p, "page": 0}),
    assert_(r["blocks"] == [], f"Expected empty, got {len(r['blocks'])}"),
))

test("8.2 find_text case insensitive", lambda: (
    r := handle_find_text({"pdf_path": RESUME, "search": "aryan b v", "case_sensitive": False}),
    assert_(len(r["matches"]) >= 1, "Case-insensitive search failed"),
))

test("8.3 extract_bbox_text with tolerance=10", lambda: (
    r := handle_extract_bbox_text({
        "pdf_path": RESUME, "bbox": {"x0": 14, "y0": 430, "x1": 100, "y1": 440},
        "page": 0, "tolerance": 10,
    }),
    assert_(len(r["text"]) > 0, "Loose tolerance found nothing"),
))

test("8.4 analyze_subset for bullet char", lambda: (
    r := handle_analyze_subset({"pdf_path": RESUME, "text": "\u2022", "font_name": "F1"}),
    # Bullet may or may not be in F1 — just shouldn't crash
    assert_(isinstance(r["available"], bool)),
))

test("8.5 detect_paragraphs on empty PDF", lambda: (
    p := gen_empty_pdf(),
    r := handle_detect_paragraphs({"pdf_path": p, "page": 0}),
    assert_(r["paragraphs"] == []),
))

# ── Category 9: Write Tool Edge Cases ────────────────────────────────

print("\n--- Cat 9: Write Tool Edge Cases ---")


def test_batch_replace_partial_match():
    """Some edits match, some don't — partial success."""
    r = handle_batch_replace({
        "pdf_path": RESUME,
        "edits": [
            {"find": "Bangalore", "replace": "FOUND"},
            {"find": "XYZNONEXISTENT999", "replace": "NOPE"},
        ],
        "output_path": out("partial_batch.pdf"),
    })
    assert_(r["summary"]["succeeded"] >= 1, "No edits at all")
    assert_(r["summary"]["failed"] >= 0)  # May or may not count non-matches as failures


def test_delete_block_at_bottom():
    """Delete block near page bottom — close_gap should work."""
    handle_delete_block({
        "pdf_path": RESUME, "page": 0,
        "bbox": {"x0": 14, "y0": 10, "x1": 580, "y1": 80},
        "output_path": out("delete_bottom.pdf"),
    })
    assert_(os.path.exists(out("delete_bottom.pdf")))


def test_insert_then_get_text():
    handle_insert_text_block({
        "pdf_path": RESUME, "page": 0,
        "x": 72, "y": 400, "text": "INSERTED_MARKER_12345",
        "output_path": out("inserted.pdf"),
    })
    r = handle_get_text({"pdf_path": out("inserted.pdf")})
    assert_("INSERTED_MARKER_12345" in r["text"])


test("9.1 batch_replace with partial matches", test_batch_replace_partial_match)
test("9.2 delete_block at page bottom", test_delete_block_at_bottom)
test("9.3 insert then verify text", test_insert_then_get_text)

# ── Summary ─────────────────────────────────────────────────────────

print()
print("=" * 70)
total = passed + failed
print(f"RESULTS: {passed}/{total} passed, {failed} failed")
print("=" * 70)
if errors_list:
    print("\nFailed tests:")
    for e in errors_list:
        print(f"  - {e}")
    sys.exit(1)
else:
    print("\nALL TESTS PASSED")
