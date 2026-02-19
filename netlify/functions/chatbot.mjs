// netlify/functions/chatbot.mjs
// ─────────────────────────────────────────────────────────────
// RAG chatbot serverless function.
// Adapted from rebootdemocracy-main/netlify/functions/chatbot_reboot.mjs
//
// Flow:
//   1. Receive user question (POST { message, conversation })
//   2. Search Weaviate CoachingTool collection (hybrid: BM25 + vector)
//   3. Format top results as context
//   4. Stream an OpenAI GPT response back as SSE
//   5. Append source documents at the end
// ─────────────────────────────────────────────────────────────

import weaviate from 'weaviate-ts-client';
import { OpenAI } from 'openai';

// ──── Client initialisation ──────────────────────────────────
// (Inline here so the Netlify function is self-contained; in a
//  non-serverless setup you'd import from lib/weaviate-client.mjs)

function resolveHost() {
  const raw = process.env.WEAVIATE_HOST?.trim();
  if (!raw) return { scheme: 'http', host: 'localhost:8080' };
  if (/^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    return {
      scheme: u.protocol.replace(':', ''),
      host: u.port ? `${u.hostname}:${u.port}` : u.hostname,
    };
  }
  return { scheme: process.env.WEAVIATE_SCHEME || 'https', host: raw };
}

const { scheme, host } = resolveHost();

const weaviateClient = weaviate.client({
  scheme,
  host,
  apiKey: process.env.WEAVIATE_API_KEY
    ? new weaviate.ApiKey(process.env.WEAVIATE_API_KEY)
    : undefined,
  headers: { 'X-OpenAI-Api-Key': process.env.OPENAI_API_KEY || '' },
});

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ──── Constants ──────────────────────────────────────────────
const COLLECTION_NAME = 'CoachingTool';
const MAX_RESULTS = parseInt(process.env.CHATBOT_MAX_RESULTS, 10) || 5;
const MODEL = process.env.CHATBOT_MODEL || 'gpt-5.2';

// Request both Excel-ingest (doc_name, section_name, chunk_index, total_chunks, document_id)
// and PDF-ingest (sourceFile, title, sectionPath, chunkIndex) fields for compatibility.
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
  objectId
  sourceFile
  title
  chapterTitle
  sectionPath
  contextPrefix
  chunkIndex
  _additional { id score }
`;

// ──── Search helper (hybrid: BM25 + vector fusion) ───────────

/**
 * Search Weaviate using hybrid search (fuses BM25 keyword +
 * vector semantic results in a single query).
 * alpha = 0.5 gives equal weight to keyword and vector signals.
 */
async function searchContent(query) {
  try {
    const res = await weaviateClient.graphql
      .get()
      .withClassName(COLLECTION_NAME)
      .withFields(CHUNK_FIELDS)
      .withHybrid({ query, alpha: 0.5 })
      .withLimit(MAX_RESULTS)
      .do();

    const hits = res?.data?.Get?.[COLLECTION_NAME] ?? [];
    console.log(`Hybrid search returned ${hits.length} hit(s)`);
    return hits;
  } catch (err) {
    console.error('Hybrid search failed:', err.message);

    // Fallback: try nearText if hybrid is unavailable
    try {
      const fallbackRes = await weaviateClient.graphql
        .get()
        .withClassName(COLLECTION_NAME)
        .withFields(CHUNK_FIELDS)
        .withNearText({ concepts: [query] })
        .withLimit(MAX_RESULTS)
        .do();

      const fallbackHits = fallbackRes?.data?.Get?.[COLLECTION_NAME] ?? [];
      console.log(`nearText fallback returned ${fallbackHits.length} hit(s)`);
      return fallbackHits;
    } catch (fallbackErr) {
      console.error('nearText fallback also failed:', fallbackErr.message);
      return [];
    }
  }
}

// ──── Format utilities ───────────────────────────────────────
// content_type (snake_case) -> display label for user
const CONTENT_TYPE_LABELS = {
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

function contentTypeLabel(ctype) {
  return (ctype && CONTENT_TYPE_LABELS[ctype]) || CONTENT_TYPE_LABELS.other || 'Other';
}

function formatSearchResults(results) {
  if (!results?.length) {
    return 'No specific information found in the knowledge base.';
  }

  return results
    .map((r) => {
      const docTitle = r.doc_name || r.title || 'Untitled';
      const section = r.section_name || r.sectionPath || r.chapterTitle || '';
      const chunkIdx = r.chunk_index ?? r.chunkIndex;
      const totalChunks = r.total_chunks;
      const position =
        totalChunks != null && chunkIdx != null
          ? ` (chunk ${chunkIdx + 1} of ${totalChunks})`
          : chunkIdx != null
            ? ` (chunk ${chunkIdx + 1})`
            : '';
      const source = r.source_label || r.sourceFile || 'unknown';
      const typeLabel = r.content_type ? contentTypeLabel(r.content_type) : '';
      const sourceInfo = typeLabel ? `${source} · ${typeLabel}` : source;
      const header = section
        ? `**${docTitle}** — _${section}_${position} (source: ${sourceInfo})`
        : `**${docTitle}**${position} (source: ${sourceInfo})`;
      return `${header}\n${r.content || ''}`;
    })
    .join('\n\n---\n\n');
}

// ──── Netlify handler ────────────────────────────────────────
// Adapted from chatbot_reboot.mjs handler()

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { message, conversation } = JSON.parse(event.body || '{}');

  if (!message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing "message" in request body.' }) };
  }

  try {
    // ── 1. Search Weaviate ──────────────────────────────────
    const searchResults = await searchContent(message);
    const formattedResults = formatSearchResults(searchResults);

    console.log(`Query: "${message}" → ${searchResults.length} result(s)`);

    // ── 2. Build messages for the LLM ───────────────────────
    const systemMessage = `You are a helpful coaching assistant that answers questions based on a curated knowledge base of documents.

