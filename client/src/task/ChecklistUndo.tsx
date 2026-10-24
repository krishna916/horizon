import { useEffect, useRef, useState } from 'react';
import type { ChecklistItem } from './types';

interface ChecklistUndoProps {
  readonly removedItem: ChecklistItem | null;
  readonly onUndo: () => Promise<void>;
  readonly onDismiss: () => void;
}

type UndoPhase = 'idle' | 'restoring' | 'failed' | 'resolved';

export function ChecklistUndo({ removedItem, onUndo, onDismiss }: ChecklistUndoProps) {
  const [phase, setPhase] = useState<UndoPhase>('idle');
  const phaseRef = useRef<UndoPhase>('idle');
  const attemptRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss);
  const onUndoRef = useRef(onUndo);
  const removedItemId = removedItem?.id;

  useEffect(() => {
    onDismissRef.current = onDismiss;
    onUndoRef.current = onUndo;
  }, [onDismiss, onUndo]);

  useEffect(() => {
    if (removedItemId === undefined) return;
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      if (phaseRef.current === 'idle') onDismissRef.current();
    }, 8_000);
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      attemptRef.current += 1;
    };
  }, [removedItemId]);

  async function undo() {
    if (!removedItem || phaseRef.current === 'restoring' || phaseRef.current === 'resolved') return;
    phaseRef.current = 'restoring';
    setPhase('restoring');
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    const attempt = ++attemptRef.current;
    try {
      await onUndoRef.current();
      if (attempt !== attemptRef.current) return;
      phaseRef.current = 'resolved';
      setPhase('resolved');
      onDismissRef.current();
    } catch {
      if (attempt !== attemptRef.current) return;
      phaseRef.current = 'failed';
      setPhase('failed');
    }
  }

  if (!removedItem) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
      <p>Removed {removedItem.title}</p>
      <button
        type="button"
        aria-label={`Undo removing ${removedItem.title}`}
        disabled={phase === 'restoring' || phase === 'resolved'}
        onClick={() => void undo()}
        className="rounded-md px-2 py-1 font-medium underline underline-offset-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Undo
      </button>
      {phase === 'failed' && (
        <div role="alert" className="flex items-center gap-2">
          <p>Could not undo checklist removal.</p>
          <button
            type="button"
            onClick={() => void undo()}
            className="rounded-md border border-border px-2 py-1 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry undo checklist removal
          </button>
        </div>
      )}
    </div>
  );
}
