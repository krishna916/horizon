import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HeroSummary } from './HeroSummary';
import type { HomeSummary } from './types';

const mockSummary: HomeSummary = {
  overdueCount: 3,
  dueTodayCount: 5,
  inboxCount: 8,
  recentProgress: {
    tasksCompletedToday: 4,
    tasksCompletedThisWeek: 12,
    checklistItemsCompletedToday: 6,
    checklistItemsCompletedThisWeek: 18,
  },
};

describe('HeroSummary', () => {
  it('renders time-based greeting and username from email', () => {
    // Mock system time to morning
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-27T08:00:00'));

    render(<HeroSummary email="test@example.com" summary={mockSummary} />);

    expect(screen.getByText('Good morning, test')).toBeInTheDocument();
    expect(screen.getByText('Here is the current state of your personal system.')).toBeInTheDocument();
    
    vi.useRealTimers();
  });

  it('renders metric highlights correctly', () => {
    render(<HeroSummary email="test@example.com" summary={mockSummary} />);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('overdue')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('due today')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('in inbox')).toBeInTheDocument();
  });
});
