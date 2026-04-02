import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { UnifiedChat } from '../UnifiedChat';

// ── Mocks ──────────────────────────────────────────────────

const mockNavigate = vi.fn();
let mockLocationState: Record<string, unknown> = {};

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({
      state: mockLocationState,
      pathname: '/coach',
      search: '',
      hash: '',
      key: 'default',
    }),
  };
});

vi.mock('../ui/markdown-content', () => ({
  MarkdownContent: ({ children }: { children: string }) => (
    <span data-testid="md">{children}</span>
  ),
}));

// ── Helpers ─────────────────────────────────────────────────

function renderChat() {
  return render(
    <MemoryRouter initialEntries={['/coach']}>
      <Routes>
        <Route path="/coach" element={<UnifiedChat />} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockSSEResponse(content: string, metadata?: Record<string, unknown>) {
  const lines: string[] = [];
  if (content) lines.push(`data: ${JSON.stringify({ content })}`);
  if (metadata) lines.push(`data: ${JSON.stringify({ metadata })}`);
  lines.push('data: [DONE]');

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(lines.join('\n')),
  });
}

// ── Tests ───────────────────────────────────────────────────

describe('UnifiedChat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockClear();
    mockLocationState = {};
    sessionStorage.clear();
  });

  describe('Initial render', () => {
    it('renders the welcome message', () => {
      renderChat();
      expect(
        screen.getByText(/public engagement coach/i),
      ).toBeInTheDocument();
    });

    it('renders the text input', () => {
      renderChat();
      expect(
        screen.getByPlaceholderText(/public engagement project/i),
      ).toBeInTheDocument();
    });

    it('renders the send button', () => {
      renderChat();
      expect(screen.getByLabelText('Send message')).toBeInTheDocument();
    });

    it('disables send button when input is empty', () => {
      renderChat();
      const btn = screen.getByLabelText('Send message');
      expect(btn).toBeDisabled();
    });

    it('renders the knowledge base disclaimer', () => {
      renderChat();
      expect(
        screen.getByText(/grounded in our curated knowledge base/i),
      ).toBeInTheDocument();
    });
  });

  describe('Sending messages', () => {
    it('enables send button when text is entered', async () => {
      const user = userEvent.setup();
      renderChat();

      const input = screen.getByPlaceholderText(/public engagement project/i);
      await user.type(input, 'Hello');

      expect(screen.getByLabelText('Send message')).not.toBeDisabled();
    });

    it('adds user message to the chat on send', async () => {
      mockSSEResponse('Bot reply');
      const user = userEvent.setup();
      renderChat();

      const input = screen.getByPlaceholderText(/public engagement project/i);
      await user.type(input, 'I want to engage communities');
      await user.click(screen.getByLabelText('Send message'));

      expect(screen.getByText('I want to engage communities')).toBeInTheDocument();
    });

    it('clears the input after sending', async () => {
      mockSSEResponse('Reply');
      const user = userEvent.setup();
      renderChat();

      const input = screen.getByPlaceholderText(/public engagement project/i) as HTMLTextAreaElement;
      await user.type(input, 'Test message');
      await user.click(screen.getByLabelText('Send message'));

      expect(input.value).toBe('');
    });

    it('shows bot response after API call', async () => {
      mockSSEResponse('Here is my coaching advice.');
      const user = userEvent.setup();
      renderChat();

      const input = screen.getByPlaceholderText(/public engagement project/i);
      await user.type(input, 'Help me');
      await user.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(screen.getByText('Here is my coaching advice.')).toBeInTheDocument();
      });
    });

    it('sends message on Enter key', async () => {
      mockSSEResponse('Response');
      const user = userEvent.setup();
      renderChat();

      const input = screen.getByPlaceholderText(/public engagement project/i);
      await user.type(input, 'My question{Enter}');

      await waitFor(() => {
        expect(screen.getByText('Response')).toBeInTheDocument();
      });
    });

    it('does not send on Shift+Enter (allows newline)', async () => {
      global.fetch = vi.fn();
      const user = userEvent.setup();
      renderChat();

      const input = screen.getByPlaceholderText(/public engagement project/i) as HTMLTextAreaElement;
      await user.type(input, 'Line 1{Shift>}{Enter}{/Shift}Line 2');

      // Message should not be sent — fetch should not have been called
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('shows error message when API returns non-ok', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const user = userEvent.setup();
      renderChat();

      const input = screen.getByPlaceholderText(/public engagement project/i);
      await user.type(input, 'Test');
      await user.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      });
    });

    it('shows connection error when fetch throws', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const user = userEvent.setup();
      renderChat();

      const input = screen.getByPlaceholderText(/public engagement project/i);
      await user.type(input, 'Test');
      await user.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(screen.getByText(/could not connect/i)).toBeInTheDocument();
      });
    });
  });

  describe('Initial message from Home page', () => {
    it('fires API call automatically when initialMessage is provided', async () => {
      mockSSEResponse('Welcome, let me help you with parks.');
      mockLocationState = { initialMessage: 'How do I engage about parks?' };

      renderChat();

      // The user message should appear
      expect(screen.getByText('How do I engage about parks?')).toBeInTheDocument();

      // The bot response should eventually appear
      await waitFor(() => {
        expect(screen.getByText('Welcome, let me help you with parks.')).toBeInTheDocument();
      });
    });
  });

  describe('Reflection button', () => {
    it('does not show Generate Reflection when no questions addressed', () => {
      renderChat();
      expect(screen.queryByText('Generate Reflection')).not.toBeInTheDocument();
    });

    it('shows Generate Reflection when addressedCount > 0', async () => {
      const metadata = {
        sessionSummary: {
          activeQuestionId: 1,
          addressedCount: 2,
          inProgressCount: 0,
          totalQuestions: 9,
          questions: [],
        },
      };
      mockSSEResponse('Great answer!', metadata);

      const user = userEvent.setup();
      renderChat();

      const input = screen.getByPlaceholderText(/public engagement project/i);
      await user.type(input, 'Test');
      await user.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(screen.getByText('Generate Reflection')).toBeInTheDocument();
      });
    });
  });

  describe('Suggestion chips', () => {
    it('renders suggestion chips when metadata includes suggestions', async () => {
      const metadata = {
        handler: 'suggest',
        suggestions: [
          { questionId: 2, reason: 'Identify participants' },
          { questionId: 6, reason: 'Define tasks' },
        ],
        sessionSummary: {
          activeQuestionId: null,
          addressedCount: 1,
          inProgressCount: 0,
          totalQuestions: 9,
          questions: [
            { id: 2, question: 'Have you identified the right participants?', status: 'not-started', hasCoachingHistory: false },
            { id: 6, question: 'Have you defined the tasks?', status: 'not-started', hasCoachingHistory: false },
          ],
        },
      };
      mockSSEResponse('Here are some suggestions:', metadata);

      const user = userEvent.setup();
      renderChat();

      const input = screen.getByPlaceholderText(/public engagement project/i);
      await user.type(input, 'What should I work on next?');
      await user.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(screen.getByText('Have you identified the right participants?')).toBeInTheDocument();
        expect(screen.getByText('Have you defined the tasks?')).toBeInTheDocument();
      });
    });
  });

  describe('Session persistence', () => {
    it('persists messages to sessionStorage', async () => {
      mockSSEResponse('Persisted reply');
      const user = userEvent.setup();
      renderChat();

      const input = screen.getByPlaceholderText(/public engagement project/i);
      await user.type(input, 'Save this');
      await user.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(screen.getByText('Persisted reply')).toBeInTheDocument();
      });

      const stored = sessionStorage.getItem('coach-chat-state');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.messages.length).toBeGreaterThan(1);
    });

    it('clears saved state when initialMessage is provided', () => {
      sessionStorage.setItem(
        'coach-chat-state',
        JSON.stringify({
          sessionId: 'old-session',
          messages: [{ id: 'old', role: 'assistant', content: 'Old message' }],
          lastMetadata: null,
        }),
      );

      mockSSEResponse('Fresh start');
      mockLocationState = { initialMessage: 'New conversation' };
      renderChat();

      // Should NOT see old message
      expect(screen.queryByText('Old message')).not.toBeInTheDocument();
      // Should see new initial message
      expect(screen.getByText('New conversation')).toBeInTheDocument();
    });
  });
});
