import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useAuthSession } from '@/user/session/AuthSessionProvider';
import type { AuthSessionPhase } from '@/user/session/AuthSessionProvider';
import { useNoteList } from './queries';
import { useNotesBrowse } from './NotesBrowseContext';
import { NoteCard } from './NoteCard';
import { NoteListRow } from './NoteListRow';
import type { NoteCollection, NoteSort, NoteSummary, NoteViewMode } from './types';

const skeletonIds = Array.from({ length: 8 }, (_, index) => `note-skeleton-${index + 1}`);
type NotesListQuery = ReturnType<typeof useNoteList>;

function getMain(element: HTMLElement | null): HTMLElement | null {
  return element?.closest('main') ?? null;
}

function LoadingSkeleton({ view }: { readonly view: NoteViewMode }) {
  if (view === 'list') {
    return (
      <output className="block" aria-busy="true">
        <span className="sr-only">Loading notes…</span>
        <div aria-hidden="true" className="space-y-3">
          {skeletonIds.map((id) => (
            <div
              key={id}
              className="h-16 animate-pulse rounded-md bg-muted/50 motion-reduce:animate-none"
            />
          ))}
        </div>
      </output>
    );
  }

  return (
    <output className="block" aria-busy="true">
      <span className="sr-only">Loading notes…</span>
      <div
        aria-hidden="true"
        className="grid auto-rows-min grid-cols-1 items-start gap-5 min-[601px]:grid-cols-2 min-[1221px]:grid-cols-3 min-[1600px]:grid-cols-4"
      >
        {skeletonIds.map((id) => (
          <div
            key={id}
            className="h-52 animate-pulse rounded-xl border border-border bg-muted/50 motion-reduce:animate-none"
          />
        ))}
      </div>
    </output>
  );
}

function SessionStatus({
  phase,
  verifySession,
}: {
  readonly phase: AuthSessionPhase;
  readonly verifySession: () => Promise<void>;
}) {
  if (phase === 'retryable-error') {
    return (
      <section className="p-6 sm:p-8" aria-labelledby="notes-heading">
        <h1 id="notes-heading" className="text-3xl font-medium text-foreground">
          Notes
        </h1>
        <div role="alert" className="mt-8 flex flex-wrap items-center gap-3 text-sm">
          <p className="text-muted-foreground">
            We couldn’t verify your session. Please try again.
          </p>
          <button
            type="button"
            onClick={() => void verifySession()}
            className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="p-6 sm:p-8" aria-labelledby="notes-heading">
      <h1 id="notes-heading" className="text-3xl font-medium text-foreground">
        Notes
      </h1>
      <output className="mt-8 block text-sm text-muted-foreground">Verifying your session…</output>
    </section>
  );
}

function CollectionControls({
  collection,
  counts,
  setCollection,
}: {
  readonly collection: NoteCollection;
  readonly counts: { active: number; archived: number } | undefined;
  readonly setCollection: (collection: NoteCollection) => void;
}) {
  return (
    <fieldset className="inline-flex flex-wrap gap-2">
      <legend className="sr-only">Note collection</legend>
      <button
        type="button"
        aria-pressed={collection === 'active'}
        onClick={() => setCollection('active')}
        className="inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
      >
        Active <span className="text-xs text-muted-foreground">{counts?.active ?? 0}</span>
      </button>
      <button
        type="button"
        aria-pressed={collection === 'archived'}
        onClick={() => setCollection('archived')}
        className="inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
      >
        Archived <span className="text-xs text-muted-foreground">{counts?.archived ?? 0}</span>
      </button>
    </fieldset>
  );
}

function SortControl({
  sort,
  setSort,
}: {
  readonly sort: NoteSort;
  readonly setSort: (sort: NoteSort) => void;
}) {
  return (
    <div className="inline-flex items-center gap-2 text-sm">
      <label htmlFor="notes-sort" className="text-muted-foreground">
        Sort
      </label>
      <select
        id="notes-sort"
        aria-label="Sort notes"
        value={sort}
        onChange={(event) => setSort(event.currentTarget.value as NoteSort)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="updated_desc">Recently updated</option>
        <option value="updated_asc">Least recently updated</option>
        <option value="title_asc">Title A–Z</option>
      </select>
    </div>
  );
}

function ViewControls({
  view,
  setView,
}: {
  readonly view: NoteViewMode;
  readonly setView: (view: NoteViewMode) => void;
}) {
  return (
    <fieldset className="inline-flex w-fit rounded-md border border-border p-1">
      <legend className="sr-only">Note view</legend>
      <button
        type="button"
        aria-pressed={view === 'cards'}
        onClick={() => setView('cards')}
        className="min-h-8 rounded px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
      >
        Cards
      </button>
      <button
        type="button"
        aria-pressed={view === 'list'}
        onClick={() => setView('list')}
        className="min-h-8 rounded px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
      >
        List
      </button>
    </fieldset>
  );
}

function EmptyCollection({ collection }: { readonly collection: NoteCollection }) {
  const title = collection === 'active' ? 'No active notes yet' : 'No archived notes';
  const description =
    collection === 'active' ? 'Your notes will appear here.' : 'Archived notes will appear here.';
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <h2 className="text-lg font-medium text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function InitialLoadError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 py-8 text-sm">
      <p className="text-muted-foreground">We couldn’t load your notes. Please try again.</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Retry
      </button>
    </div>
  );
}

function NoteItems({
  notes,
  view,
}: {
  readonly notes: NoteSummary[];
  readonly view: NoteViewMode;
}) {
  if (view === 'list') {
    return (
      <ul aria-label="Notes list" className="divide-y divide-border">
        {notes.map((note) => (
          <NoteListRow key={note.id} note={note} />
        ))}
      </ul>
    );
  }

  return (
    <ul
      aria-label="Notes cards"
      className="grid auto-rows-min grid-cols-1 items-start gap-5 min-[601px]:grid-cols-2 min-[1221px]:grid-cols-3 min-[1600px]:grid-cols-4"
    >
      {notes.map((note) => (
        <li key={note.id} className="min-w-0 self-start">
          <NoteCard note={note} />
        </li>
      ))}
    </ul>
  );
}

function NoteResults({
  query,
  notes,
  collection,
  view,
}: {
  readonly query: NotesListQuery;
  readonly notes: NoteSummary[];
  readonly collection: NoteCollection;
  readonly view: NoteViewMode;
}) {
  if (query.isPending) return <LoadingSkeleton view={view} />;
  if (query.isError && !query.data)
    return <InitialLoadError onRetry={() => void query.refetch()} />;
  if (notes.length === 0) return <EmptyCollection collection={collection} />;

  return (
    <>
      <NoteItems notes={notes} view={view} />
      {query.isFetchNextPageError && (
        <div role="alert" className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          <p className="text-muted-foreground">We couldn’t load more notes. Please try again.</p>
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry loading more notes
          </button>
        </div>
      )}
      {query.hasNextPage && !query.isFetchNextPageError && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
            className="min-h-10 rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
          >
            {query.isFetchingNextPage ? 'Loading more…' : 'Load more notes'}
          </button>
        </div>
      )}
    </>
  );
}

