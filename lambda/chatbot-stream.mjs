// lambda/chatbot-stream.mjs
// SSE streaming handler for POST /api/chatbot and POST /api/generate-plan
// and POST /api/adapt-case-study.
// Uses awslambda.streamifyResponse() for Lambda response streaming.

const LIB_PATH = process.env.AWS_LAMBDA_FUNCTION_NAME ? '/opt/nodejs' : '..';

const { openaiClient } = await import(`${LIB_PATH}/lib/weaviate-client.mjs`);
const { resolveAgentToolCalls } = await import(`${LIB_PATH}/lib/agent-runner.mjs`);
const {
  agentToolDefinitions,
  agentToolImplementations,
  buildSourceDocuments,
} = await import(`${LIB_PATH}/lib/agent-tools.mjs`);
const { formatSSEChunk, formatSSESources, formatSSEDone } = await import(`${LIB_PATH}/lib/sse.mjs`);
const {
  CHATBOT_PROMPT,
  GENERATE_PLAN_PROMPT,
  ADAPT_CASE_STUDY_PROMPT,
  EVALUATE_COACHING_PROMPT,
} = await import(`${LIB_PATH}/prompts/load.mjs`);

const MODEL = process.env.CHATBOT_MODEL || 'gpt-5.1';
const MAX_ITERATIONS = 5;


// ── Shared helpers ──────────────────────────────────────────

function collectSourcesFromMessages(messages) {
  const sources = [];
  for (const msg of messages) {
    if (msg.role !== 'tool') continue;
    try {
      const data = JSON.parse(msg.content);
      if (data.results) sources.push(...data.results);
      if (data.chunks) sources.push(...data.chunks);
    } catch { /* skip non-JSON */ }
  }
  return sources;
}

function parseCoachingContext(prefixText) {
  const extract = (label) => {
    const re = new RegExp(`${label}:\\s*"?([^"\\n]+)"?`);
    const match = prefixText.match(re);
    return match ? match[1].trim() : '';
  };
  return {
    question: extract('NESTA QUESTION'),
    userResponse: extract("USER'S ORIGINAL RESPONSE"),
    status: extract('ASSESSMENT STATUS'),
    gap: extract('IDENTIFIED GAP'),
  };
}

function evaluateCoachingInBackground(coachingMeta, evalConversation) {
  const conversationText = evalConversation
    .map((m) => `${m.role === 'coach' ? 'COACH' : 'PRACTITIONER'}: ${m.content}`)
    .join('\n\n');

  const evalUserMessage = [
    'Evaluate the following coaching conversation:',
    '',
    '## Context',
    `**Nesta Question:** ${coachingMeta.question}`,
    `**Practitioner's Original Response:** ${coachingMeta.userResponse}`,
    `**Assessment Status:** ${coachingMeta.status}`,
    `**Identified Gap:** ${coachingMeta.gap || 'None'}`,
    '',
    '## Coaching Conversation',
    conversationText,
    '',
    'Evaluate this coaching conversation using the rubric and return structured JSON.',
  ].join('\n');

  openaiClient.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: EVALUATE_COACHING_PROMPT },
      { role: 'user', content: evalUserMessage },
    ],
    temperature: 0,
  }).then((evalResponse) => {
    const evalText = evalResponse.choices[0]?.message?.content || '';
    const cleaned = evalText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    console.log(`[coaching-eval] Score: ${parsed.overall_score}/100`);
  }).catch((err) => {
    console.error('[coaching-eval] Evaluation failed:', err.message);
  });
}

// ── Plan formatting helpers ─────────────────────────────────

function resolveOther(val, otherVal) {
  return val === 'Other' && otherVal ? `Other: "${otherVal}"` : val;
}

function resolveArrayOther(arr, otherVal) {
  return (arr || [])
    .map((v) => (v === 'Other' && otherVal ? `Other: "${otherVal}"` : v))
    .join('; ');
}

