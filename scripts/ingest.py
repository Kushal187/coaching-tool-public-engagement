#!/usr/bin/env python3
"""
Ingestion pipeline for the Public Engagement Coaching Tool.

Reads from "Data Tracker.xlsx" and loads chunks into Weaviate.
  - Participedia Case Studies  → section-based chunking
  - Data for ingestion         → Markdown heading-based when present, else sliding-window

Usage:
  python scripts/ingest.py                # ingest all data
  python scripts/ingest.py --clear        # wipe collection first
  python scripts/ingest.py --dry-run      # chunk + stats only, no Weaviate writes
"""

import argparse
import os
import re
import sys
import uuid
from collections import Counter
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from tqdm import tqdm

import weaviate
from weaviate.classes.config import Configure, Property, DataType
from weaviate.classes.init import Auth

# ── Config ─────────────────────────────────────────────────────

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

COLLECTION_NAME = "CoachingTool"
EXCEL_FILE = "Data Tracker.xlsx"

SECTION_HEADERS = [
    "Problems and Purpose",
    "Background History and Context",
    "Organizing, Supporting, and Funding Entities",
    "Participant Recruitment and Selection",
    "Methods and Tools Used",
    "What Went On: Process, Interaction, and Participation",
    "Influence, Outcomes, and Effects",
    "Analysis and Lessons Learned",
]

SLIDING_WINDOW_SIZE = 1000
SLIDING_WINDOW_OVERLAP = 200
LONG_SECTION_MAX_CHARS = 8000  # ~2 000 tokens (Participedia long sections)
DANE_MARKDOWN_MAX_CHARS = 2000  # Data for ingestion: section sub-split size (aligns with PDF chunking)
MIN_CHUNK_CHARS = 50           # discard chunks shorter than this

# Markdown heading pattern (# through ####)
MARKDOWN_HEADING_RE = re.compile(r"^(#{1,4})\s+(.+)$")

# Stable namespace for document_id (UUID5) so the same doc always gets the same ID
DOCUMENT_ID_NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


# ── Text cleanup (before chunking) ────────────────────────────────

# Inline citation markers to strip: [1], [2], [12], [123], etc.
CITATION_PATTERN = re.compile(r"\[\d+\]")

# Optional: other common reference clutter (footnote refs, "see note X")
FOOTNOTE_REF_PATTERN = re.compile(r"\[\s*note\s*\d*\s*\]", re.IGNORECASE)


def clean_text(text):
    """Remove citation markers like [1], [2] and normalize whitespace."""
    if not text or not isinstance(text, str):
        return ""
    s = CITATION_PATTERN.sub("", text)
    s = FOOTNOTE_REF_PATTERN.sub("", s)
    # Collapse multiple spaces/newlines introduced by removals
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
    return s.strip()


# ── Weaviate connection ────────────────────────────────────────

def connect():
    """Connect to Weaviate (cloud or local) using env vars."""
    host = os.getenv("WEAVIATE_HOST", "localhost:8080").strip()
    api_key = os.getenv("WEAVIATE_API_KEY", "").strip()
    scheme = os.getenv("WEAVIATE_SCHEME", "https").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    clean = re.sub(r"^https?://", "", host).rstrip("/")
    headers = {"X-OpenAI-Api-Key": openai_key}

    if "localhost" in clean or "127.0.0.1" in clean:
        parts = clean.split(":")
        return weaviate.connect_to_local(
            host=parts[0],
            port=int(parts[1]) if len(parts) > 1 else 8080,
            headers=headers,
        )

    url = f"{scheme}://{clean}"
    return weaviate.connect_to_weaviate_cloud(
        cluster_url=url,
        auth_credentials=Auth.api_key(api_key),
        headers=headers,
    )


# ── Schema ─────────────────────────────────────────────────────

