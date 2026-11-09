import { Link } from '@tanstack/react-router';
import type { NoteSummary } from './types';
import { NotePreview } from './notePreview';

function titleFor(note: NoteSummary): string {
  return note.title?.trim() || 'Untitled note';
}

function updatedDate(note: NoteSummary): string {
  return new Date(note.updatedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function NoteCard({ note }: { readonly note: NoteSummary }) {
  return (
    <article className="min-w-0 max-h-[440px] self-start">
      <Link
        to="/notes/$id"
        params={{ id: String(note.id) }}
        className="flex max-h-[440px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex min-h-0 flex-1 flex-col p-[21px]">
          <h3 className="break-words text-lg font-medium leading-6 text-foreground">
            {titleFor(note)}
          </h3>
          <div className="mt-3 max-h-[265px] min-h-0 overflow-hidden [mask-image:linear-gradient(to_bottom,black_82%,transparent)]">
            <NotePreview document={note.preview} interactiveLinks={false} />
          </div>
          <time
            className="mt-4 text-xs text-muted-foreground"
            dateTime={note.updatedAt}
            aria-label={`Updated ${updatedDate(note)}`}
          >
            Updated {updatedDate(note)}
          </time>
        </div>
      </Link>
    </article>
  );
}
