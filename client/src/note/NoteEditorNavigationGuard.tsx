import { useBlocker } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNoteModal } from './useNoteModal';

export function NoteEditorNavigationGuard({
  canLeave,
  canLeaveNow,
  persistedNoteIdNow,
  phase,
  writeInFlight,
  outcomeUncertain,
  flush,
  retry,
  discardDraft,
  children,
}: {
  readonly canLeave: boolean;
  readonly canLeaveNow: () => boolean;
  readonly persistedNoteIdNow: () => number | null;
  readonly phase: string;
  readonly writeInFlight: boolean;
  readonly outcomeUncertain: boolean;
  readonly flush: () => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly discardDraft: () => void;
  readonly children: ReactNode;
}) {
  const [confirmUncertainLogout, setConfirmUncertainLogout] = useState(false);
  const blocker = useBlocker({
    withResolver: true,
    shouldBlockFn: ({ current, next }) => {
      if (canLeave) return false;
      // The first confirmed POST replaces /notes/new with its canonical ID in place.
      if (
        current.pathname === '/notes/new' &&
        persistedNoteIdNow() !== null &&
        next.pathname === `/notes/${persistedNoteIdNow()}`
      )
        return false;
      return true;
    },
    enableBeforeUnload: () => !canLeave,
  });
  const leaveDialogRef = useNoteModal(blocker.status === 'blocked', () => blocker.reset?.());
  const isExplicitLogout = blocker.status === 'blocked' && blocker.next.pathname === '/login';

  async function waitAndLeave() {
    if (phase === 'failed' || phase === 'conflict' || phase === 'paused') return;
    await flush();
    if (canLeaveNow() && blocker.status === 'blocked') blocker.proceed();
  }

  async function retryAndLeave() {
    await retry();
    if (canLeaveNow() && blocker.status === 'blocked') blocker.proceed();
  }

  return (
    <>
      {children}
      {blocker.status === 'blocked' && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4">
          <dialog
            ref={leaveDialogRef}
            aria-modal="true"
            aria-labelledby="note-leave-title"
            className="relative m-0 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl"
          >
            <h2 id="note-leave-title" className="text-lg font-medium">
              {isExplicitLogout
                ? 'Sign out with an unsaved note?'
                : 'Your note has unsaved changes'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {isExplicitLogout
                ? writeInFlight || outcomeUncertain
                  ? 'A save request has already been sent. It may still be applied even if you sign out.'
                  : 'This note has unsent changes. You can discard them and sign out.'
                : 'Wait for the note to save before leaving. Your draft will stay open if saving fails.'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => blocker.reset()}
                className="rounded-md px-3 py-2 text-sm hover:bg-muted"
              >
                Stay
              </button>
              {phase === 'failed' && (
                <button
                  type="button"
                  onClick={() => void retryAndLeave()}
                  className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
                >
                  {isExplicitLogout ? 'Retry save and sign out' : 'Retry and leave'}
                </button>
              )}
              {phase !== 'failed' && phase !== 'conflict' && phase !== 'paused' && (
                <button
                  type="button"
                  onClick={() => void waitAndLeave()}
                  className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
                >
                  {isExplicitLogout ? 'Wait for save and sign out' : 'Wait for save'}
                </button>
              )}
              {isExplicitLogout &&
                (writeInFlight || outcomeUncertain ? (
                  confirmUncertainLogout ? (
                    <button
                      type="button"
                      onClick={() => {
                        discardDraft();
                        blocker.proceed();
                      }}
                      className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground"
                    >
                      Sign out anyway — changes may already have saved
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmUncertainLogout(true)}
                      className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground"
                    >
                      Sign out without waiting
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      discardDraft();
                      blocker.proceed();
                    }}
                    className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground"
                  >
                    Discard unsent changes and sign out
                  </button>
                ))}
            </div>
          </dialog>
        </div>
      )}
    </>
  );
}