def ensure_collection(client):
    """Create the collection if it doesn't exist; return the Collection handle."""
    if client.collections.exists(COLLECTION_NAME):
        print(f'  Collection "{COLLECTION_NAME}" already exists.')
        return client.collections.get(COLLECTION_NAME)

    collection = client.collections.create(
        name=COLLECTION_NAME,
        vectorizer_config=Configure.Vectorizer.text2vec_openai(
            model="text-embedding-3-small",
        ),
        properties=[
            Property(name="content",       data_type=DataType.TEXT),
            Property(name="document_id",   data_type=DataType.TEXT,  skip_vectorization=True),  # stable ID for all chunks of same doc (for prev/next chunk lookup)
            Property(name="doc_name",      data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="source_label",   data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="source_url",    data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="doc_type",      data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="content_type",   data_type=DataType.TEXT,  skip_vectorization=True),  # case_study | transcript | blog_post | journal_article | report | guide | policy_brief | lecture | tool_or_resource | other
            Property(name="section_name",   data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="chunk_index",   data_type=DataType.INT,   skip_vectorization=True),
            Property(name="total_chunks",  data_type=DataType.INT,   skip_vectorization=True),
            Property(name="doc_date",      data_type=DataType.TEXT,  skip_vectorization=True),
        ],
    )
    print(f'  Created collection "{COLLECTION_NAME}" '
          f"(text2vec-openai / text-embedding-3-small).")
    return collection


def drop_collection(client):
    """Delete the collection if it exists."""
    if client.collections.exists(COLLECTION_NAME):
        client.collections.delete(COLLECTION_NAME)
        print(f'  Deleted collection "{COLLECTION_NAME}".')
    else:
        print(f'  Collection "{COLLECTION_NAME}" does not exist — nothing to delete.')


# ── Participedia: section-based chunking ───────────────────────

def _char_split(text, max_chars=LONG_SECTION_MAX_CHARS, overlap=300):
    """Last-resort character-level split with overlap, breaking at word boundaries."""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            # Try to break at a sentence or word boundary
            snippet = text[start:end]
            last_break = max(snippet.rfind(". "), snippet.rfind("\n"))
            if last_break > max_chars * 0.5:
                end = start + last_break + 1
        chunks.append(text[start:end].strip())
        start = end - overlap if end < len(text) else len(text)
    return [c for c in chunks if len(c) >= MIN_CHUNK_CHARS]


def _split_long_section(section_name, text, max_chars=LONG_SECTION_MAX_CHARS):
    """Sub-split a section that exceeds max_chars at paragraph boundaries."""
    if len(text) <= max_chars:
        return [(section_name, text)]

    paragraphs = text.split("\n\n")
    sub_chunks, buf = [], ""

    for para in paragraphs:
        candidate = f"{buf}\n\n{para}" if buf else para
        if len(candidate) > max_chars and buf:
            sub_chunks.append(buf.strip())
            buf = para
        else:
            buf = candidate

    if buf.strip():
        sub_chunks.append(buf.strip())

    # If paragraph splitting didn't help (e.g. no \n\n in the text),
    # fall back to character-level splitting
    if not sub_chunks or any(len(c) > max_chars for c in sub_chunks):
        flat = []
        for c in (sub_chunks or [text]):
            if len(c) > max_chars:
                flat.extend(_char_split(c, max_chars))
            else:
                flat.append(c)
        sub_chunks = flat

    if not sub_chunks:
        return [(section_name, text)]

    return [
        (f"{section_name} (part {i + 1})" if len(sub_chunks) > 1 else section_name, chunk)
        for i, chunk in enumerate(sub_chunks)
    ]


