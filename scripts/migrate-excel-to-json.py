#!/usr/bin/env python3
"""
One-time migration script: converts Data Tracker.xlsx rows into individual
JSON files under data/registry/.

Usage:
  python scripts/migrate-excel-to-json.py              # migrate all rows
  python scripts/migrate-excel-to-json.py --dry-run    # preview without writing
"""

import argparse
import json
import re
import unicodedata
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
EXCEL_FILE = ROOT / "Data Tracker.xlsx"
REGISTRY_DIR = ROOT / "data" / "registry"


def slugify(text: str, max_len: int = 80) -> str:
    """Convert a document name to a filesystem-safe slug."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text[:max_len] if text else "untitled"


def migrate_participedia(xl: dict[str, pd.DataFrame], dry_run: bool) -> int:
    """Migrate the 'Participedia Case Studies' sheet."""
    df = xl["Participedia Case Studies"]
    df = df[df["Body"].astype(str).str.len() > 100]
    out_dir = REGISTRY_DIR / "participedia"
    out_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    for _, row in df.iterrows():
        name = str(row.get("Name", "")).strip()
        body = str(row.get("Body", "")).strip()
        link = str(row.get("Link", "")).strip()
        raw_date = row.get("Date")
        doc_date = str(raw_date)[:10] if pd.notna(raw_date) else ""

        entry = {
            "name": name,
            "source": "Participedia Case Studies",
            "source_url": link,
            "doc_date": doc_date,
            "content_type": "case_study",
            "content": body,
            "format": "markdown",
        }

        slug = slugify(name)
        filepath = out_dir / f"{slug}.json"

        # avoid collisions
        i = 2
        while filepath.exists():
            filepath = out_dir / f"{slug}-{i}.json"
            i += 1

        if dry_run:
            print(f"  [dry-run] {filepath.relative_to(ROOT)}")
        else:
            with open(filepath, "w") as f:
                json.dump(entry, f, indent=2, ensure_ascii=False)
        count += 1

    return count


def migrate_data_for_ingestion(xl: dict[str, pd.DataFrame], dry_run: bool) -> int:
    """Migrate the 'Data for ingestion' sheet."""
    df = xl["Data for ingestion"]
    df = df[df["Content"].astype(str).str.len() > 50]

    count = 0
    for _, row in df.iterrows():
        name = str(row.get("Name", "")).strip()
        content = str(row.get("Content", "")).strip()
        source = str(row.get("Source", "")).strip()
        link = str(row.get("Link", "")).strip()

        source_slug = slugify(source) if source else "external"
        out_dir = REGISTRY_DIR / source_slug
        out_dir.mkdir(parents=True, exist_ok=True)

        entry = {
            "name": name,
            "source": source,
            "source_url": link,
            "doc_date": "",
            "content": content,
            "format": "markdown",
        }

        slug = slugify(name)
        filepath = out_dir / f"{slug}.json"

        i = 2
        while filepath.exists():
            filepath = out_dir / f"{slug}-{i}.json"
            i += 1

        if dry_run:
            print(f"  [dry-run] {filepath.relative_to(ROOT)}")
        else:
            with open(filepath, "w") as f:
                json.dump(entry, f, indent=2, ensure_ascii=False)
        count += 1

    return count


def main():
    parser = argparse.ArgumentParser(
        description="Migrate Data Tracker.xlsx to JSON registry files",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Preview file paths without writing",
    )
    args = parser.parse_args()

    if not EXCEL_FILE.exists():
        print(f"Error: {EXCEL_FILE} not found.")
        return

    print("=" * 60)
    print("  Migrating Data Tracker.xlsx → data/registry/")
    print("=" * 60)

    xl = pd.read_excel(EXCEL_FILE, sheet_name=None)

    p_count = migrate_participedia(xl, args.dry_run)
    print(f"\n  Participedia Case Studies: {p_count} files")

    d_count = migrate_data_for_ingestion(xl, args.dry_run)
    print(f"  Data for Ingestion: {d_count} files")

    print(f"\n  Total: {p_count + d_count} registry files")
    if args.dry_run:
        print("  (dry run — no files written)")
    else:
        print(f"  Written to: {REGISTRY_DIR.relative_to(ROOT)}/")
    print("=" * 60)


if __name__ == "__main__":
    main()
