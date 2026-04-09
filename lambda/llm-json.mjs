// lambda/llm-json.mjs
//
// Single OpenAI call handler for:
//   POST /api/admin/classify  (live — invoked by the admin pipeline UI)
//
// The /api/analyze-cross-resolution route used to be served by this handler,
// but it was retired along with its prompt (cross-resolution.txt). It has no
// remaining frontend caller — requests to that path now return HTTP 410 Gone
// from this handler.

const LIB_PATH = process.env.AWS_LAMBDA_FUNCTION_NAME ? '/opt/nodejs' : '..';

const { openaiClient } = await import(`${LIB_PATH}/lib/weaviate-client.mjs`);
const { CLASSIFY_SYSTEM } = await import(`${LIB_PATH}/prompts/load.mjs`);

const CLASSIFY_MODEL = process.env.CLASSIFY_MODEL || 'gpt-5.1-mini';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

// ── /api/admin/classify ─────────────────────────────────────

async function handleClassify(body) {
  const { name, source, content } = body;
  if (!content || content.length < 30) {
    return errorResponse(400, 'Content too short to classify.');
  }

  try {
    const excerpt = content.slice(0, 2000);
    const prompt = `Document name: ${name || '(unknown)'}\nSource: ${source || '(unknown)'}\n\nContent excerpt:\n${excerpt}`;

    const resp = await openaiClient.chat.completions.create({
      model: CLASSIFY_MODEL,
      messages: [
        { role: 'system', content: CLASSIFY_SYSTEM },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    });

    const raw = resp.choices[0].message.content.trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const ctMatch = raw.match(/"content_type"\s*:\s*"([^"]+)"/);
      const sumMatch = raw.match(/"summary"\s*:\s*"([^"]+)"/);
      parsed = {
        content_type: ctMatch?.[1] || 'other',
        summary: sumMatch?.[1] || '',
      };
    }

    const validTypes = [
      'case_study', 'transcript', 'blog_post', 'journal_article',
      'report', 'guide', 'policy_brief', 'lecture', 'tool_or_resource', 'other',
    ];
    if (!validTypes.includes(parsed.content_type)) {
      parsed.content_type = 'other';
    }

    return jsonResponse(parsed);
  } catch (error) {
    console.error('Classify error:', error);
    return errorResponse(500, 'Classification failed.');
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
    const routePath = body._route || event.path || event.resource || event.rawPath || '';

    if (routePath.includes('/classify')) {
      return await handleClassify(body);
    }

    // /api/analyze-cross-resolution was retired along with its prompt; return
    // a clear signal to any caller that still hits this path.
    if (routePath.includes('/analyze-cross-resolution')) {
      return {
        statusCode: 410,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Endpoint retired',
          message: 'The /api/analyze-cross-resolution endpoint has been retired. Cross-question resolution is now handled inside the unified /api/chat coaching interface.',
        }),
      };
    }

    return errorResponse(404, `Unknown route: ${routePath}`);
  } catch (error) {
    console.error('LLM JSON handler error:', error);
    return errorResponse(500, 'Internal server error.');
  }
};
