import { Link } from '@tanstack/react-router';
import type { NoteSummary } from './types';
import { noteListExcerpt } from './notePreview';
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

export function NoteListRow({ note }: { readonly note: NoteSummary }) {
  const excerpt = noteListExcerpt(note.preview);
  const tags = sortNoteTags(note.tags);
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        to="/notes/$id"
        params={{ id: String(note.id) }}
        state={{ horizonNoteNavigation: { kind: 'from-workspace', noteId: note.id } }}
        className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto] sm:px-4"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{titleFor(note)}</span>
          {excerpt && (
            <span className="mt-1 block truncate text-sm text-muted-foreground">{excerpt}</span>
          )}
        </span>
        <span
          className="hidden min-w-0 flex-wrap items-center gap-1.5 sm:flex"
          aria-label="Note Tags"
        >
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="max-w-32 truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {tag.name}
            </span>
          ))}
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
