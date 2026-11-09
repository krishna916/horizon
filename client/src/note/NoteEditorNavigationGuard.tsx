import { useBlocker } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function NoteEditorNavigationGuard({
  canLeave,
  phase,
  flush,
  retry,
  discardDraft,
  children,
}: {
  readonly canLeave: boolean;
  readonly phase: string;
  readonly flush: () => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly discardDraft: () => void;
  readonly children: ReactNode;
}) {
  const canLeaveRef = useRef(canLeave);
  useLayoutEffect(() => {
    canLeaveRef.current = canLeave;
  }, [canLeave]);
  const blocker = useBlocker({
    withResolver: true,
    shouldBlockFn: ({ current, next }) => {
      if (canLeave) return false;
      // The first confirmed POST replaces /notes/new with its canonical ID in place.
      if (current.pathname === '/notes/new' && /^\/notes\/\d+$/.test(next.pathname)) return false;
      return true;
    },
    enableBeforeUnload: () => !canLeave,
  });
  const isExplicitLogout = blocker.status === 'blocked' && blocker.next.pathname === '/login';

  async function waitAndLeave() {
    if (phase === 'failed' || phase === 'conflict' || phase === 'paused') return;
    await flush();
    if (canLeaveRef.current && blocker.status === 'blocked') blocker.proceed();
  }

  async function retryAndLeave() {
    await retry();
    if (canLeaveRef.current && blocker.status === 'blocked') blocker.proceed();
  }

  return (
    <>
      {children}
      {blocker.status === 'blocked' && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-leave-title"
            className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl"
          >
            <h2 id="note-leave-title" className="text-lg font-medium">
              {isExplicitLogout
                ? 'Sign out with an unsaved note?'
                : 'Your note has unsaved changes'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {isExplicitLogout
                ? 'Signing out will discard this in-memory draft.'
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
              {phase === 'failed' ? (
                <button
                  type="button"
                  onClick={() => void retryAndLeave()}
                  className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
                >
                  Retry and leave
                </button>
              ) : phase !== 'conflict' && phase !== 'paused' ? (
                <button
                  type="button"
                  onClick={() => void waitAndLeave()}
                  className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
                >
                  Wait for save
                </button>
              ) : null}
              {isExplicitLogout && (
                <button
                  type="button"
                  onClick={() => {
                    discardDraft();
                    blocker.proceed();
                  }}
                  className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground"
                >
                  Discard draft and sign out
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
