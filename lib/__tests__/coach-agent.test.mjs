// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ───────────────────────────────────────

const mockRunAgentLoop = vi.fn();
vi.mock('../agent-runner.mjs', () => ({
  runAgentLoop: mockRunAgentLoop,
}));

vi.mock('../agent-tools.mjs', () => ({
  agentToolDefinitions: [{ type: 'function', function: { name: 'search_knowledge_base' } }],
  agentToolImplementations: { search_knowledge_base: vi.fn() },
}));

vi.mock('../../prompts/load.mjs', () => ({
  COACH_AGENT_OPEN_PROMPT: 'OPEN coach for {{question}} | Explanation: {{explanation}} | User so far: {{userResponse}}',
  COACH_AGENT_CONTINUE_PROMPT: 'CONTINUE coach for {{question}} | Explanation: {{explanation}} | User so far: {{userResponse}}',
}));

const { coachResponse } = await import('../coach-agent.mjs');
const { getOrCreateSession } = await import('../session-state.mjs');

// ── Helpers ─────────────────────────────────────────────────

function freshSession() {
  return getOrCreateSession(`coach-test-${Date.now()}-${Math.random()}`);
}

function agentResult(text, sources = []) {
  return { text, sources };
}

// ── Tests ───────────────────────────────────────────────────

describe('coachResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns coaching response for a valid question', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Great question! Let me help you articulate your goals.'));

    const result = await coachResponse(1, 'We want to improve local parks', session);

    expect(result.message).toContain('help you articulate your goals');
    expect(result.resolved).toBe(false);
    expect(result.questionId).toBe(1);
  });

  it('detects resolution marker and marks question as addressed', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockResolvedValueOnce(
      agentResult('You have clearly defined your goals. [[RESOLVED]]'),
    );

    const result = await coachResponse(1, 'Our goal is to increase park usage by 20%', session);

    expect(result.resolved).toBe(true);
    expect(result.message).toBe('You have clearly defined your goals.');
    expect(session.questions[1].status).toBe('addressed');
    expect(session.questions[1].userResponse).toContain('increase park usage');
  });

  it('strips [[RESOLVED]] marker from the response message', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Well done! [[RESOLVED]]'));

    const result = await coachResponse(1, 'answer', session);
    expect(result.message).not.toContain('[[RESOLVED]]');
    expect(result.message).toBe('Well done!');
  });

  it('updates question status to in-progress on first interaction', async () => {
    const session = freshSession();
    expect(session.questions[3].status).toBe('not-started');

    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Tell me more about your outreach strategy.'));

    await coachResponse(3, 'We use social media', session);

    expect(session.questions[3].status).toBe('in-progress');
  });

  it('does not downgrade status from in-progress on subsequent turns', async () => {
    const session = freshSession();
    session.questions[3].status = 'in-progress';

    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Good, what else?'));

    await coachResponse(3, 'We also do door-to-door', session);

    expect(session.questions[3].status).toBe('in-progress');
  });

  it('records coaching history on the question state', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Let me help.'));

    await coachResponse(2, 'We need to find stakeholders', session);

    const history = session.questions[2].coachingHistory;
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: 'user', content: 'We need to find stakeholders' });
    expect(history[1]).toEqual({ role: 'coach', content: 'Let me help.' });
  });

  it('sets activeQuestionId on the session', async () => {
    const session = freshSession();
    expect(session.activeQuestionId).toBeNull();

    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Response'));
    await coachResponse(7, 'workflow question', session);

    expect(session.activeQuestionId).toBe(7);
  });

  it('returns error message for invalid question ID', async () => {
    const session = freshSession();

    const result = await coachResponse(99, 'test', session);

    expect(result.message).toContain("couldn't find question");
    expect(result.resolved).toBe(false);
    expect(mockRunAgentLoop).not.toHaveBeenCalled();
  });

  it('handles agent loop error gracefully', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockRejectedValueOnce(new Error('OpenAI timeout'));

    const result = await coachResponse(1, 'test', session);

    expect(result.message).toContain('trouble connecting');
    expect(result.resolved).toBe(false);
  });

  it('handles empty agent loop response', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockResolvedValueOnce(agentResult(''));

    const result = await coachResponse(1, 'test', session);

    expect(result.message).toContain('rephrase');
    expect(result.resolved).toBe(false);
  });

  it('handles null agent loop response', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockResolvedValueOnce(agentResult(null));

    const result = await coachResponse(1, 'test', session);

    expect(result.message).toContain('rephrase');
    expect(result.resolved).toBe(false);
  });

  it('compiles userResponse from coaching history when resolved', async () => {
    const session = freshSession();
    // Simulate prior coaching turns
    session.questions[1].coachingHistory = [
      { role: 'user', content: 'We want to engage youth' },
      { role: 'coach', content: 'Good start' },
      { role: 'user', content: 'Specifically ages 16-24' },
      { role: 'coach', content: 'Great specificity' },
    ];

    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Excellent, you have clear goals. [[RESOLVED]]'));

    await coachResponse(1, 'In local parks and community centers', session);

    expect(session.questions[1].userResponse).toContain('engage youth');
    expect(session.questions[1].userResponse).toContain('ages 16-24');
    expect(session.questions[1].userResponse).toContain('local parks');
  });

  it('builds system prompt with turn-count context after 3+ exchanges', async () => {
    const session = freshSession();
    // Simulate 3 prior user messages
    session.questions[1].coachingHistory = [
      { role: 'user', content: 'msg1' },
      { role: 'coach', content: 'reply1' },
      { role: 'user', content: 'msg2' },
      { role: 'coach', content: 'reply2' },
      { role: 'user', content: 'msg3' },
      { role: 'coach', content: 'reply3' },
    ];

    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Final response. [[RESOLVED]]'));

    await coachResponse(1, 'msg4', session);

    // Verify the system prompt sent to agent loop contains resolution nudge
    const callArgs = mockRunAgentLoop.mock.calls[0][0];
    const systemMsg = callArgs.messages[0];
    expect(systemMsg.content).toContain('exchange #4');
    expect(systemMsg.content).toContain('lean toward resolving');
  });

  it('passes through sources from the agent loop', async () => {
    const session = freshSession();
    const mockSources = [
      { title: 'Handbook', sourceUrl: 'https://example.com/handbook', contentTypeLabel: 'Guide' },
    ];
    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Here is advice.', mockSources));

    const result = await coachResponse(1, 'Help me', session);

    expect(result.sources).toEqual(mockSources);
  });
});
