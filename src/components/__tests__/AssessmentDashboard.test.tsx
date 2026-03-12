import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AssessmentDashboard } from '../AssessmentDashboard';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../ui/markdown-content', () => ({
  MarkdownContent: ({ children }: { children: string }) => (
    <span data-testid="md">{children}</span>
  ),
}));

vi.mock('../CoachingChatPanel', () => ({
  CoachingChatPanel: ({ card }: { card: { questionId: number } }) => (
    <div data-testid="coaching-panel">
      <span>Coaching Q{card.questionId}</span>
    </div>
  ),
}));

const MOCK_RESPONSES = { 1: 'Goal answer', 2: 'Participant answer', 3: 'Reach answer', 4: 'Owner answer', 5: 'Incentives answer', 6: 'Tasks answer', 7: 'Workflow answer', 8: 'Evaluate answer', 9: 'Use answer' };

const MOCK_EVALUATIONS = [
  { questionId: 1, question: 'Have you articulated goals?', status: 'addressed', gap: null },
  { questionId: 2, question: 'Have you identified participants?', status: 'addressed', gap: null },
  { questionId: 3, question: 'Can you reach participants?', status: 'partial', gap: 'Needs more detail on channels' },
  { questionId: 4, question: 'Who is the right owner?', status: 'addressed', gap: null },
  { questionId: 5, question: 'Included incentives?', status: 'addressed', gap: null },
  { questionId: 6, question: 'Defined the tasks?', status: 'addressed', gap: null },
  { questionId: 7, question: 'Established workflow?', status: 'addressed', gap: null },
  { questionId: 8, question: 'How will you evaluate?', status: 'not-addressed', gap: 'No evaluation plan described' },
  { questionId: 9, question: 'How will you use outputs?', status: 'addressed', gap: null },
];

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AssessmentDashboard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockNavigate.mockClear();
  sessionStorage.clear();
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
});

describe('AssessmentDashboard', () => {
  it('redirects to /coach when no session data exists', () => {
    renderDashboard();
    expect(mockNavigate).toHaveBeenCalledWith('/coach');
  });

  it('renders dashboard from sessionStorage evaluations', async () => {
    sessionStorage.setItem('nestaResponses', JSON.stringify(MOCK_RESPONSES));
    sessionStorage.setItem('nestaEvaluations', JSON.stringify(MOCK_EVALUATIONS));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Assessment Dashboard')).toBeInTheDocument();
    });
    expect(screen.getByText(/7\/9 addressed/)).toBeInTheDocument();
  });

  it('shows status group headers with counts', async () => {
    sessionStorage.setItem('nestaResponses', JSON.stringify(MOCK_RESPONSES));
    sessionStorage.setItem('nestaEvaluations', JSON.stringify(MOCK_EVALUATIONS));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Assessment Dashboard')).toBeInTheDocument();
    });

    expect(screen.getByText('Addressed (7)')).toBeInTheDocument();
    expect(screen.getByText('Partial (1)')).toBeInTheDocument();
    expect(screen.getByText('Not Addressed (1)')).toBeInTheDocument();
  });

  it('shows placeholder when no question is selected', async () => {
    sessionStorage.setItem('nestaResponses', JSON.stringify(MOCK_RESPONSES));
    sessionStorage.setItem('nestaEvaluations', JSON.stringify(MOCK_EVALUATIONS));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Assessment Dashboard')).toBeInTheDocument();
    });

    expect(screen.getByText('Select a question to begin')).toBeInTheDocument();
  });

  it('enables Generate Reflection when 7+ cards are addressed', async () => {
    sessionStorage.setItem('nestaResponses', JSON.stringify(MOCK_RESPONSES));
    sessionStorage.setItem('nestaEvaluations', JSON.stringify(MOCK_EVALUATIONS));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Assessment Dashboard')).toBeInTheDocument();
    });

    const btn = screen.getByRole('button', { name: /Generate Reflection/i });
    expect(btn).not.toBeDisabled();
  });

  it('disables Generate Reflection when fewer than 7 are addressed', async () => {
    const fewAddressed = MOCK_EVALUATIONS.map((e) =>
      e.questionId <= 4 ? { ...e, status: 'addressed' } : { ...e, status: 'not-addressed' },
    );
    sessionStorage.setItem('nestaResponses', JSON.stringify(MOCK_RESPONSES));
    sessionStorage.setItem('nestaEvaluations', JSON.stringify(fewAddressed));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Assessment Dashboard')).toBeInTheDocument();
    });

    const btn = screen.getByRole('button', { name: /Generate Reflection/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/Address at least 7 of 9/)).toBeInTheDocument();
  });

  it('opens coaching panel when a question is clicked', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem('nestaResponses', JSON.stringify(MOCK_RESPONSES));
    sessionStorage.setItem('nestaEvaluations', JSON.stringify(MOCK_EVALUATIONS));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Assessment Dashboard')).toBeInTheDocument();
    });

    await user.click(screen.getByText('3. Can you reach participants?'));

    expect(screen.getByTestId('coaching-panel')).toBeInTheDocument();
    expect(screen.getByText('Coaching Q3')).toBeInTheDocument();
  });

  it('fetches evaluations from API when not in sessionStorage', async () => {
    sessionStorage.setItem('nestaResponses', JSON.stringify(MOCK_RESPONSES));

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/evaluate-assessment') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ evaluations: MOCK_EVALUATIONS }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Assessment Dashboard')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/evaluate-assessment',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows error state with retry when API fails', async () => {
    sessionStorage.setItem('nestaResponses', JSON.stringify(MOCK_RESPONSES));

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Failed to load your assessment/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
  });
});
