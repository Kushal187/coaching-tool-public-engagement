#!/usr/bin/env python3
"""
Ingestion pipeline for the Public Engagement Coaching Tool.

Reads from "Data Tracker.xlsx" and loads chunks into Weaviate.
  - Participedia Case Studies  → section-based chunking
  - Data for ingestion         → Markdown heading-based when present, else sliding-window

Two collections:
  - CoachingTool        → chunked documents for RAG retrieval
  - CaseStudyLibrary    → unchunked case studies with LLM-generated metadata

Usage:
  python scripts/ingest.py                            # full pipeline
  python scripts/ingest.py --skip-case-study-library   # chunked ingestion only (legacy)
  python scripts/ingest.py --only-case-study-library   # case study library only
  python scripts/ingest.py --clear                     # wipe both collections
  python scripts/ingest.py --dry-run                   # chunk + stats, no Weaviate writes
"""

import argparse
import json
import os
import re
import sys
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import threading

import pandas as pd
from dotenv import load_dotenv
from tqdm import tqdm

import weaviate
from weaviate.classes.config import Configure, Property, DataType
from weaviate.classes.init import Auth, AdditionalConfig, Timeout

# ── Config ─────────────────────────────────────────────────────

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

COLLECTION_NAME = "CoachingTool"
CASE_STUDY_COLLECTION = "CaseStudyLibrary"
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
LONG_SECTION_MAX_CHARS = 8000
DANE_MARKDOWN_MAX_CHARS = 2000
MIN_CHUNK_CHARS = 50

MARKDOWN_HEADING_RE = re.compile(r"^(#{1,4})\s+(.+)$")

# Stable namespace for document_id (UUID5) so the same doc always gets the same ID
DOCUMENT_ID_NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

# LLM config
CLASSIFICATION_MODEL = "gpt-4.1-mini"
SUMMARY_MODEL = "gpt-4.1-mini"
SCRIPT_DIR = Path(__file__).resolve().parent
CLASSIFICATION_CACHE_FILE = SCRIPT_DIR / "classification_cache.json"
CASE_STUDY_CACHE_FILE = SCRIPT_DIR / "case_study_summaries_cache.json"

CONTENT_TYPES = (
    "case_study", "transcript", "blog_post", "journal_article",
    "report", "guide", "policy_brief", "lecture", "tool_or_resource", "other",
)

LLM_WORKERS = 7  # parallel LLM calls

# ── OpenAI client (lazy init, thread-safe) ─────────────────────

_openai_client = None
_openai_lock = threading.Lock()


def _get_openai():
    global _openai_client
    if _openai_client is None:
        with _openai_lock:
            if _openai_client is None:
                from openai import OpenAI
                _openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
    return _openai_client


# ── Thread-safe JSON cache with atomic writes ─────────────────

_cache_lock = threading.Lock()
_cache_stores = {}  # path → dict, in-memory mirrors of on-disk caches


def _load_json_cache(path):
    """Load entire cache (used only for legacy/startup reads)."""
    with _cache_lock:
        return _cache_store(path).copy()


def _save_json_cache(path, data):
    """Overwrite entire cache (used only for legacy/startup writes)."""
    with _cache_lock:
        _cache_stores[str(path)] = dict(data)
        _atomic_write(path, data)


def _cache_store(path):
    """Return the in-memory dict for a given cache path, loading from disk on first access."""
    key = str(path)
    if key not in _cache_stores:
        if path.exists():
            try:
                with open(path) as f:
                    _cache_stores[key] = json.load(f)
            except (json.JSONDecodeError, OSError):
                print(f"  Warning: cache {path.name} is corrupt, starting fresh")
                _cache_stores[key] = {}
        else:
            _cache_stores[key] = {}
    return _cache_stores[key]


def _atomic_write(path, data):
    """Write JSON to a temp file then rename (atomic on POSIX)."""
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    tmp.rename(path)


def _cache_get(path, key):
    """Thread-safe single-key read."""
    with _cache_lock:
        return _cache_store(path).get(key)


