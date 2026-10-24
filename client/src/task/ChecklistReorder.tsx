import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChecklistItem } from './types';

export interface ChecklistReorderDraftState {
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly save: () => Promise<boolean>;
  readonly discard: () => void;
}

interface ChecklistReorderProps {
  readonly items: ChecklistItem[];
  readonly onSave: (orderedIds: number[]) => Promise<boolean>;
  readonly onCancel: () => void;
  readonly onSessionChange: (active: boolean) => void;
  readonly onDraftStateChange: (state: ChecklistReorderDraftState | null) => void;
}

function moveItem(ids: number[], from: number, to: number): number[] {
  if (to < 0 || to >= ids.length || from === to) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return ids;
  next.splice(to, 0, moved);
  return next;
}

export function ChecklistReorder({
  items,
  onSave,
  onCancel,
  onSessionChange,
  onDraftStateChange,
}: ChecklistReorderProps) {
  const baselineIds = useMemo(() => items.map((item) => item.id), [items]);
  const [orderedIds, setOrderedIds] = useState(baselineIds);
  const [pending, setPending] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const draggedId = useRef<number | null>(null);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const dirty =
    orderedIds.length !== baselineIds.length ||
    orderedIds.some((id, index) => id !== baselineIds[index]);

  const cancel = useCallback(() => {
    setOrderedIds(baselineIds);
    setSaveFailed(false);
    onDraftStateChange(null);
    onSessionChange(false);
    onCancel();
  }, [baselineIds, onCancel, onDraftStateChange, onSessionChange]);

  const persistOrder = useCallback(
    async (preserveSession: boolean): Promise<boolean> => {
      if (!dirty || pending) return !dirty;
      setPending(true);
      setSaveFailed(false);
      try {
        const saved = await onSave([...orderedIds]);
        if (!saved) {
          setSaveFailed(true);
          setPending(false);
          return false;
        }
        setPending(false);
        if (!preserveSession) {
          onDraftStateChange(null);
          onSessionChange(false);
          onCancel();
        }
        return true;
      } catch {
        setSaveFailed(true);
        setPending(false);
        return false;
      }
    },
    [dirty, onCancel, onDraftStateChange, onSave, onSessionChange, orderedIds, pending]
  );

  const saveForGuard = useCallback(() => persistOrder(true), [persistOrder]);
  const discardForGuard = useCallback(() => cancel(), [cancel]);

  useEffect(() => {
    onSessionChange(true);
    return () => onSessionChange(false);
  }, [onSessionChange]);

  useEffect(() => {
    onDraftStateChange({ dirty, pending, save: saveForGuard, discard: discardForGuard });
  }, [dirty, discardForGuard, onDraftStateChange, pending, saveForGuard]);

  function announceMove(itemId: number, nextIds: number[]) {
    const item = itemById.get(itemId);
    const position = nextIds.indexOf(itemId);
    if (!item || position < 0) return;
    setOrderedIds(nextIds);
    setAnnouncement(`Moved ${item.title} to position ${position + 1} of ${nextIds.length}`);
  }

  function dropOn(targetId: number) {
    const sourceId = draggedId.current;
    draggedId.current = null;
    if (sourceId === null || sourceId === targetId) return;
    announceMove(
      sourceId,
      moveItem(orderedIds, orderedIds.indexOf(sourceId), orderedIds.indexOf(targetId))
    );
  }

  async function saveFromButton() {
    await persistOrder(false);
  }

  return (
    <div className="space-y-3" aria-label="Reorder checklist">
      <ul className="divide-y divide-border" aria-label="Checklist reorder draft">
        {orderedIds.map((id, index) => {
          const item = itemById.get(id);
          if (!item) return null;
          return (
            <li
              key={id}
              aria-label={item.title}
              draggable={!pending}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                dropOn(id);
              }}
              className="flex min-h-11 items-center gap-2 rounded-md px-1 py-1"
            >
              <button
                type="button"
                aria-label={`Reorder checklist item ${item.title}`}
                disabled={pending}
                draggable={!pending}
                onDragStart={(event) => {
                  draggedId.current = id;
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(id));
                }}
                onDragEnd={() => {
                  draggedId.current = null;
                }}
                className="inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GripVertical aria-hidden="true" className="size-4" />
              </button>
              <span className="min-w-0 flex-1 break-words text-base leading-6 text-foreground">
                {item.title}
              </span>
              <button
                type="button"
                aria-label={`Move ${item.title} up`}
                disabled={pending || index === 0}
                onClick={() => announceMove(id, moveItem(orderedIds, index, index - 1))}
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${item.title} down`}
                disabled={pending || index === orderedIds.length - 1}
                onClick={() => announceMove(id, moveItem(orderedIds, index, index + 1))}
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowDown aria-hidden="true" className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {announcement}
      </p>
      {saveFailed && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p>Could not save checklist order.</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => void persistOrder(false)}
            className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retry checklist order
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void saveFromButton()}
          disabled={!dirty || pending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save checklist order'}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel checklist order
        </button>
      </div>
    </div>
  );
}
