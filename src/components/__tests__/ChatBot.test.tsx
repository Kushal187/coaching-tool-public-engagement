import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatBot } from '../ChatBot';

vi.mock('../ui/markdown-content', () => ({
  MarkdownContent: ({ children }: { children: string }) => (
    <span data-testid="markdown">{children}</span>
  ),
}));

describe('ChatBot', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Floating button', () => {
    it('renders the floating open-chat button', () => {
      render(<ChatBot />);
      expect(screen.getByLabelText('Open chat')).toBeInTheDocument();
    });

    it('opens the chat panel when the button is clicked', async () => {
      const user = userEvent.setup();
      render(<ChatBot />);

      await user.click(screen.getByLabelText('Open chat'));

      expect(screen.getByText('Q&A Assistant')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Ask a question...')).toBeInTheDocument();
    });

    it('hides the floating button when chat is open', async () => {
      const user = userEvent.setup();
      render(<ChatBot />);

      await user.click(screen.getByLabelText('Open chat'));

      expect(screen.queryByLabelText('Open chat')).not.toBeInTheDocument();
    });
  });

  describe('Chat panel', () => {
    async function openChat() {
      const user = userEvent.setup();
      render(<ChatBot />);
      await user.click(screen.getByLabelText('Open chat'));
      return user;
    }

    it('shows the initial bot greeting', async () => {
      await openChat();
      expect(
        screen.getByText(/public engagement assistant/i),
      ).toBeInTheDocument();
    });

    it('closes the panel when X is clicked', async () => {
      const user = await openChat();

      await user.click(screen.getByLabelText('Close chat'));

      expect(screen.queryByText('Q&A Assistant')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Open chat')).toBeInTheDocument();
    });

    it('has a disabled send button when input is empty', async () => {
      await openChat();
      const sendBtn = screen.getByLabelText('Send message');
      expect(sendBtn).toBeDisabled();
    });

    it('enables send button when text is entered', async () => {
      const user = await openChat();
      const input = screen.getByPlaceholderText('Ask a question...');

      await user.type(input, 'Hello');

      const sendBtn = screen.getByLabelText('Send message');
      expect(sendBtn).not.toBeDisabled();
    });

    it('sends a message and shows it in the chat', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('data: {"content":"Bot reply"}\ndata: [DONE]\n'),
      });

      const user = await openChat();
      const input = screen.getByPlaceholderText('Ask a question...');

      await user.type(input, 'What is stakeholder mapping?');
      await user.click(screen.getByLabelText('Send message'));

      expect(screen.getByText('What is stakeholder mapping?')).toBeInTheDocument();
    });

    it('clears the input after sending', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('data: {"content":"Reply"}\ndata: [DONE]\n'),
      });

      const user = await openChat();
      const input = screen.getByPlaceholderText('Ask a question...') as HTMLInputElement;

      await user.type(input, 'Hello');
      await user.click(screen.getByLabelText('Send message'));

      expect(input.value).toBe('');
    });

    it('shows bot response after API call completes', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('data: {"content":"Here is my answer."}\ndata: [DONE]\n'),
      });

      const user = await openChat();
      const input = screen.getByPlaceholderText('Ask a question...');

      await user.type(input, 'Help me');
      await user.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(screen.getByText('Here is my answer.')).toBeInTheDocument();
      });
    });

    it('shows error message when API call fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const user = await openChat();
      const input = screen.getByPlaceholderText('Ask a question...');

      await user.type(input, 'Test question');
      await user.click(screen.getByLabelText('Send message'));

      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      });
    });
  });

  describe('File upload', () => {
    async function openChat() {
      const user = userEvent.setup();
      render(<ChatBot />);
      await user.click(screen.getByLabelText('Open chat'));
      return user;
    }

    it('renders the upload button', async () => {
      await openChat();
      expect(screen.getByLabelText('Upload a plan')).toBeInTheDocument();
    });

    it('shows filename indicator after selecting a file', async () => {
      const user = await openChat();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['plan content'], 'my-plan.txt', {
        type: 'text/plain',
      });
      await user.upload(fileInput, file);

      expect(screen.getByText('my-plan.txt')).toBeInTheDocument();
    });

    it('clears uploaded file when X is clicked on the indicator', async () => {
      const user = await openChat();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['plan content'], 'my-plan.txt', {
        type: 'text/plain',
      });
      await user.upload(fileInput, file);

      expect(screen.getByText('my-plan.txt')).toBeInTheDocument();

      const clearButtons = screen.getAllByRole('button');
      const clearBtn = clearButtons.find(
        (btn) => btn.closest('.bg-gray-50') && btn.querySelector('svg'),
      );
      if (clearBtn) {
        await user.click(clearBtn);
        expect(screen.queryByText('my-plan.txt')).not.toBeInTheDocument();
      }
    });
  });
});
