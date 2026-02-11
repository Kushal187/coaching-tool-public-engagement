#!/usr/bin/env node
// scripts/ingest-pdfs.mjs
// ─────────────────────────────────────────────────────────────
// CLI script: read every converted Markdown file in
// ./documents/converted/, chunk each one using structure-aware
// heading-based splitting, and index the chunks into Weaviate.
//
// Prerequisites:
//   Run `python scripts/convert-pdfs.py` first to convert PDFs
//   to Markdown using Docling.
//
// Usage:
//   node scripts/ingest-pdfs.mjs              # structure-aware chunking
//   node scripts/ingest-pdfs.mjs --simple     # fast word-boundary chunking
//   node scripts/ingest-pdfs.mjs --clear      # wipe collection first
//   node scripts/ingest-pdfs.mjs --clear --simple
// ─────────────────────────────────────────────────────────────

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v5 as uuidv5 } from 'uuid';

import { weaviateClient } from '../lib/weaviate-client.mjs';
import { chunkDocument } from '../lib/chunking.mjs';
import { ensureSchema, deleteSchema, COLLECTION_NAME } from '../lib/schema.mjs';

// ──── Constants ──────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCUMENTS_DIR = path.resolve(__dirname, '..', 'documents');
const CONVERTED_DIR = path.resolve(DOCUMENTS_DIR, 'converted');

// UUID namespace – same as the rebootdemocracy source
const UUID_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const makeUuid = (s) => uuidv5(s, UUID_NS);

// ──── Helpers ────────────────────────────────────────────────

/**
 * Derive a human-readable title from the Markdown content.
 * Looks for the first `# ` heading; falls back to filename.
 */
function titleFromMarkdown(markdown, filename) {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return titleFromFilename(filename);
}

/**
 * Derive a human-readable title from the filename.
 * "my-cool-document.md" → "My Cool Document"
 */
function titleFromFilename(filename) {
  return filename
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Delete all existing Weaviate objects for a given sourceFile
 * (so re-running the ingestion is idempotent).
 */
async function deleteChunksForFile(sourceFile) {
  try {
    const res = await weaviateClient.graphql
      .get()
      .withClassName(COLLECTION_NAME)
      .withFields('objectId _additional { id }')
      .withWhere({
        path: ['sourceFile'],
        operator: 'Equal',
        valueText: sourceFile,
      })
      .withLimit(500)
      .do();

    const hits = res?.data?.Get?.[COLLECTION_NAME] ?? [];
    for (const h of hits) {
      await weaviateClient.data
        .deleter()
        .withClassName(COLLECTION_NAME)
        .withId(h._additional.id)
        .do();
    }

    if (hits.length > 0) {
      console.log(`  Deleted ${hits.length} existing chunk(s) for "${sourceFile}".`);
    }
  } catch (err) {
    // Collection may not exist yet – that's fine
    if (!err.message?.includes('could not find class')) {
      console.warn(`  Warning deleting old chunks: ${err.message}`);
    }
  }
}

/**
 * Index a single chunk into Weaviate.
 */
async function indexChunk(chunk) {
  await weaviateClient.data
    .creator()
    .withClassName(COLLECTION_NAME)
    .withId(makeUuid(chunk.objectId))
    .withProperties({
      objectId: chunk.objectId,
      sourceFile: chunk.sourceFile,
      title: chunk.title,
      chapterTitle: chunk.chapterTitle || '',
      sectionPath: chunk.sectionPath || '',
      contextPrefix: chunk.contextPrefix || '',
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
    })
    .do();
}

// ──── Main ───────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const clearFirst = args.includes('--clear');
  const simpleMode = args.includes('--simple');

  console.log('══════════════════════════════════════════');
  console.log(' Markdown → Weaviate Ingestion Pipeline');
  console.log(`  Mode: ${simpleMode ? 'Simple (word-boundary)' : 'Structure-aware heading-based chunking'}`);
  console.log('══════════════════════════════════════════');

  // Optionally wipe the collection
  if (clearFirst) {
    console.log('\n--clear flag detected: deleting existing collection …');
    await deleteSchema();
  }

  // Ensure collection schema exists
  await ensureSchema();

  // Check for converted directory
  if (!fs.existsSync(CONVERTED_DIR)) {
    console.error(`\nError: converted documents directory not found at ${CONVERTED_DIR}`);
    console.error('Run "npm run convert" (or "python scripts/convert-pdfs.py") first.');
    process.exit(1);
  }

  const mdFiles = fs.readdirSync(CONVERTED_DIR).filter((f) => /\.md$/i.test(f));

  if (mdFiles.length === 0) {
    console.log('\nNo Markdown files found in ./documents/converted/');
    console.log('Run "npm run convert" first to convert your PDFs.');
    process.exit(0);
  }

  console.log(`\nFound ${mdFiles.length} Markdown file(s) in ./documents/converted/\n`);

  let totalChunks = 0;

  for (const filename of mdFiles) {
    const filePath = path.join(CONVERTED_DIR, filename);
    console.log(`▸ Processing: ${filename}`);

    // 1. Read the converted Markdown
    const text = fs.readFileSync(filePath, 'utf-8');

    if (!text || text.trim().length === 0) {
      console.log(`  ⚠ Empty file – skipping.\n`);
      continue;
    }

    const lineCount = text.split('\n').length;
    console.log(`  Read ${text.length} characters (${lineCount} lines).`);

    // 2. Derive title from the Markdown content
    const title = titleFromMarkdown(text, filename);

    // 3. Chunk using structure-aware strategy (or simple fallback)
    const chunks = chunkDocument({
      text,
      sourceFile: filename,
      title,
      simple: simpleMode,
    });

    console.log(`  Split into ${chunks.length} chunk(s).`);

    // 4. Delete old chunks for this file (idempotent re-ingestion)
    await deleteChunksForFile(filename);

    // 5. Index each chunk
    for (const chunk of chunks) {
      await indexChunk(chunk);
    }
    console.log(`  ✓ Indexed ${chunks.length} chunk(s).\n`);
    totalChunks += chunks.length;
  }

  console.log('══════════════════════════════════════════');
  console.log(`Done. Indexed ${totalChunks} chunk(s) from ${mdFiles.length} file(s).`);
  console.log('══════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