def chunk_participedia(row):
    """Split one Participedia case into section-level chunks."""
    body = clean_text(str(row.get("Body", "")))
    if len(body) < 100:
        return []

    doc_name = str(row.get("Name", ""))
    source_url = str(row.get("Link", ""))
    raw_date = row.get("Date")
    doc_date = str(raw_date)[:10] if pd.notna(raw_date) else ""

    # Split body on known section headers (captured in the result list)
    pattern = "(" + "|".join(re.escape(h) for h in SECTION_HEADERS) + ")"
    parts = re.split(pattern, body)

    raw_sections = []
    current_section = "Introduction"
    current_text = ""

    for part in parts:
        stripped = part.strip()
        if stripped in SECTION_HEADERS:
            if current_text.strip():
                raw_sections.append((current_section, current_text.strip()))
            current_section = stripped
            current_text = ""
        else:
            current_text += " " + stripped

    if current_text.strip():
        raw_sections.append((current_section, current_text.strip()))

    if not raw_sections:
        raw_sections = [("Full Body", body)]

    # Prepend the section header into the chunk content (gives the
    # embedding model semantic context about what kind of text follows),
    # then sub-split any sections that are unusually long.
    expanded = []
    for section, text in raw_sections:
        with_header = f"{section}\n\n{text}"
        expanded.extend(_split_long_section(section, with_header))

    # Filter out tiny chunks (empty sections, stray whitespace)
    expanded = [(s, t) for s, t in expanded if len(t) >= MIN_CHUNK_CHARS]

    doc_id = uuid.uuid5(
        DOCUMENT_ID_NAMESPACE,
        f"participedia|{doc_name}|{source_url}",
    ).hex

    return [
        {
            "content": text,
            "document_id": doc_id,
            "doc_name": doc_name,
            "source_label": "Participedia Case Studies",
            "source_url": source_url,
            "doc_type": "participedia_case",
            "content_type": "case_study",
            "section_name": section,
            "chunk_index": i,
            "total_chunks": len(expanded),
            "doc_date": doc_date,
        }
        for i, (section, text) in enumerate(expanded)
    ]


# ── Data for ingestion: Markdown section or sliding-window ─────

def _parse_markdown_sections(text):
    """Parse Markdown into sections by #–#### headings. Returns list of (title, content)."""
    if not text or not text.strip():
        return []
    lines = text.split("\n")
    sections = []
    current_title = ""
    current_lines = []

    for line in lines:
        match = MARKDOWN_HEADING_RE.match(line)
        if match:
            if current_lines or current_title:
                content = "\n".join(current_lines).strip()
                if content or current_title:
                    sections.append((current_title, content))
            current_title = match.group(2).strip()
            current_lines = []
        else:
            current_lines.append(line)

    if current_lines or current_title:
        content = "\n".join(current_lines).strip()
        if content or current_title:
            sections.append((current_title, content))

    return sections


def _chunk_dane_by_markdown(content, max_chars=DANE_MARKDOWN_MAX_CHARS):
    """
    Chunk content by Markdown headings. Returns list of (section_name, content) or
    empty list if no headings found (caller should fall back to sliding window).
    """
    sections = _parse_markdown_sections(content)
    if not sections:
        return []
    # Use section-based chunking only if we have real structure: multiple sections
    # or a single section that had a heading (title non-empty)
    use_sections = len(sections) > 1 or (len(sections) == 1 and sections[0][0].strip())
    if not use_sections:
        return []

    expanded = []
    for title, text in sections:
        section_name = title if title else "Content"
        with_header = f"{section_name}\n\n{text}" if title else text
        expanded.extend(
            _split_long_section(section_name, with_header, max_chars=max_chars)
        )
    return [(s, t) for s, t in expanded if len(t) >= MIN_CHUNK_CHARS]


def _sliding_window(text, size=SLIDING_WINDOW_SIZE, overlap=SLIDING_WINDOW_OVERLAP):
    """Character-level sliding window with sentence-boundary snapping.

    Uses a FIXED step of (size - overlap) so that sentence snapping
    only affects the chunk boundary, never the advance rate.
    """
    if not text or not text.strip():
        return []
    if len(text) <= size:
        return [text.strip()]

    step = size - overlap  # fixed advance: 800 chars
    chunks = []
    start = 0

    while start < len(text):
        end = min(start + size, len(text))
        chunk = text[start:end]

        # Snap to the last sentence boundary (". ") if it's in the back half
        if end < len(text):
            last_period = chunk.rfind(". ")
            if last_period > size * 0.5:
                chunk = chunk[: last_period + 2]

        if chunk.strip() and len(chunk.strip()) >= MIN_CHUNK_CHARS:
            chunks.append(chunk.strip())

        start += step

    return chunks


# Content-type taxonomy for retrieval and display (source label to user).
# One of: case_study, transcript, blog_post, journal_article, report, guide,
# policy_brief, lecture, tool_or_resource, other.
CONTENT_TYPES = (
    "case_study",
    "transcript",
    "blog_post",
    "journal_article",
    "report",
    "guide",
    "policy_brief",
    "lecture",
    "tool_or_resource",
    "other",
)

