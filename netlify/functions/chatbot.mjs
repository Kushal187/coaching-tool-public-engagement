// netlify/functions/chatbot.mjs
// ─────────────────────────────────────────────────────────────
// RAG chatbot serverless function.
// Adapted from rebootdemocracy-main/netlify/functions/chatbot_reboot.mjs
//
// Flow:
//   1. Receive user question (POST { message, conversation })
//   2. Search Weaviate CoachingTool collection (BM25 → nearText fallback)
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

const CHUNK_FIELDS = `
  objectId
  sourceFile
  title
  chapterTitle
  content
  chunkIndex
  _additional { id distance certainty }
`;

// ──── Search helpers (BM25 → nearText fallback) ──────────────
// Adapted from chatbot_reboot.mjs searchWeaviate()

async function searchWeaviate(query) {
  // 1. BM25 keyword search
  try {
    const bm25Res = await weaviateClient.graphql
      .get()
      .withClassName(COLLECTION_NAME)
      .withFields(CHUNK_FIELDS)
      .withBm25({ query })
      .withLimit(MAX_RESULTS)
      .do();

    const bm25Hits = bm25Res?.data?.Get?.[COLLECTION_NAME] ?? [];
    if (bm25Hits.length > 0) {
      console.log(`BM25 search returned ${bm25Hits.length} hit(s)`);
      return bm25Hits;
    }
  } catch (err) {
    console.warn('BM25 search failed, falling back to nearText:', err.message);
  }

  // 2. Semantic (nearText) fallback
  try {
    const vecRes = await weaviateClient.graphql
      .get()
      .withClassName(COLLECTION_NAME)
      .withFields(CHUNK_FIELDS)
      .withNearText({ concepts: [query] })
      .withLimit(MAX_RESULTS)
      .do();

    const vecHits = vecRes?.data?.Get?.[COLLECTION_NAME] ?? [];
    console.log(`nearText search returned ${vecHits.length} hit(s)`);
    return vecHits;
  } catch (err) {
    console.error('nearText search failed:', err.message);
    return [];
  }
}

/**
 * Main search entry point.
 * Runs BM25 → nearText, then filters/sorts results.
 */
async function searchContent(query) {
  try {
    const hits = await searchWeaviate(query);

    // Exact-match filter (case-insensitive substring)
    const lowerQuery = query.toLowerCase();
    const exactMatches = hits.filter((h) => {
      const searchable = [h.content, h.title, h.chapterTitle, h.sourceFile].filter(Boolean);
      return searchable.some((f) => f.toLowerCase().includes(lowerQuery));
    });

    // Prefer exact matches; otherwise fall back to distance sort
    const pool = exactMatches.length > 0 ? exactMatches : hits;
    const sorted = pool.sort(
      (a, b) => (a._additional?.distance ?? 1) - (b._additional?.distance ?? 1)
    );

    return sorted.slice(0, MAX_RESULTS);
  } catch (err) {
    console.error('searchContent error:', err);
    return [];
  }
}

// ──── Format utilities ───────────────────────────────────────
// Adapted from chatbot_reboot.mjs formatSearchResults()

function formatSearchResults(results) {
  if (!results?.length) {
    return 'No specific information found in the knowledge base.';
  }

  return results
    .map((r) => {
      const header = r.chapterTitle
        ? `**${r.title || 'Untitled'}** — _${r.chapterTitle}_ (source: ${r.sourceFile || 'unknown'})`
        : `**${r.title || 'Untitled'}** (source: ${r.sourceFile || 'unknown'}, chunk ${r.chunkIndex ?? '?'})`;
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

    // ── 4. Append source documents ──────────────────────────
    const sourceDocuments = searchResults
      .map((r) => ({
        title: r.chapterTitle
          ? `${r.title || r.sourceFile} — ${r.chapterTitle}`
          : r.title || r.sourceFile || 'Unknown',
        sourceFile: r.sourceFile || '',
        chapterTitle: r.chapterTitle || '',
        chunkIndex: r.chunkIndex ?? null,
      }))
      // Deduplicate by sourceFile + chapterTitle
      .filter(
        (doc, i, arr) =>
          arr.findIndex(
            (d) => d.sourceFile === doc.sourceFile && d.chapterTitle === doc.chapterTitle
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