def _cache_put(path, key, value):
    """Thread-safe single-key write with periodic flush to disk."""
    with _cache_lock:
        store = _cache_store(path)
        store[key] = value
        if len(store) % 25 == 0:
            _atomic_write(path, store)


def _flush_caches():
    """Flush all in-memory caches to disk."""
    with _cache_lock:
        for key, store in _cache_stores.items():
            _atomic_write(Path(key), store)


# ── Text cleanup (before chunking) ────────────────────────────

CITATION_PATTERN = re.compile(r"\[\d+\]")
FOOTNOTE_REF_PATTERN = re.compile(r"\[\s*note\s*\d*\s*\]", re.IGNORECASE)


def clean_text(text):
    """Remove citation markers like [1], [2] and normalize whitespace."""
    if not text or not isinstance(text, str):
        return ""
    s = CITATION_PATTERN.sub("", text)
    s = FOOTNOTE_REF_PATTERN.sub("", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
    return s.strip()


# ── LLM-based content classification ──────────────────────────

_CLASSIFICATION_SYSTEM = (
    "You are a document classifier. Given a document's name, source label, "
    "and a content excerpt, classify it into exactly one category.\n\n"
    "Valid categories: case_study, transcript, blog_post, journal_article, "
    "report, guide, policy_brief, lecture, tool_or_resource, other\n\n"
    "Respond with ONLY the category label, nothing else."
)

# Rule-based fallback
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
    """Rule-based fallback classifier. Returns one of CONTENT_TYPES."""
    s = str(source).lower()
    n = str(name).lower()
    for predicate, ctype in _CONTENT_TYPE_RULES:
        if predicate(s, n):
            return ctype
    return "other"


def _llm_classify_content_type(source, name, content, doc_id):
    """Classify a document via LLM with caching. Falls back to rule-based on failure."""
    cached = _cache_get(CLASSIFICATION_CACHE_FILE, doc_id)
    if cached is not None:
        return cached

    excerpt = content[:1500] if content else ""
    prompt = (
        f"Document name: {name}\n"
        f"Source: {source}\n\n"
        f"Content excerpt:\n{excerpt}"
    )

    try:
        client = _get_openai()
        resp = client.chat.completions.create(
            model=CLASSIFICATION_MODEL,
            messages=[
                {"role": "system", "content": _CLASSIFICATION_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            max_tokens=20,
        )
        label = resp.choices[0].message.content.strip().lower().replace('"', "").replace("'", "")
        if label not in CONTENT_TYPES:
            label = _classify_content_type(source, name)
    except Exception as e:
        print(f"    LLM classification failed for '{name[:50]}': {e}")
        label = _classify_content_type(source, name)

    _cache_put(CLASSIFICATION_CACHE_FILE, doc_id, label)
    return label


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
        skip_init_checks=True,
        additional_config=AdditionalConfig(timeout=Timeout(init=60)),
    )


# ── CoachingTool schema ───────────────────────────────────────

def ensure_collection(client):
    """Create the CoachingTool collection if it doesn't exist; return the Collection handle."""
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
            Property(name="document_id",   data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="doc_name",      data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="source_label",  data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="source_url",    data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="doc_type",      data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="content_type",  data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="section_name",  data_type=DataType.TEXT,  skip_vectorization=True),
            Property(name="chunk_index",   data_type=DataType.INT,   skip_vectorization=True),
            Property(name="total_chunks",  data_type=DataType.INT,   skip_vectorization=True),
            Property(name="doc_date",      data_type=DataType.TEXT,  skip_vectorization=True),
        ],
    )
    print(f'  Created collection "{COLLECTION_NAME}" '
          f"(text2vec-openai / text-embedding-3-small).")
    return collection


def drop_collection(client):
    """Delete the CoachingTool collection if it exists."""
    if client.collections.exists(COLLECTION_NAME):
        client.collections.delete(COLLECTION_NAME)
        print(f'  Deleted collection "{COLLECTION_NAME}".')
    else:
        print(f'  Collection "{COLLECTION_NAME}" does not exist — nothing to delete.')


