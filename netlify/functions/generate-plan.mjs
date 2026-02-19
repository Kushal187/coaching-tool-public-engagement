// netlify/functions/generate-plan.mjs
// Agent 2: Engagement plan generation with agentic RAG.
// Searches the knowledge base across multiple facets (methods, case studies,
// constraint strategies) and synthesises a grounded engagement plan with
// inline citations and a source list.

import {
  agentToolDefinitions,
  agentToolImplementations,
  buildSourceDocuments,
} from '../../lib/agent-tools.mjs';
import { resolveAgentToolCalls, streamFinalResponse } from '../../lib/agent-runner.mjs';
import {
  handleCors,
  formatSSEChunk,
  formatSSESources,
  formatSSEDone,
  sseResponse,
  errorResponse,
} from '../../lib/sse.mjs';

const MODEL = process.env.CHATBOT_MODEL || 'gpt-4.1';
const MAX_ITERATIONS = 3;

const SYSTEM_PROMPT = `You are a senior public engagement consultant with deep expertise in participatory democracy, community engagement, and deliberative processes.

You have access to a curated knowledge base of guides, case studies, reports, and tools. You MUST use your search tools to find relevant evidence before making any recommendation.

PROCESS:
1. Search for engagement methods that match the user's stated goal and target audience.
2. Search for case studies that relate to the user's engagement topic or issue area.
3. Search for strategies specifically addressing the user's biggest constraint.
4. If the user mentioned a specific process stage (e.g., mid-process), search for stage-specific guidance.
5. If you find a particularly relevant document, use get_document_details to retrieve the full context.
6. Synthesise all evidence into a structured engagement plan.

RULES:
- Search at least 3 times with different queries covering: (1) engagement methods for the goal, (2) relevant case studies, (3) constraint-specific strategies.
- Every specific method, tool, or approach you recommend MUST cite its source inline: [Source: Document Name]
- Do NOT recommend anything you cannot ground in a retrieved document.
- If you cannot find relevant evidence for a particular aspect, explicitly state: "Based on available resources, I don't have specific guidance on this."
- Tailor the plan to the user's timeline, resources, and AI comfort level.
- If the user is mid-process, Phase 1 should focus on Assessment & Course Correction rather than initial design.
- When the user provided follow-up answers, integrate that additional context throughout the plan.

OUTPUT FORMAT (use markdown):

## Your Engagement Plan

**Context Summary:** [1-2 sentence summary of the user's situation derived from their answers]

### Phase 1: Preparation & Design
(or "Phase 1: Assessment & Course Correction" if the user is mid-process)
- [Concrete steps with citations]

### Phase 2: Engagement Implementation
- [Methods, activities, and approaches with citations]
- [Timeline-aware sequencing]

### Phase 3: Synthesis & Closing the Loop
- [How to analyse results, report back to participants, and maintain trust — with citations]

### AI Integration Guidance
- [Specific ways AI can support the engagement, calibrated to the user's comfort level]
- [Tools or approaches from the knowledge base, with citations]

### Measuring Success
- [Metrics and evaluation approaches aligned to the user's success criteria, with citations]

### Sources
[List every document cited in the plan, with its content type]`;

export async function handler(event) {
  const cors = handleCors(event);
  if (cors) return cors;

  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Method Not Allowed');
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON in request body.');
  }

  const { userContext, followUpAnswers } = body;

  if (!userContext) {
    return errorResponse(400, 'Missing required field: userContext.');
  }

  try {
    const userMessage = formatUserContext(userContext, followUpAnswers);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ];

    const { messages: resolvedMessages, earlyContent } = await resolveAgentToolCalls({
      tools: agentToolDefinitions,
      toolImpls: agentToolImplementations,
      model: MODEL,
      maxIterations: MAX_ITERATIONS,
      messages,
    });

    let sseBody = '';

    if (earlyContent) {
      sseBody += formatSSEChunk(earlyContent);
    } else {
      sseBody += await streamFinalResponse({ messages: resolvedMessages, model: MODEL });
    }

    const allSources = collectSourcesFromMessages(resolvedMessages);
    if (allSources.length > 0) {
      sseBody += formatSSESources(buildSourceDocuments(allSources));
    }
    sseBody += formatSSEDone();

    return sseResponse(sseBody);
  } catch (error) {
    console.error('Error generating plan:', error);
    return errorResponse(500, 'An error occurred while generating the engagement plan.');
  }
}

// ── Helpers ──────────────────────────────────────────────────

function resolveOther(val, otherVal) {
  return val === 'Other' && otherVal ? `Other: "${otherVal}"` : val;
}

function resolveArrayOther(arr, otherVal) {
  return (arr || [])
    .map((v) => (v === 'Other' && otherVal ? `Other: "${otherVal}"` : v))
    .join('; ');
}

function formatUserContext(ctx, followUpAnswers) {
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
