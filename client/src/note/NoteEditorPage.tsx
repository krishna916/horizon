import { isAxiosError } from 'axios';
import { useAuthSession } from '@/user/session/AuthSessionProvider';
import { RichTextEditor } from '@/components/rich-text/RichTextEditor';
import { useNoteDetail } from './queries';
import { parseNoteId } from './noteNavigation';
import { useNoteDraftRecovery } from './NoteDraftRecoveryProvider';
import { NoteEditorNavigationGuard } from './NoteEditorNavigationGuard';
import { useState } from 'react';
import { useNoteAutosave } from './useNoteAutosave';
import { useNoteModal } from './useNoteModal';
import type { NoteDetail } from './types';
import type { NoteDraft } from './noteDraft';
import type { NoteDraftRecoveryEntry } from './NoteDraftRecoveryProvider';

const blankDraft: NoteDraft = { title: '', content: null, tags: [] };

function isUnavailableNote(
  routeNoteId: string | null,
  id: number | null,
  query: ReturnType<typeof useNoteDetail>
) {
  if (routeNoteId === null) return false;
  if (id === null) return true;
  return (
    query.isError &&
    isAxiosError(query.error) &&
    [403, 404].includes(query.error.response?.status ?? 0)
  );
}

function isLoadingExistingNote(
  routeNoteId: string | null,
  query: ReturnType<typeof useNoteDetail>
) {
  return routeNoteId !== null && query.isPending;
}

function hasExistingNoteLoadError(
  routeNoteId: string | null,
  query: ReturnType<typeof useNoteDetail>
) {
  return routeNoteId !== null && (query.isError || !query.data);
}

function statusText(snapshot: {
  phase: string;
  persisted: { id: number; version: number } | null;
}): string {
  if (snapshot.phase === 'saving') return 'Saving…';
  if (snapshot.phase === 'saved' || snapshot.phase === 'clean') {
    return snapshot.persisted ? 'Saved' : 'Not saved yet';
  }
  if (snapshot.phase === 'failed') return 'Save failed';
  if (snapshot.phase === 'conflict') return 'This note changed elsewhere';
  if (snapshot.phase === 'paused') return 'Save paused';
  return 'Unsaved changes';
}

