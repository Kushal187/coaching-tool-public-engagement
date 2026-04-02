// lib/orchestrator.mjs
// Routes user messages to the appropriate handler (coach, retrieval, suggest, general)
// using an LLM-based classification of intent + session state.

import { openaiClient } from './weaviate-client.mjs';
import { ORCHESTRATOR_PROMPT } from '../prompts/load.mjs';
import { formatQuestionsForLLM } from './nesta-questions.mjs';
import { buildStateSummaryForLLM } from './session-state.mjs';

const MODEL = process.env.CHATBOT_MODEL || 'gpt-5.1';

// Build the system prompt once at startup (questions don't change)
const SYSTEM_PROMPT = ORCHESTRATOR_PROMPT.replace(
  '{{NESTA_QUESTIONS}}',
  formatQuestionsForLLM(),
);

/**
 * Classify a user message and return a routing decision.
 *
 * @param {string} userMessage - The user's latest message
 * @param {object} session - The full session object from session-state.mjs
 * @returns {{ action: string, questionId: number|null, reasoning: string }}
 */
export async function classifyIntent(userMessage, session) {
  const stateSummary = buildStateSummaryForLLM(session);

  const userContent = [
    'SESSION STATE:',
    stateSummary,
    '',
    'USER MESSAGE:',
    userMessage,
  ].join('\n');

  const response = await openaiClient.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 0,
  });

  const text = (response.choices[0]?.message?.content || '').trim();
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    const decision = {
      action: parsed.action || 'general',
      questionId: parsed.questionId ?? null,
      reasoning: parsed.reasoning || '',
    };

    // Validate action
    const validActions = ['map_to_question', 'coach_continue', 'retrieve', 'suggest_next', 'general'];
    if (!validActions.includes(decision.action)) {
      console.warn(`[orchestrator] Invalid action "${decision.action}", falling back to general`);
      decision.action = 'general';
    }

    // Validate questionId range
    if (decision.questionId !== null && (decision.questionId < 1 || decision.questionId > 9)) {
      console.warn(`[orchestrator] Invalid questionId ${decision.questionId}, setting to null`);
      decision.questionId = null;
    }

    console.log(`[orchestrator] "${userMessage.slice(0, 60)}..." → ${decision.action} (Q${decision.questionId ?? '-'}): ${decision.reasoning}`);
    return decision;
  } catch (err) {
    console.error('[orchestrator] Failed to parse LLM response:', text, err.message);
    // Fallback: if there's an active question, assume coach_continue; otherwise general
    return {
      action: session.activeQuestionId ? 'coach_continue' : 'general',
      questionId: session.activeQuestionId,
      reasoning: 'Fallback due to parse error',
    };
  }
}

/**
 * Route a message to the appropriate handler based on the orchestrator's decision.
 *
 * @param {string} userMessage
 * @param {object} session
 * @returns {{ handler: string, questionId: number|null, decision: object }}
 */
export async function routeMessage(userMessage, session) {
  const decision = await classifyIntent(userMessage, session);

  session.lastRoutingDecision = decision;

  switch (decision.action) {
    case 'map_to_question':
    case 'coach_continue':
      return { handler: 'coach', questionId: decision.questionId, decision };

    case 'retrieve':
      return { handler: 'retrieval', questionId: decision.questionId, decision };

    case 'suggest_next':
      return { handler: 'suggest', questionId: null, decision };

    case 'general':
    default:
      return { handler: 'general', questionId: null, decision };
  }
}
