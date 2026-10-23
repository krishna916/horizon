import { Check, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ChecklistDueDatePicker } from './ChecklistDueDatePicker';
import type { ChecklistItem } from './types';

interface ChecklistItemRowProps {
  readonly item: ChecklistItem;
  readonly disabled: boolean;
  readonly editingTitle: boolean;
  readonly titleDraft: string;
  readonly onTitleDraftChange: (value: string) => void;
  readonly onBeginTitleEdit: () => void;
  readonly onSaveTitle: () => void;
  readonly onCancelTitle: () => void;
  readonly onDueDateChange: (value: string | null) => void;
  readonly onComplete: () => void;
  readonly onReopen: () => void;
  readonly onRemove: () => void;
}

export function ChecklistItemRow({
  item,
  disabled,
  editingTitle,
  titleDraft,
  onTitleDraftChange,
  onBeginTitleEdit,
  onSaveTitle,
  onCancelTitle,
  onDueDateChange,
  onComplete,
  onReopen,
  onRemove,
}: ChecklistItemRowProps) {
  const completed = item.completedAt !== null;
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  return (
    <li className="flex min-h-11 items-center gap-2 rounded-md px-1 py-1">
      <input
        type="checkbox"
        checked={completed}
        disabled={disabled || editingTitle}
        aria-label={`${completed ? 'Reopen' : 'Complete'} checklist item ${item.title}`}
        onChange={() => (completed ? onReopen() : onComplete())}
        className="size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      <div className="min-w-0 flex-1">
        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            aria-label="Checklist item title"
            disabled={disabled}
            onChange={(event) => onTitleDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSaveTitle();
              } else if (event.key === 'Escape') {
                onCancelTitle();
              }
            }}
            className="min-h-9 w-full rounded-md border border-border bg-background px-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`min-w-0 flex-1 break-words text-base leading-6 ${completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}
            >
              {item.title}
            </span>
            <button
              type="button"
              aria-label={`Edit checklist item ${item.title}`}
              disabled={disabled}
              onClick={onBeginTitleEdit}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Pencil aria-hidden="true" className="size-4" />
            </button>
          </div>
        )}
      </div>
      {editingTitle ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Save checklist item title"
            disabled={disabled || !titleDraft.trim()}
            onClick={onSaveTitle}
            className="inline-flex size-8 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Cancel checklist item title"
            disabled={disabled}
            onClick={onCancelTitle}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <ChecklistDueDatePicker
            itemId={item.id}
            itemTitle={item.title}
            value={item.dueDate}
            disabled={disabled}
            onChange={onDueDateChange}
          />
          <button
            type="button"
            aria-label={`Remove checklist item ${item.title}`}
            disabled={disabled}
            onClick={onRemove}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}
    </li>
  );
}
