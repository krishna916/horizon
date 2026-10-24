import { Plus, Trash2 } from 'lucide-react';
import { useRef } from 'react';

export interface CreateChecklistDraft {
  localId: string;
  title: string;
  dueDate: string | null;
}

interface TaskCreateChecklistProps {
  readonly items: CreateChecklistDraft[];
  readonly onChange: (items: CreateChecklistDraft[]) => void;
  readonly disabled: boolean;
}

export function TaskCreateChecklist({ items, onChange, disabled }: TaskCreateChecklistProps) {
  const nextLocalId = useRef(1);

  function addItem() {
    onChange([
      ...items,
      { localId: `checklist-draft-${nextLocalId.current++}`, title: '', dueDate: null },
    ]);
  }

  function updateItem(
    localId: string,
    patch: Partial<Pick<CreateChecklistDraft, 'title' | 'dueDate'>>
  ) {
    onChange(items.map((item) => (item.localId === localId ? { ...item, ...patch } : item)));
  }

  function removeItem(localId: string) {
    onChange(items.filter((item) => item.localId !== localId));
  }

  return (
    <section aria-labelledby="task-create-checklist-heading" className="space-y-2">
      <h2 id="task-create-checklist-heading" className="text-sm font-medium text-foreground">
        Checklist (optional)
      </h2>
      {items.length > 0 && (
        <ul className="space-y-2" aria-label="Initial checklist draft items">
          {items.map((item, index) => (
            <li
              key={item.localId}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2"
            >
              <input
                type="text"
                maxLength={255}
                aria-label={`Checklist item ${index + 1} title`}
                value={item.title}
                disabled={disabled}
                onChange={(event) => updateItem(item.localId, { title: event.currentTarget.value })}
                placeholder="Checklist item title"
                className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
              <input
                type="date"
                aria-label={`Checklist item ${index + 1} due date`}
                value={item.dueDate ?? ''}
                disabled={disabled}
                onChange={(event) =>
                  updateItem(item.localId, { dueDate: event.currentTarget.value || null })
                }
                className="h-9 w-36 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="button"
                aria-label={`Remove checklist draft item ${index + 1}`}
                disabled={disabled}
                onClick={() => removeItem(item.localId)}
                className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        aria-label="Add checklist draft item"
        disabled={disabled}
        onClick={addItem}
        className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus aria-hidden="true" className="size-4" />
        Add checklist item
      </button>
    </section>
  );
}