function formatPlanUserContext(ctx, followUpAnswers) {
  const lines = [
    `Generate an engagement plan based on the following questionnaire responses:`,
    ``,
    `## Questionnaire Answers`,
    `- **Issue Area:** ${resolveOther(ctx.issueArea, ctx.issueAreaOther)}`,
    `- **Primary Goal:** ${resolveOther(ctx.primaryGoal, ctx.primaryGoalOther)}`,
    `- **Target Audience:** ${resolveArrayOther(ctx.audience, ctx.audienceOther)}`,
    `- **Timeline:** ${ctx.timeline}`,
    `- **Available Resources:** ${resolveArrayOther(ctx.resources, ctx.resourcesOther)}`,
    `- **Biggest Constraint:** ${resolveOther(ctx.biggestConstraint, ctx.biggestConstraintOther)}`,
    `- **AI Comfort Level:** ${ctx.aiComfort}`,
    `- **Success Criteria:** ${resolveOther(ctx.successLooksLike, ctx.successOther)}`,
    `- **Stuck Point:** ${resolveOther(ctx.stuckPoint, ctx.stuckPointOther)}`,
    `- **Process Stage:** ${ctx.processStage}`,
  ];

  if (ctx.processStage && ctx.processStage.toLowerCase().includes('mid')) {
    lines.push(
      ``,
      `> The user is MID-PROCESS. Phase 1 should be "Assessment & Course Correction" rather than initial design.`,
    );
  }

  if (ctx.existingWork) {
    lines.push(``, `## Existing Work`, ctx.existingWork);
  }

  const mergedFollowUps = {
    ...(ctx.followUpAnswers || {}),
    ...(followUpAnswers || {}),
  };

  if (Object.keys(mergedFollowUps).length > 0) {
    lines.push(``, `## Follow-Up Clarifications`);
    for (const [qId, answer] of Object.entries(mergedFollowUps)) {
      lines.push(`- **${qId}:** ${answer}`);
    }
  }

  lines.push(
    ``,
    `Please search the knowledge base for engagement methods, case studies, and constraint-specific strategies relevant to this situation, then produce a comprehensive engagement plan grounded in evidence.`,
  );

  return lines.join('\n');
}

// ── Adapt case study formatting helper ──────────────────────

function formatAdaptRequest(caseStudy, context, constraints) {
  const lines = [
    `I want to adapt the following case study to my situation:`,
    ``,
    `## Reference Case Study`,
    `- **Title:** ${caseStudy.title}`,
    `- **Location:** ${caseStudy.location}`,
    `- **Timeframe:** ${caseStudy.timeframe}`,
    `- **Size:** ${caseStudy.size}`,
    `- **Demographic:** ${caseStudy.demographic}`,
    `- **Tags:** ${(caseStudy.tags || []).join(', ')}`,
  ];

  if (caseStudy.description) {
    lines.push(`- **Description:** ${caseStudy.description}`);
  }

  if (caseStudy.keyOutcomes?.length) {
    lines.push(``, `**Key Outcomes:**`);
    caseStudy.keyOutcomes.forEach((o) => lines.push(`- ${o}`));
  }

  if (caseStudy.implementationSteps?.length) {
    lines.push(``, `**Implementation Steps:**`);
    caseStudy.implementationSteps.forEach((s) => lines.push(`- ${s}`));
  }

  lines.push(
    ``,
    `## My Situation`,
    context,
    ``,
    `## My Constraints`,
    constraints || 'No specific constraints mentioned.',
    ``,
    `Please search the knowledge base for the original case study and related resources, then produce an adapted plan grounded in evidence.`,
  );

  return lines.join('\n');
}

// ── Core streaming logic ────────────────────────────────────

async function resolveAndStream(responseStream, messages) {
  const encoder = new TextEncoder();

  const { messages: resolved, earlyContent } = await resolveAgentToolCalls({
    tools: agentToolDefinitions,
    toolImpls: agentToolImplementations,
    model: MODEL,
    maxIterations: MAX_ITERATIONS,
    messages,
  });

  let fullContent = '';

  if (earlyContent) {
    fullContent = earlyContent;
    responseStream.write(encoder.encode(formatSSEChunk(earlyContent)));
  } else {
    const stream = await openaiClient.chat.completions.create({
      model: MODEL,
      messages: resolved,
      stream: true,
    });
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content || '';
      if (content) {
        fullContent += content;
        responseStream.write(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
      }
    }
  }

  const allSources = collectSourcesFromMessages(resolved);
  if (allSources.length > 0) {
    responseStream.write(encoder.encode(formatSSESources(buildSourceDocuments(allSources))));
  }

  responseStream.write(encoder.encode(formatSSEDone()));
  responseStream.end();

  return fullContent;
}

