import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Coach } from '../Coach';
import { renderWithRouter, screen, userEvent, waitFor } from '../../test/test-utils';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

beforeEach(() => {
  vi.restoreAllMocks();
  mockNavigate.mockClear();
  sessionStorage.clear();
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
});

describe('Coach', () => {
  describe('Initial render', () => {
    it('renders the assessment heading', () => {
      renderWithRouter(<Coach />);
      expect(screen.getByText('Coaching Assessment')).toBeInTheDocument();
    });

    it('renders the progress bar showing 0 of 9 answered', () => {
      renderWithRouter(<Coach />);
      expect(screen.getByText('0 of 9 answered')).toBeInTheDocument();
    });

    it('renders all 9 NESTA questions', () => {
      renderWithRouter(<Coach />);
      const questions = [
        "1. Have you articulated the project's goals?",
        '2. Have you identified the right participants?',
        '3. Can you reach the participants you identified?',
        '4. Who is the right owner?',
        '5. Have you included incentives for participation?',
        '6. Have you defined the tasks?',
        '7. Have you established the workflow?',
        '8. How will you evaluate inputs?',
        '9. How will you use what the group creates?',
      ];
      for (const q of questions) {
        expect(screen.getByText(q)).toBeInTheDocument();
      }
    });

    it('renders a textarea for each question', () => {
      renderWithRouter(<Coach />);
      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(9);
    });

    it('renders the Complete Assessment button (disabled initially)', () => {
      renderWithRouter(<Coach />);
      const btn = screen.getByRole('button', { name: /Complete Assessment/i });
      expect(btn).toBeDisabled();
    });

    it('shows a message to answer all questions', () => {
      renderWithRouter(<Coach />);
      expect(
        screen.getByText('Please answer all 9 questions to continue'),
      ).toBeInTheDocument();
    });

    it('renders the Generate Scenario Responses button', () => {
      renderWithRouter(<Coach />);
      expect(
        screen.getByRole('button', { name: /Generate Scenario Responses/i }),
      ).toBeInTheDocument();
    });
  });

  describe('Answering questions', () => {
    it('updates the progress count as questions are filled', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Coach />);

      const textareas = screen.getAllByRole('textbox');
      await user.type(textareas[0], 'My project goals are...');

      expect(screen.getByText('1 of 9 answered')).toBeInTheDocument();
    });

    it('enables submit when all 9 are answered', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Coach />);

      const textareas = screen.getAllByRole('textbox');
      for (const ta of textareas) {
        await user.type(ta, 'Response text');
      }

      expect(screen.getByText('9 of 9 answered')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Complete Assessment/i }),
      ).not.toBeDisabled();
    });
  });

  describe('Form submission', () => {
    it('calls /api/evaluate-assessment and navigates on success', async () => {
      const user = userEvent.setup();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            evaluations: [
              { questionId: 1, status: 'addressed' },
              { questionId: 2, status: 'gap' },
            ],
          }),
      });

      renderWithRouter(<Coach />);

      const textareas = screen.getAllByRole('textbox');
      for (const ta of textareas) {
        await user.type(ta, 'Detailed response');
      }

      await user.click(
        screen.getByRole('button', { name: /Complete Assessment/i }),
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/evaluate-assessment',
          expect.objectContaining({ method: 'POST' }),
        );
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/coach/dashboard');
      });
    });

    it('stores responses and evaluations in sessionStorage', async () => {
      const user = userEvent.setup();
      const mockEvaluations = [
        { questionId: 1, status: 'addressed' },
        { questionId: 2, status: 'gap' },
      ];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ evaluations: mockEvaluations }),
      });

      renderWithRouter(<Coach />);

      const textareas = screen.getAllByRole('textbox');
      for (const ta of textareas) {
        await user.type(ta, 'Answer');
      }
      await user.click(
        screen.getByRole('button', { name: /Complete Assessment/i }),
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalled();
      });

      expect(sessionStorage.getItem('nestaResponses')).toBeTruthy();
      expect(sessionStorage.getItem('nestaEvaluations')).toBeTruthy();
      expect(sessionStorage.getItem('nestaInitiallyAddressed')).toBeTruthy();

      const addressed = JSON.parse(
        sessionStorage.getItem('nestaInitiallyAddressed')!,
      );
      expect(addressed).toEqual([1]);
    });

    it('does not navigate when the API fails', async () => {
      const user = userEvent.setup();
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'fail' }),
      });

      renderWithRouter(<Coach />);

      const textareas = screen.getAllByRole('textbox');
      for (const ta of textareas) {
        await user.type(ta, 'Answer');
      }
      await user.click(
        screen.getByRole('button', { name: /Complete Assessment/i }),
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      // should NOT navigate
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Session persistence', () => {
    it('restores saved responses from sessionStorage', () => {
      const saved: Record<number, string> = { 1: 'Saved goal', 3: 'Saved reach' };
      sessionStorage.setItem('nestaResponses', JSON.stringify(saved));

      renderWithRouter(<Coach />);

      const textareas = screen.getAllByRole('textbox');
      expect(textareas[0]).toHaveValue('Saved goal');
      expect(textareas[1]).toHaveValue('');
      expect(textareas[2]).toHaveValue('Saved reach');
    });
  });

  describe('Generate Scenario Responses dialog', () => {
    it('opens the dialog when the button is clicked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Coach />);

      await user.click(
        screen.getByRole('button', { name: /Generate Scenario Responses/i }),
      );

      expect(
        screen.getByText(/Select a scenario to auto-fill all 9 questions/),
      ).toBeInTheDocument();
      expect(screen.getByText('Well-Prepared Practitioner')).toBeInTheDocument();
      expect(screen.getByText('Vague / Minimal Effort')).toBeInTheDocument();
    });

    it('calls /api/generate-scenario-responses with the selected scenario', async () => {
      const user = userEvent.setup();
      const mockResponses: Record<string, string> = {};
      for (let i = 1; i <= 9; i++) mockResponses[String(i)] = `Response ${i}`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ responses: mockResponses }),
      });

      renderWithRouter(<Coach />);

      await user.click(
        screen.getByRole('button', { name: /Generate Scenario Responses/i }),
      );

      await user.click(screen.getByText('Well-Prepared Practitioner'));
      await user.click(screen.getByRole('button', { name: /^Generate$/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/generate-scenario-responses',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ scenario: 'well-prepared' }),
          }),
        );
      });

      await waitFor(() => {
        const textareas = screen.getAllByRole('textbox');
        expect(textareas[0]).toHaveValue('Response 1');
      });
    });
  });
});
