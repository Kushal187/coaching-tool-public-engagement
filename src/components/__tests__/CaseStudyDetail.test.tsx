import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { CaseStudyDetail } from '../CaseStudyDetail';

vi.mock('../ui/markdown-content', () => ({
  MarkdownContent: ({ children }: { children: string }) => (
    <span data-testid="md">{children}</span>
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

});
