import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '../../test/test-utils';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { CaseStudies } from '../CaseStudies';

const MOCK_CASE_STUDIES = [
  {
    id: '1',
    title: 'Taiwan Digital Democracy Initiative',
    location: 'Taiwan',
    timeframe: '6 months',
    demographic: 'General public',
    scale: 'large' as const,
    tags: ['Digital Engagement', 'Policy Development'],
    summary: 'A digital platform enabling citizen policy-making.',
    keyOutcomes: ['Engaged 200,000 citizens', 'Increased trust by 23%'],
    implementationSteps: ['Mapped stakeholders', 'Developed platform'],
    sourceUrl: 'https://example.com',
    sourceLabel: 'Source',
    docDate: '2024-01',
  },
  {
    id: '2',
    title: 'Rural Health Co-Design',
    location: 'Australia',
    timeframe: '4 months',
    demographic: 'Rural communities',
    scale: 'small' as const,
    tags: ['Health Services', 'Co-Design'],
    summary: 'Co-designing health services with rural communities.',
    keyOutcomes: ['Engaged 750 participants', 'Identified 8 service gaps'],
    implementationSteps: ['Partnered with local orgs', 'Used mobile units'],
    sourceUrl: 'https://example.com',
    sourceLabel: 'Source',
    docDate: '2024-02',
  },
];

function renderCaseStudies() {
  return render(
    <MemoryRouter>
      <CaseStudies />
    </MemoryRouter>,
  );
}

describe('CaseStudies', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise(() => {}),
    );
    renderCaseStudies();
    expect(screen.getByText('Loading case studies…')).toBeInTheDocument();
  });

  it('renders case studies after successful fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_CASE_STUDIES),
    });

    renderCaseStudies();

    await waitFor(() => {
      expect(
        screen.getByText('Taiwan Digital Democracy Initiative'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Rural Health Co-Design')).toBeInTheDocument();
  });

  it('renders the page heading', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_CASE_STUDIES),
    });
    renderCaseStudies();
    expect(screen.getByText('Case Study Library')).toBeInTheDocument();
  });

  it('shows error state and retry button on fetch failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    renderCaseStudies();

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to load case studies/),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('retries fetch when Retry button is clicked', async () => {
    const user = userEvent.setup();

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_CASE_STUDIES),
      });

    renderCaseStudies();

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(
        screen.getByText('Taiwan Digital Democracy Initiative'),
      ).toBeInTheDocument();
    });
  });

  it('shows "Adapt to My Situation" links for each case study', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_CASE_STUDIES),
    });

    renderCaseStudies();

    await waitFor(() => {
      const adaptLinks = screen.getAllByText('Adapt to My Situation');
      expect(adaptLinks).toHaveLength(2);
    });
  });

  it('displays case study metadata (location, timeframe, demographic, scale)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_CASE_STUDIES),
    });

    renderCaseStudies();

    await waitFor(() => {
      expect(screen.getByText('Taiwan')).toBeInTheDocument();
    });
    expect(screen.getByText('6 months')).toBeInTheDocument();
    expect(screen.getByText('Australia')).toBeInTheDocument();
  });

  it('displays tags as badges', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_CASE_STUDIES),
    });

    renderCaseStudies();

    await waitFor(() => {
      const badges = screen.getAllByText('Digital Engagement');
      const badgeEl = badges.find((el) =>
        el.getAttribute('data-slot') === 'badge',
      );
      expect(badgeEl).toBeTruthy();
    });
    const coDesignBadges = screen.getAllByText('Co-Design');
    expect(coDesignBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders filter section with Scale and Topic dropdowns', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_CASE_STUDIES),
    });

    renderCaseStudies();

    await waitFor(() => {
      expect(screen.getByText('Filter Case Studies')).toBeInTheDocument();
    });

    const filterSection = screen.getByText('Filter Case Studies').closest('div.mb-8')!;
    expect(filterSection).toBeTruthy();

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(2);

    expect(selects[0].querySelector('option[value="all"]')).toBeTruthy();
    expect(selects[1].querySelector('option[value="all"]')).toBeTruthy();
  });

  it('filters case studies by scale', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_CASE_STUDIES),
    });

    renderCaseStudies();

    await waitFor(() => {
      expect(
        screen.getByText('Taiwan Digital Democracy Initiative'),
      ).toBeInTheDocument();
    });

    const selects = screen.getAllByRole('combobox');
    const scaleSelect = selects[0];
    await user.selectOptions(scaleSelect, 'small');

    expect(
      screen.queryByText('Taiwan Digital Democracy Initiative'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Rural Health Co-Design')).toBeInTheDocument();
  });

  it('shows empty state when no case studies match filters', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_CASE_STUDIES),
    });

    renderCaseStudies();

    await waitFor(() => {
      expect(
        screen.getByText('Taiwan Digital Democracy Initiative'),
      ).toBeInTheDocument();
    });

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1], 'Health Services');
    await user.selectOptions(selects[0], 'large');

    expect(
      screen.getByText(/No case studies match your selected filters/),
    ).toBeInTheDocument();
  });

  it('shows key outcomes and implementation steps', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_CASE_STUDIES),
    });

    renderCaseStudies();

    await waitFor(() => {
      expect(
        screen.getByText('Engaged 200,000 citizens'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Mapped stakeholders')).toBeInTheDocument();
  });
});
