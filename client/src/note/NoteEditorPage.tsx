import { isAxiosError } from 'axios';
import { useAuthSession } from '@/user/session/AuthSessionProvider';
import { RichTextEditor } from '@/components/rich-text/RichTextEditor';
import { TagSelector } from '@/tag/TagSelector';
import { useNoteDetail } from './queries';
import { parseNoteId } from './noteNavigation';
import { useNoteDraftRecovery } from './NoteDraftRecoveryProvider';
import { NoteEditorNavigationGuard } from './NoteEditorNavigationGuard';
import { useEffect, useState } from 'react';
import { useNoteAutosave } from './useNoteAutosave';
import { useNoteModal } from './useNoteModal';
import { useNoteLifecycle } from './NoteLifecycleProvider';
import { NoteLifecycleActions } from './NoteLifecycleActions';
import type { NoteLifecycleOperation, NoteLifecycleTarget } from './types';
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
  readonly onBack: (options?: { focusCollection?: boolean }) => void | Promise<void>;
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
        <button
          type="button"
          onClick={() => void onBack()}
          className="text-sm font-medium hover:underline"
        >
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
        <button
          type="button"
          onClick={() => void onBack()}
          className="text-sm font-medium hover:underline"
        >
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
        <button
          type="button"
          onClick={() => void onBack()}
          className="text-sm font-medium hover:underline"
        >
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
        <button
          type="button"
          onClick={() => void onBack()}
          className="text-sm font-medium hover:underline"
        >
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
  readonly onBack: (options?: { focusCollection?: boolean }) => void | Promise<void>;
  readonly onCreated: (note: NoteDetail) => void;
}) {
  const [conflictChoice, setConflictChoice] = useState<'keep-local' | 'load-server' | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [lifecycleRetryError, setLifecycleRetryError] = useState<string | null>(null);
  const [localLifecycleNote, setLocalLifecycleNote] = useState(initialNote);
  const {
    snapshot,
    edit,
    flush,
    prepareLifecycleMutation,
    completeLifecycleMutation,
    recoverLifecycleMutation,
    cancelLifecycleMutation,
    retry,
    resolveConflict,
    discardDraft,
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
    onCreated: (note) => {
      setLocalLifecycleNote(note);
      onCreated(note);
    },
    onServerReconciled: setLocalLifecycleNote,
  });
  const lifecycle = useNoteLifecycle();
  const registerEditor = lifecycle.registerEditor;
  const lifecycleState = lifecycle.stateFor(
    ownerId,
    localLifecycleNote?.id ?? initialNote?.id ?? -1
  );
  const lifecycleNote = [
    initialNote,
    localLifecycleNote,
    lifecycleState.note,
  ].reduce<NoteDetail | null>(
    (latest, note) => (!note || (latest && latest.version > note.version) ? latest : note),
    null
  );
  const lifecycleBusy = snapshot.lifecycleBusy || actionPending || lifecycleState.recoveryRequired;

  useEffect(() => {
    const noteId = lifecycleNote?.id;
    if (noteId === undefined) return;
    return registerEditor(noteId, {
      prepare: prepareLifecycleMutation,
      complete: (note) => {
        completeLifecycleMutation(note);
        if (note) setLocalLifecycleNote(note);
        else void onBack({ focusCollection: true });
      },
      recover: (note) => {
        const recovered = recoverLifecycleMutation(note);
        if (recovered) setLocalLifecycleNote(note);
        return recovered;
      },
      cancel: cancelLifecycleMutation,
    });
  }, [
    cancelLifecycleMutation,
    completeLifecycleMutation,
    recoverLifecycleMutation,
    lifecycleNote?.id,
    onBack,
    prepareLifecycleMutation,
    registerEditor,
  ]);

  async function runLifecycleAction(
    operation: NoteLifecycleOperation,
    retryTarget?: NoteLifecycleTarget,
    isRetry = false
  ) {
    if (!snapshot.persisted || lifecycleBusy) return;
    setLifecycleRetryError(null);
    setActionPending(true);
    let prepared = false;
    try {
      const preparedTarget = await prepareLifecycleMutation();
      if (!preparedTarget) return;
      prepared = true;
      if (
        isRetry &&
        retryTarget &&
        (preparedTarget.id !== retryTarget.id || preparedTarget.version !== retryTarget.version)
      ) {
        prepared = false;
        cancelLifecycleMutation();
        setLifecycleRetryError(
          'This note changed elsewhere. Review the latest version before trying again.'
        );
        return;
      }
      const result = await lifecycle.run(
        ownerId,
        {
          id: preparedTarget.id,
          version: preparedTarget.version,
          archivedAt: lifecycleNote?.archivedAt ?? null,
        },
        operation
      );
      if (result?.kind === 'note') {
        setLocalLifecycleNote(result.note);
        completeLifecycleMutation(result.note);
      } else if (result?.kind === 'deleted') {
        completeLifecycleMutation(null);
        await onBack({ focusCollection: true });
      } else {
        const outcomeUnknown = lifecycle.stateFor(ownerId, preparedTarget.id).outcomeUnknown;
        if (!outcomeUnknown) cancelLifecycleMutation();
      }
    } catch {
      if (prepared) cancelLifecycleMutation();
    } finally {
      setActionPending(false);
    }
  }

  function updateTitle(title: string) {
    edit({ ...snapshot.draft, title });
  }

  function updateContent(content: NoteDraft['content']) {
    edit({ ...snapshot.draft, content });
  }

  const conflictDialogRef = useNoteModal(conflictChoice !== null, () => setConflictChoice(null));

  return (
    <NoteEditorNavigationGuard
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
            onClick={() => void onBack()}
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
            {snapshot.persisted && lifecycleNote && (
              <NoteLifecycleActions
                target={{
                  id: lifecycleNote.id,
                  version: snapshot.persisted.version,
                  archivedAt: lifecycleNote.archivedAt,
                }}
                label={lifecycleNote.title?.trim() || 'Untitled note'}
                placement="editor"
                disabled={
                  lifecycleBusy ||
                  snapshot.phase === 'saving' ||
                  snapshot.phase === 'failed' ||
                  snapshot.phase === 'conflict' ||
                  snapshot.outcomeUncertain
                }
                onExecute={runLifecycleAction}
                onRetry={(operation, target) => runLifecycleAction(operation, target, true)}
              />
            )}
            {lifecycleRetryError && (
              <p role="alert" className="text-sm text-destructive">
                {lifecycleRetryError}
              </p>
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
            disabled={lifecycleBusy}
            className="w-full border-0 bg-transparent p-0 text-3xl font-medium leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/55 focus-visible:ring-0 sm:text-4xl"
          />
          <div
            className="mb-6 mt-3 min-h-5 text-xs text-muted-foreground"
            aria-label="Note details"
          >
            {lifecycleNote ? (
              <span>
                {lifecycleNote.archivedAt ? 'Archived' : 'Note'} · Updated{' '}
                {new Date(lifecycleNote.updatedAt).toLocaleDateString()}
                {lifecycleNote.archivedAt && snapshot.persisted && (
                  <button
                    type="button"
                    disabled={lifecycleBusy}
                    onClick={() => void runLifecycleAction('restore')}
                    className="ml-2 underline disabled:opacity-50"
                  >
                    Restore
                  </button>
                )}
              </span>
            ) : (
              <span>Private note</span>
            )}
          </div>

          <div className="mb-6">
            <TagSelector
              value={snapshot.draft.tags ?? []}
              onChange={(tags) => edit({ ...snapshot.draft, tags })}
              userId={ownerId}
              knownTags={snapshot.knownTags}
              disabled={lifecycleBusy}
              createLabel="add"
            />
            {snapshot.tagValidationError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {snapshot.tagValidationError}
              </p>
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
            disabled={lifecycleBusy}
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
