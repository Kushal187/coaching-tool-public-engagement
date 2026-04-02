import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Reflection } from '../Reflection';

const mockNavigate = vi.fn();
let mockLocationState: Record<string, unknown> = {};

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: mockLocationState, pathname: '/coach/reflection', search: '', hash: '', key: 'default' }),
  };
});

vi.mock('../ui/markdown-content', () => ({
  MarkdownContent: ({ children }: { children: string }) => (
    <span data-testid="md">{children}</span>
  ),
}));

vi.mock('jspdf', () => ({
  default: vi.fn().mockImplementation(() => ({
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    setFont: vi.fn(),
    setDrawColor: vi.fn(),
    setLineWidth: vi.fn(),
    setFillColor: vi.fn(),
    text: vi.fn(),
    line: vi.fn(),
    splitTextToSize: vi.fn().mockReturnValue(['line']),
    roundedRect: vi.fn(),
    addPage: vi.fn(),
    save: vi.fn(),
  })),
}));

const MOCK_REFLECTION = {
  summary: 'Overall you have a solid foundation.',
  addressed: [
    { questionId: 1, question: 'Goals?', analysis: 'Well articulated goals.' },
  ],
  partial: [
    { questionId: 2, question: 'Participants?', analysis: 'Needs work.', nextSteps: ['Identify more stakeholders'] },
  ],
  notAddressed: [
    { questionId: 3, question: 'Reach?', analysis: 'Not addressed at all.', nextSteps: ['Develop outreach plan', 'Map community networks'] },
  ],
  priorityActions: [
    { action: 'Create outreach strategy', rationale: 'Essential for participation', timeline: 'Week 1-2' },
  ],
};

function renderReflection() {
  return render(
    <MemoryRouter>
      <Reflection />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockNavigate.mockClear();
  mockLocationState = {};
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
});

describe('Reflection', () => {
  it('redirects to /coach when no sessionId exists', () => {
    renderReflection();
    expect(mockNavigate).toHaveBeenCalledWith('/coach');
  });

  it('shows loading state while generating', () => {
    mockLocationState = { sessionId: 'test-session-123' };
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    renderReflection();
    expect(screen.getByText('Generating your reflection...')).toBeInTheDocument();
  });

  it('renders reflection content after API success', async () => {
    mockLocationState = { sessionId: 'test-session-123' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reflection: MOCK_REFLECTION }),
    });

    renderReflection();

    await waitFor(() => {
      expect(screen.getByText('Your Reflection')).toBeInTheDocument();
    });

    expect(screen.getByText('Overall Summary')).toBeInTheDocument();
    expect(screen.getByText('Strengths')).toBeInTheDocument();
    expect(screen.getByText('Areas to Develop')).toBeInTheDocument();
    expect(screen.getByText('Critical Gaps')).toBeInTheDocument();
    expect(screen.getByText('Priority Actions')).toBeInTheDocument();
  });

  it('renders reflection items with their analysis', async () => {
    mockLocationState = { sessionId: 'test-session-123' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reflection: MOCK_REFLECTION }),
    });

    renderReflection();

    await waitFor(() => {
      expect(screen.getByText('1. Goals?')).toBeInTheDocument();
    });
    expect(screen.getByText('2. Participants?')).toBeInTheDocument();
    expect(screen.getByText('3. Reach?')).toBeInTheDocument();
  });

  it('renders next steps for partial and not-addressed items', async () => {
    mockLocationState = { sessionId: 'test-session-123' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reflection: MOCK_REFLECTION }),
    });

    renderReflection();

    await waitFor(() => {
      expect(screen.getByText('Identify more stakeholders')).toBeInTheDocument();
    });
    expect(screen.getByText('Develop outreach plan')).toBeInTheDocument();
    expect(screen.getByText('Map community networks')).toBeInTheDocument();
  });

  it('renders priority actions with timelines', async () => {
    mockLocationState = { sessionId: 'test-session-123' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reflection: MOCK_REFLECTION }),
    });

    renderReflection();

    await waitFor(() => {
      expect(screen.getByText('Create outreach strategy')).toBeInTheDocument();
    });
    expect(screen.getByText('Essential for participation')).toBeInTheDocument();
    expect(screen.getByText('Week 1-2')).toBeInTheDocument();
  });

  it('shows error state with retry on API failure', async () => {
    mockLocationState = { sessionId: 'test-session-123' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    renderReflection();

    await waitFor(() => {
      expect(screen.getByText(/Failed to generate your reflection/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
  });

  it('renders Download Reflection and Back to Chat buttons', async () => {
    mockLocationState = { sessionId: 'test-session-123' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reflection: MOCK_REFLECTION }),
    });

    renderReflection();

    await waitFor(() => {
      expect(screen.getByText('Your Reflection')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Download Reflection/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to Chat/i })).toBeInTheDocument();
  });

  it('navigates to /coach when Back to Chat is clicked', async () => {
    const user = userEvent.setup();
    mockLocationState = { sessionId: 'test-session-123' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reflection: MOCK_REFLECTION }),
    });

    renderReflection();

    await waitFor(() => {
      expect(screen.getByText('Your Reflection')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Back to Chat/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/coach');
  });
});
