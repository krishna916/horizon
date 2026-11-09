import { isAxiosError } from 'axios';
import { useAuthSession } from '@/user/session/AuthSessionProvider';
import { RichTextViewer } from '@/components/rich-text/RichTextViewer';
import { useNoteDetail } from './queries';
import { parseNoteId } from './noteNavigation';

function titleFor(title: string | null | undefined): string {
  return title?.trim() || 'Untitled note';
}

export function NoteDetailPage({
  rawId,
  onBack,
}: {
  readonly rawId: string;
  readonly onBack: () => void;
}) {
  const { phase, verifiedUserId, verifySession } = useAuthSession();
  const id = parseNoteId(rawId);
  const userId = phase === 'verified' ? (verifiedUserId ?? undefined) : undefined;
  const query = useNoteDetail(userId, id);

  if (phase !== 'verified' || userId === undefined) {
    return (
      <section
        className="mx-auto w-full max-w-3xl p-6 sm:p-8"
        aria-labelledby="note-detail-heading"
      >
        <button
          type="button"
          onClick={onBack}
          className="mb-6 text-sm font-medium text-primary hover:underline"
        >
          Back to Notes
        </button>
        <h1 id="note-detail-heading" className="text-3xl font-medium text-foreground">
          Note
        </h1>
        {phase === 'retryable-error' ? (
          <div role="alert" className="mt-8 flex flex-wrap items-center gap-3 text-sm">
            <p>We couldn’t verify your session.</p>
            <button type="button" onClick={() => void verifySession()}>
              Retry
            </button>
          </div>
        ) : (
          <output role="status" className="mt-8 block">
            Verifying your session…
          </output>
        )}
      </section>
    );
  }

  if (
    id === null ||
    (query.isError &&
      isAxiosError(query.error) &&
      [403, 404].includes(query.error.response?.status ?? 0))
  ) {
    return (
      <section
        className="mx-auto w-full max-w-3xl p-6 sm:p-8"
        aria-labelledby="note-detail-heading"
      >
        <button
          type="button"
          onClick={onBack}
          className="mb-6 text-sm font-medium text-primary hover:underline"
        >
          Back to Notes
        </button>
        <h1 id="note-detail-heading" className="text-3xl font-medium text-foreground">
          Note unavailable
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">This note is unavailable.</p>
      </section>
    );
  }

  if (query.isPending) {
    return (
      <section
        className="mx-auto w-full max-w-3xl p-6 sm:p-8"
        aria-labelledby="note-detail-heading"
      >
        <button
          type="button"
          onClick={onBack}
          className="mb-6 text-sm font-medium text-primary hover:underline"
        >
          Back to Notes
        </button>
        <h1 id="note-detail-heading" className="sr-only">
          Loading note
        </h1>
        <output
          role="status"
          aria-busy="true"
          className="block animate-pulse rounded-xl bg-muted/50 p-8 motion-reduce:animate-none"
        >
          Loading note…
        </output>
      </section>
    );
  }

  if (query.isError || !query.data) {
    return (
      <section
        className="mx-auto w-full max-w-3xl p-6 sm:p-8"
        aria-labelledby="note-detail-heading"
      >
        <button
          type="button"
          onClick={onBack}
          className="mb-6 text-sm font-medium text-primary hover:underline"
        >
          Back to Notes
        </button>
        <h1 id="note-detail-heading" className="text-3xl font-medium text-foreground">
          Note
        </h1>
        <div role="alert" className="mt-8 flex flex-wrap items-center gap-3 text-sm">
          <p className="text-muted-foreground">We couldn’t load this note. Please try again.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const note = query.data.data;
  return (
    <article className="mx-auto w-full max-w-3xl p-6 sm:p-8 lg:p-10">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to Notes
      </button>
      <header className="border-b border-border pb-6">
        <h1 className="break-words text-3xl font-medium leading-tight tracking-tight text-foreground">
          {titleFor(note.title)}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <time dateTime={note.updatedAt}>
            Updated{' '}
            {new Date(note.updatedAt).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </time>
          {note.archivedAt && <span>Archived</span>}
        </div>
      </header>
      <div className="pt-7">
        <RichTextViewer value={note.content} ariaLabel="Note content" />
      </div>
    </article>
  );
}
