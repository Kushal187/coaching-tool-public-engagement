// netlify/functions/case-studies.mjs
// Serves case studies from the CaseStudyLibrary Weaviate collection.
// GET /                    → all case studies (summary view)
// GET /?id=<document_id>   → single case study (full data incl. full_content)
// GET /?scale=large        → filter by scale
// GET /?tag=Climate        → filter by tag (case-insensitive substring)

import { weaviateClient } from '../../lib/weaviate-client.mjs';

const COLLECTION = 'CaseStudyLibrary';

const SUMMARY_FIELDS =
  'document_id title source_label source_url doc_date summary location timeframe demographic scale tags key_outcomes implementation_steps';
const FULL_FIELDS = SUMMARY_FIELDS + ' full_content';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  const params = event.queryStringParameters || {};

  try {
    // Single case study by document_id
    if (params.id) {
      return await fetchOne(params.id);
    }
    // List all (with optional filters)
    return await fetchAll(params);
  } catch (error) {
    console.error('case-studies error:', error);
    return jsonResponse(500, { error: 'Failed to fetch case studies.' });
  }
}

async function fetchOne(documentId) {
  const result = await weaviateClient.graphql
    .get()
    .withClassName(COLLECTION)
    .withFields(FULL_FIELDS)
    .withWhere({
      path: ['document_id'],
      operator: 'Equal',
      valueText: documentId,
    })
    .withLimit(1)
    .do();

  const hits = result?.data?.Get?.[COLLECTION] ?? [];

  if (hits.length === 0) {
    return jsonResponse(404, { error: 'Case study not found.' });
  }

  return jsonResponse(200, mapToFrontend(hits[0], true));
}

async function fetchAll(params) {
  const result = await weaviateClient.graphql
    .get()
    .withClassName(COLLECTION)
    .withFields(SUMMARY_FIELDS)
    .withLimit(200)
    .do();

  let items = (result?.data?.Get?.[COLLECTION] ?? []).map((h) =>
    mapToFrontend(h, false),
  );

  // In-memory filtering (dataset is small)
  if (params.scale) {
    const scale = params.scale.toLowerCase();
    items = items.filter((cs) => cs.scale === scale);
  }
  if (params.tag) {
    const tag = params.tag.toLowerCase();
    items = items.filter((cs) =>
      cs.tags.some((t) => t.toLowerCase().includes(tag)),
    );
  }

  return jsonResponse(200, items);
}

function mapToFrontend(hit, includeFull) {
  const mapped = {
    id: hit.document_id,
    title: hit.title || 'Untitled',
    location: hit.location || 'Not specified',
    timeframe: hit.timeframe || 'Not specified',
    demographic: hit.demographic || 'Not specified',
    scale: hit.scale || 'medium',
    tags: hit.tags || [],
    summary: hit.summary || '',
    keyOutcomes: hit.key_outcomes || [],
    implementationSteps: hit.implementation_steps || [],
    sourceUrl: hit.source_url || '',
    sourceLabel: hit.source_label || '',
    docDate: hit.doc_date || '',
  };
  if (includeFull) {
    mapped.fullContent = hit.full_content || '';
  }
  return mapped;
}
