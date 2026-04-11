#!/usr/bin/env python3
"""Generate synthetic test fixture PDFs for bridge integration tests.

Run: python tests/generate_fixtures.py

Creates:
  tests/fixtures/reportlab_simple.pdf  — simple 1-page doc
  tests/fixtures/structured_doc.pdf    — multi-section doc with annotations
"""

import os
import sys

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors
except ImportError:
    print("reportlab not installed. Run: pip install reportlab", file=sys.stderr)
    sys.exit(1)

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
os.makedirs(FIXTURES_DIR, exist_ok=True)


def generate_simple():
    """Simple 1-page PDF with 'Test Document' and 'simple' text."""
    path = os.path.join(FIXTURES_DIR, "reportlab_simple.pdf")
    c = canvas.Canvas(path, pagesize=letter)
    w, h = letter

    c.setFont("Helvetica-Bold", 18)
    c.drawString(72, h - 72, "Test Document")

    c.setFont("Helvetica", 12)
    c.drawString(72, h - 110, "This is a simple test document for pdf-edit-mcp.")
    c.drawString(72, h - 130, "It contains basic text for unit testing.")

    c.save()
    print(f"  Created {path}")


def generate_structured():
    """Multi-section document with annotations, multiple fonts, paragraphs."""
    path = os.path.join(FIXTURES_DIR, "structured_doc.pdf")
    c = canvas.Canvas(path, pagesize=letter)
    w, h = letter
    y = h - 60

    # Title — large bold
    c.setFont("Helvetica-Bold", 22)
    c.drawString(72, y, "Jane Smith")
    y -= 20

    c.setFont("Helvetica", 10)
    c.drawString(72, y, "Software Engineer | jane@example.com | github.com/janesmith")
    y -= 30

    # Section 1: Experience (heading font)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, y, "Experience")
    y -= 18

    c.setFont("Helvetica", 11)
    lines = [
        "Senior Developer at TechCorp (2022-2024)",
        "Built scalable microservices handling 10M requests per day.",
        "Led migration from monolith to event-driven architecture.",
        "Mentored team of 5 junior developers.",
    ]
    for line in lines:
        c.drawString(72, y, line)
        y -= 15
    y -= 10

    # Section 2: Education (heading font)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, y, "Education")
    y -= 18

    c.setFont("Helvetica", 11)
    lines = [
        "M.S. Computer Science, State University (2020-2022)",
        "B.S. Mathematics, City College (2016-2020)",
        "Graduated summa cum laude with focus on algorithms.",
    ]
    for line in lines:
        c.drawString(72, y, line)
        y -= 15
    y -= 10

    # Section 3: Skills (heading font)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, y, "Skills")
    y -= 18

    c.setFont("Helvetica", 11)
    lines = [
        "Python, TypeScript, Go, Rust, SQL",
        "AWS, Docker, Kubernetes, Terraform",
        "React, Next.js, PostgreSQL, Redis",
    ]
    for line in lines:
        c.drawString(72, y, line)
        y -= 15
    y -= 10

    # Section 4: Projects (heading font)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, y, "Projects")
    y -= 18

    c.setFont("Helvetica", 11)
    c.drawString(72, y, "DataPipeline — Real-time ETL framework")
    y -= 15
    c.drawString(72, y, "Open source tool for streaming data transformations.")
    y -= 15
    c.drawString(72, y, "Used by 50+ companies in production.")
    y -= 25

    # Add a link annotation (required by annotation tests)
    link_rect = (72, y, 250, y + 14)
    c.setFont("Helvetica", 11)
    c.setFillColor(colors.blue)
    c.drawString(72, y, "https://github.com/janesmith/datapipeline")
    c.setFillColor(colors.black)

    # Add the actual PDF link annotation
    c.linkURL(
        "https://github.com/janesmith/datapipeline",
        link_rect,
        relative=0,
    )

    c.save()
    print(f"  Created {path}")


if __name__ == "__main__":
    print("Generating test fixtures...")
    generate_simple()
    generate_structured()
    print("Done.")