export function NoteEditorPage({
  routeNoteId,
  ownerId: retainedOwnerId,
  identityKey,
  onBack,
  onCreated,
}: {
  readonly routeNoteId: string | null;
  readonly ownerId?: number;
  readonly identityKey?: string;
  readonly onBack: () => void;
  readonly onCreated: (note: NoteDetail) => void;
}) {
  const { phase, verifiedUserId, verifySession } = useAuthSession();
  const recoveryContext = useNoteDraftRecovery();
  const id = routeNoteId === null ? null : parseNoteId(routeNoteId);
  const userId = phase === 'verified' ? (verifiedUserId ?? undefined) : undefined;
  const editorOwnerId = userId ?? retainedOwnerId;
  const logicalIdentity = identityKey ?? (routeNoteId === null ? 'new' : `note:${routeNoteId}`);
  const query = useNoteDetail(editorOwnerId, id, phase === 'verified' && userId !== undefined);
  const editorRoute = routeNoteId === null ? '/notes/new' : `/notes/${routeNoteId}`;
  const retainedRecovery =
    userId === undefined ? null : recoveryContext.peekForVerifiedOwner(userId);
  const recovery = retainedRecovery?.editorRoute === editorRoute ? retainedRecovery : null;
  if (
    phase !== 'verified' &&
    phase !== 'unauthenticated' &&
    editorOwnerId !== undefined &&
    (routeNoteId === null || query.data !== undefined)
  ) {
    return (
      <ActiveNoteEditor
        key={`${editorOwnerId}:${logicalIdentity}`}
        ownerId={editorOwnerId}
        routeNoteId={routeNoteId}
        initialNote={query.data?.data ?? null}
        recovery={null}
        onBack={onBack}
        onCreated={onCreated}
      />
    );
  }

  if (phase !== 'verified' || userId === undefined) {
    return (
      <section className="mx-auto w-full max-w-[808px] px-5 py-5 sm:px-8" aria-label="Note editor">
        <button type="button" onClick={onBack} className="text-sm font-medium hover:underline">
          Back to Notes
        </button>
        {phase === 'retryable-error' ? (
          <div role="alert" className="mt-6 flex items-center gap-3 text-sm">
            <p>We couldn’t verify your session.</p>
            <button type="button" onClick={() => void verifySession()} className="underline">
              Retry
            </button>
          </div>
        ) : (
          <output className="mt-6 block text-sm text-muted-foreground">
            Verifying your session…
          </output>
        )}
      </section>
    );
  }

  if (isUnavailableNote(routeNoteId, id, query)) {
    return (
      <section className="mx-auto w-full max-w-[808px] px-5 py-5 sm:px-8">
        <button type="button" onClick={onBack} className="text-sm font-medium hover:underline">
          Back to Notes
        </button>
        <h1 className="mt-8 text-2xl font-medium">Note unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">This note is unavailable.</p>
      </section>
    );
  }

  if (isLoadingExistingNote(routeNoteId, query)) {
    return (
      <section className="mx-auto w-full max-w-[808px] px-5 py-5 sm:px-8">
        <button type="button" onClick={onBack} className="text-sm font-medium hover:underline">
          Back to Notes
        </button>
        <output
          className="mt-8 block animate-pulse rounded-lg bg-muted/50 p-8 motion-reduce:animate-none"
          aria-busy="true"
        >
          Loading note…
        </output>
      </section>
    );
  }

  if (hasExistingNoteLoadError(routeNoteId, query)) {
    return (
      <section className="mx-auto w-full max-w-[808px] px-5 py-5 sm:px-8">
        <button type="button" onClick={onBack} className="text-sm font-medium hover:underline">
          Back to Notes
        </button>
        <div role="alert" className="mt-8 flex items-center gap-3 text-sm">
          <p className="text-muted-foreground">We couldn’t load this note. Please try again.</p>
          <button type="button" onClick={() => void query.refetch()} className="underline">
            Retry
          </button>
        </div>
      </section>
    );
  }

  const initialNote = query.data?.data ?? null;
  return (
    <ActiveNoteEditor
      key={`${userId}:${logicalIdentity}`}
      ownerId={userId}
      routeNoteId={routeNoteId}
      initialNote={initialNote}
      recovery={recovery}
      onBack={onBack}
      onCreated={onCreated}
    />
  );
}

