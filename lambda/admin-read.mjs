// lambda/admin-read.mjs
// GET handlers for admin endpoints:
//   GET /api/admin/stats
//   GET /api/admin/documents
//   GET /api/admin/documents/:id
//   GET /api/admin/registry

const LIB_PATH = process.env.AWS_LAMBDA_FUNCTION_NAME ? '/opt/nodejs' : '..';

const { weaviateClient } = await import(`${LIB_PATH}/lib/weaviate-client.mjs`);

// DynamoDB for registry in Lambda; in Lambda we use AWS SDK
let dynamoDb;
const REGISTRY_TABLE = process.env.REGISTRY_TABLE || 'CoachingToolRegistry';

if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  const client = new DynamoDBClient({});
  dynamoDb = DynamoDBDocumentClient.from(client);
}

const CT_COLLECTION = 'CoachingTool';
const CS_COLLECTION = 'CaseStudyLibrary';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ── Helpers ─────────────────────────────────────────────────

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

async function getCollectionCount(className) {
  try {
    const result = await weaviateClient.graphql
      .aggregate()
      .withClassName(className)
      .withFields('meta { count }')
      .do();
    return result?.data?.Aggregate?.[className]?.[0]?.meta?.count ?? 0;
  } catch {
    return 0;
  }
}

async function getRegistryCount() {
  if (!dynamoDb) return 0;
  try {
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const result = await dynamoDb.send(new ScanCommand({
      TableName: REGISTRY_TABLE,
      Select: 'COUNT',
    }));
    return result.Count || 0;
  } catch {
    return 0;
  }
}

