// lambda/case-studies-read.mjs
// GET /api/case-studies handler.
// Supports ?id=X for single case study, ?q=X for search,
// ?scale=X and ?tag=X for filtering.

const LIB_PATH = process.env.AWS_LAMBDA_FUNCTION_NAME ? '/opt/nodejs' : '..';

const { weaviateClient } = await import(`${LIB_PATH}/lib/weaviate-client.mjs`);

const CS_COLLECTION = 'CaseStudyLibrary';
const CS_SUMMARY_FIELDS =
  'document_id title source_label source_url doc_date summary location timeframe demographic scale tags key_outcomes implementation_steps';
const CS_FULL_FIELDS = CS_SUMMARY_FIELDS + ' full_content';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ── Helpers ─────────────────────────────────────────────────

function mapCaseStudy(hit, includeFull) {
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

function jsonResponse(data, statusCode = 200) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message }),
  };
}

// ── Lambda handler ──────────────────────────────────────────

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const params = event.queryStringParameters || {};

    // Single case study by ID
    if (params.id) {
      const result = await weaviateClient.graphql
        .get()
        .withClassName(CS_COLLECTION)
        .withFields(CS_FULL_FIELDS)
        .withWhere({
          path: ['document_id'],
          operator: 'Equal',
          valueText: params.id,
        })
        .withLimit(1)
        .do();

      const hits = result?.data?.Get?.[CS_COLLECTION] ?? [];
      if (hits.length === 0) {
        return errorResponse(404, 'Case study not found.');
      }
      return jsonResponse(mapCaseStudy(hits[0], true));
    }

    // Search or list all
    const q = typeof params.q === 'string' ? params.q.trim() : '';
    let hits;

    if (q) {
      console.log(`[case-studies] search q="${q}"`);
      try {
        const searchResult = await weaviateClient.graphql
          .get()
          .withClassName(CS_COLLECTION)
          .withFields(CS_SUMMARY_FIELDS)
          .withNearText({ concepts: [q] })
          .withLimit(50)
          .do();
        hits = searchResult?.data?.Get?.[CS_COLLECTION] ?? [];
        console.log(`[case-studies] nearText search -> ${hits.length} hit(s)`);
      } catch (searchErr) {
        console.error('[case-studies] nearText search failed, falling back to hybrid:', searchErr.message);
        try {
          const fallback = await weaviateClient.graphql
            .get()
            .withClassName(CS_COLLECTION)
            .withFields(CS_SUMMARY_FIELDS)
            .withHybrid({ query: q, alpha: 0.75 })
            .withLimit(50)
            .do();
          hits = fallback?.data?.Get?.[CS_COLLECTION] ?? [];
          console.log(`[case-studies] hybrid fallback -> ${hits.length} hit(s)`);
        } catch (hybridErr) {
          console.error('[case-studies] hybrid fallback also failed:', hybridErr.message);
          hits = [];
        }
      }
    } else {
      const result = await weaviateClient.graphql
        .get()
        .withClassName(CS_COLLECTION)
        .withFields(CS_SUMMARY_FIELDS)
        .withLimit(200)
        .do();
      hits = result?.data?.Get?.[CS_COLLECTION] ?? [];
    }

    // Deduplicate
    const seen = new Set();
    let items = hits
      .map((h) => mapCaseStudy(h, false))
      .filter((cs) => {
        if (seen.has(cs.id)) return false;
        seen.add(cs.id);
        return true;
      });

    // Apply filters
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

    return jsonResponse(items);
  } catch (error) {
    console.error('case-studies error:', error);
    return errorResponse(500, 'Failed to fetch case studies.');
  }
};