// ── Route dispatch ──────────────────────────────────────────

async function handleChatbot(body) {
  const { message, conversation } = body;

  if (!message) {
    return { error: true, statusCode: 400, message: 'Missing "message" in request body.' };
  }

  const messages = [{ role: 'system', content: CHATBOT_PROMPT }];

  if (Array.isArray(conversation)) {
    messages.push(
      ...conversation.slice(0, -1).flatMap((m) => {
        if (m.type === 'user') return { role: 'user', content: m.content };
        if (m.type === 'bot') return { role: 'assistant', content: m.content };
        return [];
      }),
    );
  }

  messages.push({ role: 'user', content: message });

  return { error: false, messages, conversation };
}

function handleChatbotPostStream(body, fullContent) {
  const { conversation } = body;
  // Fire-and-forget coaching evaluation
  const contextEntry = Array.isArray(conversation)
    && conversation.find((m) => m.content?.includes('[COACHING CONTEXT'));
  if (contextEntry) {
    const coachingMeta = parseCoachingContext(contextEntry.content);

    const evalConversation = [];
    for (const m of conversation.slice(1)) {
      evalConversation.push({
        role: m.type === 'bot' ? 'coach' : 'user',
        content: m.content,
      });
    }
    if (fullContent) {
      evalConversation.push({ role: 'coach', content: fullContent });
    }

    evaluateCoachingInBackground(coachingMeta, evalConversation);
  }
}

function handleGeneratePlan(body) {
  const { userContext, followUpAnswers } = body;

  if (!userContext) {
    return { error: true, statusCode: 400, message: 'Missing required field: userContext.' };
  }

  const userMessage = formatPlanUserContext(userContext, followUpAnswers);
  const messages = [
    { role: 'system', content: GENERATE_PLAN_PROMPT },
    { role: 'user', content: userMessage },
  ];

  return { error: false, messages };
}

function handleAdaptCaseStudy(body) {
  const { caseStudy, context, constraints } = body;

  if (!caseStudy || !context) {
    return { error: true, statusCode: 400, message: 'Missing required fields: caseStudy, context.' };
  }

  const userMessage = formatAdaptRequest(caseStudy, context, constraints);
  const messages = [
    { role: 'system', content: ADAPT_CASE_STUDY_PROMPT },
    { role: 'user', content: userMessage },
  ];

  return { error: false, messages };
}

// ── Lambda handler (streaming) ──────────────────────────────

export const handler = awslambda.streamifyResponse(
  async (event, responseStream, _context) => {
    // Set SSE headers via metadata prelude
    const metadata = {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    };

    responseStream = awslambda.HttpResponseStream.from(responseStream, metadata);
    const encoder = new TextEncoder();

    try {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      const routePath = event.path || event.resource || event.rawPath || '';

      let result;

      if (routePath.includes('/generate-plan')) {
        result = handleGeneratePlan(body);
      } else if (routePath.includes('/adapt-case-study')) {
        result = handleAdaptCaseStudy(body);
      } else {
        // Default: /api/chatbot
        result = await handleChatbot(body);
      }

      if (result.error) {
        responseStream.write(encoder.encode(`data: ${JSON.stringify({ error: result.message })}\n\n`));
        responseStream.write(encoder.encode(formatSSEDone()));
        responseStream.end();
        return;
      }

      const fullContent = await resolveAndStream(responseStream, result.messages);

      // Post-stream background work for chatbot
      if (!routePath.includes('/generate-plan') && !routePath.includes('/adapt-case-study')) {
        handleChatbotPostStream(body, fullContent);
      }
    } catch (error) {
      console.error('Streaming handler error:', error);
      responseStream.write(encoder.encode(`data: ${JSON.stringify({ error: 'An error occurred processing your message.' })}\n\n`));
      responseStream.write(encoder.encode(formatSSEDone()));
      responseStream.end();
    }
  },
);