# Rules (source, name) -> content_type. First match wins. Pass (source_lower, name_lower).
_CONTENT_TYPE_RULES = [
    (lambda s, n: "transcript" in s or "transcript" in n, "transcript"),
    (lambda s, n: "lecture" in s or "lecture" in n, "lecture"),
    (lambda s, n: "journal" in s or "journal" in n or "academic" in s or "academic" in n, "journal_article"),
    (lambda s, n: "blog" in s or "blog" in n, "blog_post"),
    (lambda s, n: "report" in s or "report" in n or "white paper" in s or "white paper" in n or "whitepaper" in s or "whitepaper" in n, "report"),
    (lambda s, n: "guide" in s or "guide" in n or "handbook" in s or "handbook" in n or "how-to" in s or "how-to" in n, "guide"),
    (lambda s, n: "popvox" in s or "democracynext" in s or "policy brief" in s or "policy brief" in n, "policy_brief"),
    (lambda s, n: "govlab" in s, "report"),
    (lambda s, n: "reboot" in s or "reboot" in n, "blog_post"),
    (lambda s, n: "case study" in s or "case study" in n or "case studies" in s or "case studies" in n, "case_study"),
    (lambda s, n: "tool" in s or "tool" in n or "resource" in s or "resource" in n, "tool_or_resource"),
]


def _classify_content_type(source, name):
    """Classify document for retrieval and display. Returns one of CONTENT_TYPES."""
    s = str(source).lower()
    n = str(name).lower()
    for predicate, ctype in _CONTENT_TYPE_RULES:
        if predicate(s, n):
            return ctype
    return "other"


_DOC_TYPE_RULES = [
    (lambda s: "filtered reboot" in s, "reboot_democracy"),
    (lambda s: "govlab" in s,          "govlab_resource"),
    (lambda s: "lecture" in s,         "lecture_series"),
    (lambda s: "transcript" in s,      "transcript"),
    (lambda s: "reboot" in s,          "reboot_democracy"),
    (lambda s: "popvox" in s,          "policy_resource"),
    (lambda s: "democracynext" in s,   "policy_resource"),
    (lambda s: "journal" in s,         "academic_paper"),
]


def _classify_doc_type(source):
    low = str(source).lower()
    for predicate, dtype in _DOC_TYPE_RULES:
        if predicate(low):
            return dtype
    return "external_resource"


def chunk_dane(row):
    """
    Chunk one row from the 'Data for ingestion' sheet.
    Prefer Markdown heading-based sections when present; fall back to sliding-window.
    """
    content = clean_text(str(row.get("Content", "")))
    if len(content) < 50:
        return []

    doc_name = str(row.get("Name", ""))
    source = str(row.get("Source", ""))
    source_url = str(row.get("Link", ""))
    doc_type = _classify_doc_type(source)
    content_type = _classify_content_type(source, doc_name)

    doc_id = uuid.uuid5(
        DOCUMENT_ID_NAMESPACE,
        f"dane|{source}|{doc_name}|{source_url}",
    ).hex

    # Prefer section-based chunking when content has Markdown headings
    section_chunks = _chunk_dane_by_markdown(content)
    if section_chunks:
        chunks_with_meta = [
            {
                "content": text,
                "document_id": doc_id,
                "doc_name": doc_name,
                "source_label": source,
                "source_url": source_url,
                "doc_type": doc_type,
                "content_type": content_type,
                "section_name": section,
                "chunk_index": i,
                "total_chunks": len(section_chunks),
                "doc_date": "",
            }
            for i, (section, text) in enumerate(section_chunks)
        ]
        return chunks_with_meta

    # Fallback: sliding-window for plain or unstructured content
    windows = _sliding_window(content)
    return [
        {
            "content": chunk,
            "document_id": doc_id,
            "doc_name": doc_name,
            "source_label": source,
            "source_url": source_url,
            "doc_type": doc_type,
            "content_type": content_type,
            "section_name": f"chunk_{i + 1}_of_{len(windows)}",
            "chunk_index": i,
            "total_chunks": len(windows),
            "doc_date": "",
        }
        for i, chunk in enumerate(windows)
    ]


