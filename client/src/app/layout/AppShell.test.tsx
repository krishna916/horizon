import type React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';

// Mock the hooks
vi.mock('@/user/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    data: { id: 1, email: 'user@example.com' },
    isLoading: false,
  }),
}));

vi.mock('@/user/hooks/useLogoutUser', () => ({
  useLogoutUser: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

// Mock `@tanstack/react-router` Link, useLocation, useNavigate
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string | ((opts: { isActive: boolean }) => string);
  }) => {
    const isActive = false;
    const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className;
    return (
      <a href={to} className={resolvedClassName}>
        {children}
      </a>
    );
  },
  useNavigate: () => vi.fn(),
  useLocation: () => ({
    pathname: '/tasks',
  }),
}));

describe('Layout Components', () => {
  it('renders Sidebar with logo and navigation links', () => {
    render(<AppSidebar />);

    // Check brand logo
    expect(screen.getByText('Horizon')).toBeInTheDocument();
    expect(screen.getByText(/productivity/i)).toBeInTheDocument();

    // Check navigation links
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();

    // Check user profile info
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
  });

  it('renders Header with title, search input and actions', () => {
    render(<AppHeader />);

    // Check dynamic title from location.pathname ('/tasks' maps to 'Tasks')
    expect(screen.getByText('Tasks')).toBeInTheDocument();

    // Check search input
    expect(screen.getByPlaceholderText('Search tasks...')).toBeInTheDocument();

    // Check action buttons
    expect(screen.getByRole('button', { name: /Notifications/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Help/i })).toBeInTheDocument();
  });
});
