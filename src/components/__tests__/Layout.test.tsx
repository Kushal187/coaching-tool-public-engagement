import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { Layout } from '../Layout';

vi.mock('../ChatBot', () => ({
  ChatBot: () => <div data-testid="chatbot-mock" />,
}));

function renderLayout(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<div>Home Content</div>} />
          <Route path="coach" element={<div>Coach Content</div>} />
          <Route path="case-studies" element={<div>Case Studies Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout', () => {
  it('renders the app title linking to home', () => {
    renderLayout();
    const titles = screen.getAllByText('Public Engagement Coach');
    const navTitle = titles.find((el) => el.closest('a')?.getAttribute('href') === '/');
    expect(navTitle).toBeTruthy();
  });

  it('renders nav links for Coach and Case Studies', () => {
    renderLayout();
    const coachLinks = screen.getAllByRole('link', { name: /Coach/i });
    const navCoach = coachLinks.find((l) => l.getAttribute('href') === '/coach');
    expect(navCoach).toBeTruthy();

    const csLinks = screen.getAllByRole('link', { name: /Case Studies/i });
    const navCs = csLinks.find((l) => l.getAttribute('href') === '/case-studies');
    expect(navCs).toBeTruthy();
  });

  it('renders the ChatBot component', () => {
    renderLayout();
    expect(screen.getByTestId('chatbot-mock')).toBeInTheDocument();
  });

  it('renders child route content via Outlet', () => {
    renderLayout('/');
    expect(screen.getByText('Home Content')).toBeInTheDocument();
  });

  it('renders Coach page content when navigating to /coach', () => {
    renderLayout('/coach');
    expect(screen.getByText('Coach Content')).toBeInTheDocument();
  });

  it('renders Case Studies content when navigating to /case-studies', () => {
    renderLayout('/case-studies');
    expect(screen.getByText('Case Studies Content')).toBeInTheDocument();
  });
});
