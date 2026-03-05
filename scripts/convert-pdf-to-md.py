"""Convert a single PDF to Markdown using Docling."""

import sys
from pathlib import Path

def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.pdf> <output.md>", file=sys.stderr)
        sys.exit(1)

    pdf_path = Path(sys.argv[1])
    md_path = Path(sys.argv[2])

    if not pdf_path.exists():
        print(f"Error: PDF not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    from docling.document_converter import DocumentConverter

    result = DocumentConverter().convert(str(pdf_path))
    markdown = result.document.export_to_markdown()

    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(markdown, encoding="utf-8")
    print(f"Converted {pdf_path.name} -> {md_path.name} ({len(markdown)} chars)")

if __name__ == "__main__":
    main()
