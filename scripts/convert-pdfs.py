#!/usr/bin/env python3
"""
scripts/convert-pdfs.py
─────────────────────────────────────────────────────────────
Pre-processing script: convert every PDF in ./documents/ to
structured Markdown using Docling, saving the output to
./documents/converted/<filename>.md

Usage:
    python scripts/convert-pdfs.py              # convert all PDFs
    python scripts/convert-pdfs.py --force      # re-convert even if .md exists
─────────────────────────────────────────────────────────────
"""

import argparse
import sys
from pathlib import Path

from docling.document_converter import DocumentConverter


DOCUMENTS_DIR = Path(__file__).resolve().parent.parent / "documents"
CONVERTED_DIR = DOCUMENTS_DIR / "converted"


def convert_pdf(pdf_path: Path, output_path: Path) -> None:
    """Convert a single PDF to Markdown using Docling."""
    converter = DocumentConverter()
    result = converter.convert(str(pdf_path))
    md_content = result.document.export_to_markdown()
    output_path.write_text(md_content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert PDFs to Markdown via Docling")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-convert PDFs even if the .md output already exists",
    )
    args = parser.parse_args()

    if not DOCUMENTS_DIR.exists():
        print(f"Error: documents directory not found at {DOCUMENTS_DIR}")
        print("Create it and place your PDF files inside.")
        sys.exit(1)

    pdf_files = sorted(DOCUMENTS_DIR.glob("*.pdf"))

    if not pdf_files:
        print("No PDF files found in ./documents/")
        print("Place your PDF files there and re-run.")
        sys.exit(0)

    CONVERTED_DIR.mkdir(exist_ok=True)

    print("══════════════════════════════════════════")
    print(" PDF → Markdown Conversion (Docling)")
    print("══════════════════════════════════════════")
    print(f"\nFound {len(pdf_files)} PDF file(s) in ./documents/\n")

    converted = 0
    skipped = 0

    for pdf_path in pdf_files:
        output_name = pdf_path.stem + ".md"
        output_path = CONVERTED_DIR / output_name

        if output_path.exists() and not args.force:
            print(f"  Skipping (already converted): {pdf_path.name}")
            skipped += 1
            continue

        print(f"  Converting: {pdf_path.name} ...")
        try:
            convert_pdf(pdf_path, output_path)
            size_kb = output_path.stat().st_size / 1024
            print(f"    -> {output_name} ({size_kb:.1f} KB)")
            converted += 1
        except Exception as e:
            print(f"    ERROR converting {pdf_path.name}: {e}")

    print(f"\n══════════════════════════════════════════")
    print(f"Done. Converted: {converted}, Skipped: {skipped}")
    print(f"Output directory: {CONVERTED_DIR}")
    print("══════════════════════════════════════════")


if __name__ == "__main__":
    main()
