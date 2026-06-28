import { Link } from '@tanstack/react-router';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ArrowRight, Inbox } from 'lucide-react';

export interface InboxCardProps {
  inboxCount: number;
}

export function InboxCard({ inboxCount }: InboxCardProps) {
  return (
    <Link
      to="/inbox"
      className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
    >
      <Card className="cursor-pointer hover:border-foreground/30 transition-all select-none duration-200 group flex flex-col h-full justify-between">
        <div>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <span>Inbox</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Items to Review</span>
              <p className="text-2xl font-semibold tracking-tight text-foreground">{inboxCount}</p>
            </div>
          </CardContent>
        </div>
        <div className="px-6 pb-6 pt-2 flex items-center justify-between text-xs text-muted-foreground font-medium group-hover:text-foreground transition-colors mt-auto">
          <span>Go to Inbox</span>
          <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </Card>
    </Link>
  );
}
