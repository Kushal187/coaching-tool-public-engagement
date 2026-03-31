// lambda/admin-ingest.mjs
// POST handlers for admin ingest endpoints:
//   POST /api/admin/ingest/text
//   POST /api/admin/ingest/url
//   POST /api/admin/ingest/pdf/confirm

const LIB_PATH = process.env.AWS_LAMBDA_FUNCTION_NAME ? '/opt/nodejs' : '..';

// Only need weaviate-client for re-exports (openaiClient unused here)
// but we import it to ensure secrets are loaded
await import(`${LIB_PATH}/lib/weaviate-client.mjs`);

// DynamoDB for registry, Step Functions for pipeline
let dynamoDb;
let sfnClient;
const REGISTRY_TABLE = process.env.REGISTRY_TABLE || 'CoachingToolRegistry';
const PIPELINE_STATE_MACHINE_ARN = process.env.PIPELINE_STATE_MACHINE_ARN || '';

if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  const client = new DynamoDBClient({});
  dynamoDb = DynamoDBDocumentClient.from(client);

  const { SFNClient } = await import('@aws-sdk/client-sfn');
  sfnClient = new SFNClient({});
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

async function writeRegistryEntry(entry) {
  if (!dynamoDb) {
    console.warn('DynamoDB not available; skipping registry write.');
    return;
  }
  const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
  await dynamoDb.send(new PutCommand({
    TableName: REGISTRY_TABLE,
    Item: entry,
  }));
}

async function startPipelineExecution(input) {
  if (!sfnClient || !PIPELINE_STATE_MACHINE_ARN) {
    console.warn('Step Functions not configured; skipping pipeline trigger.');
    return { executionArn: null };
  }
  const { StartExecutionCommand } = await import('@aws-sdk/client-sfn');
  const result = await sfnClient.send(new StartExecutionCommand({
    stateMachineArn: PIPELINE_STATE_MACHINE_ARN,
    input: JSON.stringify(input),
    name: `ingest-${Date.now()}`,
  }));
  return { executionArn: result.executionArn };
}

// ── POST /api/admin/ingest/text ─────────────────────────────

async function handleIngestText(body) {
  try {
    const { name, source, source_url, doc_date, content_type, content } = body;

    if (!name || !source || !content) {
      return errorResponse(400, 'Missing required fields: name, source, content.');
    }

    const entryId = `${slugify(source)}/${slugify(name)}`;
    const entry = {
      id: entryId,
      name,
      source,
      source_url: source_url || '',
      doc_date: doc_date || '',
      content_type: content_type || undefined,
      content,
      format: 'markdown',
      created_at: new Date().toISOString(),
    };

    await writeRegistryEntry(entry);

    // Trigger pipeline for this entry
    let pipelineResult;
    try {
      pipelineResult = await startPipelineExecution({
        mode: 'single',
        registryId: entryId,
        source: 'registry',
      });
    } catch (err) {
      console.warn('Pipeline trigger failed:', err.message);
      pipelineResult = { success: false, error: err.message };
    }

    return jsonResponse({
      success: true,
      registryPath: entryId,
      pipeline: pipelineResult,
    });
  } catch (error) {
    console.error('Admin ingest text error:', error);
    return errorResponse(500, 'Failed to ingest text.');
  }
}

// ── POST /api/admin/ingest/url ──────────────────────────────

async function handleIngestUrl(body) {
  try {
    const { url } = body;

    if (!url) {
      return errorResponse(400, 'Missing required field: url.');
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CoachingTool/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain,*/*',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return errorResponse(400, `Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const contentTypeHeader = (response.headers.get('content-type') || '').toLowerCase();
    const isPdf = contentTypeHeader.includes('application/pdf') || url.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      // In Lambda, PDF conversion is handled by the pipeline.
      // Return the URL info so the frontend can use the pdf/confirm flow.
      const urlPath = new URL(url).pathname;
      const urlFilename = urlPath.split('/').pop()?.replace(/\.pdf$/i, '') || 'url-download';
      const suggestedTitle = urlFilename.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      return jsonResponse({
        success: true,
        url,
        suggestedTitle,
        extractedContent: '',
        contentLength: 0,
        format: 'pdf',
        message: 'PDF detected. Use the PDF ingest flow for conversion.',
      });
    }

    // HTML / plain text URL: extract text from markup
    const html = await response.text();

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const suggestedTitle = titleMatch
      ? titleMatch[1].replace(/\s*[|–—-]\s*.+$/, '').trim()
      : '';

    return jsonResponse({
      success: true,
      url,
      suggestedTitle,
      extractedContent: text,
      contentLength: text.length,
      format: 'html',
    });
  } catch (error) {
    console.error('Admin ingest URL error:', error);
    const message = error.name === 'TimeoutError'
      ? 'URL fetch timed out after 30 seconds.'
      : 'Failed to fetch URL content.';
    return errorResponse(500, message);
  }
}

// ── POST /api/admin/ingest/pdf/confirm ──────────────────────

async function handleIngestPdfConfirm(body) {
  try {
    const { name, source, source_url, doc_date, content_type, content, pdfPath } = body;

    if (!name || !content) {
      return errorResponse(400, 'Name and content are required.');
    }

    const entryId = `${slugify(source || 'pdf-upload')}/${slugify(name)}`;
    const entry = {
      id: entryId,
      name,
      source: source || 'PDF Upload',
      source_url: source_url || '',
      doc_date: doc_date || '',
      content_type: content_type || undefined,
      content,
      format: 'markdown',
      pdf_path: pdfPath || '',
      created_at: new Date().toISOString(),
    };

    await writeRegistryEntry(entry);
    console.log(`[pdf/confirm] Registry entry: ${entryId}`);

    let pipelineResult;
    try {
      pipelineResult = await startPipelineExecution({
        mode: 'single',
        registryId: entryId,
        source: 'registry',
      });
      console.log(`[pdf/confirm] Pipeline triggered.`);
    } catch (pipeErr) {
      console.warn('[pdf/confirm] Pipeline failed:', pipeErr.message);
      pipelineResult = { success: false, error: pipeErr.message };
    }

    return jsonResponse({
      success: true,
      registryPath: entryId,
      pdfPath,
      pipeline: pipelineResult,
    });
  } catch (error) {
    console.error('PDF confirm error:', error);
    return errorResponse(500, 'Failed to ingest document.');
  }
}

// ── Lambda handler ──────────────────────────────────────────

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
    const routePath = event.path || event.resource || event.rawPath || '';

    if (routePath.includes('/ingest/text')) {
      return await handleIngestText(body);
    }
    if (routePath.includes('/ingest/url')) {
      return await handleIngestUrl(body);
    }
    if (routePath.includes('/ingest/pdf/confirm')) {
      return await handleIngestPdfConfirm(body);
    }

    return errorResponse(404, `Unknown ingest route: ${routePath}`);
  } catch (error) {
    console.error('Admin ingest handler error:', error);
    return errorResponse(500, 'Internal server error.');
  }
};
