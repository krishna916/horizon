import type { HomeSummary } from './types';

export interface HeroSummaryProps {
  email?: string;
  summary: HomeSummary;
}

export function HeroSummary({ email, summary }: HeroSummaryProps) {
  const username = email ? email.split('@')[0] : 'User';
  
  const getGreeting = () => {
    const hours = new Date().getHours();
    if (hours < 12) return 'Good morning';
    if (hours < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="space-y-4 pb-6 border-b border-border">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {getGreeting()}, {username}
        </h1>
        <p className="text-muted-foreground text-sm">
          Here is the current state of your personal system.
        </p>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{summary.overdueCount}</span>
          <span className="text-muted-foreground">overdue</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-foreground/30" />
          <span className="font-semibold text-foreground">{summary.dueTodayCount}</span>
          <span className="text-muted-foreground">due today</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-foreground/30" />
          <span className="font-semibold text-foreground">{summary.inboxCount}</span>
          <span className="text-muted-foreground">in inbox</span>
        </div>
      </div>
    </div>
  );
}
