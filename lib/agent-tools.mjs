// lib/agent-tools.mjs
// Weaviate tool definitions and implementations for agent function calling.

import { weaviateClient } from './weaviate-client.mjs';

const COLLECTION_NAME = 'CoachingTool';
const DEFAULT_MAX_RESULTS = parseInt(process.env.CHATBOT_MAX_RESULTS, 10) || 5;

const CHUNK_FIELDS = `
  content
  document_id
  doc_name
  source_label
  source_url
  content_type
  section_name
  chunk_index
  total_chunks
  doc_type
  doc_date
  _additional { id score }
`;

// ── OpenAI function-calling tool definitions ─────────────────

export const agentToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description:
        'Search the public engagement knowledge base using a text query. Returns relevant document chunks with metadata. Call multiple times with different queries to gather comprehensive evidence.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query text',
          },
          content_type_filter: {
            type: 'string',
            description: 'Optional filter to restrict results to a specific content type',
            enum: [
              'case_study', 'transcript', 'blog_post', 'journal_article',
              'report', 'guide', 'policy_brief', 'lecture', 'tool_or_resource',
            ],
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_document_details',
      description:
        'Retrieve all chunks for a specific document by its document_id. Use when you find a promising search result and want the full document context.',
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'string',
            description: 'The document_id of the document to retrieve',
          },
        },
        required: ['document_id'],
      },
    },
  },
];

// ── Tool implementations ─────────────────────────────────────

export async function searchKnowledgeBase(
  { query, content_type_filter },
  maxResults = DEFAULT_MAX_RESULTS,
) {
  try {
    let builder = weaviateClient.graphql
      .get()
      .withClassName(COLLECTION_NAME)
      .withFields(CHUNK_FIELDS)
      .withHybrid({ query, alpha: 0.5 })
      .withLimit(maxResults);

    if (content_type_filter) {
      builder = builder.withWhere({
        path: ['content_type'],
        operator: 'Equal',
        valueText: content_type_filter,
      });
    }

    const res = await builder.do();
    const hits = res?.data?.Get?.[COLLECTION_NAME] ?? [];
    console.log(`[agent-tools] search "${query}" → ${hits.length} hit(s)`);
    return { query, resultCount: hits.length, results: hits.map(formatHit) };
  } catch (err) {
    console.error('[agent-tools] Hybrid search failed:', err.message);

    try {
      const fallback = await weaviateClient.graphql
        .get()
        .withClassName(COLLECTION_NAME)
        .withFields(CHUNK_FIELDS)
        .withNearText({ concepts: [query] })
        .withLimit(maxResults)
        .do();

      const hits = fallback?.data?.Get?.[COLLECTION_NAME] ?? [];
      console.log(`[agent-tools] nearText fallback → ${hits.length} hit(s)`);
      return { query, resultCount: hits.length, results: hits.map(formatHit) };
    } catch (fallbackErr) {
      console.error('[agent-tools] nearText fallback also failed:', fallbackErr.message);
      return { query, resultCount: 0, results: [] };
    }
  }
}

export async function getDocumentDetails({ document_id }) {
  try {
    const res = await weaviateClient.graphql
      .get()
      .withClassName(COLLECTION_NAME)
      .withFields(CHUNK_FIELDS)
      .withWhere({
        path: ['document_id'],
        operator: 'Equal',
        valueText: document_id,
      })
      .withLimit(50)
      .do();

    const hits = res?.data?.Get?.[COLLECTION_NAME] ?? [];
    hits.sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0));
    console.log(`[agent-tools] getDocumentDetails(${document_id}) → ${hits.length} chunk(s)`);
    return { document_id, chunkCount: hits.length, chunks: hits.map(formatHit) };
  } catch (err) {
    console.error('[agent-tools] getDocumentDetails failed:', err.message);
    return { document_id, chunkCount: 0, chunks: [] };
  }
}

function formatHit(r) {
  return {
    content: r.content || '',
    docName: r.doc_name || 'Untitled',
    section: r.section_name || '',
    contentType: r.content_type || '',
    sourceLabel: r.source_label || '',
    sourceUrl: r.source_url || '',
    documentId: r.document_id || null,
    chunkIndex: r.chunk_index ?? null,
    totalChunks: r.total_chunks ?? null,
  };
}

export const agentToolImplementations = {
  search_knowledge_base: searchKnowledgeBase,
  get_document_details: getDocumentDetails,
};

// ── Display helpers ──────────────────────────────────────────

export const CONTENT_TYPE_LABELS = {
  case_study: 'Case study',
  transcript: 'Transcript',
  blog_post: 'Blog post',
  journal_article: 'Journal article',
  report: 'Report',
  guide: 'Guide',
  policy_brief: 'Policy brief',
  lecture: 'Lecture',
  tool_or_resource: 'Tool or resource',
  other: 'Other',
};

export function contentTypeLabel(ctype) {
  return (ctype && CONTENT_TYPE_LABELS[ctype]) || 'Other';
}

/**
 * Format an array of formatted hits into a text context block for the LLM.
 */
export function formatSearchResultsAsContext(hits) {
  if (!hits?.length) return 'No specific information found in the knowledge base.';

  return hits
    .map((r) => {
      const position =
        r.totalChunks != null && r.chunkIndex != null
          ? ` (chunk ${r.chunkIndex + 1} of ${r.totalChunks})`
          : r.chunkIndex != null
            ? ` (chunk ${r.chunkIndex + 1})`
            : '';
      const typeLabel = r.contentType ? contentTypeLabel(r.contentType) : '';
      const source = r.sourceLabel || 'unknown';
      const sourceInfo = typeLabel ? `${source} · ${typeLabel}` : source;
      const header = r.section
        ? `**${r.docName}** — _${r.section}_${position} (source: ${sourceInfo})`
        : `**${r.docName}**${position} (source: ${sourceInfo})`;
      return `${header}\n${r.content}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Build deduplicated source-document list for the client.
 */
export function buildSourceDocuments(hits) {
  return hits
    .map((r) => ({
      title: r.section ? `${r.docName} — ${r.section}` : r.docName,
      sourceFile: r.sourceLabel || '',
      sourceUrl: r.sourceUrl || '',
      contentType: r.contentType || null,
      contentTypeLabel: r.contentType ? contentTypeLabel(r.contentType) : null,
      sectionPath: r.section || '',
      chunkIndex: r.chunkIndex,
      totalChunks: r.totalChunks,
      documentId: r.documentId,
    }))
    .filter(
      (doc, i, arr) =>
        arr.findIndex(
          (d) =>
            (doc.documentId != null &&
              d.documentId === doc.documentId &&
              d.chunkIndex === doc.chunkIndex) ||
            (doc.documentId == null &&
              d.sourceFile === doc.sourceFile &&
              d.sectionPath === doc.sectionPath),
        ) === i,
    );
}
