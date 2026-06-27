import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HomeComponent } from './HomeComponent';

const mockUseCurrentUser = vi.fn();
vi.mock('@/user/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

describe('HomeComponent Integration', () => {
  it('renders skeleton loading state when current user is pending', () => {
    mockUseCurrentUser.mockReturnValue({
      data: null,
      isPending: true,
    });

    const { container } = render(<HomeComponent />);
    expect(container.querySelector('[data-testid="loading-skeleton"]')).toBeInTheDocument();
  });

  it('renders the complete landing briefing dashboard once user loads', () => {
    mockUseCurrentUser.mockReturnValue({
      data: { id: 1, email: 'john@example.com' },
      isPending: false,
    });

    render(<HomeComponent />);

    // Verify header greeting
    expect(screen.getByText(/Good/)).toBeInTheDocument();
    expect(screen.getByText(/john/)).toBeInTheDocument();

    // Verify cards render
    expect(screen.getByText("Today's Commitments")).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('Recent Progress')).toBeInTheDocument();
  });
});
