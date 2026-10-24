import { Button } from '@/components/ui/button';
import { useTaskLifecycle } from './TaskLifecycleProvider';

export function TaskLifecycleNoticeList(): React.JSX.Element | null {
  const lifecycle = useTaskLifecycle();
  if (lifecycle.notices.length === 0) return null;

  return (
    <div aria-label="Task updates" className="space-y-2" role="region">
      {lifecycle.notices.map((notice) => (
        <div
          key={notice.id}
          className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
          role="status"
        >
          <p className="min-w-0 flex-1">
            {notice.kind === 'delete-unconfirmed'
              ? `Couldn't confirm moving ${notice.taskKey} to Trash`
              : `${notice.taskKey} ${notice.action === 'archive' ? 'archived' : 'moved to Trash'}`}
          </p>
          {notice.error && (
            <p className="w-full text-destructive" role="alert">
              {notice.error}
            </p>
          )}
          {notice.kind === 'undo' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={notice.retrying}
              onClick={() => void lifecycle.undo(notice.id)}
              aria-label={`Undo ${notice.taskKey} ${notice.action}`}
            >
              {notice.retrying ? 'Restoring…' : 'Undo'}
            </Button>
          )}
          {(notice.kind === 'delete-unconfirmed' || (notice.kind === 'undo' && notice.error)) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={notice.retrying}
              onClick={() =>
                void (notice.kind === 'delete-unconfirmed'
                  ? lifecycle.retryDelete(notice.id)
                  : lifecycle.undo(notice.id))
              }
              aria-label={
                notice.kind === 'delete-unconfirmed'
                  ? `Retry delete for ${notice.taskKey}`
                  : `Retry undo for ${notice.taskKey}`
              }
            >
              {notice.retrying ? 'Retrying…' : 'Retry'}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={notice.retrying}
            onClick={() => lifecycle.dismiss(notice.id)}
            aria-label={`Dismiss ${notice.taskKey} notice`}
          >
            Dismiss
          </Button>
        </div>
      ))}
    </div>
  );
}