function ActiveNoteEditor({
  ownerId,
  routeNoteId,
  initialNote,
  recovery,
  onBack,
  onCreated,
}: {
  readonly ownerId: number;
  readonly routeNoteId: string | null;
  readonly initialNote: NoteDetail | null;
  readonly recovery: NoteDraftRecoveryEntry | null;
  readonly onBack: () => void;
  readonly onCreated: (note: NoteDetail) => void;
}) {
  const [conflictChoice, setConflictChoice] = useState<'keep-local' | 'load-server' | null>(null);
  const {
    snapshot,
    edit,
    flush,
    retry,
    resolveConflict,
    discardDraft,
    canLeave,
    canLeaveNow,
    holdQueuedWritesForNavigation,
    releaseQueuedWritesForNavigation,
    getNavigationSaveStateNow,
    persistedNoteIdNow,
  } = useNoteAutosave({
    ownerId,
    initialNote,
    initialDraft: initialNote ? undefined : blankDraft,
    editorRoute: routeNoteId === null ? '/notes/new' : `/notes/${routeNoteId}`,
    recovery,
    onCreated,
  });

  function updateTitle(title: string) {
    edit({ ...snapshot.draft, title });
  }

  function updateContent(content: NoteDraft['content']) {
    edit({ ...snapshot.draft, content });
  }

  const conflictDialogRef = useNoteModal(conflictChoice !== null, () => setConflictChoice(null));

  return (
    <NoteEditorNavigationGuard
      canLeave={canLeave}
      canLeaveNow={canLeaveNow}
      holdQueuedWritesForNavigation={holdQueuedWritesForNavigation}
      releaseQueuedWritesForNavigation={releaseQueuedWritesForNavigation}
      getNavigationSaveStateNow={getNavigationSaveStateNow}
      persistedNoteIdNow={persistedNoteIdNow}
      phase={snapshot.phase}
      hasTagOnlyDraft={snapshot.hasTagOnlyDraft}
      writeInFlight={snapshot.writeInFlight}
      outcomeUncertain={snapshot.outcomeUncertain}
      flush={flush}
      retry={retry}
      discardDraft={discardDraft}
    >
      <article className="mx-auto w-full max-w-[808px] px-5 pb-16 pt-4 sm:px-8 sm:pt-6">
        <div className="sticky top-0 z-10 -mx-5 mb-8 flex min-h-12 items-center justify-between gap-4 border-b border-border/70 bg-background/95 px-5 py-2 backdrop-blur sm:-mx-8 sm:px-8">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-9 items-center rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to Notes
          </button>
          <div className="flex items-center gap-3 text-sm" aria-live="polite">
            <span
              className={snapshot.phase === 'failed' ? 'text-destructive' : 'text-muted-foreground'}
            >
              {statusText(snapshot)}
            </span>
            {snapshot.phase === 'failed' && (
              <button type="button" onClick={() => void retry()} className="font-medium underline">
                Retry
              </button>
            )}
          </div>
        </div>

        <div className="mx-auto w-full max-w-[736px]">
          <input
            aria-label="Note title"
            value={snapshot.draft.title}
            onChange={(event) => updateTitle(event.target.value)}
            placeholder="Untitled note"
            maxLength={255}
            className="w-full border-0 bg-transparent p-0 text-3xl font-medium leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/55 focus-visible:ring-0 sm:text-4xl"
          />
          <div
            className="mb-6 mt-3 min-h-5 text-xs text-muted-foreground"
            aria-label="Note details"
          >
            {initialNote ? (
              <span>
                {initialNote.archivedAt ? 'Archived' : 'Note'} · Updated{' '}
                {new Date(initialNote.updatedAt).toLocaleDateString()}
              </span>
            ) : (
              <span>Private note</span>
            )}
          </div>

          {snapshot.phase === 'conflict' && (
            <section
              className="mb-6 rounded-lg border border-border bg-muted/30 p-4"
              aria-label="Version conflict"
            >
              <p className="text-sm font-medium">A newer version is available.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose which version to keep. Your draft stays here until you confirm.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setConflictChoice('keep-local')}
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  Keep my version
                </button>
                <button
                  type="button"
                  onClick={() => setConflictChoice('load-server')}
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  Load latest version
                </button>
              </div>
            </section>
          )}

          <RichTextEditor
            value={snapshot.draft.content}
            onChange={updateContent}
            ariaLabel="Note content"
            externalReplacementKey={snapshot.replacementRevision}
          />
        </div>

        {conflictChoice && (
          <div className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-4">
            <dialog
              ref={conflictDialogRef}
              aria-modal="true"
              aria-labelledby="conflict-confirm-title"
              className="relative m-0 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl"
            >
              <h2 id="conflict-confirm-title" className="text-lg font-medium">
                {conflictChoice === 'keep-local'
                  ? 'Keep your version?'
                  : 'Load the latest version?'}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {conflictChoice === 'keep-local'
                  ? 'Your current draft will be saved over the latest version.'
                  : 'This replaces your current draft with the latest saved version.'}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConflictChoice(null)}
                  className="rounded-md px-3 py-2 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const choice = conflictChoice;
                    setConflictChoice(null);
                    void resolveConflict(choice);
                  }}
                  disabled={snapshot.resolvingConflict}
                  className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
                >
                  Confirm
                </button>
              </div>
            </dialog>
          </div>
        )}
      </article>
    </NoteEditorNavigationGuard>
  );
}
