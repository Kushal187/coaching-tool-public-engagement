// server.mjs
// Express server replacing Netlify Functions. True SSE streaming,
// no serverless timeout constraints.

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { openaiClient, weaviateClient } from './lib/weaviate-client.mjs';
import { resolveAgentToolCalls, runAgentLoop } from './lib/agent-runner.mjs';
import {
  agentToolDefinitions,
  agentToolImplementations,
  buildSourceDocuments,
} from './lib/agent-tools.mjs';
import { formatSSEChunk, formatSSESources, formatSSEDone } from './lib/sse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.CHATBOT_MODEL || 'gpt-4.1';
const MAX_ITERATIONS = 3;

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── System Prompts ──────────────────────────────────────────

const CHATBOT_PROMPT = `You are a knowledgeable public engagement assistant with access to a curated knowledge base of documents about participatory democracy, community engagement, and deliberative processes.

You have tools to search the knowledge base. Use them to find relevant evidence before answering.

RULES:
- You MUST use your search tools to find relevant information before making any recommendation or providing detailed guidance.
- Search at least once, and search again with different queries if the first results are insufficient.
- Every specific method, tool, or approach you recommend MUST cite its source inline: [Source: Document Name]
- If you cannot find relevant evidence for a particular aspect, explicitly state: "Based on available resources, I don't have specific guidance on this."
- Do NOT recommend anything you cannot ground in a retrieved document or widely accepted public engagement knowledge.
- Use markdown formatting (bullet points, bold, headers) to make your answers clear and readable.
- Keep answers concise unless the user asks for detail.
- When citing sources, use the document name from search results.
- At the end of your response, include a "### Sources" section listing all cited documents.`;

const GENERATE_PLAN_PROMPT = `You are a senior public engagement consultant with deep expertise in participatory democracy, community engagement, and deliberative processes.

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

const GENERATE_QUESTIONS_PROMPT = `You are an expert public engagement consultant reviewing a user's questionnaire responses before generating their engagement plan.

Your job is to identify ambiguity, gaps, or contradictions in their answers — especially when they selected "Other" and provided free-text input. Use your search tools to find relevant context from the knowledge base that can help you ask better follow-up questions.

PROCESS:
1. Review all the user's answers carefully.
2. If any answers contain "Other" with custom text, search the knowledge base using that text to understand the engagement context better.
3. Look for combinations that might need clarification (e.g., very short timeline with ambitious goals, contradicting constraints and resources).
4. Generate 0-4 follow-up questions that would help produce a better, more targeted plan.

RULES:
- Only generate follow-up questions when genuinely needed — do NOT ask follow-ups for every response.
- Each question should have a clear reason ("why") explaining why this clarification helps.
- If a knowledge base search reveals related case studies or guides, reference them in the "source" field.
- If all answers are clear and unambiguous, return needsFollowUp: false.
- Questions should be open-ended and invite the user to provide context, not yes/no questions.

You MUST respond with valid JSON in exactly this format (no markdown, no code fences):
{
  "needsFollowUp": true/false,
  "questions": [
    {
      "id": "q_unique_id",
      "question": "The follow-up question text",
      "why": "Brief explanation of why this clarification helps",
      "source": "Document name that informed this question (or null)"
    }
  ]
}

If needsFollowUp is false, questions should be an empty array.`;

const ADAPT_CASE_STUDY_PROMPT = `You are an experienced public engagement practitioner helping someone adapt a real-world case study to their specific situation.

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

// ── Shared Helpers ──────────────────────────────────────────

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

function initSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

async function resolveAndStream(res, messages) {
  initSSE(res);

  const { messages: resolved, earlyContent } = await resolveAgentToolCalls({
    tools: agentToolDefinitions,
    toolImpls: agentToolImplementations,
    model: MODEL,
    maxIterations: MAX_ITERATIONS,
    messages,
  });

  if (earlyContent) {
    res.write(formatSSEChunk(earlyContent));
  } else {
    const stream = await openaiClient.chat.completions.create({
      model: MODEL,
      messages: resolved,
      stream: true,
    });
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content || '';
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
  }

  const allSources = collectSourcesFromMessages(resolved);
  if (allSources.length > 0) {
    res.write(formatSSESources(buildSourceDocuments(allSources)));
  }
  res.write(formatSSEDone());
  res.end();
}

