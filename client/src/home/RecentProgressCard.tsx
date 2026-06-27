import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { TrendingUp, CheckSquare, ListTodo } from 'lucide-react';

export interface RecentProgressCardProps {
  tasksCompletedToday: number;
  tasksCompletedThisWeek: number;
  checklistItemsCompletedToday: number;
  checklistItemsCompletedThisWeek: number;
}

export function RecentProgressCard({
  tasksCompletedToday,
  tasksCompletedThisWeek,
  checklistItemsCompletedToday,
  checklistItemsCompletedThisWeek,
}: RecentProgressCardProps) {
  return (
    <Card className="select-none flex flex-col h-full justify-between">
      <div>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span>Recent Progress</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3.5">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <CheckSquare className="h-3.5 w-3.5" />
                <span>Completed Tasks</span>
              </div>
              <div className="grid grid-cols-2 gap-4 border-l border-border/80 pl-3">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Today</span>
                  <p className="text-lg font-semibold text-foreground">{tasksCompletedToday}</p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">This Week</span>
                  <p className="text-lg font-semibold text-foreground">{tasksCompletedThisWeek}</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <ListTodo className="h-3.5 w-3.5" />
                <span>Checklist Items</span>
              </div>
              <div className="grid grid-cols-2 gap-4 border-l border-border/80 pl-3">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Today</span>
                  <p className="text-lg font-semibold text-foreground">{checklistItemsCompletedToday}</p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">This Week</span>
                  <p className="text-lg font-semibold text-foreground">{checklistItemsCompletedThisWeek}</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </div>
      <div className="px-6 pb-6 pt-2 text-xs text-muted-foreground font-medium mt-auto">
        <span>Summarizing your achievements</span>
      </div>
    </Card>
  );
}
