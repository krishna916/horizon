import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChecklistItemRow } from './ChecklistItemRow';
import { ChecklistUndo } from './ChecklistUndo';
import type { ChecklistItem } from './types';
import { useTaskChecklist } from './useTaskChecklist';

interface ChecklistSectionProps {
  readonly taskId: number;
  readonly userId: number;
  readonly items: ChecklistItem[];
  readonly editBlocked: boolean;
  readonly onEditSessionChange: (active: boolean) => void;
}

interface TitleEdit {
  itemId: number;
  draft: string;
}

export function ChecklistSection({
  taskId,
  userId,
  items,
  editBlocked,
  onEditSessionChange,
}: ChecklistSectionProps) {
  const checklist = useTaskChecklist(userId, taskId);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [titleEdit, setTitleEdit] = useState<TitleEdit | null>(null);
  const [actionError, setActionError] = useState(false);
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<number>>(() => new Set());
  const [removedItem, setRemovedItem] = useState<ChecklistItem | null>(null);
  const retryRef = useRef<(() => Promise<unknown>) | null>(null);
  const disabled = editBlocked || checklist.isPending;
  const isTitleEditing = titleEdit !== null;

  useEffect(() => {
    onEditSessionChange(isTitleEditing);
    return () => onEditSessionChange(false);
  }, [isTitleEditing, onEditSessionChange]);

  async function run(action: () => Promise<unknown>) {
    retryRef.current = action;
    setActionError(false);
    try {
      await action();
      retryRef.current = null;
    } catch {
      setActionError(true);
    }
  }

  function addItem() {
    const title = quickAddTitle.trim();
    if (!title || disabled) return;
    void run(async () => {
      await checklist.addItem(title);
      setQuickAddTitle('');
    });
  }

  function saveTitle() {
    if (!titleEdit || !titleEdit.draft.trim() || disabled) return;
    const { itemId, draft } = titleEdit;
    void run(async () => {
      await checklist.patchItem(itemId, { title: draft.trim() });
      setTitleEdit(null);
    });
  }

  function removeItem(item: ChecklistItem) {
    void run(async () => {
      setHiddenItemIds((current) => new Set(current).add(item.id));
      setRemovedItem(null);
      try {
        await checklist.removeItem(item.id);
        setRemovedItem(item);
      } catch (error) {
        setHiddenItemIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
        throw error;
      }
    });
  }

  async function undoRemovedItem() {
    if (!removedItem) return;
    await checklist.restoreItem(removedItem.id);
    setHiddenItemIds((current) => {
      const next = new Set(current);
      next.delete(removedItem.id);
      return next;
    });
  }

  const dismissUndo = useCallback(() => setRemovedItem(null), []);
  const orderedItems = [...items]
    .filter((item) => !hiddenItemIds.has(item.id))
    .sort((left, right) => left.position - right.position);

  return (
    <section aria-labelledby="task-checklist-heading" className="space-y-3">
      <h2 id="task-checklist-heading" className="text-base font-semibold text-foreground">
        Checklist
      </h2>
      {orderedItems.length > 0 && (
        <ul className="divide-y divide-border" aria-label="Checklist items">
          {orderedItems.map((item) => {
            const editingTitle = titleEdit?.itemId === item.id;
            return (
              <ChecklistItemRow
                key={item.id}
                item={item}
                disabled={disabled}
                editingTitle={editingTitle}
                titleDraft={editingTitle ? titleEdit.draft : ''}
                onTitleDraftChange={(draft) => setTitleEdit({ itemId: item.id, draft })}
                onBeginTitleEdit={() => setTitleEdit({ itemId: item.id, draft: item.title })}
                onSaveTitle={saveTitle}
                onCancelTitle={() => setTitleEdit(null)}
                onDueDateChange={(dueDate) =>
                  void run(() => checklist.patchItem(item.id, { dueDate }))
                }
                onComplete={() => void run(() => checklist.completeItem(item.id))}
                onReopen={() => void run(() => checklist.reopenItem(item.id))}
                onRemove={() => removeItem(item)}
              />
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Plus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input
          type="text"
          aria-label="Add checklist item"
          value={quickAddTitle}
          maxLength={255}
          disabled={disabled}
          onChange={(event) => setQuickAddTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addItem();
            }
          }}
          placeholder="Add an item…"
          className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      {actionError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-foreground">
          <p>Could not save checklist changes.</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (retryRef.current) void run(retryRef.current);
            }}
            className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retry checklist change
          </button>
        </div>
      )}
      {checklist.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Saving checklist…
        </p>
      )}
      <ChecklistUndo
        key={removedItem?.id ?? 'none'}
        removedItem={removedItem}
        onUndo={undoRemovedItem}
        onDismiss={dismissUndo}
      />
    </section>
  );
}
