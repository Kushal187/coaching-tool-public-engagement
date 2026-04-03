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
  RETRIEVAL_AGENT_PROMPT: 'Retrieval agent. Context: {{CONTEXT_BLOCK}} | Query: {{userQuery}}',
}));

const { retrievalResponse } = await import('../retrieval-agent.mjs');
const { getOrCreateSession } = await import('../session-state.mjs');

// ── Helpers ─────────────────────────────────────────────────

function freshSession() {
  return getOrCreateSession(`retr-test-${Date.now()}-${Math.random()}`);
}

function agentResult(text, sources = []) {
  return { text, sources };
}

// ── Tests ───────────────────────────────────────────────────

describe('retrievalResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns knowledge base results for a query', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockResolvedValueOnce(
      agentResult('Here are some examples of community engagement from Taiwan and Australia.'),
    );

    const result = await retrievalResponse('Show me engagement examples', session);

    expect(result.message).toContain('Taiwan');
    expect(result.type).toBe('retrieval');
  });

  it('includes question context when activeQuestionId is set', async () => {
    const session = freshSession();
    session.activeQuestionId = 3;

    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Based on reaching participants...'));

    await retrievalResponse('How do I reach people?', session);

    const callArgs = mockRunAgentLoop.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain('Q3');
    expect(callArgs.systemPrompt).toContain('reach');
  });

  it('uses general context when no activeQuestionId', async () => {
    const session = freshSession();
    session.activeQuestionId = null;

    mockRunAgentLoop.mockResolvedValueOnce(agentResult('General info...'));

    await retrievalResponse('What is public engagement?', session);

    const callArgs = mockRunAgentLoop.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain('generally');
  });

  it('handles agent loop error gracefully', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockRejectedValueOnce(new Error('Weaviate down'));

    const result = await retrievalResponse('find examples', session);

    expect(result.message).toContain('trouble searching');
    expect(result.type).toBe('retrieval');
  });

  it('handles empty agent response', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockResolvedValueOnce(agentResult(''));

    const result = await retrievalResponse('obscure query', session);

    expect(result.message).toContain('rephrase');
    expect(result.type).toBe('retrieval');
  });

  it('handles null agent response', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockResolvedValueOnce(agentResult(null));

    const result = await retrievalResponse('another query', session);

    expect(result.message).toContain('rephrase');
    expect(result.type).toBe('retrieval');
  });

  it('passes user message to agent loop', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Response'));

    await retrievalResponse('Show me case studies about youth engagement', session);

    const callArgs = mockRunAgentLoop.mock.calls[0][0];
    expect(callArgs.userMessage).toBe('Show me case studies about youth engagement');
  });

  it('injects user query into the system prompt', async () => {
    const session = freshSession();
    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Response'));

    await retrievalResponse('examples of digital democracy', session);

    const callArgs = mockRunAgentLoop.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain('examples of digital democracy');
  });

  it('passes through sources from the agent loop', async () => {
    const session = freshSession();
    const mockSources = [
      { title: 'Case Study', sourceUrl: 'https://example.com/case', contentTypeLabel: 'Case study' },
    ];
    mockRunAgentLoop.mockResolvedValueOnce(agentResult('Found some results.', mockSources));

    const result = await retrievalResponse('find examples', session);

    expect(result.sources).toEqual(mockSources);
  });
});