// ── POST /api/chatbot ───────────────────────────────────────

app.post('/api/chatbot', async (req, res) => {
  const { message, conversation } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Missing "message" in request body.' });
  }

  try {
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
    await resolveAndStream(res, messages);
  } catch (error) {
    console.error('Error processing chatbot message:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'An error occurred processing your message.' });
    }
    res.end();
  }
});

// ── POST /api/generate-plan ─────────────────────────────────

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

app.post('/api/generate-plan', async (req, res) => {
  const { userContext, followUpAnswers } = req.body;

  if (!userContext) {
    return res.status(400).json({ error: 'Missing required field: userContext.' });
  }

  try {
    const userMessage = formatPlanUserContext(userContext, followUpAnswers);
    const messages = [
      { role: 'system', content: GENERATE_PLAN_PROMPT },
      { role: 'user', content: userMessage },
    ];
    await resolveAndStream(res, messages);
  } catch (error) {
    console.error('Error generating plan:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'An error occurred while generating the engagement plan.' });
    }
    res.end();
  }
});

// ── POST /api/generate-questions ────────────────────────────

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

app.post('/api/generate-questions', async (req, res) => {
  try {
    const userMessage = formatQuestionsUserContext(req.body);

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
      const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse agent response as JSON:', result);
      parsed = { needsFollowUp: false, questions: [] };
    }

    if (!Array.isArray(parsed.questions)) {
      parsed.questions = [];
    }

    res.json(parsed);
  } catch (error) {
    console.error('Error generating follow-up questions:', error);
    res.json({ needsFollowUp: false, questions: [] });
  }
});

// ── POST /api/adapt-case-study ──────────────────────────────

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

app.post('/api/adapt-case-study', async (req, res) => {
  const { caseStudy, context, constraints } = req.body;

  if (!caseStudy || !context) {
    return res.status(400).json({ error: 'Missing required fields: caseStudy, context.' });
  }

  try {
    const userMessage = formatAdaptRequest(caseStudy, context, constraints);
    const messages = [
      { role: 'system', content: ADAPT_CASE_STUDY_PROMPT },
      { role: 'user', content: userMessage },
    ];
    await resolveAndStream(res, messages);
  } catch (error) {
    console.error('Error adapting case study:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'An error occurred while adapting the case study.' });
    }
    res.end();
  }
});

// ── GET /api/case-studies ───────────────────────────────────

const CS_COLLECTION = 'CaseStudyLibrary';
const CS_SUMMARY_FIELDS =
  'document_id title source_label source_url doc_date summary location timeframe demographic scale tags key_outcomes implementation_steps';
const CS_FULL_FIELDS = CS_SUMMARY_FIELDS + ' full_content';

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

app.get('/api/case-studies', async (req, res) => {
  try {
    if (req.query.id) {
      const result = await weaviateClient.graphql
        .get()
        .withClassName(CS_COLLECTION)
        .withFields(CS_FULL_FIELDS)
        .withWhere({
          path: ['document_id'],
          operator: 'Equal',
          valueText: req.query.id,
        })
        .withLimit(1)
        .do();

      const hits = result?.data?.Get?.[CS_COLLECTION] ?? [];
      if (hits.length === 0) {
        return res.status(404).json({ error: 'Case study not found.' });
      }
      return res.json(mapCaseStudy(hits[0], true));
    }

    const result = await weaviateClient.graphql
      .get()
      .withClassName(CS_COLLECTION)
      .withFields(CS_SUMMARY_FIELDS)
      .withLimit(200)
      .do();

    let items = (result?.data?.Get?.[CS_COLLECTION] ?? []).map((h) =>
      mapCaseStudy(h, false),
    );

    if (req.query.scale) {
      const scale = req.query.scale.toLowerCase();
      items = items.filter((cs) => cs.scale === scale);
    }
    if (req.query.tag) {
      const tag = req.query.tag.toLowerCase();
      items = items.filter((cs) =>
        cs.tags.some((t) => t.toLowerCase().includes(tag)),
      );
    }

    res.json(items);
  } catch (error) {
    console.error('case-studies error:', error);
    res.status(500).json({ error: 'Failed to fetch case studies.' });
  }
});

// ── Static Files (production) ───────────────────────────────

app.use(express.static(path.join(__dirname, 'dist')));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
