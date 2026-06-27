export interface HomeSummary {
  overdueCount: number;
  dueTodayCount: number;
  inboxCount: number;
  recentProgress: {
    tasksCompletedToday: number;
    tasksCompletedThisWeek: number;
    checklistItemsCompletedToday: number;
    checklistItemsCompletedThisWeek: number;
  };
}
