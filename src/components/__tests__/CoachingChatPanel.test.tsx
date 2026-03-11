import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoachingChatPanel, type AssessmentCard } from '../CoachingChatPanel';

vi.mock('../ui/markdown-content', () => ({
  MarkdownContent: ({ children }: { children: string }) => (
    <span data-testid="markdown">{children}</span>
  ),
}));

const MOCK_CARD: AssessmentCard = {
  questionId: 5,
  question: 'Have you included incentives for participation?',
  status: 'partial',
  gap: 'Response lacks specific incentive types and how they match participants.',
  coachingContext: 'You mentioned thinking about incentives — great start! Can you describe what specific incentives you have in mind?',
};

const MOCK_ALL_CARDS: AssessmentCard[] = [
  MOCK_CARD,
  {
    questionId: 1,
    question: "Have you articulated the project's goals?",
    status: 'addressed',
    gap: '',
    coachingContext: '',
  },
  {
    questionId: 2,
    question: 'Have you identified the right participants?',
    status: 'not-addressed',
    gap: 'No participants identified.',
    coachingContext: '',
  },
];

const defaultProps = {
  card: MOCK_CARD,
  allCards: MOCK_ALL_CARDS,
  userResponse: 'I think incentives might help get people involved.',
  onClose: vi.fn(),
  onStatusChange: vi.fn(),
};

function sseResponse(content: string) {
  return {
    ok: true,
    text: () => Promise.resolve(`data: {"content":"${content}"}\ndata: [DONE]\n`),
  };
}

describe('CoachingChatPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    // Mock cross-resolution endpoint to return no resolved questions by default
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/analyze-cross-resolution') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ resolvedQuestionIds: [] }),
        });
      }
      return Promise.resolve(sseResponse('Coach reply'));
    });
  });

  describe('Rendering', () => {
    it('shows the coaching chat header with the question', () => {
      render(<CoachingChatPanel {...defaultProps} />);
      expect(screen.getByText('Coaching Chat')).toBeInTheDocument();
      expect(screen.getByText(MOCK_CARD.question)).toBeInTheDocument();
    });

    it('shows the initial coaching context message', () => {
      render(<CoachingChatPanel {...defaultProps} />);
      expect(screen.getByText(MOCK_CARD.coachingContext)).toBeInTheDocument();
    });

    it('shows the input field and send button', () => {
      render(<CoachingChatPanel {...defaultProps} />);
      expect(screen.getByPlaceholderText('Type your response...')).toBeInTheDocument();
    });

    it('shows "Mark as Resolved" for partial status', () => {
      render(<CoachingChatPanel {...defaultProps} />);
      expect(screen.getByText('Mark as Resolved')).toBeInTheDocument();
    });

    it('shows "Mark as Unresolved" for addressed status', () => {
      const addressedCard = { ...MOCK_CARD, status: 'addressed' as const };
      render(<CoachingChatPanel {...defaultProps} card={addressedCard} />);
      expect(screen.getByText('Mark as Unresolved')).toBeInTheDocument();
    });
  });

  describe('Sending messages', () => {
    it('sends a message and shows it in the chat', async () => {
      const user = userEvent.setup();
      render(<CoachingChatPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Type your response...');
      await user.type(input, 'We plan to offer gift cards');
      await user.keyboard('{Enter}');

      expect(screen.getByText('We plan to offer gift cards')).toBeInTheDocument();
    });

    it('clears the input after sending', async () => {
      const user = userEvent.setup();
      render(<CoachingChatPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Type your response...') as HTMLInputElement;
      await user.type(input, 'Gift cards');
      await user.keyboard('{Enter}');

      expect(input.value).toBe('');
    });

    it('shows the bot response from SSE stream', async () => {
      const user = userEvent.setup();
      render(<CoachingChatPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Type your response...');
      await user.type(input, 'Gift cards for participants');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByText('Coach reply')).toBeInTheDocument();
      });
    });

    it('shows error message when API fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      const user = userEvent.setup();
      render(<CoachingChatPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Type your response...');
      await user.type(input, 'Test');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByText(/encountered an error/i)).toBeInTheDocument();
      });
    });

    it('does not send empty messages', async () => {
      const user = userEvent.setup();
      render(<CoachingChatPanel {...defaultProps} />);

      await user.keyboard('{Enter}');

      expect(global.fetch).not.toHaveBeenCalledWith(
        '/api/chatbot',
        expect.anything(),
      );
    });

    it('sends conversation context with the coaching prefix', async () => {
      const user = userEvent.setup();
      render(<CoachingChatPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Type your response...');
      await user.type(input, 'Test message');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
        const chatbotCall = calls.find((c) => c[0] === '/api/chatbot');
        expect(chatbotCall).toBeDefined();

        const body = JSON.parse(chatbotCall![1].body);
        expect(body.message).toBe('Test message');
        expect(body.conversation[0].content).toContain('[COACHING CONTEXT');
        expect(body.conversation[0].content).toContain(MOCK_CARD.question);
      });
    });
  });

  describe('Status toggle', () => {
    it('calls onStatusChange when Mark as Resolved is clicked', async () => {
      const user = userEvent.setup();
      render(<CoachingChatPanel {...defaultProps} />);

      await user.click(screen.getByText('Mark as Resolved'));

      expect(defaultProps.onStatusChange).toHaveBeenCalledWith(5, 'addressed');
    });

    it('toggles to Mark as Unresolved after resolving', async () => {
      const user = userEvent.setup();
      render(<CoachingChatPanel {...defaultProps} />);

      await user.click(screen.getByText('Mark as Resolved'));

      expect(screen.getByText('Mark as Unresolved')).toBeInTheDocument();
    });
  });

  describe('Close', () => {
    it('calls onClose when backdrop is clicked', async () => {
      const user = userEvent.setup();
      render(<CoachingChatPanel {...defaultProps} />);

      const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
      await user.click(backdrop);

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('calls onClose when X button is clicked', async () => {
      const user = userEvent.setup();
      render(<CoachingChatPanel {...defaultProps} />);

      const buttons = screen.getAllByRole('button');
      const closeBtn = buttons.find((b) => b.querySelector('.lucide-x'));
      if (closeBtn) await user.click(closeBtn);

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('Chat history persistence', () => {
    it('saves messages to sessionStorage', async () => {
      const user = userEvent.setup();
      render(<CoachingChatPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('Type your response...');
      await user.type(input, 'Persisted message');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        const saved = sessionStorage.getItem('nestaChat_5');
        expect(saved).toBeTruthy();
        const parsed = JSON.parse(saved!);
        expect(parsed.some((m: { content: string }) => m.content === 'Persisted message')).toBe(true);
      });
    });

    it('restores messages from sessionStorage on mount', () => {
      const history = [
        { role: 'ai', content: 'Welcome back!' },
        { role: 'user', content: 'Previous message' },
      ];
      sessionStorage.setItem('nestaChat_5', JSON.stringify(history));

      render(<CoachingChatPanel {...defaultProps} />);

      expect(screen.getByText('Welcome back!')).toBeInTheDocument();
      expect(screen.getByText('Previous message')).toBeInTheDocument();
    });
  });
});
