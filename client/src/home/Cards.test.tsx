import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TodaysCommitmentsCard } from './TodaysCommitmentsCard';
import { InboxCard } from './InboxCard';
import { RecentProgressCard } from './RecentProgressCard';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

describe('Briefing Cards', () => {
  it('renders TodaysCommitmentsCard and navigates to /today', () => {
    render(<TodaysCommitmentsCard overdueCount={3} dueTodayCount={5} />);

    expect(screen.getByText("Today's Commitments")).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /today's commitments/i });
    expect(link).toHaveAttribute('href', '/today');
  });

  it('renders InboxCard and navigates to /inbox', () => {
    render(<InboxCard inboxCount={8} />);

    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /inbox/i });
    expect(link).toHaveAttribute('href', '/inbox');
  });

  it('renders RecentProgressCard correctly', () => {
    render(
      <RecentProgressCard
        tasksCompletedToday={4}
        tasksCompletedThisWeek={12}
        checklistItemsCompletedToday={6}
        checklistItemsCompletedThisWeek={18}
      />
    );

    expect(screen.getByText('Recent Progress')).toBeInTheDocument();
    expect(screen.getByText('Completed Tasks')).toBeInTheDocument();
    expect(screen.getByText('Checklist Items')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
  });
});
