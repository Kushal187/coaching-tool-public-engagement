// netlify/functions/adapt-case-study.mjs
// Agent 3: Case study adaptation with agentic RAG.
// Retrieves related case studies and guides from the knowledge base,
// produces a grounded adaptation plan with citations.

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
const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `You are an experienced public engagement practitioner helping someone adapt a real-world case study to their specific situation.

You have access to a knowledge base of public engagement documents. Use your search tools to find relevant evidence before making recommendations.

PROCESS:
1. Search for the original case study in the knowledge base to get richer context beyond what the user provided.
2. Search for case studies or guides matching the user's specific situation and constraints.
3. Search for constraint-specific adaptation strategies.
4. If you find a particularly relevant document, use get_document_details to retrieve the full context.

RULES:
- Search at least 3 times with different queries covering: (1) the original case study, (2) the user's situation, (3) constraint-specific strategies.
- Clearly distinguish in your output:
  (a) Elements from the case study that transfer directly to the user's situation
  (b) Elements that need modification and how to modify them
  (c) New elements needed for the user's specific context
- Every adaptation recommendation MUST cite its source inline: [Source: Document Name]
- Flag risks grounded in what similar engagements have experienced.
- If the user's situation differs significantly from available evidence, explicitly state limitations.
- Do NOT recommend anything you cannot ground in a retrieved document.

OUTPUT FORMAT (use markdown):
## Adapted Plan: Based on [Case Study Title]

**Your Context:** [summary]
**Your Constraints:** [summary]
**Reference Case Study:** [title and location]

### What Transfers Directly
- [elements that can be used as-is, with citations]

### What Needs Modification
- [elements that need changes, with specific guidance and citations]

### New Elements for Your Context
- [additions based on user's unique situation, with citations]

### Phase 1: Setup
- [adapted steps with citations]

### Phase 2: Implementation
- [adapted steps with citations]

### Phase 3: Evaluation & Outcomes
- [adapted outcomes with citations]

### Risks & Considerations
- [risks grounded in evidence, with citations]

### Sources
[list all cited documents]`;

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

  const { caseStudy, context, constraints } = body;

  if (!caseStudy || !context) {
    return errorResponse(400, 'Missing required fields: caseStudy, context.');
  }

  try {
    const userMessage = formatAdaptRequest(caseStudy, context, constraints);

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
    console.error('Error adapting case study:', error);
    return errorResponse(500, 'An error occurred while adapting the case study.');
  }
}

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
