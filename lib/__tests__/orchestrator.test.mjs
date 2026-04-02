// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ───────────────────────────────────────

const mockCreate = vi.fn();
vi.mock('../weaviate-client.mjs', () => ({
  openaiClient: {
    chat: { completions: { create: mockCreate } },
  },
}));

vi.mock('../../prompts/load.mjs', () => ({
  ORCHESTRATOR_PROMPT: 'SYSTEM: {{NESTA_QUESTIONS}}',
}));

const { classifyIntent, routeMessage } = await import('../orchestrator.mjs');
const { getOrCreateSession } = await import('../session-state.mjs');

// ── Helpers ─────────────────────────────────────────────────

function freshSession() {
  return getOrCreateSession(`orch-test-${Date.now()}-${Math.random()}`);
}

function mockLLMResponse(content) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content } }],
  });
}

// ── Tests ───────────────────────────────────────────────────

describe('orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('classifyIntent', () => {
    it('parses a valid map_to_question response', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({
        action: 'map_to_question',
        questionId: 3,
        reasoning: 'User is asking about reaching participants',
      }));

      const result = await classifyIntent('How do I reach rural communities?', session);

      expect(result.action).toBe('map_to_question');
      expect(result.questionId).toBe(3);
      expect(result.reasoning).toContain('reaching participants');
    });

    it('parses a retrieve action', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({
        action: 'retrieve',
        questionId: 1,
        reasoning: 'User wants examples',
      }));

      const result = await classifyIntent('Show me some examples', session);
      expect(result.action).toBe('retrieve');
    });

    it('parses a suggest_next action', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({
        action: 'suggest_next',
        questionId: null,
        reasoning: 'User wants to know what to work on',
      }));

      const result = await classifyIntent('What should I do next?', session);
      expect(result.action).toBe('suggest_next');
      expect(result.questionId).toBeNull();
    });

    it('handles JSON wrapped in markdown fences', async () => {
      const session = freshSession();
      mockLLMResponse('```json\n{"action":"coach_continue","questionId":5,"reasoning":"cont"}\n```');

      const result = await classifyIntent('Tell me more', session);
      expect(result.action).toBe('coach_continue');
      expect(result.questionId).toBe(5);
    });

    it('falls back to general for invalid action', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({
        action: 'invalid_action',
        questionId: null,
        reasoning: 'test',
      }));

      const result = await classifyIntent('hello', session);
      expect(result.action).toBe('general');
    });

    it('sets questionId to null for out-of-range values', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({
        action: 'map_to_question',
        questionId: 15,
        reasoning: 'test',
      }));

      const result = await classifyIntent('test', session);
      expect(result.questionId).toBeNull();
    });

    it('sets questionId to null for questionId 0', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({
        action: 'map_to_question',
        questionId: 0,
        reasoning: 'test',
      }));

      const result = await classifyIntent('test', session);
      expect(result.questionId).toBeNull();
    });

    it('falls back to coach_continue when parse fails and activeQuestionId is set', async () => {
      const session = freshSession();
      session.activeQuestionId = 4;
      mockLLMResponse('Not valid JSON at all!');

      const result = await classifyIntent('hmm', session);
      expect(result.action).toBe('coach_continue');
      expect(result.questionId).toBe(4);
      expect(result.reasoning).toContain('Fallback');
    });

    it('falls back to general when parse fails and no activeQuestionId', async () => {
      const session = freshSession();
      mockLLMResponse('garbage response');

      const result = await classifyIntent('hello', session);
      expect(result.action).toBe('general');
      expect(result.questionId).toBeNull();
    });

    it('uses temperature 0 for deterministic classification', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({ action: 'general', questionId: null, reasoning: '' }));

      await classifyIntent('test', session);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0);
    });

    it('includes session state summary in user message', async () => {
      const session = freshSession();
      session.questions[1].status = 'addressed';
      session.activeQuestionId = 2;

      mockLLMResponse(JSON.stringify({ action: 'general', questionId: null, reasoning: '' }));

      await classifyIntent('test message', session);

      const callArgs = mockCreate.mock.calls[0][0];
      const userMsg = callArgs.messages.find((m) => m.role === 'user');
      expect(userMsg.content).toContain('SESSION STATE');
      expect(userMsg.content).toContain('test message');
      expect(userMsg.content).toContain('Q1 [addressed]');
    });
  });

  describe('routeMessage', () => {
    it('routes map_to_question to coach handler', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({ action: 'map_to_question', questionId: 2, reasoning: '' }));

      const result = await routeMessage('Who should I involve?', session);
      expect(result.handler).toBe('coach');
      expect(result.questionId).toBe(2);
    });

    it('routes coach_continue to coach handler', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({ action: 'coach_continue', questionId: 5, reasoning: '' }));

      const result = await routeMessage('Tell me more', session);
      expect(result.handler).toBe('coach');
      expect(result.questionId).toBe(5);
    });

    it('routes retrieve to retrieval handler', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({ action: 'retrieve', questionId: 3, reasoning: '' }));

      const result = await routeMessage('Show examples', session);
      expect(result.handler).toBe('retrieval');
    });

    it('routes suggest_next to suggest handler', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({ action: 'suggest_next', questionId: null, reasoning: '' }));

      const result = await routeMessage('What next?', session);
      expect(result.handler).toBe('suggest');
      expect(result.questionId).toBeNull();
    });

    it('routes general to general handler', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({ action: 'general', questionId: null, reasoning: '' }));

      const result = await routeMessage('Hi there', session);
      expect(result.handler).toBe('general');
    });

    it('stores the routing decision on the session', async () => {
      const session = freshSession();
      mockLLMResponse(JSON.stringify({ action: 'retrieve', questionId: 1, reasoning: 'needs examples' }));

      await routeMessage('Help me', session);
      expect(session.lastRoutingDecision).toBeTruthy();
      expect(session.lastRoutingDecision.action).toBe('retrieve');
    });
  });
});
