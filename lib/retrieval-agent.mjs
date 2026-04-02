// lib/retrieval-agent.mjs
// Retrieval agent that searches the Weaviate knowledge base for evidence,
// case studies, and examples when the user is confused or asks for help.

import { runAgentLoop } from './agent-runner.mjs';
import { agentToolDefinitions, agentToolImplementations } from './agent-tools.mjs';
import { RETRIEVAL_AGENT_PROMPT } from '../prompts/load.mjs';
import { getQuestionById } from './nesta-questions.mjs';

const MODEL = process.env.CHATBOT_MODEL || 'gpt-5.1';
const MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS, 10) || 3;

/**
 * Build the system prompt with optional question context.
 */
function buildSystemPrompt(questionId, userMessage) {
  let contextBlock = '';

  if (questionId) {
    const question = getQuestionById(questionId);
    if (question) {
      contextBlock = [
        `The practitioner is currently working on Nesta question Q${questionId}:`,
        `"${question.question}"`,
        `Context: ${question.explanation}`,
      ].join('\n');
    }
  }

  if (!contextBlock) {
    contextBlock = 'The practitioner is exploring public engagement topics generally (no specific Nesta question is active).';
  }

  return RETRIEVAL_AGENT_PROMPT
    .replace('{{CONTEXT_BLOCK}}', contextBlock)
    .replace('{{userQuery}}', userMessage);
}

/**
 * Run the retrieval agent for a user's help request.
 *
 * @param {string} userMessage - The user's message asking for help/examples
 * @param {object} session - Full session object from session-state.mjs
 * @returns {{ message: string, type: string }}
 */
export async function retrievalResponse(userMessage, session) {
  const questionId = session.activeQuestionId;
  const systemPrompt = buildSystemPrompt(questionId, userMessage);

  let responseText;
  try {
    responseText = await runAgentLoop({
      systemPrompt,
      userMessage,
      tools: agentToolDefinitions,
      toolImpls: agentToolImplementations,
      model: MODEL,
      maxIterations: MAX_ITERATIONS,
    });
  } catch (err) {
    console.error('[retrieval-agent] Error:', err.message);
    return {
      message: "I'm having trouble searching the knowledge base right now. Could you try again?",
      type: 'retrieval',
    };
  }

  if (!responseText) {
    return {
      message: "I wasn't able to find relevant information. Could you rephrase your question?",
      type: 'retrieval',
    };
  }

  console.log(`[retrieval-agent] Responded for Q${questionId ?? '-'}: ${userMessage.slice(0, 60)}...`);

  return {
    message: responseText,
    type: 'retrieval',
  };
}
