import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { CaseStudyDetail } from '../CaseStudyDetail';

vi.mock('../ui/markdown-content', () => ({
  MarkdownContent: ({ children }: { children: string }) => (
    <span data-testid="md">{children}</span>
  ),
}));

vi.mock('../ui/progress', () => ({
  Progress: ({ value }: { value: number }) => (
    <div data-testid="progress" data-value={value} />
  ),
}));

const MOCK_CASE_STUDY = {
  id: 'cs-1',
  title: 'Taiwan Digital Democracy Initiative',
  location: 'Taiwan',
  timeframe: '6 months',
  demographic: 'General public',
  scale: 'large',
  tags: ['Digital Engagement', 'Policy Development'],
  summary: 'A digital platform enabling citizen policy-making.',
  keyOutcomes: ['Engaged 200,000 citizens', 'Increased trust by 23%'],
  implementationSteps: ['Mapped stakeholders', 'Developed platform', 'Launched outreach'],
  sourceUrl: 'https://example.com/taiwan',
  sourceLabel: 'Source',
  docDate: '2024-01',
  fullContent: null,
};

function renderDetail(id = 'cs-1') {
  return render(
    <MemoryRouter initialEntries={[`/case-studies/${id}`]}>
      <Routes>
        <Route path="/case-studies/:caseStudyId" element={<CaseStudyDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
});

describe('CaseStudyDetail', () => {
  describe('Loading and error states', () => {
    it('shows loading state initially', () => {
      global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
      renderDetail();
      expect(screen.getByText('Loading case study...')).toBeInTheDocument();
    });

    it('shows error when fetch fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText(/Not found/)).toBeInTheDocument();
      });
    });

    it('shows "Back to Case Studies" link in error state', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      renderDetail();

      await waitFor(() => {
        const links = screen.getAllByText('Back to Case Studies');
        expect(links.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Successful render', () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MOCK_CASE_STUDY),
      });
    });

    it('renders the case study title', async () => {
      renderDetail();
      await waitFor(() => {
        const titles = screen.getAllByText('Taiwan Digital Democracy Initiative');
        expect(titles.length).toBeGreaterThanOrEqual(1);
        const h1 = titles.find((el) => el.tagName === 'H1');
        expect(h1).toBeTruthy();
      });
    });

    it('renders metadata (location, timeframe, demographic, scale)', async () => {
      renderDetail();
      await waitFor(() => {
        expect(screen.getByText('Taiwan')).toBeInTheDocument();
      });
      expect(screen.getByText('6 months')).toBeInTheDocument();
      expect(screen.getByText('General public')).toBeInTheDocument();
      expect(screen.getByText('large')).toBeInTheDocument();
    });

    it('renders tags as badges', async () => {
      renderDetail();
      await waitFor(() => {
        expect(screen.getByText('Digital Engagement')).toBeInTheDocument();
      });
      expect(screen.getByText('Policy Development')).toBeInTheDocument();
    });

    it('renders summary text', async () => {
      renderDetail();
      await waitFor(() => {
        expect(screen.getByText('A digital platform enabling citizen policy-making.')).toBeInTheDocument();
      });
    });

    it('renders source link', async () => {
      renderDetail();
      await waitFor(() => {
        expect(screen.getByText('View original source')).toBeInTheDocument();
      });
    });

    it('renders key outcomes in sidebar', async () => {
      renderDetail();
      await waitFor(() => {
        expect(screen.getByText('Engaged 200,000 citizens')).toBeInTheDocument();
      });
      expect(screen.getByText('Increased trust by 23%')).toBeInTheDocument();
    });

    it('renders implementation steps in sidebar', async () => {
      renderDetail();
      await waitFor(() => {
        expect(screen.getByText('Mapped stakeholders')).toBeInTheDocument();
      });
      expect(screen.getByText('Developed platform')).toBeInTheDocument();
      expect(screen.getByText('Launched outreach')).toBeInTheDocument();
    });
  });

  describe('Adapt wizard', () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MOCK_CASE_STUDY),
      });
    });

    it('shows the info step with Get Started button', async () => {
      renderDetail();
      await waitFor(() => {
        expect(screen.getByText('Adapt to My Situation')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /Get Started/i })).toBeInTheDocument();
    });

    it('advances to context step on Get Started', async () => {
      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Get Started/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Get Started/i }));

      expect(screen.getByText('Describe your situation')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/city agency/i)).toBeInTheDocument();
    });

    it('disables Continue until context is entered', async () => {
      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Get Started/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Get Started/i }));

      const continueBtn = screen.getByRole('button', { name: /Continue/i });
      expect(continueBtn).toBeDisabled();

      await user.type(screen.getByPlaceholderText(/city agency/i), 'Our community project');
      expect(continueBtn).not.toBeDisabled();
    });

    it('advances to constraints step after entering context', async () => {
      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Get Started/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Get Started/i }));
      await user.type(screen.getByPlaceholderText(/city agency/i), 'Community project');
      await user.click(screen.getByRole('button', { name: /Continue/i }));

      expect(screen.getByText('What are your constraints?')).toBeInTheDocument();
    });

    it('navigates back from constraints to context', async () => {
      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Get Started/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Get Started/i }));
      await user.type(screen.getByPlaceholderText(/city agency/i), 'Community project');
      await user.click(screen.getByRole('button', { name: /Continue/i }));

      expect(screen.getByText('What are your constraints?')).toBeInTheDocument();
      await user.click(screen.getByText('Back'));
      expect(screen.getByText('Describe your situation')).toBeInTheDocument();
    });

    it('calls API and shows adapted plan on generate', async () => {
      const user = userEvent.setup();
      const mockText = 'data: {"content":"## Adapted Plan\\n\\nHere it is."}\ndata: [DONE]\n';
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('case-studies')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(MOCK_CASE_STUDY),
          });
        }
        if (typeof url === 'string' && url.includes('adapt-case-study')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(mockText),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      renderDetail();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Get Started/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Get Started/i }));
      await user.type(screen.getByPlaceholderText(/city agency/i), 'My context');
      await user.click(screen.getByRole('button', { name: /Continue/i }));
      await user.type(screen.getByPlaceholderText(/Limited budget/i), 'Small budget');
      await user.click(screen.getByRole('button', { name: /Generate Adapted Plan/i }));

      await waitFor(() => {
        expect(screen.getByText('Your Adapted Plan')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Download/i })).toBeInTheDocument();
    });
  });
});
