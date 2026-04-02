import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Home } from '../Home';
import { renderWithRouter, screen } from '../../test/test-utils';
import userEvent from '@testing-library/user-event';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

describe('Home', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders the main heading', () => {
    renderWithRouter(<Home />);
    expect(
      screen.getByText('Public Engagement Coach'),
    ).toBeInTheDocument();
  });

  it('renders the subtitle description', () => {
    renderWithRouter(<Home />);
    expect(
      screen.getByText(/evidence-based guidance/i),
    ).toBeInTheDocument();
  });

  it('renders the text input and Get started button', () => {
    renderWithRouter(<Home />);
    expect(
      screen.getByPlaceholderText(/public engagement challenge/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Get started')).toBeInTheDocument();
  });

  it('navigates to /coach with initial message on submit', async () => {
    const user = userEvent.setup();
    renderWithRouter(<Home />);

    const textarea = screen.getByPlaceholderText(/public engagement challenge/i);
    await user.type(textarea, 'How do I engage local communities?');
    await user.click(screen.getByText('Get started'));

    expect(mockNavigate).toHaveBeenCalledWith('/coach', {
      state: { initialMessage: 'How do I engage local communities?' },
    });
  });

  it('disables Get started button when input is empty', () => {
    renderWithRouter(<Home />);
    const button = screen.getByText('Get started').closest('button');
    expect(button).toBeDisabled();
  });
});
