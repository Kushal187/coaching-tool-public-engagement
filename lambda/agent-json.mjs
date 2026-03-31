// lambda/agent-json.mjs
// Non-streaming agent loop handler for:
//   POST /api/generate-questions
//   POST /api/generate-scenario-responses
//   POST /api/evaluate-assessment
//   POST /api/generate-reflection

const LIB_PATH = process.env.AWS_LAMBDA_FUNCTION_NAME ? '/opt/nodejs' : '..';

const { runAgentLoop } = await import(`${LIB_PATH}/lib/agent-runner.mjs`);
const {
  agentToolDefinitions,
  agentToolImplementations,
} = await import(`${LIB_PATH}/lib/agent-tools.mjs`);
const {
  GENERATE_QUESTIONS_PROMPT,
  GENERATE_SCENARIO_PROMPT,
  SCENARIO_DESCRIPTIONS,
  EVALUATE_ASSESSMENT_PROMPT,
  GENERATE_REFLECTION_PROMPT,
} = await import(`${LIB_PATH}/prompts/load.mjs`);

const MODEL = process.env.CHATBOT_MODEL || 'gpt-5.1';
const MAX_ITERATIONS = 5;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Nesta questions ─────────────────────────────────────────

const NESTA_QUESTIONS = [
  { id: 1, question: "Have you articulated the project's goals?" },
  { id: 2, question: 'Have you identified the right participants?' },
  { id: 3, question: 'Can you reach the participants you identified?' },
  { id: 4, question: 'Who is the right owner?' },
  { id: 5, question: 'Have you included incentives for participation?' },
  { id: 6, question: 'Have you defined the tasks?' },
  { id: 7, question: 'Have you established the workflow?' },
  { id: 8, question: 'How will you evaluate inputs?' },
  { id: 9, question: 'How will you use what the group creates?' },
];

// ── Helpers ─────────────────────────────────────────────────

function resolveOther(val, otherVal) {
  return val === 'Other' && otherVal ? `Other: "${otherVal}"` : val;
}

function resolveArrayOther(arr, otherVal) {
  return (arr || [])
    .map((v) => (v === 'Other' && otherVal ? `Other: "${otherVal}"` : v))
    .join('; ');
}

