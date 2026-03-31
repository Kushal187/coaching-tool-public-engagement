// lambda/admin-write.mjs
// Write handlers for admin endpoints:
//   DELETE /api/admin/documents/:id
//   POST   /api/admin/registry

const LIB_PATH = process.env.AWS_LAMBDA_FUNCTION_NAME ? '/opt/nodejs' : '..';

const { weaviateClient } = await import(`${LIB_PATH}/lib/weaviate-client.mjs`);

// DynamoDB for registry in Lambda
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
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
};

// ── Helpers ─────────────────────────────────────────────────

function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'untitled';
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

// ── DELETE /api/admin/documents/:id ─────────────────────────

async function handleDeleteDocument(docId) {
  try {
    // Delete from CoachingTool
    try {
      await weaviateClient.batch
        .objectsBatchDeleter()
        .withClassName(CT_COLLECTION)
        .withWhere({
          path: ['document_id'],
          operator: 'Equal',
          valueText: docId,
        })
        .do();
    } catch (err) {
      console.warn(`Failed to delete from ${CT_COLLECTION}:`, err.message);
    }

    // Delete from CaseStudyLibrary if present
    try {
      await weaviateClient.batch
        .objectsBatchDeleter()
        .withClassName(CS_COLLECTION)
        .withWhere({
          path: ['document_id'],
          operator: 'Equal',
          valueText: docId,
        })
        .do();
    } catch (err) {
      console.warn(`Failed to delete from ${CS_COLLECTION}:`, err.message);
    }

    return jsonResponse({ success: true, deleted: docId });
  } catch (error) {
    console.error('Admin delete error:', error);
    return errorResponse(500, 'Failed to delete document.');
  }
}

// ── POST /api/admin/registry ────────────────────────────────

async function handleCreateRegistryEntry(body) {
  try {
    const { name, source, source_url, doc_date, content_type, content, format } = body;

    if (!name || !source || !content) {
      return errorResponse(400, 'Missing required fields: name, source, content.');
    }

    const entry = {
      id: `${slugify(source)}/${slugify(name)}`,
      name,
      source,
      source_url: source_url || '',
      doc_date: doc_date || '',
      content_type: content_type || undefined,
      content,
      format: format || 'markdown',
      created_at: new Date().toISOString(),
    };

    if (dynamoDb) {
      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
      await dynamoDb.send(new PutCommand({
        TableName: REGISTRY_TABLE,
        Item: entry,
      }));
    }

    return jsonResponse({
      success: true,
      path: entry.id,
      entry,
    });
  } catch (error) {
    console.error('Admin registry create error:', error);
    return errorResponse(500, 'Failed to create registry entry.');
  }
}

// ── Lambda handler ──────────────────────────────────────────

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const httpMethod = event.httpMethod || event.requestContext?.http?.method || '';
    const routePath = event.path || event.resource || event.rawPath || '';
    const pathParams = event.pathParameters || {};

    // DELETE /api/admin/documents/:id
    if (httpMethod === 'DELETE') {
      const docId = pathParams.id || routePath.match(/\/documents\/([^/]+)$/)?.[1];
      if (!docId) {
        return errorResponse(400, 'Missing document ID.');
      }
      return await handleDeleteDocument(docId);
    }

    // POST /api/admin/registry
    if (httpMethod === 'POST' && routePath.includes('/registry')) {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
      return await handleCreateRegistryEntry(body);
    }

    return errorResponse(404, `Unknown admin write route: ${httpMethod} ${routePath}`);
  } catch (error) {
    console.error('Admin write handler error:', error);
    return errorResponse(500, 'Internal server error.');
  }
};
