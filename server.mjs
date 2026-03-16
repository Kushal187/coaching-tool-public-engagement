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
import adminRoutes from './lib/admin-routes.mjs';
import {
  CHATBOT_PROMPT,
  GENERATE_PLAN_PROMPT,
  GENERATE_QUESTIONS_PROMPT,
  ADAPT_CASE_STUDY_PROMPT,
  EVALUATE_COACHING_PROMPT,
  CROSS_RESOLUTION_PROMPT,
  GENERATE_SCENARIO_PROMPT,
  SCENARIO_DESCRIPTIONS,
  EVALUATE_ASSESSMENT_PROMPT,
  GENERATE_REFLECTION_PROMPT,
  SCORE_CASE_STUDIES_PROMPT,
} from './prompts/load.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.CHATBOT_MODEL || 'gpt-5.1';
const MAX_ITERATIONS = 5;

app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── System Prompts (loaded from prompts/ folder) ───────────

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

  let fullContent = '';

  if (earlyContent) {
    fullContent = earlyContent;
    res.write(formatSSEChunk(earlyContent));
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
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
  }

  const allSources = collectSourcesFromMessages(resolved);
  if (allSources.length > 0) {
    res.write(formatSSESources(buildSourceDocuments(allSources)));
  }

  res._lastStreamedContent = fullContent;

  res.write(formatSSEDone());
  res.end();

  return fullContent;
}

// ── Background coaching evaluation ──────────────────────────
// Runs after the coach response is sent to the user. Logs results
// to the server console without affecting the user experience.

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

    console.log('\n[coaching-eval] ── Coaching Evaluation ──');
    console.log(`[coaching-eval] Question: ${coachingMeta.question}`);
    console.log(`[coaching-eval] Status: ${coachingMeta.status}`);
    console.log(`[coaching-eval] Overall Score: ${parsed.overall_score}/100`);
    if (parsed.dimensions) {
      const d = parsed.dimensions;
      console.log(`[coaching-eval]   Socratic:    ${d.socratic_approach?.score ?? '?'}/10`);
      console.log(`[coaching-eval]   Specificity: ${d.specificity?.score ?? '?'}/10`);
      console.log(`[coaching-eval]   Evidence:    ${d.evidence_use?.score ?? '?'}/10`);
      console.log(`[coaching-eval]   Warmth:      ${d.warmth_and_tone?.score ?? '?'}/10`);
      console.log(`[coaching-eval]   Gap Target:  ${d.gap_targeting?.score ?? '?'}/10`);
      console.log(`[coaching-eval]   Progression: ${d.progression?.score ?? '?'}/10`);
    }
    if (parsed.strengths?.length) {
      console.log(`[coaching-eval] Strengths: ${parsed.strengths.join('; ')}`);
    }
    if (parsed.weaknesses?.length) {
      console.log(`[coaching-eval] Weaknesses: ${parsed.weaknesses.join('; ')}`);
    }
    if (parsed.summary) {
      console.log(`[coaching-eval] Summary: ${parsed.summary}`);
    }
    console.log('[coaching-eval] ── End ──\n');
  }).catch((err) => {
    console.error('[coaching-eval] Evaluation failed:', err.message);
  });
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

    // Detect coaching conversations from the COACHING_CONTEXT_PREFIX
    // that CoachingChatPanel prepends to the conversation. If found,
    // evaluate the coach's response in the background.
    const contextEntry = Array.isArray(conversation)
      && conversation.find((m) => m.content?.includes('[COACHING CONTEXT'));
    if (contextEntry) {
      const coachingMeta = parseCoachingContext(contextEntry.content);
      const coachResponse = res._lastStreamedContent;

      const evalConversation = [];
      for (const m of conversation.slice(1)) {
        evalConversation.push({
          role: m.type === 'bot' ? 'coach' : 'user',
          content: m.content,
        });
      }
      if (coachResponse) {
        evalConversation.push({ role: 'coach', content: coachResponse });
      }

      evaluateCoachingInBackground(coachingMeta, evalConversation);
    }
  } catch (error) {
    console.error('Error processing chatbot message:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'An error occurred processing your message.' });
    }
    res.end();
  }
});

// ── POST /api/analyze-cross-resolution ──────────────────────

