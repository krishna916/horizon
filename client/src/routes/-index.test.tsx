import type React from 'react';
import { render, screen } from '@testing-library/react';
import { HomeComponent } from '../home/HomeComponent';
import { vi, describe, beforeEach, it, expect } from 'vitest';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const mockUseCurrentUser = vi.fn();
vi.mock('@/user/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

describe('Home Index Route integration', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockUseCurrentUser.mockReturnValue({
      data: { id: 1, email: 'test@example.com' },
      isPending: false,
      isError: false,
    });
  });

  it('renders dashboard greeting and layout cards', () => {
    render(<HomeComponent />);

    expect(screen.getByText(/Good/)).toBeInTheDocument();
    expect(screen.getByText(/test/)).toBeInTheDocument();
    expect(screen.getByText("Today's Commitments")).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('Recent Progress')).toBeInTheDocument();
  });
});
