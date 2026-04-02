// lib/session-state.mjs
// In-memory session store for the unified coaching chat.
// Tracks per-question coaching state and full conversation history.

import { NESTA_QUESTIONS } from './nesta-questions.mjs';

const sessions = new Map();

// Auto-expire sessions after 4 hours of inactivity
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

function createQuestionState() {
  const questions = {};
  for (const q of NESTA_QUESTIONS) {
    questions[q.id] = {
      status: 'not-started', // not-started | in-progress | partial | addressed
      userResponse: '',       // summarized user response once resolved
      gap: '',                // identified gap (set during coaching)
      coachingHistory: [],    // [{ role: 'user'|'coach', content: string }]
    };
  }
  return questions;
}

export function getOrCreateSession(sessionId) {
  if (sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    session.lastAccessedAt = Date.now();
    return session;
  }

  const session = {
    id: sessionId,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    questions: createQuestionState(),
    activeQuestionId: null,
    conversationHistory: [], // [{ role: 'user'|'assistant', content, metadata? }]
    lastRoutingDecision: null,
  };

  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) session.lastAccessedAt = Date.now();
  return session || null;
}

export function deleteSession(sessionId) {
  return sessions.delete(sessionId);
}

export function getSessionSummary(session) {
  const questionSummaries = [];
  let addressedCount = 0;
  let inProgressCount = 0;

  for (const q of NESTA_QUESTIONS) {
    const qs = session.questions[q.id];
    if (qs.status === 'addressed') addressedCount++;
    if (qs.status === 'in-progress') inProgressCount++;

    questionSummaries.push({
      id: q.id,
      question: q.question,
      status: qs.status,
      hasCoachingHistory: qs.coachingHistory.length > 0,
    });
  }

  return {
    activeQuestionId: session.activeQuestionId,
    addressedCount,
    inProgressCount,
    totalQuestions: 9,
    questions: questionSummaries,
  };
}

/**
 * Build a text summary of the session state for the orchestrator LLM.
 */
export function buildStateSummaryForLLM(session) {
  const lines = [];

  if (session.activeQuestionId) {
    const q = NESTA_QUESTIONS.find((q) => q.id === session.activeQuestionId);
    lines.push(`CURRENTLY COACHING: Q${session.activeQuestionId} — "${q?.question}"`);
  } else {
    lines.push('CURRENTLY COACHING: None (no active question)');
  }

  lines.push('');
  lines.push('QUESTION STATUS:');

  for (const q of NESTA_QUESTIONS) {
    const qs = session.questions[q.id];
    const histLen = qs.coachingHistory.length;
    const detail = histLen > 0 ? ` (${histLen} messages in coaching history)` : '';
    lines.push(`  Q${q.id} [${qs.status}]: "${q.question}"${detail}`);
  }

  return lines.join('\n');
}

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      sessions.delete(id);
      console.log(`[session] Expired session ${id}`);
    }
  }
}, 60 * 60 * 1000); // Check every hour
