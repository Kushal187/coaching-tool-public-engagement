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
4. Search for practical guidance specifically addressing the user's stated stuck point (e.g., if they said "reaching underrepresented groups," search for outreach strategies for hard-to-reach populations).
5. If the user mentioned a specific process stage (e.g., mid-process), search for stage-specific guidance.
6. If you find a particularly relevant document, use get_document_details to retrieve the full context.
7. Synthesise all evidence into a structured engagement plan.

RULES:
- Search at least 3 times with different queries covering: (1) engagement methods for the goal, (2) relevant case studies, (3) constraint-specific strategies.
- Every specific method, tool, or approach you recommend MUST cite its source inline: [Source: Document Name]
- Do NOT recommend anything you cannot ground in a retrieved document.
- If you cannot find relevant evidence for a particular aspect, explicitly state: "Based on available resources, I don't have specific guidance on this."
- Tailor the plan to the user's timeline, resources, and AI comfort level.
- If the user is mid-process, Phase 1 should focus on Assessment & Course Correction rather than initial design.
- When the user provided follow-up answers, integrate that additional context throughout the plan.
- Every step in the plan must follow a "verb + specific action" format, specific enough that the practitioner can act on it without further research. Instead of "Conduct outreach to underrepresented communities," write "Identify 3 trusted community organizations in your area, draft a one-paragraph partnership ask, and schedule introductory meetings within [timeframe]." Directly below each step, add an indented line: "  - *Deliverable:* [concrete, tangible output of this step]" (e.g., "  - *Deliverable:* Confirmed partnerships with at least 2 community organizations").
- The user's stated stuck point is their most urgent need. Within the most relevant phase, begin with a bold-labeled sub-point — **Addressing your core challenge: [stuck point]** — that directly tackles it with concrete, cited guidance. Do not bury this across the plan; make it immediately visible.
- Scale the plan's density to the user's stated timeline. For timelines under 4 weeks: compress Phase 1 to 2-3 essential setup steps and merge Phases 2-3 where possible. For 1-3 months: keep all three phases but tighten sequencing. For 6-12 months: include iterative engagement cycles within Phase 2 and interim check-ins. Always include specific time estimates (e.g., "Week 1-2") anchored to the user's timeline.
- Within each phase, group steps under two subtitle headings: **Essential** (the minimum viable engagement — what the practitioner must do even if everything else falls away; limit to 3-4 steps per phase) and **If Resources Allow** (additional steps that strengthen the engagement but can be deferred). Use #### for these subtitles within each phase.
- Include at least one decision point or contingency per phase, formatted as: "**If [risk scenario]:** [concrete pivot or fallback action]." Ground these in evidence from the knowledge base where possible (e.g., "If turnout is below expectations, [Source: X] recommends shifting to...").
- In the Sources section, list every cited document as a markdown hyperlink using the document's source URL: [Document Name](source_url). If no URL is available for a document, list it as plain text with its content type.

OUTPUT FORMAT (use markdown, follow this indentation exactly):

## Your Engagement Plan

