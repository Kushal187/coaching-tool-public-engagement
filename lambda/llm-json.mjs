// lambda/llm-json.mjs
// Single OpenAI call handler for:
//   POST /api/analyze-cross-resolution
//   POST /api/admin/classify

const LIB_PATH = process.env.AWS_LAMBDA_FUNCTION_NAME ? '/opt/nodejs' : '..';

const { openaiClient } = await import(`${LIB_PATH}/lib/weaviate-client.mjs`);
const {
  CROSS_RESOLUTION_PROMPT,
  CLASSIFY_SYSTEM,
} = await import(`${LIB_PATH}/prompts/load.mjs`);

const MODEL = process.env.CHATBOT_MODEL || 'gpt-5.1';
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

// ── /api/analyze-cross-resolution ───────────────────────────

async function handleCrossResolution(body) {
  const { conversation, currentQuestionId, currentQuestion, unresolvedCards } = body;

  if (!Array.isArray(conversation) || !currentQuestion) {
    return jsonResponse({ resolvedQuestionIds: [], currentQuestionResolved: false });
  }

  try {
    const transcript = conversation
      .map((m) => `${m.role === 'user' ? 'PRACTITIONER' : 'COACH'}: ${m.content}`)
      .join('\n\n');

    const messageParts = [
      `## Current Coaching Conversation (Question ${currentQuestionId})`,
      '',
      transcript,
      '',
      `## Current Question`,
      `- Question ${currentQuestionId}: "${currentQuestion.question}" | Gap: "${currentQuestion.gap}"`,
      '',
    ];

    const hasOtherCards = Array.isArray(unresolvedCards) && unresolvedCards.length > 0;
    if (hasOtherCards) {
      const cardsList = unresolvedCards
        .map((c) => `- Question ${c.questionId}: "${c.question}" | Gap: "${c.gap}"`)
        .join('\n');
      messageParts.push('## Other Unresolved Assessment Cards', '', cardsList, '');
    }

    messageParts.push(
      'Has the conversation substantively resolved the current question\'s gap? ' +
      (hasOtherCards ? 'Which of the other cards (if any) has it also resolved? ' : '') +
      'Return JSON.',
    );

    const userMessage = messageParts.join('\n');

    const response = await openaiClient.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: CROSS_RESOLUTION_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
    });

    const text = (response.choices[0]?.message?.content || '').trim();
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const currentResolved = parsed.currentQuestionResolved === true;
    const ids = (parsed.resolvedQuestionIds || []).filter(
      (id) => typeof id === 'number' && id !== currentQuestionId,
    );

    console.log(`[cross-resolution] Q${currentQuestionId} -> self-resolved: ${currentResolved}, resolved others: [${ids.join(', ')}]`);
    return jsonResponse({ resolvedQuestionIds: ids, currentQuestionResolved: currentResolved });
  } catch (err) {
    console.error('[cross-resolution] Analysis failed:', err.message);
    return jsonResponse({ resolvedQuestionIds: [], currentQuestionResolved: false });
  }
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
    const routePath = event.path || event.resource || event.rawPath || '';

    if (routePath.includes('/analyze-cross-resolution')) {
      return await handleCrossResolution(body);
    }
    if (routePath.includes('/classify')) {
      return await handleClassify(body);
    }

    return errorResponse(404, `Unknown route: ${routePath}`);
  } catch (error) {
    console.error('LLM JSON handler error:', error);
    return errorResponse(500, 'Internal server error.');
  }
};
