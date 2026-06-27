import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TodaysCommitmentsCard } from './TodaysCommitmentsCard';
import { InboxCard } from './InboxCard';
import { RecentProgressCard } from './RecentProgressCard';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

describe('Briefing Cards', () => {
  it('renders TodaysCommitmentsCard and handles navigation', () => {
    render(<TodaysCommitmentsCard overdueCount={3} dueTodayCount={5} />);

    expect(screen.getByText("Today's Commitments")).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    fireEvent.click(screen.getByText("Today's Commitments"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/today' });
  });

  it('renders InboxCard and handles navigation', () => {
    render(<InboxCard inboxCount={8} />);

    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Inbox'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/inbox' });
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
