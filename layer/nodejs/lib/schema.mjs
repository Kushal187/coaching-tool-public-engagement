// lib/schema.mjs
// ─────────────────────────────────────────────────────────────
// Weaviate schema management for the CoachingTool collection.
// Uses OpenAI text-embedding-3-small for vectorisation.
//
// The Python ingestion script (scripts/ingest.py) handles schema
// creation directly. This module keeps the JS codebase in sync
// and is used by the chatbot and any Node.js tooling.
// ─────────────────────────────────────────────────────────────

import { weaviateClient } from './weaviate-client.mjs';

export const COLLECTION_NAME = 'CoachingTool';

const SCHEMA = {
  class: COLLECTION_NAME,
  description:
    'Chunks of public-engagement documents and case studies for RAG retrieval.',
  vectorizer: 'text2vec-openai',
  moduleConfig: {
    'text2vec-openai': {
      model: 'text-embedding-3-small',
      type: 'text',
    },
  },
  properties: [
    {
      name: 'content',
      dataType: ['text'],
      description: 'The chunk text (primary field for embedding).',
      moduleConfig: { 'text2vec-openai': { skip: false } },
    },
    {
      name: 'document_id',
      dataType: ['text'],
      description:
        'Stable ID shared by all chunks of the same document (for prev/next chunk lookup).',
      moduleConfig: { 'text2vec-openai': { skip: true } },
    },
    {
      name: 'doc_name',
      dataType: ['text'],
      description: 'Human-readable document / case-study name.',
      moduleConfig: { 'text2vec-openai': { skip: true } },
    },
    {
      name: 'source_label',
      dataType: ['text'],
      description: 'Data source label, e.g. "Participedia Case Studies", "Covid Course Govlab".',
      moduleConfig: { 'text2vec-openai': { skip: true } },
    },
    {
      name: 'source_url',
      dataType: ['text'],
      description: 'Original URL for citation.',
      moduleConfig: { 'text2vec-openai': { skip: true } },
    },
    {
      name: 'doc_type',
      dataType: ['text'],
      description:
        'Document type: participedia_case | govlab_resource | lecture_series | transcript | reboot_democracy | policy_resource | academic_paper | external_resource.',
      moduleConfig: { 'text2vec-openai': { skip: true } },
    },
    {
      name: 'content_type',
      dataType: ['text'],
      description:
        'Content classification for retrieval and display: case_study | transcript | blog_post | journal_article | report | guide | policy_brief | lecture | tool_or_resource | other.',
      moduleConfig: { 'text2vec-openai': { skip: true } },
    },
    {
      name: 'section_name',
      dataType: ['text'],
      description:
        'Section name for Participedia (e.g. "Problems and Purpose") or chunk label (e.g. "chunk_3_of_12").',
      moduleConfig: { 'text2vec-openai': { skip: true } },
    },
    {
      name: 'chunk_index',
      dataType: ['int'],
      description: 'Zero-based positional index of this chunk within the document.',
      moduleConfig: { 'text2vec-openai': { skip: true } },
    },
    {
      name: 'total_chunks',
      dataType: ['int'],
      description: 'Total number of chunks for this document.',
      moduleConfig: { 'text2vec-openai': { skip: true } },
    },
    {
      name: 'doc_date',
      dataType: ['text'],
      description: 'Document date (ISO-like string, e.g. "2021-04-12").',
      moduleConfig: { 'text2vec-openai': { skip: true } },
    },
  ],
};

/**
 * Create the collection if it doesn't already exist.
 */
export async function ensureSchema() {
  try {
    const existing = await weaviateClient.schema
      .classGetter()
      .withClassName(COLLECTION_NAME)
      .do();
    if (existing) {
      console.log(`Collection "${COLLECTION_NAME}" already exists.`);
      return;
    }
  } catch {
    // Class doesn't exist yet – create it below
  }

  await weaviateClient.schema.classCreator().withClass(SCHEMA).do();
  console.log(
    `Created collection "${COLLECTION_NAME}" (vectorizer: text2vec-openai / text-embedding-3-small).`
  );
}

/**
 * Delete the collection (used with --clear flag).
 */
export async function deleteSchema() {
  try {
    await weaviateClient.schema
      .classDeleter()
      .withClassName(COLLECTION_NAME)
      .do();
    console.log(`Deleted collection "${COLLECTION_NAME}".`);
  } catch (err) {
    console.warn(`Could not delete collection: ${err.message}`);
  }
}