Instructions:
- The user will ask a question. We have searched our knowledge base and placed relevant excerpts into <CONTEXT> tags for you.
- Base your answer ONLY on the provided context or common knowledge. Do not fabricate information.
- If the context does not contain enough information to answer, say so clearly and suggest the user rephrase or ask something else.
- Use markdown formatting (bullet points, bold, headers) to make your answers clear and readable.
- Keep answers concise unless the user asks for detail.
- Do not mention the context tags or the retrieval process to the user — just answer naturally.`;

    const messages = [{ role: 'system', content: systemMessage }];

    // Append prior conversation turns (excluding the placeholder last bot message)
    if (Array.isArray(conversation)) {
      messages.push(
        ...conversation.slice(0, -1).flatMap((m) => {
          if (m.type === 'user') return { role: 'user', content: m.content };
          if (m.type === 'bot') return { role: 'assistant', content: m.content };
          return [];
        })
      );
    }

    // Latest user question with retrieval context
    messages.push({
      role: 'user',
      content: `<LATEST_USER_QUESTION>\n${message}\n</LATEST_USER_QUESTION>\n\n<CONTEXT>\n${formattedResults}\n</CONTEXT>\n\nYour answer in markdown:`,
    });

    // ── 3. Stream the LLM response ──────────────────────────
    const stream = await openaiClient.chat.completions.create({
      model: MODEL,
      messages,
      stream: true,
    });

    // Accumulate SSE events in the response body
    // (Netlify Functions v1 — returns all events at once;
    //  the client reads them as if they were streamed.)
    let body = '';

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content || '';
      if (content) {
        body += `data: ${JSON.stringify({ content })}\n\n`;
      }
    }

    // ── 4. Append source documents ─────────────────────────────────
    // Each item includes documentId, chunkIndex, totalChunks so the client can
    // fetch adjacent chunks: e.g. previous = Weaviate filter
    //   { operator: 'And', operands: [
    //     { path: ['document_id'], operator: 'Equal', valueText: hit.documentId },
    //     { path: ['chunk_index'], operator: 'Equal', valueInt: hit.chunkIndex - 1 }
    //   ] }
    const sourceDocuments = searchResults
      .map((r) => {
        const section = r.section_name || r.sectionPath || r.chapterTitle || '';
        const docTitle = r.doc_name || r.title || r.sourceFile || 'Unknown';
        return {
          title: section ? `${docTitle} — ${section}` : docTitle,
          sourceFile: r.source_label ?? r.sourceFile ?? '',
          sourceUrl: r.source_url ?? '',
          contentType: r.content_type ?? null,
          contentTypeLabel: r.content_type ? contentTypeLabel(r.content_type) : null,
          sectionPath: section,
          chapterTitle: r.chapterTitle ?? '',
          chunkIndex: r.chunk_index ?? r.chunkIndex ?? null,
          totalChunks: r.total_chunks ?? null,
          documentId: r.document_id ?? null,
        };
      })
      // Deduplicate by document_id + chunk_index (or sourceFile + sectionPath for PDF-only)
      .filter(
        (doc, i, arr) =>
          arr.findIndex(
            (d) =>
              (doc.documentId != null && d.documentId === doc.documentId && d.chunkIndex === doc.chunkIndex) ||
              (doc.documentId == null && d.sourceFile === doc.sourceFile && d.sectionPath === doc.sectionPath)
          ) === i
      );

    body += `data: ${JSON.stringify({ sourceDocuments })}\n\n`;
    body += 'data: [DONE]\n\n';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
      body,
    };
  } catch (error) {
    console.error('Error processing message:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An error occurred processing your message.' }),
    };
  }
}
