"""Serialise engine ``EditResult`` / ``FidelityReport`` to the wrapper's wire shapes.

Hand-rolled to preserve the exact JSON the v0.1.x ``bridge.py`` produced (the
integration suite pins these keys); mirrors ``bridge._serialize_edit_result``. The
v0.2.0 degradation kinds flow through unchanged — each ``Degradation`` becomes
``{kind, detail, severity}``, so new kinds need no wrapper change.
"""

from __future__ import annotations

from typing import Any

from pdf_edit_engine import EditResult


def serialize_edit_result(result: EditResult) -> dict[str, Any]:
    """Return the per-edit dict: success + text + font_action + fidelity report."""
    fr = result.fidelity_report
    return {
        "success": result.success,
        "original_text": result.original_text,
        "new_text": result.new_text,
        "font_action": result.font_action,
        "warnings": list(result.warnings),
        "fidelity": {
            "font_preserved": fr.font_preserved,
            "font_substituted": fr.font_substituted,
            "overflow_detected": fr.overflow_detected,
            "reflow_applied": fr.reflow_applied,
            "glyphs_missing": list(fr.glyphs_missing),
            "degradations": [
                {"kind": d.kind, "detail": d.detail, "severity": d.severity}
                for d in fr.degradations
            ],
        },
    }


def aggregate_fidelity(results: list[EditResult]) -> dict[str, Any]:
    """Top-level fidelity rollup for replace_all (matches bridge ``replace_text``)."""
    kinds = sorted({d.kind for r in results for d in r.fidelity_report.degradations})
    return {
        "font_preserved": all(r.fidelity_report.font_preserved for r in results),
        "overflow_detected": any(r.fidelity_report.overflow_detected for r in results),
        "any_substitution": any(bool(r.fidelity_report.font_substituted) for r in results),
        "any_degradation": any(bool(r.fidelity_report.degradations) for r in results),
        "degradation_kinds": kinds,
    }
