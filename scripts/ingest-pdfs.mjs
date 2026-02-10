#!/usr/bin/env node
// scripts/ingest-pdfs.mjs
// ─────────────────────────────────────────────────────────────
// CLI script: read every PDF in ./documents/, chunk each one
// using an LLM-based strategy, and index the chunks into Weaviate.
//
// Usage:
//   node scripts/ingest-pdfs.mjs              # LLM-based chunking
//   node scripts/ingest-pdfs.mjs --simple     # fast word-boundary chunking
//   node scripts/ingest-pdfs.mjs --clear      # wipe collection first
//   node scripts/ingest-pdfs.mjs --clear --simple
// ─────────────────────────────────────────────────────────────

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfParse from 'pdf-parse';
import { v5 as uuidv5 } from 'uuid';

import { weaviateClient, openaiClient } from '../lib/weaviate-client.mjs';
import { chunkDocument } from '../lib/chunking.mjs';
import { ensureSchema, deleteSchema, COLLECTION_NAME } from '../lib/schema.mjs';

// ──── Constants ──────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCUMENTS_DIR = path.resolve(__dirname, '..', 'documents');

// UUID namespace – same as the rebootdemocracy source
const UUID_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const makeUuid = (s) => uuidv5(s, UUID_NS);

// ──── Helpers ────────────────────────────────────────────────

/**
 * Derive a human-readable title from the PDF filename.
 * "my-cool-document.pdf" → "My Cool Document"
 */
function titleFromFilename(filename) {
  return filename
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extract plain text from a PDF buffer.
 */
async function extractText(pdfBuffer) {
  const data = await pdfParse(pdfBuffer);
  return data.text;
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
  console.log(' PDF → Weaviate Ingestion Pipeline');
  console.log(`  Mode: ${simpleMode ? 'Simple (word-boundary)' : 'LLM-based intelligent chunking'}`);
  console.log('══════════════════════════════════════════');

  // Optionally wipe the collection
  if (clearFirst) {
    console.log('\n--clear flag detected: deleting existing collection …');
    await deleteSchema();
  }

  // Ensure collection schema exists
  await ensureSchema();

  // Discover PDF files
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    console.error(`\nError: documents directory not found at ${DOCUMENTS_DIR}`);
    console.error('Create it and place your PDF files inside.');
    process.exit(1);
  }

  const pdfFiles = fs.readdirSync(DOCUMENTS_DIR).filter((f) => /\.pdf$/i.test(f));

  if (pdfFiles.length === 0) {
    console.log('\nNo PDF files found in ./documents/');
    console.log('Place your PDF files there and re-run: npm run ingest');
    process.exit(0);
  }

  console.log(`\nFound ${pdfFiles.length} PDF file(s) in ./documents/\n`);

  let totalChunks = 0;

  for (const filename of pdfFiles) {
    const filePath = path.join(DOCUMENTS_DIR, filename);
    console.log(`▸ Processing: ${filename}`);

    // 1. Read & extract text
    const pdfBuffer = fs.readFileSync(filePath);
    const text = await extractText(pdfBuffer);

    if (!text || text.trim().length === 0) {
      console.log(`  ⚠ No extractable text – skipping.\n`);
      continue;
    }

    const lineCount = text.split('\n').length;
    console.log(`  Extracted ${text.length} characters (${lineCount} lines).`);

    // 2. Chunk using LLM strategy (or simple fallback)
    const chunks = await chunkDocument({
      text,
      sourceFile: filename,
      title: titleFromFilename(filename),
      openaiClient,
      simple: simpleMode,
    });

    console.log(`  Split into ${chunks.length} chunk(s).`);

    // 3. Delete old chunks for this file (idempotent re-ingestion)
    await deleteChunksForFile(filename);

    // 4. Index each chunk
    for (const chunk of chunks) {
      await indexChunk(chunk);
    }
    console.log(`  ✓ Indexed ${chunks.length} chunk(s).\n`);
    totalChunks += chunks.length;
  }

  console.log('══════════════════════════════════════════');
  console.log(`Done. Indexed ${totalChunks} chunk(s) from ${pdfFiles.length} PDF(s).`);
  console.log('══════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
