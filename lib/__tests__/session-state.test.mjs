// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrCreateSession,
  getSession,
  deleteSession,
  getSessionSummary,
  buildStateSummaryForLLM,
} from '../session-state.mjs';

// ── Helpers ──────────────────────────────────────────────────

function uniqueId() {
  return `test-${Date.now()}-${Math.random()}`;
}

// ── Tests ────────────────────────────────────────────────────

describe('session-state', () => {
  describe('getOrCreateSession', () => {
    it('creates a new session with correct initial structure', () => {
      const session = getOrCreateSession(uniqueId());

      expect(session.id).toBeTruthy();
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.lastAccessedAt).toBeGreaterThan(0);
      expect(session.activeQuestionId).toBeNull();
      expect(session.conversationHistory).toEqual([]);
      expect(session.lastRoutingDecision).toBeNull();
    });

    it('initializes all 9 questions with not-started status', () => {
      const session = getOrCreateSession(uniqueId());

      for (let i = 1; i <= 9; i++) {
        expect(session.questions[i]).toBeDefined();
        expect(session.questions[i].status).toBe('not-started');
        expect(session.questions[i].userResponse).toBe('');
        expect(session.questions[i].gap).toBe('');
        expect(session.questions[i].coachingHistory).toEqual([]);
      }
    });

    it('returns the same session on subsequent calls', () => {
      const id = uniqueId();
      const first = getOrCreateSession(id);
      first.activeQuestionId = 3;

      const second = getOrCreateSession(id);
      expect(second.activeQuestionId).toBe(3);
      expect(second).toBe(first);
    });

    it('updates lastAccessedAt on re-access', () => {
      const id = uniqueId();
      const session = getOrCreateSession(id);
      const initialTime = session.lastAccessedAt;

      // Slight delay to ensure timestamp differs
      session.lastAccessedAt = initialTime - 1000;
      getOrCreateSession(id);
      expect(session.lastAccessedAt).toBeGreaterThanOrEqual(initialTime);
    });
  });

  describe('getSession', () => {
    it('returns null for non-existent session', () => {
      expect(getSession('does-not-exist-' + Math.random())).toBeNull();
    });

    it('returns existing session', () => {
      const id = uniqueId();
      getOrCreateSession(id);
      const session = getSession(id);
      expect(session).toBeTruthy();
      expect(session.id).toBe(id);
    });
  });

  describe('deleteSession', () => {
    it('deletes an existing session', () => {
      const id = uniqueId();
      getOrCreateSession(id);
      expect(deleteSession(id)).toBe(true);
      expect(getSession(id)).toBeNull();
    });

    it('returns false for non-existent session', () => {
      expect(deleteSession('nope-' + Math.random())).toBe(false);
    });
  });

  describe('getSessionSummary', () => {
    it('returns correct counts for a fresh session', () => {
      const session = getOrCreateSession(uniqueId());
      const summary = getSessionSummary(session);

      expect(summary.activeQuestionId).toBeNull();
      expect(summary.addressedCount).toBe(0);
      expect(summary.inProgressCount).toBe(0);
      expect(summary.totalQuestions).toBe(9);
      expect(summary.questions).toHaveLength(9);
    });

    it('counts addressed and in-progress questions', () => {
      const session = getOrCreateSession(uniqueId());
      session.questions[1].status = 'addressed';
      session.questions[2].status = 'addressed';
      session.questions[3].status = 'in-progress';
      session.activeQuestionId = 3;

      const summary = getSessionSummary(session);
      expect(summary.addressedCount).toBe(2);
      expect(summary.inProgressCount).toBe(1);
      expect(summary.activeQuestionId).toBe(3);
    });

    it('includes question text and hasCoachingHistory flag', () => {
      const session = getOrCreateSession(uniqueId());
      session.questions[1].coachingHistory.push({ role: 'user', content: 'test' });

      const summary = getSessionSummary(session);
      const q1 = summary.questions.find((q) => q.id === 1);
      expect(q1.question).toContain('goals');
      expect(q1.hasCoachingHistory).toBe(true);

      const q2 = summary.questions.find((q) => q.id === 2);
      expect(q2.hasCoachingHistory).toBe(false);
    });
  });

  describe('buildStateSummaryForLLM', () => {
    it('shows "None" when no active question', () => {
      const session = getOrCreateSession(uniqueId());
      const text = buildStateSummaryForLLM(session);
      expect(text).toContain('None (no active question)');
    });

    it('shows the active question when set', () => {
      const session = getOrCreateSession(uniqueId());
      session.activeQuestionId = 5;
      const text = buildStateSummaryForLLM(session);
      expect(text).toContain('CURRENTLY COACHING: Q5');
      expect(text).toContain('incentives');
    });

    it('includes all question statuses', () => {
      const session = getOrCreateSession(uniqueId());
      session.questions[1].status = 'addressed';
      session.questions[4].status = 'in-progress';

      const text = buildStateSummaryForLLM(session);
      expect(text).toContain('Q1 [addressed]');
      expect(text).toContain('Q4 [in-progress]');
      expect(text).toContain('Q9 [not-started]');
    });

    it('includes coaching history count', () => {
      const session = getOrCreateSession(uniqueId());
      session.questions[2].coachingHistory = [
        { role: 'user', content: 'a' },
        { role: 'coach', content: 'b' },
      ];

      const text = buildStateSummaryForLLM(session);
      expect(text).toContain('Q2');
      expect(text).toContain('2 messages');
    });
  });
});