**Context Summary:** [1-2 sentence summary of the user's situation derived from their answers]

### Phase 1: Preparation & Design
(or "Phase 1: Assessment & Course Correction" if the user is mid-process)

#### Essential
- [Concrete step with citation] [Source: Document Name]
  - *Deliverable:* [tangible output of this step]
- [Next step with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

#### If Resources Allow
- [Additional step with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

### Phase 2: Engagement Implementation

#### Essential
- [Method or activity with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

#### If Resources Allow
- [Additional method with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

### Phase 3: Synthesis & Closing the Loop

#### Essential
- [Step for analysing results, reporting back, maintaining trust — with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

#### If Resources Allow
- [Additional step with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

### AI Integration Guidance
- [Specific ways AI can support the engagement, calibrated to the user's comfort level]
- [Tools or approaches from the knowledge base, with citations]

### Measuring Success
- [Metrics and evaluation approaches aligned to the user's success criteria, with citations]

### Sources
[List every document cited in the plan as a markdown hyperlink: [Document Name](source_url). Include content type.]`;

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
- Every adaptation recommendation MUST cite its source inline as a hyperlink: [Source: [Document Name](source_url)]. If no URL is available, fall back to plain text: [Source: Document Name].
- Flag risks grounded in what similar engagements have experienced.
- If the user's situation differs significantly from available evidence, explicitly state limitations.
- Do NOT recommend anything you cannot ground in a retrieved document.
- Every step in the phased plan must be specific and actionable. Directly below each step, add an indented line: "  - *Deliverable:* [concrete, tangible output of this step]" (e.g., "  - *Deliverable:* Revised outreach flyer adapted to your community's demographics").
- If the user's free-text input is sparse or omits key details (timeline, audience, scale, resources), explicitly state your assumptions at the top of the plan under **Your Context** (e.g., "You did not mention a timeline; based on your constraints, this plan assumes a 2-3 month window. Adjust phase durations if your timeline differs."). Infer reasonable defaults from the case study's parameters and the user's constraints. Never silently guess — always surface assumptions so the practitioner can correct them.
- The adapted plan must visibly diverge from the original case study. In the "What Needs Modification" section, identify at least 3 concrete, substantive changes — not cosmetic substitutions like swapping city names. If the user's scale, timeline, or audience differs from the case study, those differences must drive structural changes in the phased plan, not just wording changes.
- Every phase must include a specific time estimate (e.g., "Weeks 1-2," "Month 1"). If the user stated a timeline, anchor to it. If they didn't, infer one from their constraints and state the assumption. If the case study's timeframe is significantly longer or shorter than the user's apparent situation, explicitly describe how to compress or expand each phase.
- Within each phase, group steps under two subtitle headings: **Essential** (the minimum viable adaptation — what the practitioner must do even with severe constraints; limit to 2-3 steps per phase) and **If Resources Allow** (additional steps that strengthen the adaptation but can be deferred). Use #### for these subtitles within each phase.
- Include at least one contingency per phase: "**If [scenario]:** [fallback]." Prioritize risks that stem from the differences between the case study's context and the user's context (e.g., "The original case study had 6 months; if your compressed timeline causes low turnout at the first session, consider...").
- In the Sources section, list every cited document as a markdown hyperlink using the document's source URL: [Document Name](source_url). If no URL is available for a document, list it as plain text with its content type.

OUTPUT FORMAT (use markdown, follow this indentation exactly):
## Adapted Plan: Based on [Case Study Title]

- **Your Context:** [summary]
- **Your Constraints:** [summary]
- **Reference Case Study:** [title and location]

### What Transfers Directly
- [elements that can be used as-is, with citations]

### What Needs Modification
- [elements that need changes, with specific guidance and citations]

### New Elements for Your Context
- [additions based on user's unique situation, with citations]

### Phase 1: Setup

#### Essential
- [Adapted step with citation] [Source: Document Name]
  - *Deliverable:* [tangible output of this step]
- [Next step with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

#### If Resources Allow
- [Additional step with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

### Phase 2: Implementation

#### Essential
- [Adapted step with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

#### If Resources Allow
- [Additional step with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

### Phase 3: Evaluation & Outcomes

#### Essential
- [Adapted step with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

#### If Resources Allow
- [Additional step with citation] [Source: Document Name]
  - *Deliverable:* [tangible output]

### Risks & Considerations
- [risks grounded in evidence, with citations]

### Sources
[List every cited document as a markdown hyperlink: [Document Name](source_url). Include content type.]`;

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

const EVALUATE_COACHING_PROMPT = `You are an expert evaluator assessing the quality of an AI coaching conversation about public engagement.

The coach being evaluated uses the Nesta framework to help practitioners improve their public engagement plans through Socratic dialogue.

EVALUATION DIMENSIONS (score each 1-10):
1. Socratic Approach: Does the coach ask probing questions to guide thinking, rather than lecturing? Does it encourage self-discovery?
2. Specificity: Does the coach reference the practitioner's actual words and situation, or give generic advice?
3. Evidence Use: Does the coach cite sources or ground recommendations in evidence? Or give unsupported opinions?
4. Warmth & Tone: Is the coach warm, collaborative, and encouraging? Or cold, condescending, or robotic?
5. Gap Targeting: Does the coach effectively guide the practitioner toward addressing the identified gap?
6. Progression: Does the conversation move forward meaningfully? Does the coach build on previous exchanges?

SCORING GUIDE:
- 9-10: Exceptional coaching
- 7-8: Good coaching with minor areas for improvement
- 5-6: Adequate but lacks depth or nuance
- 3-4: Below average with significant issues
- 1-2: Poor — fails to provide meaningful coaching

You MUST respond with valid JSON in exactly this format (no markdown, no code fences):
{
  "dimensions": {
    "socratic_approach": { "score": 7, "rationale": "Brief explanation" },
    "specificity": { "score": 8, "rationale": "Brief explanation" },
    "evidence_use": { "score": 6, "rationale": "Brief explanation" },
    "warmth_and_tone": { "score": 9, "rationale": "Brief explanation" },
    "gap_targeting": { "score": 7, "rationale": "Brief explanation" },
    "progression": { "score": 8, "rationale": "Brief explanation" }
  },
  "overall_score": 75,
  "strengths": ["Strength 1", "Strength 2"],
  "weaknesses": ["Weakness 1", "Weakness 2"],
  "recommendations": ["Improvement suggestion 1", "Improvement suggestion 2"],
  "summary": "2-3 sentence overall assessment of coaching quality."
}

The overall_score should be the average of all dimension scores mapped to 0-100 (multiply average by 10).`;

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

const CROSS_RESOLUTION_PROMPT = `You are an evaluator that determines whether a coaching conversation has substantively addressed assessment gaps from OTHER Nesta framework questions.

You will receive:
1. A coaching conversation transcript (about a specific Nesta question).
2. A list of OTHER unresolved assessment cards, each with a question and an identified gap.

For each unresolved card, decide whether the conversation has **directly and substantively** addressed that card's specific gap. Be CONSERVATIVE:
- The conversation must contain a concrete, actionable discussion that closes the gap — not just a passing mention.
- If the gap says the user hasn't identified participants, the conversation must show the user articulating who their participants are.
- Tangential references or vague overlap do NOT count.

Return ONLY a JSON object: { "resolvedQuestionIds": [<numbers>] }
If no other cards are resolved, return: { "resolvedQuestionIds": [] }
Do NOT include the current question's ID. Return raw JSON with no markdown fences.`;

app.post('/api/analyze-cross-resolution', async (req, res) => {
  const { conversation, currentQuestionId, unresolvedCards } = req.body;

  if (!Array.isArray(conversation) || !Array.isArray(unresolvedCards) || unresolvedCards.length === 0) {
    return res.json({ resolvedQuestionIds: [] });
  }

  try {
    const transcript = conversation
      .map((m) => `${m.role === 'user' ? 'PRACTITIONER' : 'COACH'}: ${m.content}`)
      .join('\n\n');

    const cardsList = unresolvedCards
      .map((c) => `- Question ${c.questionId}: "${c.question}" | Gap: "${c.gap}"`)
      .join('\n');

    const userMessage = [
      `## Current Coaching Conversation (Question ${currentQuestionId})`,
      '',
      transcript,
      '',
      '## Other Unresolved Assessment Cards',
      '',
      cardsList,
      '',
      'Which of these other cards (if any) has the conversation substantively resolved? Return JSON.',
    ].join('\n');

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
    const ids = (parsed.resolvedQuestionIds || []).filter(
      (id) => typeof id === 'number' && id !== currentQuestionId,
    );

    console.log(`[cross-resolution] Q${currentQuestionId} → resolved others: [${ids.join(', ')}]`);
    return res.json({ resolvedQuestionIds: ids });
  } catch (err) {
    console.error('[cross-resolution] Analysis failed:', err.message);
    return res.json({ resolvedQuestionIds: [] });
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

const GENERATE_SCENARIO_PROMPT = `You are a test-data generator for a public engagement coaching tool built on the Nesta framework. Your job is to produce realistic, plausible practitioner responses to 9 self-assessment questions based on a given SCENARIO.

You have access to a knowledge base of public engagement documents. Use your search tools to ground the generated responses in realistic engagement contexts — search for real engagement methods, challenges, and case studies so the answers feel authentic, not generic.

PROCESS:
1. Read the scenario description carefully.
2. Search the knowledge base 2-3 times for relevant engagement contexts, methods, and challenges that fit the scenario.
3. Generate 9 responses that a practitioner matching the scenario would realistically write.

RULES:
- Each response should be 2-5 sentences — realistic practitioner length, not essay-length.
- The responses should be internally consistent (they should feel like they come from the same person/project).
- For adversarial scenarios, make the weaknesses feel natural and believable, not cartoonishly bad.
- Do NOT include the question text in the response — just the answer.
- Ground responses in realistic details (mention plausible organizations, methods, timelines, etc.).

You MUST respond with valid JSON in exactly this format (no markdown, no code fences):
{
  "scenario": "Brief label for the scenario",
  "description": "One-sentence description of the persona/situation",
  "responses": {
    "1": "Response to question 1...",
    "2": "Response to question 2...",
    "3": "Response to question 3...",
    "4": "Response to question 4...",
    "5": "Response to question 5...",
    "6": "Response to question 6...",
    "7": "Response to question 7...",
    "8": "Response to question 8...",
    "9": "Response to question 9..."
  }
}`;

const SCENARIO_DESCRIPTIONS = {
  'well-prepared': 'A well-prepared practitioner who has thoroughly planned their public engagement project. They have clear goals, identified stakeholders, established workflows, and thought through evaluation. Their responses should be detailed, specific, and actionable.',
  'vague-minimal': 'A practitioner who gives vague, minimal-effort responses. They use generic language, avoid specifics, and seem to be going through the motions without deep thought. Responses should be 1-2 sentences of non-specific filler.',
  'contradictory': 'A practitioner whose responses contain internal contradictions. For example, they might claim broad inclusivity in one answer but describe a narrow recruitment strategy in another, or set an ambitious timeline while describing limited resources. The contradictions should be subtle and realistic.',
  'off-topic': 'A practitioner who frequently misunderstands or goes off-topic. They might confuse public engagement with marketing, conflate consultation with co-design, or answer a different question than what was asked. Their confusion should be realistic.',
  'over-ambitious': 'A practitioner with wildly over-ambitious plans relative to their resources. They describe wanting to engage thousands of people across multiple demographics with complex deliberative processes, but hint at having minimal budget, a short timeline, and a small team.',
  'hostile-resistant': 'A practitioner who is skeptical or resistant to the engagement process. They express doubt about whether public engagement is worthwhile, question the methodology, give dismissive responses, or indicate they are being forced to do this by management/regulations.',
  'custom': null,
};

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

const EVALUATE_ASSESSMENT_PROMPT = `You are an expert public engagement evaluator using the Nesta framework for participatory projects.

You have access to a knowledge base of public engagement guides, case studies, and best practices. Use your search tools to find relevant evidence for evaluating the user's responses.

PROCESS:
1. Read each of the 9 Nesta framework responses carefully.
2. Search the knowledge base at least 3 times to find relevant best practices, standards, and examples for evaluating these responses.
3. For each question, assess whether the user's response adequately addresses the question based on best practices.

EVALUATION CRITERIA:
For each of the 9 questions, apply this decision test:

- "addressed": The response names SPECIFIC actions, people, methods, or timelines.
  A reader could act on this response without asking follow-up questions.

- "not-addressed": The response fails TWO OR MORE of these checks:
  (a) Does it name a specific method, tool, or approach? (not just "we will engage people")
  (b) Does it identify specific people, groups, or roles? (not just "stakeholders")
  (c) Does it describe a concrete step or sequence? (not just "we plan to do outreach")
  (d) Is it actually answering THIS question? (not a different one)

- "partial": The response fails exactly ONE of the above checks.
  It shows real thinking but has one clear gap.

For each question, also provide:
- "gap": A concise description of what's missing or could be improved (empty string if fully addressed).
- "coachingContext": An opening message for a coaching conversation that acknowledges what the user said and guides them toward filling the gap. Be warm, specific, and reference their actual response. For addressed items, provide an affirming message.

RULES:
- Be fair but rigorous. Don't mark something as "addressed" if it's vague or generic.
- Reference specific parts of the user's response in your evaluation.
- Ground your evaluation criteria in evidence from the knowledge base where possible.
- The coaching context should feel like a conversation opener, not a lecture.
- IMPORTANT: Do NOT default to "partial." If a response is generic enough that
  you cannot identify a single concrete action, method, or named entity in it,
  mark it "not-addressed" even if it sounds well-intentioned.

You MUST respond with valid JSON in exactly this format (no markdown, no code fences):
{
  "evaluations": [
    {
      "questionId": 1,
      "question": "Have you articulated the project's goals?",
      "status": "addressed",
      "gap": "",
      "coachingContext": "Your goals are clearly defined..."
    }
  ]
}

Return exactly 9 evaluations, one for each question, in order.`;

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

const GENERATE_REFLECTION_PROMPT = `You are an expert public engagement coach producing a final reflection for a practitioner who has completed the Nesta framework self-assessment and coaching process.

You have access to a knowledge base of public engagement guides, case studies, and best practices. Use your search tools to ground your reflection in evidence.

PROCESS:
1. Review the user's original responses to all 9 Nesta questions and the AI evaluation of each.
2. Carefully review the COACHING CONVERSATIONS provided for each question. These conversations show what happened AFTER the initial assessment — the user may have explored ideas, proposed solutions, refined their thinking, or skipped coaching entirely.
3. Search the knowledge base at least 3 times for relevant best practices, frameworks, and examples.
4. Produce a structured, in-depth reflection that accounts for the FULL journey — original answers AND coaching conversations.

COACHING CONVERSATION CONTEXT:
For each question, you will see one of these scenarios:
- "PRODUCTIVE CONVERSATION" — The user engaged with the coach, explored ideas, and possibly proposed approaches. Your reflection should acknowledge the GROWTH shown in the conversation, not just the original answer. If the user proposed and refined a solution, reflect on that refined approach.
- "RESOLVED WITHOUT CONVERSATION" — The user marked this as resolved without engaging in coaching. Flag this: acknowledge the original answer was sufficient OR note that the user skipped deeper exploration despite identified gaps.
- "UNRESOLVED WITH ACTIVE CONVERSATION" — The user started coaching but hasn't resolved the item. Reflect on what was explored and what remains to be done.
- "NO COACHING SESSION" — No conversation occurred and the item was not resolved. The reflection should note this needs attention.

OUTPUT RULES:
- Write in second person ("you"), warm but professional tone.
- Be specific — reference what the user actually wrote AND what emerged in coaching conversations.
- For addressed items: if coaching happened, reflect on the user's growth and refined approach. If resolved without coaching, note whether the original answer was strong enough to stand alone.
- For partial items: acknowledge what they started, what coaching revealed, and give 1-2 concrete next steps.
- For not-addressed items: explain why this dimension matters (with evidence), reference any coaching conversation that occurred, and give 2-3 actionable steps.
- Priority actions should be the single most impactful thing to do first, grounded in evidence and informed by coaching conversations.

You MUST respond with valid JSON in exactly this format (no markdown, no code fences):
{
  "reflection": {
    "summary": "A 2-3 paragraph narrative summary of overall engagement readiness, highlighting key strengths, the most critical areas to develop, and how the coaching process shaped their thinking.",
    "addressed": [
      {
        "questionId": 1,
        "question": "Question text",
        "analysis": "In-depth analysis incorporating both the original answer and any coaching conversation. Note growth, refined approaches, or if resolved without coaching."
      }
    ],
    "partial": [
      {
        "questionId": 2,
        "question": "Question text",
        "analysis": "What was started, what coaching revealed, what's still missing.",
        "nextSteps": ["Concrete step 1", "Concrete step 2"]
      }
    ],
    "notAddressed": [
      {
        "questionId": 3,
        "question": "Question text",
        "analysis": "Why this dimension matters, what coaching explored (if any), and the risk of leaving it unaddressed.",
        "nextSteps": ["Concrete step 1", "Concrete step 2", "Concrete step 3"]
      }
    ],
    "priorityActions": [
      {
        "action": "Clear, actionable description of what to do",
        "rationale": "Why this is the highest priority right now",
        "timeline": "Suggested timeframe (e.g., 'This week', 'Next 2 weeks')"
      }
    ]
  }
}

Return exactly the items that match each status category. priorityActions should contain exactly 3 items.`;

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

const SCORE_CASE_STUDIES_PROMPT = `You are an expert at matching public engagement case studies to practitioner needs. You have access to a knowledge base of engagement resources, case studies, and guides.

PROCESS:
1. Read the practitioner's context carefully — note every field (issue area, goal, audience, timeline, resources, constraint, stuck point, process stage).
2. Search the knowledge base AT LEAST 4 TIMES with varied queries:
   - Search 1: Focus on the issue area + engagement goal combination
   - Search 2: Focus on the target audience + timeline/resource constraints
   - Search 3: Focus on the stuck point or biggest challenge mentioned
   - Search 4: Focus on the engagement methods or approaches relevant to the process stage
   Use different keywords each time — do NOT repeat similar queries.
3. For each case study, compute a score using the WEIGHTED RUBRIC below. Sum the points across all dimensions.

WEIGHTED SCORING RUBRIC (total = 100 points):

1. Issue/Topic Alignment (20 points)
   - 20: Case study addresses the same issue area (e.g., budget → budget, crisis → crisis)
   - 12: Related issue area (e.g., infrastructure → environment)
   - 5: Loosely related or transferable methods
   - 0: Completely unrelated topic

2. Engagement Goal Match (20 points)
   - 20: Same primary goal (e.g., both aim to gather feedback on a draft plan)
   - 12: Related goal (e.g., deliberation vs. idea gathering)
   - 5: Tangentially related goal
   - 0: Different purpose entirely

3. Audience/Demographic Fit (15 points)
   - 15: Same target audience (e.g., both target underrepresented communities)
   - 10: Overlapping audiences (e.g., case targets youth, practitioner targets hard-to-reach broadly)
   - 5: Different audience but methods are transferable
   - 0: Completely different audience with non-transferable approach

4. Timeline & Scale Compatibility (15 points)
   - 15: Case study operated within a similar timeframe and scale
   - 10: Somewhat comparable (e.g., case was 6 months, practitioner has 3 months)
   - 5: Different scale but methods could be adapted
   - 0: Vastly different timeline (e.g., multi-year vs. 4 weeks)

5. Resource & Constraint Alignment (15 points)
   - 15: Case study faced similar resource constraints and biggest challenge
   - 10: Partially similar constraints
   - 5: Different constraints but lessons are still applicable
   - 0: Case study had vastly different resources (e.g., national budget vs. solo practitioner)

6. Stuck Point / Process Stage Relevance (15 points)
   - 15: Case study directly addresses the practitioner's stuck point AND is useful for their process stage
   - 10: Addresses the stuck point OR process stage well
   - 5: Loosely relevant to their challenge
   - 0: Does not help with their specific challenge

RULES:
- You MUST perform at least 4 knowledge base searches before scoring.
- Apply the rubric mechanically — add up the points for each dimension.
- Every score reason MUST reference which rubric dimensions drove the score (e.g., "Issue: 20, Goal: 12, Audience: 10, Timeline: 15, Resources: 5, Stuck: 10 = 72").
- A perfect-match case should score 90-100. A decent match: 60-80. A weak match: 30-50. Irrelevant: below 30.
- Do NOT compress scores into a narrow range. Use the full 0-100 spectrum.
- Always return at least 5 case studies. If fewer than 5 score 30 or above, include the next-highest-scoring ones to reach 5, but note in their reason that they are weak matches.

OUTPUT FORMAT: Return ONLY valid JSON, no markdown fences. Use this exact structure:
{"scores": [{"id": "case-study-id", "score": 72, "reason": "Issue: 20, Goal: 12, Audience: 10, Timeline: 15, Resources: 5, Stuck: 10. [One sentence summary of why]."}]}

Return scored case studies sorted from most to least relevant.`;

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