async function scanRegistry() {
  if (!dynamoDb) return [];
  try {
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const items = [];
    let lastKey;

    do {
      const result = await dynamoDb.send(new ScanCommand({
        TableName: REGISTRY_TABLE,
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }));
      items.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return items;
  } catch (err) {
    console.error('Registry scan error:', err.message);
    return [];
  }
}

// ── GET /api/admin/stats ────────────────────────────────────

async function handleStats() {
  try {
    const [ctCount, csCount, registryCount] = await Promise.all([
      getCollectionCount(CT_COLLECTION),
      getCollectionCount(CS_COLLECTION),
      getRegistryCount(),
    ]);

    // Get doc_type and content_type breakdowns from CoachingTool
    let docTypeBreakdown = {};
    let contentTypeBreakdown = {};
    let sourceBreakdown = {};

    try {
      const ctAgg = await weaviateClient.graphql
        .aggregate()
        .withClassName(CT_COLLECTION)
        .withFields('doc_type { count topOccurrences { value occurs } } content_type { count topOccurrences { value occurs } } source_label { count topOccurrences { value occurs } }')
        .do();

      const agg = ctAgg?.data?.Aggregate?.[CT_COLLECTION]?.[0];
      if (agg) {
        for (const occ of agg.doc_type?.topOccurrences || []) {
          docTypeBreakdown[occ.value] = occ.occurs;
        }
        for (const occ of agg.content_type?.topOccurrences || []) {
          contentTypeBreakdown[occ.value] = occ.occurs;
        }
        for (const occ of agg.source_label?.topOccurrences || []) {
          sourceBreakdown[occ.value] = occ.occurs;
        }
      }
    } catch (err) {
      console.warn('Admin stats aggregation failed:', err.message);
    }

    return jsonResponse({
      collections: {
        coachingTool: { name: CT_COLLECTION, count: ctCount },
        caseStudyLibrary: { name: CS_COLLECTION, count: csCount },
      },
      totalChunks: ctCount,
      totalCaseStudies: csCount,
      registryFiles: registryCount,
      breakdowns: {
        docType: docTypeBreakdown,
        contentType: contentTypeBreakdown,
        source: sourceBreakdown,
      },
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return errorResponse(500, 'Failed to fetch stats.');
  }
}

// ── GET /api/admin/documents ────────────────────────────────

async function handleDocuments(params) {
  try {
    const pageSize = Math.min(parseInt(params.pageSize) || 20, 100);
    const page = Math.max(parseInt(params.page) || 1, 1);

    // Build filters
    const filters = [];
    if (params.content_type) {
      filters.push({ path: ['content_type'], operator: 'Equal', valueText: params.content_type });
    }
    if (params.doc_type) {
      filters.push({ path: ['doc_type'], operator: 'Equal', valueText: params.doc_type });
    }
    if (params.source_label) {
      filters.push({ path: ['source_label'], operator: 'Equal', valueText: params.source_label });
    }

    // Paginate 2000 at a time from Weaviate, group server-side
    const BATCH = 2000;
    const docMap = new Map();
    let chunkOffset = 0;
    let keepFetching = true;

    while (keepFetching) {
      let builder = weaviateClient.graphql
        .get()
        .withClassName(CT_COLLECTION)
        .withFields('document_id doc_name source_label source_url doc_type content_type total_chunks doc_date')
        .withLimit(BATCH)
        .withOffset(chunkOffset);

      if (filters.length === 1) {
        builder = builder.withWhere(filters[0]);
      } else if (filters.length > 1) {
        builder = builder.withWhere({ operator: 'And', operands: filters });
      }

      const result = await builder.do();
      const hits = result?.data?.Get?.[CT_COLLECTION] ?? [];

      for (const hit of hits) {
        const id = hit.document_id;
        if (!docMap.has(id)) {
          docMap.set(id, {
            document_id: id,
            doc_name: hit.doc_name,
            source_label: hit.source_label,
            source_url: hit.source_url,
            doc_type: hit.doc_type,
            content_type: hit.content_type,
            doc_date: hit.doc_date,
            total_chunks: hit.total_chunks,
            chunk_count: 0,
          });
        }
        docMap.get(id).chunk_count++;
      }

      if (hits.length < BATCH) {
        keepFetching = false;
      } else {
        chunkOffset += BATCH;
      }
    }

    const allDocs = Array.from(docMap.values());
    const total = allDocs.length;
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const documents = allDocs.slice(start, start + pageSize);

    return jsonResponse({ documents, total, page: safePage, pageSize, totalPages });
  } catch (error) {
    console.error('Admin documents error:', error);
    return errorResponse(500, 'Failed to fetch documents.');
  }
}

// ── GET /api/admin/documents/:id ────────────────────────────

async function handleDocumentDetail(docId) {
  try {
    const result = await weaviateClient.graphql
      .get()
      .withClassName(CT_COLLECTION)
      .withFields('document_id doc_name source_label source_url doc_type content_type section_name chunk_index total_chunks doc_date content')
      .withWhere({
        path: ['document_id'],
        operator: 'Equal',
        valueText: docId,
      })
      .withLimit(500)
      .do();

    const hits = result?.data?.Get?.[CT_COLLECTION] ?? [];
    if (hits.length === 0) {
      return errorResponse(404, 'Document not found.');
    }

    const chunks = hits
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .map((h) => ({
        chunk_index: h.chunk_index,
        section_name: h.section_name,
        content: h.content,
      }));

    const first = hits[0];
    return jsonResponse({
      document_id: first.document_id,
      doc_name: first.doc_name,
      source_label: first.source_label,
      source_url: first.source_url,
      doc_type: first.doc_type,
      content_type: first.content_type,
      doc_date: first.doc_date,
      total_chunks: first.total_chunks,
      chunks,
    });
  } catch (error) {
    console.error('Admin document detail error:', error);
    return errorResponse(500, 'Failed to fetch document.');
  }
}

// ── GET /api/admin/registry ─────────────────────────────────

async function handleRegistry() {
  try {
    const entries = await scanRegistry();
    return jsonResponse({ entries, total: entries.length });
  } catch (error) {
    console.error('Admin registry error:', error);
    return errorResponse(500, 'Failed to read registry.');
  }
}

// ── Lambda handler ──────────────────────────────────────────

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const routePath = event.path || event.resource || event.rawPath || '';
    const params = event.queryStringParameters || {};
    const pathParams = event.pathParameters || {};

    // GET /api/admin/stats
    if (routePath.includes('/stats')) {
      return await handleStats();
    }

    // GET /api/admin/documents/:id  (path parameter)
    if (pathParams.id && routePath.includes('/documents')) {
      return await handleDocumentDetail(pathParams.id);
    }

    // GET /api/admin/documents/:id  (URL pattern match fallback)
    const docIdMatch = routePath.match(/\/documents\/([^/]+)$/);
    if (docIdMatch) {
      return await handleDocumentDetail(docIdMatch[1]);
    }

    // GET /api/admin/documents
    if (routePath.includes('/documents')) {
      return await handleDocuments(params);
    }

    // GET /api/admin/registry
    if (routePath.includes('/registry')) {
      return await handleRegistry();
    }

    return errorResponse(404, `Unknown admin read route: ${routePath}`);
  } catch (error) {
    console.error('Admin read handler error:', error);
    return errorResponse(500, 'Internal server error.');
  }
};