# ── CaseStudyLibrary schema ───────────────────────────────────

def ensure_case_study_collection(client):
    """Create the CaseStudyLibrary collection if it doesn't exist."""
    if client.collections.exists(CASE_STUDY_COLLECTION):
        print(f'  Collection "{CASE_STUDY_COLLECTION}" already exists.')
        return client.collections.get(CASE_STUDY_COLLECTION)

    collection = client.collections.create(
        name=CASE_STUDY_COLLECTION,
        vectorizer_config=Configure.Vectorizer.text2vec_openai(
            model="text-embedding-3-small",
        ),
        properties=[
            Property(name="document_id",          data_type=DataType.TEXT,       skip_vectorization=True),
            Property(name="title",                data_type=DataType.TEXT,       skip_vectorization=True),
            Property(name="source_label",         data_type=DataType.TEXT,       skip_vectorization=True),
            Property(name="source_url",           data_type=DataType.TEXT,       skip_vectorization=True),
            Property(name="doc_date",             data_type=DataType.TEXT,       skip_vectorization=True),
            Property(name="full_content",         data_type=DataType.TEXT,       skip_vectorization=True),
            Property(name="summary",              data_type=DataType.TEXT),
            Property(name="location",             data_type=DataType.TEXT,       skip_vectorization=True),
            Property(name="timeframe",            data_type=DataType.TEXT,       skip_vectorization=True),
            Property(name="demographic",          data_type=DataType.TEXT,       skip_vectorization=True),
            Property(name="scale",                data_type=DataType.TEXT,       skip_vectorization=True),
            Property(name="tags",                 data_type=DataType.TEXT_ARRAY, skip_vectorization=True),
            Property(name="key_outcomes",         data_type=DataType.TEXT_ARRAY, skip_vectorization=True),
            Property(name="implementation_steps", data_type=DataType.TEXT_ARRAY, skip_vectorization=True),
        ],
    )
    print(f'  Created collection "{CASE_STUDY_COLLECTION}" '
          f"(text2vec-openai / text-embedding-3-small).")
    return collection


def drop_case_study_collection(client):
    """Delete the CaseStudyLibrary collection if it exists."""
    if client.collections.exists(CASE_STUDY_COLLECTION):
        client.collections.delete(CASE_STUDY_COLLECTION)
        print(f'  Deleted collection "{CASE_STUDY_COLLECTION}".')
    else:
        print(f'  Collection "{CASE_STUDY_COLLECTION}" does not exist — nothing to delete.')


# ── Participedia: section-based chunking ───────────────────────

def _char_split(text, max_chars=LONG_SECTION_MAX_CHARS, overlap=300):
    """Last-resort character-level split with overlap, breaking at word boundaries."""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
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

    expanded = []
    for section, text in raw_sections:
        with_header = f"{section}\n\n{text}"
        expanded.extend(_split_long_section(section, with_header))

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
    """Character-level sliding window with sentence-boundary snapping."""
    if not text or not text.strip():
        return []
    if len(text) <= size:
        return [text.strip()]

    step = size - overlap
    chunks = []
    start = 0

    while start < len(text):
        end = min(start + size, len(text))
        chunk = text[start:end]

        if end < len(text):
            last_period = chunk.rfind(". ")
            if last_period > size * 0.5:
                chunk = chunk[: last_period + 2]

        if chunk.strip() and len(chunk.strip()) >= MIN_CHUNK_CHARS:
            chunks.append(chunk.strip())

        start += step

    return chunks


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


