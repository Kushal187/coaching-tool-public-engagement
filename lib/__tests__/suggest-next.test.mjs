// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies before importing the module under test ──

// Mock the OpenAI client
const mockCreate = vi.fn();
vi.mock('../weaviate-client.mjs', () => ({
  openaiClient: {
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  },
}));

// Mock the prompt loader
vi.mock('../../prompts/load.mjs', () => ({
  SUGGEST_NEXT_PROMPT: 'SYSTEM: {{RESOLVED_CONTEXT}} | {{COMPLETED_QUESTIONS}} | {{REMAINING_QUESTIONS}} | {{RECENT_CONVERSATION}}',
}));

// Import after mocks are set up
const { handleSuggestNext } = await import('../suggest-next.mjs');
const { getOrCreateSession } = await import('../session-state.mjs');

// ── Helpers ──────────────────────────────────────────────────

function buildSession(overrides = {}) {
  const session = getOrCreateSession(`test-${Date.now()}-${Math.random()}`);
  Object.assign(session, overrides);
  return session;
}

function mockLLMResponse(content) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content } }],
  });
}

// ── Tests ────────────────────────────────────────────────────

describe('handleSuggestNext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when all questions are addressed', () => {
    it('returns reflection offer with empty suggestions', async () => {
      const session = buildSession();
      // Mark all 9 questions as addressed
      for (let i = 1; i <= 9; i++) {
        session.questions[i].status = 'addressed';
        session.questions[i].userResponse = `Answer for Q${i}`;
      }

      const result = await handleSuggestNext(session);

      expect(result.type).toBe('suggest');
      expect(result.suggestions).toEqual([]);
      expect(result.message).toContain('all 9');
      expect(result.message).toContain('reflection');
      // Should NOT call the LLM when all questions are done
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('when there are remaining questions', () => {
    it('returns suggestions from LLM response', async () => {
      const session = buildSession();
      session.questions[1].status = 'addressed';
      session.questions[1].userResponse = 'We want to improve local parks.';
      session.conversationHistory = [
        { role: 'user', content: 'Our goal is park improvements' },
        { role: 'assistant', content: 'Great, you have clear goals.' },
      ];

      mockLLMResponse(JSON.stringify({
        suggestions: [
          { questionId: 2, reason: 'Now that goals are clear, identify who to engage.' },
          { questionId: 6, reason: 'Define what participants will do.' },
        ],
      }));

      const result = await handleSuggestNext(session);

      expect(result.type).toBe('suggest');
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0].questionId).toBe(2);
      expect(result.suggestions[1].questionId).toBe(6);
      expect(result.message).toContain('Have you identified the right participants?');
      expect(result.message).toContain('Have you defined the tasks?');
      expect(result.message).toContain('Which of these would you like to explore');
    });

    it('caps suggestions at 3 even if LLM returns more', async () => {
      const session = buildSession();

      mockLLMResponse(JSON.stringify({
        suggestions: [
          { questionId: 1, reason: 'r1' },
          { questionId: 2, reason: 'r2' },
          { questionId: 3, reason: 'r3' },
          { questionId: 4, reason: 'r4' },
          { questionId: 5, reason: 'r5' },
        ],
      }));

      const result = await handleSuggestNext(session);

      expect(result.suggestions).toHaveLength(3);
    });

    it('handles LLM returning JSON wrapped in markdown fences', async () => {
      const session = buildSession();
      session.questions[1].status = 'addressed';

      mockLLMResponse('```json\n{ "suggestions": [{ "questionId": 3, "reason": "reach participants" }] }\n```');

      const result = await handleSuggestNext(session);

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].questionId).toBe(3);
    });
  });

  describe('with resolvedQuestionId', () => {
    it('includes resolved question context in the LLM prompt', async () => {
      const session = buildSession();
      session.questions[1].status = 'addressed';
      session.questions[1].userResponse = 'Improve local park accessibility.';

      mockLLMResponse(JSON.stringify({
        suggestions: [{ questionId: 2, reason: 'identify stakeholders' }],
      }));

      await handleSuggestNext(session, 1);

      // Verify the system prompt sent to LLM contains resolved question context
      const callArgs = mockCreate.mock.calls[0][0];
      const systemMsg = callArgs.messages.find((m) => m.role === 'system');
      expect(systemMsg.content).toContain('Just resolved: Q1');
      expect(systemMsg.content).toContain('Improve local park accessibility.');
    });

    it('handles missing resolvedQuestionId gracefully', async () => {
      const session = buildSession();

      mockLLMResponse(JSON.stringify({
        suggestions: [{ questionId: 1, reason: 'start here' }],
      }));

      await handleSuggestNext(session, null);

      const callArgs = mockCreate.mock.calls[0][0];
      const systemMsg = callArgs.messages.find((m) => m.role === 'system');
      expect(systemMsg.content).toContain('No specific question just resolved');
    });
  });

  describe('conversation history context', () => {
    it('includes recent conversation in LLM prompt (up to 6 messages)', async () => {
      const session = buildSession();
      for (let i = 0; i < 10; i++) {
        session.conversationHistory.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `message-${i}`,
        });
      }

      mockLLMResponse(JSON.stringify({
        suggestions: [{ questionId: 1, reason: 'reason' }],
      }));

      await handleSuggestNext(session);

      const callArgs = mockCreate.mock.calls[0][0];
      const systemMsg = callArgs.messages.find((m) => m.role === 'system');
      // Should contain the LAST 6 messages (indices 4-9), not the first
      expect(systemMsg.content).toContain('message-4');
      expect(systemMsg.content).toContain('message-9');
      expect(systemMsg.content).not.toContain('message-3');
    });
  });

  describe('error handling / fallback', () => {
    it('returns fallback suggestions when LLM call fails', async () => {
      const session = buildSession();
      session.questions[1].status = 'addressed';

      mockCreate.mockRejectedValueOnce(new Error('API timeout'));

      const result = await handleSuggestNext(session);

      expect(result.type).toBe('suggest');
      expect(result.suggestions.length).toBeGreaterThan(0);
      // Fallback picks the first 3 remaining questions
      expect(result.suggestions[0].questionId).toBe(2);
      expect(result.message).toContain("haven't covered yet");
    });

    it('returns fallback when LLM returns invalid JSON', async () => {
      const session = buildSession();

      mockLLMResponse('This is not JSON at all');

      const result = await handleSuggestNext(session);

      expect(result.type).toBe('suggest');
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.message).toContain("haven't covered yet");
    });

    it('returns fallback when LLM returns empty content', async () => {
      const session = buildSession();

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '' } }],
      });

      const result = await handleSuggestNext(session);

      expect(result.type).toBe('suggest');
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('LLM call parameters', () => {
    it('uses temperature 0 for deterministic output', async () => {
      const session = buildSession();

      mockLLMResponse(JSON.stringify({
        suggestions: [{ questionId: 1, reason: 'reason' }],
      }));

      await handleSuggestNext(session);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0);
    });

    it('sends correct message structure to LLM', async () => {
      const session = buildSession();

      mockLLMResponse(JSON.stringify({
        suggestions: [{ questionId: 1, reason: 'reason' }],
      }));

      await handleSuggestNext(session);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(2);
      expect(callArgs.messages[0].role).toBe('system');
      expect(callArgs.messages[1].role).toBe('user');
      expect(callArgs.messages[1].content).toContain('Return JSON only');
    });
  });

  describe('message formatting', () => {
    it('skips suggestions with invalid questionIds not in remaining', async () => {
      const session = buildSession();
      // Mark Q1 as addressed so it's not in remaining
      session.questions[1].status = 'addressed';

      mockLLMResponse(JSON.stringify({
        suggestions: [
          { questionId: 1, reason: 'already done' },  // addressed — not in remaining
          { questionId: 2, reason: 'valid suggestion' },
        ],
      }));

      const result = await handleSuggestNext(session);

      // Message should only contain Q2, not Q1
      expect(result.message).toContain('Have you identified the right participants?');
      expect(result.message).not.toContain("Have you articulated the project's goals?");
    });
  });
});