function cleanJsonResponse(text) {
  return (text || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
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

// ── /api/generate-questions ─────────────────────────────────

function formatQuestionsUserContext(ctx) {
  const lines = [
    `Here are the user's questionnaire responses:`,
    ``,
    `Q1 - Issue Area: ${resolveOther(ctx.issueArea, ctx.issueAreaOther)}`,
    `Q2 - Primary Goal: ${resolveOther(ctx.primaryGoal, ctx.primaryGoalOther)}`,
    `Q3 - Target Audience: ${resolveArrayOther(ctx.audience || [], ctx.audienceOther)}`,
    `Q4 - Timeline: ${ctx.timeline}`,
    `Q5 - Available Resources: ${resolveArrayOther(ctx.resources || [], ctx.resourcesOther)}`,
    `Q6 - Biggest Constraint: ${resolveOther(ctx.biggestConstraint, ctx.biggestConstraintOther)}`,
    `Q7 - AI Comfort Level: ${ctx.aiComfort}`,
    `Q8 - Success Criteria: ${resolveOther(ctx.successLooksLike, ctx.successOther)}`,
    `Q9 - Stuck Point: ${resolveOther(ctx.stuckPoint, ctx.stuckPointOther)}`,
    `Q10 - Process Stage: ${ctx.processStage}`,
  ];

  if (ctx.existingWork) {
    lines.push(``, `Existing Work Description: ${ctx.existingWork}`);
  }

  const hasOtherSelections = [
    ctx.issueArea, ctx.primaryGoal, ctx.biggestConstraint,
    ctx.successLooksLike, ctx.stuckPoint,
  ].includes('Other') || (ctx.audience || []).includes('Other') || (ctx.resources || []).includes('Other');

  if (hasOtherSelections) {
    lines.push(
      ``,
      `NOTE: The user selected "Other" for one or more questions. Pay special attention to these custom inputs and search the knowledge base to understand the context better.`,
    );
  }

  lines.push(
    ``,
    `Review these answers and determine if any follow-up questions are needed before generating their engagement plan.`,
  );

  return lines.join('\n');
}

async function handleGenerateQuestions(body) {
  try {
    const userMessage = formatQuestionsUserContext(body);

    const result = await runAgentLoop({
      systemPrompt: GENERATE_QUESTIONS_PROMPT,
      userMessage,
      tools: agentToolDefinitions,
      toolImpls: agentToolImplementations,
      model: MODEL,
      maxIterations: MAX_ITERATIONS,
    });

    let parsed;
    try {
      parsed = JSON.parse(cleanJsonResponse(result));
    } catch {
      console.error('Failed to parse agent response as JSON:', result);
      parsed = { needsFollowUp: false, questions: [] };
    }

    if (!Array.isArray(parsed.questions)) {
      parsed.questions = [];
    }

    return jsonResponse(parsed);
  } catch (error) {
    console.error('Error generating follow-up questions:', error);
    return jsonResponse({ needsFollowUp: false, questions: [] });
  }
}

// ── /api/generate-scenario-responses ────────────────────────

async function handleGenerateScenarioResponses(body) {
  const { scenario, customDescription } = body;

  if (!scenario) {
    return errorResponse(400, 'Missing required field: scenario.');
  }

  const description = scenario === 'custom'
    ? customDescription
    : SCENARIO_DESCRIPTIONS[scenario];

  if (!description) {
    return errorResponse(400, 'Invalid scenario or missing custom description.');
  }

  try {
    const questionsContext = NESTA_QUESTIONS
      .map((q) => `Question ${q.id}: ${q.question}`)
      .join('\n');

    const userMessage = [
      `Generate realistic practitioner responses for the following scenario:`,
      ``,
      `## Scenario`,
      description,
      ``,
      `## Questions to Answer`,
      questionsContext,
      ``,
      `Search the knowledge base for relevant engagement contexts to make the responses feel authentic, then generate the 9 responses in the required JSON format.`,
    ].join('\n');

    const result = await runAgentLoop({
      systemPrompt: GENERATE_SCENARIO_PROMPT,
      userMessage,
      tools: agentToolDefinitions,
      toolImpls: agentToolImplementations,
      model: MODEL,
      maxIterations: MAX_ITERATIONS,
    });

    let parsed;
    try {
      parsed = JSON.parse(cleanJsonResponse(result));
    } catch {
      console.error('Failed to parse scenario response as JSON:', result);
      return errorResponse(500, 'Failed to parse generated responses.');
    }

    if (!parsed.responses || typeof parsed.responses !== 'object') {
      return errorResponse(500, 'Invalid response format.');
    }

    return jsonResponse(parsed);
  } catch (error) {
    console.error('Error generating scenario responses:', error);
    return errorResponse(500, 'Failed to generate scenario responses.');
  }
}

// ── /api/evaluate-assessment ────────────────────────────────

async function handleEvaluateAssessment(body) {
  const { responses } = body;

  if (!responses || typeof responses !== 'object') {
    return errorResponse(400, 'Missing required field: responses.');
  }

  try {
    const lines = [
      'Evaluate the following responses to the 9 Nesta framework questions for public engagement:',
      '',
    ];

    for (const q of NESTA_QUESTIONS) {
      const answer = responses[q.id] || '(No response provided)';
      lines.push(`## Question ${q.id}: ${q.question}`);
      lines.push(`**Response:** ${answer}`);
      lines.push('');
    }

    lines.push('Please evaluate each response and return structured JSON with your assessment.');

    const userMessage = lines.join('\n');

    const result = await runAgentLoop({
      systemPrompt: EVALUATE_ASSESSMENT_PROMPT,
      userMessage,
      tools: agentToolDefinitions,
      toolImpls: agentToolImplementations,
      model: MODEL,
      maxIterations: MAX_ITERATIONS,
    });

    let parsed;
    try {
      parsed = JSON.parse(cleanJsonResponse(result));
    } catch {
      console.error('Failed to parse evaluation response as JSON:', result);
      return errorResponse(500, 'Failed to parse evaluation.');
    }

    if (!parsed.evaluations || !Array.isArray(parsed.evaluations)) {
      return errorResponse(500, 'Invalid evaluation format.');
    }

    return jsonResponse(parsed);
  } catch (error) {
    console.error('Error evaluating assessment:', error);
    return errorResponse(500, 'Failed to evaluate assessment.');
  }
}

// ── /api/generate-reflection ────────────────────────────────

async function handleGenerateReflection(body) {
  const { responses, evaluations, chatHistories } = body;

  if (!responses || !evaluations) {
    return errorResponse(400, 'Missing required fields: responses, evaluations.');
  }

  try {
    const lines = [
      'Generate an in-depth reflection for the following Nesta framework self-assessment and coaching journey.',
      '',
      '## User Responses, Evaluations, and Coaching Conversations',
      '',
    ];

    for (const q of NESTA_QUESTIONS) {
      const answer = responses[q.id] || '(No response provided)';
      const evaluation = evaluations.find((e) => e.questionId === q.id);
      lines.push(`### Question ${q.id}: ${q.question}`);
      lines.push(`**User's Response:** ${answer}`);
      if (evaluation) {
        lines.push(`**Current Status:** ${evaluation.status}`);
        if (evaluation.gap) lines.push(`**Identified Gap:** ${evaluation.gap}`);
      }

      const chat = chatHistories?.[q.id];
      const userMessages = chat?.filter((m) => m.role === 'user') || [];
      const isResolved = evaluation?.status === 'addressed';

      if (chat && chat.length > 1 && userMessages.length > 0) {
        if (isResolved) {
          lines.push('**Coaching:** PRODUCTIVE CONVERSATION — The user engaged with the coach and resolved this item.');
        } else {
          lines.push('**Coaching:** UNRESOLVED WITH ACTIVE CONVERSATION — The user engaged with the coach but has not yet resolved this item.');
        }
        lines.push('**Conversation Summary:**');
        for (const msg of chat) {
          if (msg.role === 'user') {
            lines.push(`  User: ${msg.content}`);
          } else if (msg.role === 'assistant') {
            const preview = msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content;
            lines.push(`  Coach: ${preview}`);
          }
        }
      } else if (isResolved) {
        lines.push('**Coaching:** RESOLVED WITHOUT CONVERSATION — The user marked this as resolved without engaging in a coaching conversation.');
      } else {
        lines.push('**Coaching:** NO COACHING SESSION — No conversation occurred and this item remains unresolved.');
      }

      lines.push('');
    }

    lines.push('Please produce a comprehensive, evidence-grounded reflection in the required JSON format. Factor in the coaching conversations — acknowledge growth, flag skipped coaching, and note unresolved items.');

    const userMessage = lines.join('\n');

    const result = await runAgentLoop({
      systemPrompt: GENERATE_REFLECTION_PROMPT,
      userMessage,
      tools: agentToolDefinitions,
      toolImpls: agentToolImplementations,
      model: MODEL,
      maxIterations: MAX_ITERATIONS,
    });

    let parsed;
    try {
      parsed = JSON.parse(cleanJsonResponse(result));
    } catch {
      console.error('Failed to parse reflection response as JSON:', result);
      return errorResponse(500, 'Failed to parse reflection.');
    }

    if (!parsed.reflection) {
      return errorResponse(500, 'Invalid reflection format.');
    }

    return jsonResponse(parsed);
  } catch (error) {
    console.error('Error generating reflection:', error);
    return errorResponse(500, 'Failed to generate reflection.');
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

    if (routePath.includes('/generate-questions')) {
      return await handleGenerateQuestions(body);
    }
    if (routePath.includes('/generate-scenario-responses')) {
      return await handleGenerateScenarioResponses(body);
    }
    if (routePath.includes('/evaluate-assessment')) {
      return await handleEvaluateAssessment(body);
    }
    if (routePath.includes('/generate-reflection')) {
      return await handleGenerateReflection(body);
    }

    return errorResponse(404, `Unknown route: ${routePath}`);
  } catch (error) {
    console.error('Agent JSON handler error:', error);
    return errorResponse(500, 'Internal server error.');
  }
};