# ── Pipeline helpers ───────────────────────────────────────────

def build_all_chunks(xl_path):
    """Read the Excel file and return every chunk (both sheets)."""
    xl = pd.read_excel(xl_path, sheet_name=None)
    all_chunks = []

    # Phase 1 — Participedia Case Studies
    print("\n── Phase 1: Participedia Case Studies ──")
    df = xl["Participedia Case Studies"]
    df = df[df["Body"].astype(str).str.len() > 100]
    print(f"   {len(df):,} cases with body text")

    for _, row in tqdm(df.iterrows(), total=len(df), desc="   Chunking"):
        all_chunks.extend(chunk_participedia(row))

    p_count = len(all_chunks)
    print(f"   → {p_count:,} chunks")

    # Phase 2 — Data for Ingestion
    print("\n── Phase 2: Data for Ingestion ──")
    df2 = xl["Data for ingestion"]
    df2 = df2[df2["Content"].astype(str).str.len() > 50]
    print(f"   {len(df2):,} documents with content")

    for _, row in tqdm(df2.iterrows(), total=len(df2), desc="   Chunking"):
        all_chunks.extend(chunk_dane(row))

    print(f"   → {len(all_chunks) - p_count:,} chunks")

    return all_chunks


def print_stats(chunks):
    """Print a summary table of chunk counts and sizes."""
    print("\n── Chunk Statistics ──")
    types = Counter(c["doc_type"] for c in chunks)
    for dtype, count in sorted(types.items(), key=lambda x: -x[1]):
        print(f"   doc_type {dtype:22s} {count:>6,}")
    print(f"   {'TOTAL':25s} {len(chunks):>6,}")
    content_types = Counter(c["content_type"] for c in chunks)
    print("\n   content_type (for retrieval/display):")
    for ctype, count in sorted(content_types.items(), key=lambda x: -x[1]):
        print(f"     {ctype:22s} {count:>6,}")

    lengths = [len(c["content"]) for c in chunks]
    sorted_lens = sorted(lengths)
    print(
        f"\n   Content length (chars):  "
        f"min={sorted_lens[0]:,}  "
        f"max={sorted_lens[-1]:,}  "
        f"avg={sum(lengths) // len(lengths):,}  "
        f"median={sorted_lens[len(lengths) // 2]:,}"
    )


def ingest_chunks(client, chunks):
    """Batch-insert all chunks into Weaviate."""
    collection = ensure_collection(client)
    print(f"\n  Ingesting {len(chunks):,} chunks into '{COLLECTION_NAME}' …")

    # Use fixed_size batching (100 objects/batch) to stay well under
    # OpenAI's 300K-token-per-request embedding limit.
    with collection.batch.fixed_size(batch_size=100) as batch:
        for chunk in tqdm(chunks, desc="   Ingesting"):
            batch.add_object(properties=chunk)


# ── CLI entry point ────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Ingest public engagement data into Weaviate",
    )
    parser.add_argument(
        "--clear", action="store_true",
        help="Delete the existing collection before ingesting",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Chunk data and print statistics without writing to Weaviate",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    xl_path = root / EXCEL_FILE

    if not xl_path.exists():
        print(f"Error: {xl_path} not found.")
        sys.exit(1)

    print("=" * 55)
    print("  Public Engagement — Data Ingestion Pipeline")
    print("=" * 55)
    print(f"  Source : {EXCEL_FILE}")
    print(f"  Target : {COLLECTION_NAME}")

    # ── Chunk everything ───────────────────────────────────────
    all_chunks = build_all_chunks(xl_path)
    print_stats(all_chunks)

    if args.dry_run:
        print("\n  Dry run complete — no data written to Weaviate.")
        return

    # ── Connect & write ────────────────────────────────────────
    print("\n  Connecting to Weaviate …")
    client = connect()

    try:
        if args.clear:
            print("\n  --clear flag: dropping existing collection …")
            drop_collection(client)

        ingest_chunks(client, all_chunks)

        print(f"\n{'=' * 55}")
        print(f"  Done. {len(all_chunks):,} chunks ingested.")
        print(f"{'=' * 55}")
    finally:
        client.close()


if __name__ == "__main__":
    main()
