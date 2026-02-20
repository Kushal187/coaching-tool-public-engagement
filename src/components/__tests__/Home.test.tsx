import { describe, it, expect } from 'vitest';
import { Home } from '../Home';
import { renderWithRouter, screen } from '../../test/test-utils';

describe('Home', () => {
  it('renders the main heading', () => {
    renderWithRouter(<Home />);
    expect(
      screen.getByText('Public Engagement Coaching Tool'),
    ).toBeInTheDocument();
  });

  it('renders the subtitle description', () => {
    renderWithRouter(<Home />);
    expect(
      screen.getByText(/practical resource for public sector workers/i),
    ).toBeInTheDocument();
  });

  it('renders the Coach card with correct link', () => {
    renderWithRouter(<Home />);
    const coachHeading = screen.getByRole('heading', { name: 'Coach' });
    expect(coachHeading).toBeInTheDocument();

    const coachLink = screen.getByText('Start coaching session').closest('a');
    expect(coachLink).toHaveAttribute('href', '/coach');
  });

  it('renders the Case Studies card with correct link', () => {
    renderWithRouter(<Home />);
    const csHeading = screen.getByRole('heading', { name: 'Case Studies' });
    expect(csHeading).toBeInTheDocument();

    const csLink = screen.getByText('Browse case studies').closest('a');
    expect(csLink).toHaveAttribute('href', '/case-studies');
  });

  it('renders descriptions for both cards', () => {
    renderWithRouter(<Home />);
    expect(
      screen.getByText(/personalized guidance on your public engagement/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/real-world examples of successful public engagement/i),
    ).toBeInTheDocument();
  });
});