app.post('/api/analyze-cross-resolution', async (req, res) => {
  const { conversation, currentQuestionId, currentQuestion, unresolvedCards } = req.body;

  if (!Array.isArray(conversation) || !currentQuestion) {
    return res.json({ resolvedQuestionIds: [], currentQuestionResolved: false });
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

    console.log(`[cross-resolution] Q${currentQuestionId} → self-resolved: ${currentResolved}, resolved others: [${ids.join(', ')}]`);
    return res.json({ resolvedQuestionIds: ids, currentQuestionResolved: currentResolved });
  } catch (err) {
    console.error('[cross-resolution] Analysis failed:', err.message);
    return res.json({ resolvedQuestionIds: [], currentQuestionResolved: false });
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

// ── POST /api/generate-scenario-responses ───────────────────

app.post('/api/generate-scenario-responses', async (req, res) => {
  const { scenario, customDescription } = req.body;

  if (!scenario) {
    return res.status(400).json({ error: 'Missing required field: scenario.' });
  }

  const description = scenario === 'custom'
    ? customDescription
    : SCENARIO_DESCRIPTIONS[scenario];

  if (!description) {
    return res.status(400).json({ error: 'Invalid scenario or missing custom description.' });
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
      const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse scenario response as JSON:', result);
      return res.status(500).json({ error: 'Failed to parse generated responses.' });
    }

    if (!parsed.responses || typeof parsed.responses !== 'object') {
      return res.status(500).json({ error: 'Invalid response format.' });
    }

    res.json(parsed);
  } catch (error) {
    console.error('Error generating scenario responses:', error);
    res.status(500).json({ error: 'Failed to generate scenario responses.' });
  }
});

// ── POST /api/evaluate-assessment ───────────────────────────

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

app.post('/api/evaluate-assessment', async (req, res) => {
  const { responses } = req.body;

  if (!responses || typeof responses !== 'object') {
    return res.status(400).json({ error: 'Missing required field: responses.' });
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
      const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse evaluation response as JSON:', result);
      return res.status(500).json({ error: 'Failed to parse evaluation.' });
    }

    if (!parsed.evaluations || !Array.isArray(parsed.evaluations)) {
      return res.status(500).json({ error: 'Invalid evaluation format.' });
    }

    res.json(parsed);
  } catch (error) {
    console.error('Error evaluating assessment:', error);
    res.status(500).json({ error: 'Failed to evaluate assessment.' });
  }
});

// ── POST /api/generate-reflection ───────────────────────────

app.post('/api/generate-reflection', async (req, res) => {
  const { responses, evaluations, chatHistories } = req.body;

  if (!responses || !evaluations) {
    return res.status(400).json({ error: 'Missing required fields: responses, evaluations.' });
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
      const assistantMessages = chat?.filter((m) => m.role === 'assistant') || [];
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
      const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse reflection response as JSON:', result);
      return res.status(500).json({ error: 'Failed to parse reflection.' });
    }

    if (!parsed.reflection) {
      return res.status(500).json({ error: 'Invalid reflection format.' });
    }

    res.json(parsed);
  } catch (error) {
    console.error('Error generating reflection:', error);
    res.status(500).json({ error: 'Failed to generate reflection.' });
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

// ── POST /api/score-case-studies ─────────────────────────────

app.post('/api/score-case-studies', async (req, res) => {
  const { userContext, plan, caseStudies } = req.body;

  if (!userContext || !caseStudies || !Array.isArray(caseStudies)) {
    return res.status(400).json({ error: 'Missing required fields: userContext, caseStudies.' });
  }

  const startTime = Date.now();
  console.log('\n[score-case-studies] ── Request received ──');
  console.log(`[score-case-studies] Case studies to score: ${caseStudies.length}`);

  try {
    const contextSummary = [
      `Issue area: ${resolveOther(userContext.issueArea, userContext.issueAreaOther)}`,
      `Primary goal: ${resolveOther(userContext.primaryGoal, userContext.primaryGoalOther)}`,
      `Target audience: ${resolveArrayOther(userContext.audience, userContext.audienceOther)}`,
      `Timeline: ${userContext.timeline}`,
      `Resources: ${resolveArrayOther(userContext.resources, userContext.resourcesOther)}`,
      `Biggest constraint: ${resolveOther(userContext.biggestConstraint, userContext.biggestConstraintOther)}`,
      `AI comfort: ${userContext.aiComfort}`,
      `Success criteria: ${resolveOther(userContext.successLooksLike, userContext.successOther)}`,
      `Stuck point: ${resolveOther(userContext.stuckPoint, userContext.stuckPointOther)}`,
      `Process stage: ${userContext.processStage}`,
      userContext.existingWork ? `Existing work: ${userContext.existingWork}` : '',
    ].filter(Boolean).join('\n');

    console.log(`[score-case-studies] Context:\n${contextSummary}`);

    const caseStudySummaries = caseStudies.map((cs) => (
      `- ID: ${cs.id} | Title: "${cs.title}" | Location: ${cs.location} | Scale: ${cs.scale} | ` +
      `Timeframe: ${cs.timeframe} | Demographic: ${cs.demographic} | Tags: ${cs.tags?.join(', ')} | ` +
      `Summary: ${cs.summary}`
    )).join('\n');

    const userMessage = [
      `Score the following case studies for relevance to this practitioner's situation.`,
      ``,
      `## Practitioner Context`,
      contextSummary,
      plan ? `\n## Generated Plan (excerpt)\n${plan.slice(0, 1500)}` : '',
      ``,
      `## Case Studies to Score`,
      caseStudySummaries,
    ].join('\n');

    console.log(`[score-case-studies] Calling agent loop (model: ${MODEL}, max iterations: ${MAX_ITERATIONS})...`);

    const result = await runAgentLoop({
      systemPrompt: SCORE_CASE_STUDIES_PROMPT,
      userMessage,
      tools: agentToolDefinitions,
      toolImpls: agentToolImplementations,
      model: MODEL,
      maxIterations: MAX_ITERATIONS,
      temperature: 0,
    });

    const agentMs = Date.now() - startTime;
    console.log(`[score-case-studies] Agent completed in ${agentMs}ms`);

    if (!result) {
      console.error('[score-case-studies] Agent returned no response');
      return res.status(500).json({ error: 'Agent returned no response.' });
    }

    console.log(`[score-case-studies] Raw agent response:\n${result}`);

    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let scores;
    try {
      const parsed = JSON.parse(cleaned);
      scores = Array.isArray(parsed) ? parsed : parsed.scores || parsed.results || [];
    } catch {
      console.error('[score-case-studies] Failed to parse response as JSON:', cleaned);
      return res.status(500).json({ error: 'Failed to parse scoring response.' });
    }

    console.log(`[score-case-studies] ── Results (${scores.length} scored) ──`);
    scores.forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.score}%] ${s.id} — ${s.reason}`);
    });
    console.log(`[score-case-studies] Total time: ${Date.now() - startTime}ms\n`);

    res.json({ scores });
  } catch (error) {
    console.error(`[score-case-studies] Error after ${Date.now() - startTime}ms:`, error);
    res.status(500).json({ error: 'Failed to score case studies.' });
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
  res.setHeader('Cache-Control', 'no-store');
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

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let hits;

    if (q) {
      console.log(`[case-studies] search q="${q}"`);
      try {
        const searchResult = await weaviateClient.graphql
          .get()
          .withClassName(CS_COLLECTION)
          .withFields(CS_SUMMARY_FIELDS)
          .withNearText({ concepts: [q] })
          .withLimit(50)
          .do();
        hits = searchResult?.data?.Get?.[CS_COLLECTION] ?? [];
        console.log(`[case-studies] nearText search → ${hits.length} hit(s)`);
        hits.slice(0, 5).forEach((h, i) =>
          console.log(`  ${i + 1}. ${h.title}`),
        );
      } catch (searchErr) {
        console.error('[case-studies] nearText search failed, falling back to hybrid:', searchErr.message);
        try {
          const fallback = await weaviateClient.graphql
            .get()
            .withClassName(CS_COLLECTION)
            .withFields(CS_SUMMARY_FIELDS)
            .withHybrid({ query: q, alpha: 0.75 })
            .withLimit(50)
            .do();
          hits = fallback?.data?.Get?.[CS_COLLECTION] ?? [];
          console.log(`[case-studies] hybrid fallback → ${hits.length} hit(s)`);
        } catch (hybridErr) {
          console.error('[case-studies] hybrid fallback also failed:', hybridErr.message);
          hits = [];
        }
      }
    } else {
      const result = await weaviateClient.graphql
        .get()
        .withClassName(CS_COLLECTION)
        .withFields(CS_SUMMARY_FIELDS)
        .withLimit(200)
        .do();
      hits = result?.data?.Get?.[CS_COLLECTION] ?? [];
    }

    const seen = new Set();
    let items = hits
      .map((h) => mapCaseStudy(h, false))
      .filter((cs) => {
        if (seen.has(cs.id)) return false;
        seen.add(cs.id);
        return true;
      });

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

// ── Admin API ───────────────────────────────────────────────

app.use('/api/admin', adminRoutes);

// ── Static Files (production) ───────────────────────────────

app.use(express.static(path.join(__dirname, 'dist')));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
