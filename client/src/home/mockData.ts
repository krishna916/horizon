import type { HomeSummary } from './types';

export const MOCK_HOME_SUMMARY: HomeSummary = {
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
