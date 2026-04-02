// lib/suggest-next.mjs
// Suggests the next 2-3 Nesta questions to work on after a question is resolved.
// Extracted from server.mjs for testability.

import { openaiClient } from './weaviate-client.mjs';
import { SUGGEST_NEXT_PROMPT } from '../prompts/load.mjs';
import { getQuestionById } from './nesta-questions.mjs';
import { getSessionSummary } from './session-state.mjs';

const MODEL = process.env.CHATBOT_MODEL || 'gpt-5.1';

/**
 * Suggest 2-3 next questions based on session progress and recent conversation.
 *
 * @param {object} session - Full session object from session-state.mjs
 * @param {number|null} resolvedQuestionId - The question that was just resolved (if any)
 * @returns {{ message: string, type: string, suggestions: Array<{ questionId: number, reason: string }> }}
 */
export async function handleSuggestNext(session, resolvedQuestionId = null) {
  const summary = getSessionSummary(session);
  const addressed = summary.questions.filter((q) => q.status === 'addressed');
  const remaining = summary.questions.filter((q) => q.status !== 'addressed');

  if (remaining.length === 0) {
    return {
      message: "You've worked through all 9 Nesta framework questions — that's fantastic! Would you like me to generate a reflection summary of everything we've covered?",
      type: 'suggest',
      suggestions: [],
    };
  }

  // Build resolved-question context if a question was just resolved
  let resolvedContext = '';
  if (resolvedQuestionId) {
    const resolvedQ = getQuestionById(resolvedQuestionId);
    const qState = session.questions[resolvedQuestionId];
    if (resolvedQ) {
      resolvedContext = `Just resolved: Q${resolvedQuestionId} — "${resolvedQ.question}"\nUser established: ${qState?.userResponse || '(summary unavailable)'}`;
    }
  }

  // Build context of what was discussed for the LLM to pick relevant next questions
  const recentHistory = session.conversationHistory.slice(-6);
  const recentText = recentHistory.map((m) => `${m.role}: ${m.content}`).join('\n');

  const addressedList = addressed.map((q) => `- Q${q.id}: ${q.question}`).join('\n');
  const remainingList = remaining.map((q) => `- Q${q.id}: ${q.question}`).join('\n');

  // Build prompt from template
  const systemContent = SUGGEST_NEXT_PROMPT
    .replace('{{RESOLVED_CONTEXT}}', resolvedContext || '(No specific question just resolved — user asked for suggestions)')
    .replace('{{COMPLETED_QUESTIONS}}', addressedList || '(none yet)')
    .replace('{{REMAINING_QUESTIONS}}', remainingList)
    .replace('{{RECENT_CONVERSATION}}', recentText);

  try {
    const response = await openaiClient.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: 'Suggest the best 2-3 next questions. Return JSON only.' },
      ],
      temperature: 0,
    });

    const text = (response.choices[0]?.message?.content || '').trim();
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const suggestions = (parsed.suggestions || []).slice(0, 3);

    // Build a natural transition message
    const lines = [];
    lines.push("Here are some areas that would build nicely on what you've covered:\n");
    for (const s of suggestions) {
      const q = remaining.find((r) => r.id === s.questionId);
      if (q) {
        lines.push(`- **${q.question}** — ${s.reason}`);
      }
    }
    lines.push("\nWhich of these would you like to explore, or is there something else on your mind?");

    return {
      message: lines.join('\n'),
      type: 'suggest',
      suggestions,
    };
  } catch (err) {
    console.error('[suggest-next] Error:', err.message);

    // Fallback: just list the first 3 remaining
    const fallback = remaining.slice(0, 3);
    const lines = ["Nice work so far! Here are a few areas we haven't covered yet:\n"];
    for (const q of fallback) {
      lines.push(`- **${q.question}**`);
    }
    lines.push("\nWhich of these would you like to explore?");

    return {
      message: lines.join('\n'),
      type: 'suggest',
      suggestions: fallback.map((q) => ({ questionId: q.id, reason: '' })),
    };
  }
}
