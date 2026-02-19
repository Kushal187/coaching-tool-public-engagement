// netlify/functions/generate-questions.mjs
// Agent 1: Post-questionnaire follow-up question generation.
// Reviews all user answers, identifies ambiguity (especially from "Other"
// selections), and generates targeted follow-up questions grounded in
// the knowledge base.

import {
  agentToolDefinitions,
  agentToolImplementations,
} from '../../lib/agent-tools.mjs';
import { runAgentLoop } from '../../lib/agent-runner.mjs';
import { handleCors, jsonResponse, errorResponse } from '../../lib/sse.mjs';

const MODEL = process.env.CHATBOT_MODEL || 'gpt-4.1';
const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `You are an expert public engagement consultant reviewing a user's questionnaire responses before generating their engagement plan.

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

export async function handler(event) {
  const cors = handleCors(event);
  if (cors) return cors;

  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Method Not Allowed');
  }

  let userContext;
  try {
    userContext = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON in request body.');
  }

  try {
    const userMessage = formatUserContext(userContext);

    const result = await runAgentLoop({
      systemPrompt: SYSTEM_PROMPT,
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

    return jsonResponse(parsed);
  } catch (error) {
    console.error('Error generating follow-up questions:', error);
    return jsonResponse({ needsFollowUp: false, questions: [] });
  }
}

function formatUserContext(ctx) {
  const resolveOther = (val, otherVal) =>
    val === 'Other' && otherVal ? `Other: "${otherVal}"` : val;

  const resolveArrayOther = (arr, otherVal) => {
    const items = arr.map((v) => (v === 'Other' && otherVal ? `Other: "${otherVal}"` : v));
    return items.join('; ');
  };

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