def chunk_dane(row, content_type=None):
    """
    Chunk one row from the 'Data for ingestion' sheet.
    Accepts an optional pre-classified content_type; falls back to rule-based
    if not provided.
    """
    content = clean_text(str(row.get("Content", "")))
    if len(content) < 50:
        return []

    doc_name = str(row.get("Name", ""))
    source = str(row.get("Source", ""))
    source_url = str(row.get("Link", ""))
    doc_type = _classify_doc_type(source)

    if content_type is None:
        content_type = _classify_content_type(source, doc_name)

    doc_id = uuid.uuid5(
        DOCUMENT_ID_NAMESPACE,
        f"dane|{source}|{doc_name}|{source_url}",
    ).hex

    section_chunks = _chunk_dane_by_markdown(content)
    if section_chunks:
        return [
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
    """
    Read the Excel file and return (all_chunks, raw_case_studies).

    raw_case_studies is a list of dicts with full document text and metadata
    for every document classified as content_type "case_study".
    """
    xl = pd.read_excel(xl_path, sheet_name=None)
    all_chunks = []
    raw_case_studies = []

    # Phase 1 — Participedia Case Studies
    print("\n── Phase 1: Participedia Case Studies ──")
    df = xl["Participedia Case Studies"]
    df = df[df["Body"].astype(str).str.len() > 100]
    print(f"   {len(df):,} cases with body text")

    for _, row in tqdm(df.iterrows(), total=len(df), desc="   Chunking"):
        chunks = chunk_participedia(row)
        all_chunks.extend(chunks)

        if chunks:
            doc_name = str(row.get("Name", ""))
            source_url = str(row.get("Link", ""))
            raw_date = row.get("Date")
            doc_date = str(raw_date)[:10] if pd.notna(raw_date) else ""
            body = clean_text(str(row.get("Body", "")))

            raw_case_studies.append({
                "document_id": chunks[0]["document_id"],
                "title": doc_name,
                "source_label": "Participedia Case Studies",
                "source_url": source_url,
                "doc_date": doc_date,
                "full_content": body,
            })

    p_count = len(all_chunks)
    print(f"   → {p_count:,} chunks")
    print(f"   → {len(raw_case_studies):,} raw case studies collected")

    # Phase 2 — Data for Ingestion (with LLM classification)
    print("\n── Phase 2: Data for Ingestion ──")
    df2 = xl["Data for ingestion"]
    df2 = df2[df2["Content"].astype(str).str.len() > 50]
    print(f"   {len(df2):,} documents with content")

    print(f"   Classifying content types via LLM ({LLM_WORKERS} workers) …")
    dane_classifications = {}

    classify_tasks = []
    for _, row in df2.iterrows():
        doc_name = str(row.get("Name", ""))
        source = str(row.get("Source", ""))
        source_url = str(row.get("Link", ""))
        content = clean_text(str(row.get("Content", "")))
        doc_id = uuid.uuid5(
            DOCUMENT_ID_NAMESPACE,
            f"dane|{source}|{doc_name}|{source_url}",
        ).hex
        classify_tasks.append((source, doc_name, content, doc_id))

    with ThreadPoolExecutor(max_workers=LLM_WORKERS) as pool:
        futures = {
            pool.submit(_llm_classify_content_type, src, name, content, did): did
            for src, name, content, did in classify_tasks
        }
        pbar = tqdm(as_completed(futures), total=len(futures), desc="   Classifying")
        for fut in pbar:
            did = futures[fut]
            dane_classifications[did] = fut.result()

    _flush_caches()
    print("   Chunking …")
    for _, row in tqdm(df2.iterrows(), total=len(df2), desc="   Chunking"):
        doc_name = str(row.get("Name", ""))
        source = str(row.get("Source", ""))
        source_url = str(row.get("Link", ""))
        doc_id = uuid.uuid5(
            DOCUMENT_ID_NAMESPACE,
            f"dane|{source}|{doc_name}|{source_url}",
        ).hex
        ct = dane_classifications.get(doc_id)
        chunks = chunk_dane(row, content_type=ct)
        all_chunks.extend(chunks)

        if ct == "case_study" and chunks:
            content = clean_text(str(row.get("Content", "")))
            raw_case_studies.append({
                "document_id": doc_id,
                "title": doc_name,
                "source_label": source,
                "source_url": source_url,
                "doc_date": "",
                "full_content": content,
            })

    print(f"   → {len(all_chunks) - p_count:,} chunks")

    return all_chunks, raw_case_studies


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
    """Batch-insert all chunks into the CoachingTool collection."""
    collection = ensure_collection(client)
    print(f"\n  Ingesting {len(chunks):,} chunks into '{COLLECTION_NAME}' …")

    with collection.batch.fixed_size(batch_size=100) as batch:
        for chunk in tqdm(chunks, desc="   Ingesting"):
            batch.add_object(properties=chunk)


# ── LLM-based case study summarization ─────────────────────────

_SUMMARY_SYSTEM = """You are a public engagement expert. Given the full text of a case study about public engagement or participatory governance, extract structured metadata.

Return a JSON object with exactly these fields:
- "summary": A 2-3 paragraph summary of the case study (string)
- "location": The geographic location where this took place (string, e.g. "Toronto, Canada")
- "timeframe": The duration or time period (string, e.g. "6 months", "2019-2020")
- "demographic": The target demographic or participants (string, e.g. "General public (18+)")
- "scale": One of "small", "medium", or "large" based on scope/participant count
- "tags": 2-4 topic tags (array of strings, e.g. ["Deliberative Democracy", "Climate Action"])
- "key_outcomes": 3-5 key outcomes as bullet points (array of strings)
- "implementation_steps": 3-5 implementation steps as bullet points (array of strings)

If information is not available for a field, provide a reasonable inference based on context or use "Not specified".
Return ONLY valid JSON, no markdown fencing."""


def _generate_case_study_metadata(doc_id, title, full_content):
    """Generate structured metadata for a case study using LLM, with caching."""
    cached = _cache_get(CASE_STUDY_CACHE_FILE, doc_id)
    if cached is not None:
        return cached

    max_content = 12000
    content_for_llm = full_content[:max_content] if len(full_content) > max_content else full_content

    prompt = f"Case study title: {title}\n\nFull text:\n{content_for_llm}"

    try:
        client = _get_openai()
        resp = client.chat.completions.create(
            model=SUMMARY_MODEL,
            messages=[
                {"role": "system", "content": _SUMMARY_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=1500,
        )
        raw = resp.choices[0].message.content.strip()
        metadata = json.loads(raw)

        result = {
            "summary": str(metadata.get("summary", "")),
            "location": str(metadata.get("location", "Not specified")),
            "timeframe": str(metadata.get("timeframe", "Not specified")),
            "demographic": str(metadata.get("demographic", "Not specified")),
            "scale": metadata.get("scale", "medium"),
            "tags": metadata.get("tags", []),
            "key_outcomes": metadata.get("key_outcomes", []),
            "implementation_steps": metadata.get("implementation_steps", []),
        }

        if result["scale"] not in ("small", "medium", "large"):
            result["scale"] = "medium"
        result["tags"] = [str(t) for t in result["tags"]][:4]
        result["key_outcomes"] = [str(o) for o in result["key_outcomes"]][:5]
        result["implementation_steps"] = [str(s) for s in result["implementation_steps"]][:5]

    except Exception as e:
        print(f"    LLM summary failed for '{title[:50]}': {e}")
        result = {
            "summary": f"Case study: {title}",
            "location": "Not specified",
            "timeframe": "Not specified",
            "demographic": "Not specified",
            "scale": "medium",
            "tags": [],
            "key_outcomes": [],
            "implementation_steps": [],
        }

    _cache_put(CASE_STUDY_CACHE_FILE, doc_id, result)
    return result


def _summarize_one(cs):
    """Summarize a single case study — target for thread pool."""
    meta = _generate_case_study_metadata(
        cs["document_id"], cs["title"], cs["full_content"],
    )
    return {
        "document_id": cs["document_id"],
        "title": cs["title"],
        "source_label": cs["source_label"],
        "source_url": cs["source_url"],
        "doc_date": cs["doc_date"],
        "full_content": cs["full_content"],
        "summary": meta["summary"],
        "location": meta["location"],
        "timeframe": meta["timeframe"],
        "demographic": meta["demographic"],
        "scale": meta["scale"],
        "tags": meta["tags"],
        "key_outcomes": meta["key_outcomes"],
        "implementation_steps": meta["implementation_steps"],
    }


def build_case_study_library(raw_case_studies):
    """Generate LLM metadata for each raw case study in parallel."""
    print(f"\n── Generating Case Study Library ({len(raw_case_studies)} entries, {LLM_WORKERS} workers) ──")
    library = [None] * len(raw_case_studies)

    with ThreadPoolExecutor(max_workers=LLM_WORKERS) as pool:
        future_to_idx = {
            pool.submit(_summarize_one, cs): i
            for i, cs in enumerate(raw_case_studies)
        }
        pbar = tqdm(as_completed(future_to_idx), total=len(future_to_idx), desc="   Summarizing")
        for fut in pbar:
            idx = future_to_idx[fut]
            try:
                library[idx] = fut.result()
            except Exception as e:
                cs = raw_case_studies[idx]
                print(f"    Error summarizing '{cs['title'][:50]}': {e}")

    _flush_caches()
    return [item for item in library if item is not None]


def ingest_case_studies(client, library):
    """Batch-insert case study documents into the CaseStudyLibrary collection."""
    collection = ensure_case_study_collection(client)
    print(f"\n  Ingesting {len(library):,} case studies into '{CASE_STUDY_COLLECTION}' …")

    with collection.batch.fixed_size(batch_size=50) as batch:
        for doc in tqdm(library, desc="   Ingesting"):
            batch.add_object(properties=doc)


# ── CLI entry point ────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Ingest public engagement data into Weaviate",
    )
    parser.add_argument(
        "--clear", action="store_true",
        help="Delete existing collections before ingesting",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Chunk data and print statistics without writing to Weaviate",
    )
    parser.add_argument(
        "--skip-case-study-library", action="store_true",
        help="Only do chunked ingestion (legacy behavior), skip CaseStudyLibrary",
    )
    parser.add_argument(
        "--only-case-study-library", action="store_true",
        help="Only build and ingest the CaseStudyLibrary, skip chunked ingestion",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    xl_path = root / EXCEL_FILE

    if not xl_path.exists():
        print(f"Error: {xl_path} not found.")
        sys.exit(1)

    print("=" * 60)
    print("  Public Engagement — Data Ingestion Pipeline")
    print("=" * 60)
    print(f"  Source : {EXCEL_FILE}")
    print(f"  Target : {COLLECTION_NAME}", end="")
    if not args.skip_case_study_library:
        print(f" + {CASE_STUDY_COLLECTION}", end="")
    print()

    # ── Chunk everything ───────────────────────────────────────
    all_chunks, raw_case_studies = build_all_chunks(xl_path)

    if not args.only_case_study_library:
        print_stats(all_chunks)

    print(f"\n  Case studies found: {len(raw_case_studies)}")

    if args.dry_run:
        print("\n  Dry run complete — no data written to Weaviate.")
        return

    # ── Connect & write ────────────────────────────────────────
    print("\n  Connecting to Weaviate …")
    client = connect()

    try:
        if args.clear:
            print("\n  --clear flag: dropping existing collections …")
            drop_collection(client)
            drop_case_study_collection(client)

        # Chunked RAG ingestion
        if not args.only_case_study_library:
            ingest_chunks(client, all_chunks)

        # Case study library ingestion
        if not args.skip_case_study_library and raw_case_studies:
            library = build_case_study_library(raw_case_studies)
            ingest_case_studies(client, library)

        print(f"\n{'=' * 60}")
        summary_parts = []
        if not args.only_case_study_library:
            summary_parts.append(f"{len(all_chunks):,} chunks → {COLLECTION_NAME}")
        if not args.skip_case_study_library and raw_case_studies:
            summary_parts.append(f"{len(raw_case_studies):,} case studies → {CASE_STUDY_COLLECTION}")
        print(f"  Done. {' | '.join(summary_parts)}")
        print(f"{'=' * 60}")
    finally:
        client.close()


if __name__ == "__main__":
    main()
