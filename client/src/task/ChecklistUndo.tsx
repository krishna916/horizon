import { useEffect, useRef, useState } from 'react';
import type { ChecklistItem } from './types';

interface ChecklistUndoProps {
  readonly removedItem: ChecklistItem | null;
  readonly onUndo: () => Promise<void>;
  readonly onDismiss: () => void;
}

export function ChecklistUndo({ removedItem, onUndo, onDismiss }: ChecklistUndoProps) {
  const [undoErrorItemId, setUndoErrorItemId] = useState<number | null>(null);
  const onDismissRef = useRef(onDismiss);
  const onUndoRef = useRef(onUndo);
  const removedItemId = removedItem?.id;

  useEffect(() => {
    onDismissRef.current = onDismiss;
    onUndoRef.current = onUndo;
  }, [onDismiss, onUndo]);

  useEffect(() => {
    if (removedItemId === undefined) return;
    const timeout = window.setTimeout(() => onDismissRef.current(), 8_000);
    return () => window.clearTimeout(timeout);
  }, [removedItemId]);

  async function undo() {
    if (removedItem) setUndoErrorItemId(null);
    try {
      await onUndoRef.current();
      onDismissRef.current();
    } catch {
      if (removedItem) setUndoErrorItemId(removedItem.id);
    }
  }

  if (!removedItem) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
      <p>Removed {removedItem.title}</p>
      <button
        type="button"
        aria-label={`Undo removing ${removedItem.title}`}
        onClick={() => void undo()}
        className="rounded-md px-2 py-1 font-medium underline underline-offset-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Undo
      </button>
      {undoErrorItemId === removedItem.id && (
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
