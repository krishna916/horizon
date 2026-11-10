import { Link } from '@tanstack/react-router';
import type { NoteSummary } from './types';
import { NotePreview } from './notePreview';
import { sortNoteTags } from './noteTagDisplay';

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
  const tags = sortNoteTags(note.tags);
  const visibleTags = tags.slice(0, 2);

  return (
    <article className="min-w-0 max-h-[440px] self-start">
      <Link
        to="/notes/$id"
        params={{ id: String(note.id) }}
        state={{ horizonNoteNavigation: { kind: 'from-workspace', noteId: note.id } }}
        className="flex max-h-[440px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex min-h-0 flex-1 flex-col p-[21px]">
          <h2 className="note-card-title break-words text-lg font-medium leading-6 text-foreground">
            {titleFor(note)}
          </h2>
          <div className="mt-3 max-h-[240px] min-h-0 overflow-hidden [mask-image:linear-gradient(to_bottom,black_82%,transparent)] min-[601px]:max-h-[265px]">
            <NotePreview document={note.preview} interactiveLinks={false} />
          </div>
          <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Note Tags">
              {visibleTags.map((tag) => (
                <span
                  key={tag.id}
                  className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tag.name}
                </span>
              ))}
              {tags.length > 2 && (
                <span className="text-xs text-muted-foreground">+{tags.length - 2}</span>
              )}
            </div>
            <time
              className="shrink-0 text-xs text-muted-foreground"
              dateTime={note.updatedAt}
              aria-label={`Updated ${updatedDate(note)}`}
            >
              Updated {updatedDate(note)}
            </time>
          </div>
        </div>
      </Link>
    </article>
  );
}