export function NotesWorkspacePage() {
  const { phase, verifiedUserId, verifySession } = useAuthSession();
  const { state, setCollection, setSort, setView, rememberScroll } = useNotesBrowse();
  const userId = phase === 'verified' ? (verifiedUserId ?? undefined) : undefined;
  const query = useNoteList(userId, state.collection, state.sort);
  const rootRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const notes = useMemo(
    () => query.data?.pages.flatMap((page) => page.data.items) ?? [],
    [query.data]
  );
  const counts = query.data?.pages[0]?.data.counts;

  useLayoutEffect(() => {
    mainRef.current = getMain(rootRef.current);
    return () => {
      if (mainRef.current) rememberScroll(mainRef.current.scrollTop);
    };
  }, [rememberScroll]);

  useLayoutEffect(() => {
    if (!query.isSuccess) return;
    const main = getMain(rootRef.current);
    if (main && main.scrollTop !== state.scrollTop) main.scrollTop = state.scrollTop;
  }, [query.data, query.isSuccess, state.scrollTop]);

  if (phase !== 'verified' || userId === undefined) {
    return <SessionStatus phase={phase} verifySession={verifySession} />;
  }

  return (
    <section ref={rootRef} className="mx-auto w-full max-w-[1600px] p-6 sm:p-8 lg:p-10">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="notes-heading"
            className="text-4xl font-medium leading-tight tracking-tight text-foreground"
          >
            Notes
          </h1>
          <p className="mt-2 text-base text-muted-foreground">Keep what matters close.</p>
        </div>
        <Link
          to="/notes/new"
          state={{ horizonNoteNavigation: { kind: 'from-workspace' } }}
          className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          New note
        </Link>
      </header>

      <div className="mb-6 flex flex-col gap-4 border-b border-border pb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <CollectionControls
            collection={state.collection}
            counts={counts}
            setCollection={setCollection}
          />
          <SortControl sort={state.sort} setSort={setSort} />
        </div>
        <ViewControls view={state.view} setView={setView} />
      </div>

      <NoteResults query={query} notes={notes} collection={state.collection} view={state.view} />
    </section>
  );
}
