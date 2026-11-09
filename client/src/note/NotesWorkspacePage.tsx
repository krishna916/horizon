import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useAuthSession } from '@/user/session/AuthSessionProvider';
import { useNoteList } from './queries';
import { useNotesBrowse } from './NotesBrowseContext';
import { NoteCard } from './NoteCard';
import { NoteListRow } from './NoteListRow';
import type { NoteSort } from './types';

function getMain(element: HTMLElement | null): HTMLElement | null {
  return element?.closest('main') ?? null;
}

function LoadingSkeleton({ view }: { readonly view: 'cards' | 'list' }) {
  const items = view === 'cards' ? 8 : 8;
  return (
    <output className="block" role="status" aria-busy="true">
      <span className="sr-only">Loading notes…</span>
      {view === 'cards' ? (
        <div
          aria-hidden="true"
          className="grid auto-rows-min grid-cols-1 items-start gap-5 min-[601px]:grid-cols-2 min-[1221px]:grid-cols-3 min-[1600px]:grid-cols-4"
        >
          {Array.from({ length: items }, (_, index) => (
            <div
              key={index}
              className="h-52 animate-pulse rounded-xl border border-border bg-muted/50 motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : (
        <div aria-hidden="true" className="space-y-3">
          {Array.from({ length: items }, (_, index) => (
            <div
              key={index}
              className="h-16 animate-pulse rounded-md bg-muted/50 motion-reduce:animate-none"
            />
          ))}
        </div>
      )}
    </output>
  );
}

export function NotesWorkspacePage() {
  const { phase, verifiedUserId, verifySession } = useAuthSession();
  const { state, setCollection, setSort, setView, rememberScroll } = useNotesBrowse();
  const userId = phase === 'verified' ? (verifiedUserId ?? undefined) : undefined;
  const query = useNoteList(userId, state.collection, state.sort);
  const rootRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const rememberScrollRef = useRef(rememberScroll);
  rememberScrollRef.current = rememberScroll;

  const notes = useMemo(
    () => query.data?.pages.flatMap((page) => page.data.items) ?? [],
    [query.data]
  );
  const counts = query.data?.pages[0]?.data.counts;

  useLayoutEffect(() => {
    mainRef.current = getMain(rootRef.current);
    return () => {
      if (mainRef.current) rememberScrollRef.current(mainRef.current.scrollTop);
    };
  }, []);

  useLayoutEffect(() => {
    if (!query.isSuccess) return;
    const main = getMain(rootRef.current);
    if (main && main.scrollTop !== state.scrollTop) main.scrollTop = state.scrollTop;
  }, [query.data, query.isSuccess, state.scrollTop]);

  if (phase !== 'verified' || userId === undefined) {
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
        <output className="mt-8 block text-sm text-muted-foreground" role="status">
          Verifying your session…
        </output>
      </section>
    );
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
          <div role="group" aria-label="Note collection" className="inline-flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={state.collection === 'active'}
              onClick={() => setCollection('active')}
              className="inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
            >
              Active <span className="text-xs text-muted-foreground">{counts?.active ?? 0}</span>
            </button>
            <button
              type="button"
              aria-pressed={state.collection === 'archived'}
              onClick={() => setCollection('archived')}
              className="inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
            >
              Archived{' '}
              <span className="text-xs text-muted-foreground">{counts?.archived ?? 0}</span>
            </button>
          </div>

          <div className="inline-flex items-center gap-2 text-sm">
            <label htmlFor="notes-sort" className="text-muted-foreground">
              Sort
            </label>
            <select
              id="notes-sort"
              aria-label="Sort notes"
              value={state.sort}
              onChange={(event) => setSort(event.currentTarget.value as NoteSort)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="updated_desc">Recently updated</option>
              <option value="updated_asc">Least recently updated</option>
              <option value="title_asc">Title A–Z</option>
            </select>
          </div>
        </div>

        <div
          role="group"
          aria-label="Note view"
          className="inline-flex w-fit rounded-md border border-border p-1"
        >
          <button
            type="button"
            aria-pressed={state.view === 'cards'}
            onClick={() => setView('cards')}
            className="min-h-8 rounded px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
          >
            Cards
          </button>
          <button
            type="button"
            aria-pressed={state.view === 'list'}
            onClick={() => setView('list')}
            className="min-h-8 rounded px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
          >
            List
          </button>
        </div>
      </div>

      {query.isPending ? (
        <LoadingSkeleton view={state.view} />
      ) : query.isError && !query.data ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 py-8 text-sm">
          <p className="text-muted-foreground">We couldn’t load your notes. Please try again.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      ) : notes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <h2 className="text-lg font-medium text-foreground">
            {state.collection === 'active' ? 'No active notes yet' : 'No archived notes'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {state.collection === 'active'
              ? 'Your notes will appear here.'
              : 'Archived notes will appear here.'}
          </p>
        </div>
      ) : (
        <>
          {state.view === 'cards' ? (
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
          ) : (
            <ul aria-label="Notes list" className="divide-y divide-border">
              {notes.map((note) => (
                <NoteListRow key={note.id} note={note} />
              ))}
            </ul>
          )}

          {query.isFetchNextPageError && (
            <div role="alert" className="mt-6 flex flex-wrap items-center gap-3 text-sm">
              <p className="text-muted-foreground">
                We couldn’t load more notes. Please try again.
              </p>
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
      )}
    </section>
  );
}
