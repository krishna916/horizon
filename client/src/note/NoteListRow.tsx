import { Link } from '@tanstack/react-router';
import type { NoteSummary } from './types';
import { noteListExcerpt } from './notePreview';

function titleFor(note: NoteSummary): string {
  return note.title?.trim() || 'Untitled note';
}

function updatedDate(note: NoteSummary): string {
  return new Date(note.updatedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function NoteListRow({ note }: { readonly note: NoteSummary }) {
  const excerpt = noteListExcerpt(note.preview);
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        to="/notes/$id"
        params={{ id: String(note.id) }}
        state={{ horizonNoteNavigation: { kind: 'from-workspace', noteId: note.id } }}
        className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{titleFor(note)}</span>
          {excerpt && (
            <span className="mt-1 block truncate text-sm text-muted-foreground">{excerpt}</span>
          )}
        </span>
        <time
          className="whitespace-nowrap text-xs text-muted-foreground"
          dateTime={note.updatedAt}
          aria-label={`Updated ${updatedDate(note)}`}
        >
          Updated {updatedDate(note)}
        </time>
      </Link>
    </li>
  );
}
