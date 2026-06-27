import { useCurrentUser } from '@/user/hooks/useCurrentUser';
import { HeroSummary } from './HeroSummary';
import { TodaysCommitmentsCard } from './TodaysCommitmentsCard';
import { InboxCard } from './InboxCard';
import { RecentProgressCard } from './RecentProgressCard';
import { MOCK_HOME_SUMMARY } from './mockData';

export function HomeComponent() {
  const { data: user, isPending } = useCurrentUser();

  if (isPending) {
    return (
      <div className="w-full h-full flex flex-col p-8 space-y-6 animate-pulse" data-testid="loading-skeleton">
        <div className="h-8 bg-muted rounded w-1/3" />
        <div className="h-4 bg-muted rounded w-1/2" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
          <div className="h-48 bg-muted rounded-xl" />
          <div className="h-48 bg-muted rounded-xl" />
          <div className="h-48 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col p-8 space-y-8 overflow-y-auto">
      <HeroSummary email={user?.email} summary={MOCK_HOME_SUMMARY} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        <TodaysCommitmentsCard
          overdueCount={MOCK_HOME_SUMMARY.overdueCount}
          dueTodayCount={MOCK_HOME_SUMMARY.dueTodayCount}
        />
        <InboxCard inboxCount={MOCK_HOME_SUMMARY.inboxCount} />
        <RecentProgressCard
          tasksCompletedToday={MOCK_HOME_SUMMARY.recentProgress.tasksCompletedToday}
          tasksCompletedThisWeek={MOCK_HOME_SUMMARY.recentProgress.tasksCompletedThisWeek}
          checklistItemsCompletedToday={MOCK_HOME_SUMMARY.recentProgress.checklistItemsCompletedToday}
          checklistItemsCompletedThisWeek={MOCK_HOME_SUMMARY.recentProgress.checklistItemsCompletedThisWeek}
        />
      </div>
    </div>
  );
}
