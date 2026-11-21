import { Button } from '@/components/ui/button';
import { useNoteLifecycle } from './NoteLifecycleProvider';

export function NoteLifecycleNoticeList(): React.JSX.Element | null {
  const lifecycle = useNoteLifecycle();
  const notices = lifecycle.notices.filter((notice) => notice.ownerId === lifecycle.ownerId);
  if (notices.length === 0) return null;

  return (
    <div aria-label="Note updates" className="space-y-2" role="region">
      {notices.map((notice) => {
        const message =
          notice.kind === 'delete-unconfirmed'
            ? `Couldn't confirm moving Note ${notice.noteId} to Trash`
            : `Note ${notice.noteId} ${notice.operation === 'archive' ? 'archived' : 'moved to Trash'}`;
        return (
          <div
            key={notice.id}
            className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
            role={notice.error ? 'alert' : 'status'}
          >
            <p className="min-w-0 flex-1">{message}</p>
            {notice.error && <p className="w-full text-destructive">{notice.error}</p>}
            {notice.kind === 'undo' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={notice.pending}
                onClick={() => void lifecycle.undo(notice.id)}
                aria-label={`Undo Note ${notice.noteId} ${notice.operation}`}
              >
                {notice.pending ? 'Restoring…' : 'Undo'}
              </Button>
            )}
            {(notice.kind === 'delete-unconfirmed' || (notice.kind === 'undo' && notice.error)) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={notice.pending}
                onClick={() =>
                  void (notice.kind === 'delete-unconfirmed'
                    ? lifecycle.retryDelete(notice.id)
                    : lifecycle.undo(notice.id))
                }
                aria-label={
                  notice.kind === 'delete-unconfirmed'
                    ? `Retry delete for Note ${notice.noteId}`
                    : `Retry undo for Note ${notice.noteId}`
                }
              >
                {notice.pending ? 'Retrying…' : 'Retry'}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={notice.pending}
              onClick={() => lifecycle.dismiss(notice.id)}
              aria-label={`Dismiss Note ${notice.noteId} notice`}
            >
              Dismiss
            </Button>
          </div>
        );
      })}
    </div>
  );
}
