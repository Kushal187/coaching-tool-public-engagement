// lib/coach-agent.mjs
// Knowledge-grounded coaching agent. Uses the agent tool-calling loop
// to search the Weaviate knowledge base before every coaching response.

import { runAgentLoop } from './agent-runner.mjs';
import { agentToolDefinitions, agentToolImplementations } from './agent-tools.mjs';
import { COACH_AGENT_PROMPT } from '../prompts/load.mjs';
import { getQuestionById } from './nesta-questions.mjs';

const MODEL = process.env.CHATBOT_MODEL || 'gpt-5.1';
const MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS, 10) || 3;

const RESOLVED_MARKER = '[[RESOLVED]]';

/**
 * Build the system prompt for a specific question + conversation state.
 */
function buildSystemPrompt(question, qState) {
  let userResponseSoFar = qState.userResponse || '';

  // If no summarized response yet, compile from coaching history
  if (!userResponseSoFar && qState.coachingHistory.length > 0) {
    userResponseSoFar = qState.coachingHistory
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');
  }

  const userTurnCount = qState.coachingHistory.filter((m) => m.role === 'user').length;

  let prompt = COACH_AGENT_PROMPT
    .replace('{{question}}', question.question)
    .replace('{{explanation}}', question.explanation)
    .replace('{{userResponse}}', userResponseSoFar || '(none yet)');

  // Inject turn-count context so the model knows when to resolve
  if (userTurnCount >= 3) {
    prompt += `\n\nIMPORTANT: This is exchange #${userTurnCount + 1} on this question. You have had ${userTurnCount} previous exchanges with the user. Per the resolution guidelines, you should strongly lean toward resolving now. Summarize what the user has established, affirm it, and include [[RESOLVED]] unless their answer is still truly vague.`;
  }

  return prompt;
}

/**
 * Build the OpenAI messages array from coaching history.
 */
function buildMessages(systemPrompt, qState, userMessage) {
  const messages = [{ role: 'system', content: systemPrompt }];

  // Replay coaching history as alternating user/assistant turns
  for (const entry of qState.coachingHistory) {
    messages.push({
      role: entry.role === 'user' ? 'user' : 'assistant',
      content: entry.content,
    });
  }

  // Add the new user message
  messages.push({ role: 'user', content: userMessage });

  return messages;
}

/**
 * Run the coach agent for a given question and user message.
 *
 * @param {number} questionId - Nesta question ID (1-9)
 * @param {string} userMessage - The user's latest message
 * @param {object} session - Full session object from session-state.mjs
 * @returns {{ message: string, resolved: boolean, questionId: number }}
 */
export async function coachResponse(questionId, userMessage, session) {
  const question = getQuestionById(questionId);
  if (!question) {
    return {
      message: `I couldn't find question ${questionId}. Could you rephrase what you'd like to work on?`,
      resolved: false,
      questionId,
    };
  }

  const qState = session.questions[questionId];
  const systemPrompt = buildSystemPrompt(question, qState);
  const messages = buildMessages(systemPrompt, qState, userMessage);

  let responseText;
  try {
    responseText = await runAgentLoop({
      messages,
      tools: agentToolDefinitions,
      toolImpls: agentToolImplementations,
      model: MODEL,
      maxIterations: MAX_ITERATIONS,
    });
  } catch (err) {
    console.error(`[coach-agent] Error for Q${questionId}:`, err.message);
    return {
      message: "I'm having trouble connecting right now. Could you try again?",
      resolved: false,
      questionId,
    };
  }

  if (!responseText) {
    return {
      message: "I wasn't able to generate a response. Could you rephrase that?",
      resolved: false,
      questionId,
    };
  }

  // Check for resolution marker
  const resolved = responseText.includes(RESOLVED_MARKER);
  const cleanMessage = responseText.replace(RESOLVED_MARKER, '').trim();

  // Update session state
  qState.coachingHistory.push(
    { role: 'user', content: userMessage },
    { role: 'coach', content: cleanMessage },
  );

  if (resolved) {
    qState.status = 'addressed';
    // Summarize what the user established from their messages
    qState.userResponse = qState.coachingHistory
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join(' | ');
    console.log(`[coach-agent] Q${questionId} marked as ADDRESSED`);
  } else if (qState.status === 'not-started') {
    qState.status = 'in-progress';
  }

  // Update active question on session
  session.activeQuestionId = questionId;

  console.log(`[coach-agent] Q${questionId} responded (resolved=${resolved}, status=${qState.status})`);

  return {
    message: cleanMessage,
    resolved,
    questionId,
  };
}
