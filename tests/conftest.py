"""Shared pytest fixtures: synthetic PDF fixtures + output paths.

Fixtures are generated on demand via the existing reportlab builder
(``generate_fixtures.py``) so the corpus need not be committed (it is gitignored,
mirroring the engine's fixture convention).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(__file__))
import generate_fixtures  # noqa: E402

_FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session", autouse=True)
def _ensure_fixtures() -> None:
    _FIXTURES.mkdir(exist_ok=True)
    if not (_FIXTURES / "reportlab_simple.pdf").exists():
        generate_fixtures.generate_simple()
    if not (_FIXTURES / "structured_doc.pdf").exists():
        generate_fixtures.generate_structured()


@pytest.fixture
def simple_pdf() -> str:
    return str((_FIXTURES / "reportlab_simple.pdf").resolve())


@pytest.fixture
def structured_pdf() -> str:
    return str((_FIXTURES / "structured_doc.pdf").resolve())


@pytest.fixture
def out_pdf(tmp_path: Path) -> str:
    return str(tmp_path / "out.pdf")
