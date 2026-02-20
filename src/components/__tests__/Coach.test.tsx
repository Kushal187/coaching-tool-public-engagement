import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Coach } from '../Coach';
import { renderWithRouter, screen, userEvent, waitFor } from '../../test/test-utils';

vi.mock('../ui/markdown-content', () => ({
  MarkdownContent: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

function mockFetchDefaults() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/case-studies') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    if (url === '/api/generate-questions') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ needsFollowUp: false, questions: [] }),
      });
    }
    if (url === '/api/generate-plan') {
      return Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(
            'data: {"content":"## Generated Plan\\n\\nHere is your plan."}\ndata: [DONE]\n',
          ),
      });
    }
    return Promise.resolve({ ok: false, status: 404 });
  });
}

async function clickAndWait(user: ReturnType<typeof userEvent.setup>, text: string | RegExp) {
  const el = typeof text === 'string' ? screen.getByText(text) : screen.getByText(text);
  await user.click(el);
  await new Promise((r) => setTimeout(r, 250));
}

describe('Coach', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchDefaults();
  });

  describe('Initial render', () => {
    it('renders the coaching session heading', async () => {
      renderWithRouter(<Coach />);
      expect(screen.getByText('Coaching Session')).toBeInTheDocument();
    });

    it('renders the progress bar', async () => {
      renderWithRouter(<Coach />);
      expect(screen.getByText(/Step 1 of/)).toBeInTheDocument();
    });

    it('renders the Reset button', async () => {
      renderWithRouter(<Coach />);
      expect(screen.getByText('Reset')).toBeInTheDocument();
    });

    it('shows Q1 — engagement topic as the first question', async () => {
      renderWithRouter(<Coach />);
      expect(
        screen.getByText("What's your engagement about?"),
      ).toBeInTheDocument();
      expect(screen.getByText(/Question 1 of 10/)).toBeInTheDocument();
    });
  });

  describe('Q1 — Issue area (single select + other)', () => {
    it('displays all issue area options', async () => {
      renderWithRouter(<Coach />);
      expect(
        screen.getByText('Policy development or regulatory change'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Budget allocation or spending priorities'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Community planning (land use, infrastructure, environment)',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Service design or improvement'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Crisis response or recovery'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Strategic visioning or long-term planning'),
      ).toBeInTheDocument();
    });

    it('shows "Other" option', async () => {
      renderWithRouter(<Coach />);
      expect(screen.getByText('Other')).toBeInTheDocument();
    });

    it('advances to Q2 when an option is clicked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Coach />);

      await clickAndWait(user, 'Policy development or regulatory change');

      await waitFor(() => {
        expect(
          screen.getByText("What's your primary goal?"),
        ).toBeInTheDocument();
      });
      expect(screen.getByText(/Question 2 of 10/)).toBeInTheDocument();
    });

    it('shows free text input when "Other" is clicked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Coach />);

      await user.click(screen.getByText('Other'));
      expect(
        screen.getByPlaceholderText(/Describe your engagement topic/i),
      ).toBeInTheDocument();
    });
  });

  describe('Q2 — Primary goal (single select)', () => {
    async function goToQ2() {
      const user = userEvent.setup();
      renderWithRouter(<Coach />);
      await clickAndWait(user, 'Policy development or regulatory change');
      await waitFor(() => {
        expect(screen.getByText("What's your primary goal?")).toBeInTheDocument();
      });
      return user;
    }

    it('displays all goal options', async () => {
      await goToQ2();
      expect(
        screen.getByText(
          'Discover what people care about or what problems exist',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Gather ideas or proposed solutions'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Get feedback on a draft plan or proposal'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Help people deliberate and find common ground/),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Prioritize among options or tradeoffs'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Co-create a plan, policy, or program/),
      ).toBeInTheDocument();
    });

    it('has a Back button that returns to Q1', async () => {
      const user = await goToQ2();
      await user.click(screen.getByText('Back'));
      await waitFor(() => {
        expect(
          screen.getByText("What's your engagement about?"),
        ).toBeInTheDocument();
      });
    });
  });

  describe('Q3 — Audience (multi-select)', () => {
    async function goToQ3() {
      const user = userEvent.setup();
      renderWithRouter(<Coach />);

      await clickAndWait(user, 'Policy development or regulatory change');
      await waitFor(() => {
        expect(screen.getByText("What's your primary goal?")).toBeInTheDocument();
      });
      await clickAndWait(user, 'Gather ideas or proposed solutions');
      await waitFor(() => {
        expect(screen.getByText('Who are you trying to reach?')).toBeInTheDocument();
      });

      return user;
    }

    it('shows Q3 with multi-select options', async () => {
      await goToQ3();
      expect(
        screen.getByText('Who are you trying to reach?'),
      ).toBeInTheDocument();
      expect(screen.getByText('Select all that apply.')).toBeInTheDocument();
      expect(
        screen.getByText('The general public / broad community'),
      ).toBeInTheDocument();
    });

    it('has a Continue button that is disabled when nothing is selected', async () => {
      await goToQ3();
      const continueBtn = screen.getByRole('button', { name: /Continue/i });
      expect(continueBtn).toBeDisabled();
    });

    it('enables Continue when at least one option is selected', async () => {
      const user = await goToQ3();
      await user.click(
        screen.getByText('The general public / broad community'),
      );
      const continueBtn = screen.getByRole('button', { name: /Continue/i });
      expect(continueBtn).not.toBeDisabled();
    });

    it('allows selecting multiple options', async () => {
      const user = await goToQ3();
      await user.click(
        screen.getByText('The general public / broad community'),
      );
      await user.click(screen.getByText(/People directly affected/));
      const continueBtn = screen.getByRole('button', { name: /Continue/i });
      expect(continueBtn).not.toBeDisabled();
    });
  });

  describe('Full navigation to Q10', () => {
    async function goToQ10() {
      const user = userEvent.setup();
      renderWithRouter(<Coach />);

      // Q1
      await clickAndWait(user, 'Service design or improvement');
      await waitFor(() => { expect(screen.getByText("What's your primary goal?")).toBeInTheDocument(); });
      // Q2
      await clickAndWait(user, 'Gather ideas or proposed solutions');
      await waitFor(() => { expect(screen.getByText('Who are you trying to reach?')).toBeInTheDocument(); });
      // Q3 (multi)
      await user.click(screen.getByText('The general public / broad community'));
      await user.click(screen.getByRole('button', { name: /Continue/i }));
      await waitFor(() => { expect(screen.getByText("What's your timeline?")).toBeInTheDocument(); });
      // Q4
      await clickAndWait(user, /1–3 months/);
      await waitFor(() => { expect(screen.getByText('What resources do you have?')).toBeInTheDocument(); });
      // Q5 (multi)
      await user.click(screen.getByText('Dedicated staff time (1+ people working on this)'));
      await user.click(screen.getByRole('button', { name: /Continue/i }));
      await waitFor(() => { expect(screen.getByText("What's your biggest constraint?")).toBeInTheDocument(); });
      // Q6
      await clickAndWait(user, /Budget — I have very little funding/);
      await waitFor(() => { expect(screen.getByText('How comfortable are you with AI tools?')).toBeInTheDocument(); });
      // Q7
      await clickAndWait(user, /haven't used AI/);
      await waitFor(() => { expect(screen.getByText('What does success look like?')).toBeInTheDocument(); });
      // Q8
      await clickAndWait(user, /Decision-makers use the input/);
      await waitFor(() => { expect(screen.getByText('Where do you feel most stuck?')).toBeInTheDocument(); });
      // Q9
      await clickAndWait(user, /Figuring out which engagement method/);
      await waitFor(() => { expect(screen.getByText('Where are you in the process?')).toBeInTheDocument(); });

      return user;
    }

    it('shows Q10 with process stage options', async () => {
      await goToQ10();
      expect(
        screen.getByText('Where are you in the process?'),
      ).toBeInTheDocument();
      expect(screen.getByText(/Starting from scratch/)).toBeInTheDocument();
      expect(screen.getByText(/I have a rough plan/)).toBeInTheDocument();
      expect(
        screen.getByText(/mid-process and something isn't working/),
      ).toBeInTheDocument();
    }, 15000);

    it('"Starting from scratch" enters follow-up / plan generation', async () => {
      const user = await goToQ10();

      await clickAndWait(user, /Starting from scratch/);

      await waitFor(
        () => {
          const heading =
            screen.queryByText('Your Engagement Plan') ||
            screen.queryByText(/Reviewing your answers/) ||
            screen.queryByText(/Preparing your plan/) ||
            screen.queryByText(/Generating your engagement plan/);
          expect(heading).toBeTruthy();
        },
        { timeout: 3000 },
      );
    }, 15000);

    it('"I have a rough plan" goes to midway existing work', async () => {
      const user = await goToQ10();
      await clickAndWait(user, /I have a rough plan/);

      await waitFor(() => {
        expect(
          screen.getByText('What have you already done?'),
        ).toBeInTheDocument();
      });
    }, 15000);
  });

  describe('Midway branch', () => {
    async function goToMidwayBranch() {
      const user = userEvent.setup();
      renderWithRouter(<Coach />);

      await clickAndWait(user, 'Service design or improvement');
      await waitFor(() => { expect(screen.getByText("What's your primary goal?")).toBeInTheDocument(); });
      await clickAndWait(user, 'Gather ideas or proposed solutions');
      await waitFor(() => { expect(screen.getByText('Who are you trying to reach?')).toBeInTheDocument(); });
      await user.click(screen.getByText('The general public / broad community'));
      await user.click(screen.getByRole('button', { name: /Continue/i }));
      await waitFor(() => { expect(screen.getByText("What's your timeline?")).toBeInTheDocument(); });
      await clickAndWait(user, /1–3 months/);
      await waitFor(() => { expect(screen.getByText('What resources do you have?')).toBeInTheDocument(); });
      await user.click(screen.getByText('Dedicated staff time (1+ people working on this)'));
      await user.click(screen.getByRole('button', { name: /Continue/i }));
      await waitFor(() => { expect(screen.getByText("What's your biggest constraint?")).toBeInTheDocument(); });
      await clickAndWait(user, /Budget — I have very little funding/);
      await waitFor(() => { expect(screen.getByText('How comfortable are you with AI tools?')).toBeInTheDocument(); });
      await clickAndWait(user, /haven't used AI/);
      await waitFor(() => { expect(screen.getByText('What does success look like?')).toBeInTheDocument(); });
      await clickAndWait(user, /Decision-makers use the input/);
      await waitFor(() => { expect(screen.getByText('Where do you feel most stuck?')).toBeInTheDocument(); });
      await clickAndWait(user, /Figuring out which engagement method/);
      await waitFor(() => { expect(screen.getByText('Where are you in the process?')).toBeInTheDocument(); });

      // Q10 — midway
      await clickAndWait(user, /I have a rough plan/);
      await waitFor(() => { expect(screen.getByText('What have you already done?')).toBeInTheDocument(); });

      // Continue from existing-work
      await user.click(screen.getByRole('button', { name: /Continue/i }));
      await waitFor(() => { expect(screen.getByText('How can we help you next?')).toBeInTheDocument(); });

      return user;
    }

    it('shows two branch options: plan generation and Q&A chatbot', async () => {
      await goToMidwayBranch();
      expect(
        screen.getByText(/Generate a plan that builds on my progress/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Ask questions about my engagement/),
      ).toBeInTheDocument();
    }, 20000);
  });

  describe('Plan output (fallback when API fails)', () => {
    async function goToPlanOutput() {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/case-studies') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          });
        }
        if (url === '/api/generate-questions') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ needsFollowUp: false, questions: [] }),
          });
        }
        if (url === '/api/generate-plan') {
          return Promise.reject(new Error('offline'));
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const user = userEvent.setup();
      renderWithRouter(<Coach />);

      await clickAndWait(user, 'Service design or improvement');
      await waitFor(() => { expect(screen.getByText("What's your primary goal?")).toBeInTheDocument(); });
      await clickAndWait(user, 'Gather ideas or proposed solutions');
      await waitFor(() => { expect(screen.getByText('Who are you trying to reach?')).toBeInTheDocument(); });
      await user.click(screen.getByText('The general public / broad community'));
      await user.click(screen.getByRole('button', { name: /Continue/i }));
      await waitFor(() => { expect(screen.getByText("What's your timeline?")).toBeInTheDocument(); });
      await clickAndWait(user, /1–3 months/);
      await waitFor(() => { expect(screen.getByText('What resources do you have?')).toBeInTheDocument(); });
      await user.click(screen.getByText('Dedicated staff time (1+ people working on this)'));
      await user.click(screen.getByRole('button', { name: /Continue/i }));
      await waitFor(() => { expect(screen.getByText("What's your biggest constraint?")).toBeInTheDocument(); });
      await clickAndWait(user, /Budget — I have very little funding/);
      await waitFor(() => { expect(screen.getByText('How comfortable are you with AI tools?')).toBeInTheDocument(); });
      await clickAndWait(user, /haven't used AI/);
      await waitFor(() => { expect(screen.getByText('What does success look like?')).toBeInTheDocument(); });
      await clickAndWait(user, /Decision-makers use the input/);
      await waitFor(() => { expect(screen.getByText('Where do you feel most stuck?')).toBeInTheDocument(); });
      await clickAndWait(user, /Figuring out which engagement method/);
      await waitFor(() => { expect(screen.getByText('Where are you in the process?')).toBeInTheDocument(); });
      await clickAndWait(user, /Starting from scratch/);

      await waitFor(
        () => {
          expect(screen.getByText('Your Engagement Plan')).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      return user;
    }

    it('shows the plan with Edit and Download buttons', async () => {
      await goToPlanOutput();
      expect(
        screen.getByRole('button', { name: /Edit/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Download/i }),
      ).toBeInTheDocument();
    }, 20000);
  });

  describe('Reset', () => {
    it('resets back to Q1 when Reset is clicked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Coach />);

      await clickAndWait(user, 'Service design or improvement');
      await waitFor(() => {
        expect(screen.getByText(/Question 2 of 10/)).toBeInTheDocument();
      });

      await user.click(screen.getByText('Reset'));
      expect(screen.getByText(/Question 1 of 10/)).toBeInTheDocument();
      expect(
        screen.getByText("What's your engagement about?"),
      ).toBeInTheDocument();
    });
  });
});
