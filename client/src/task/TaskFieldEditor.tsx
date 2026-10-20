import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { TaskPriority } from './types';
import type { TaskFieldName } from './useTaskFieldEdit';
import { formatTaskDueDate } from './task-view';

interface TaskFieldEditorProps {
  readonly field: TaskFieldName;
  readonly value: string | null;
  readonly activeField: TaskFieldName | null;
  readonly draft: string;
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onActivate: (field: TaskFieldName) => void;
  readonly onDraftChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

const priorityLabels: Record<TaskPriority, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

const priorityValues: TaskPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function fieldLabel(field: TaskFieldName): string {
  if (field === 'title') return 'Title';
  if (field === 'priority') return 'Priority';
  return 'Due date';
}

function readValue(field: TaskFieldName, value: string | null): string {
  if (!value) return field === 'priority' ? 'No priority' : field === 'dueDate' ? 'Not set' : '';
  if (field === 'priority') return priorityLabels[value as TaskPriority];
  if (field === 'dueDate') return formatTaskDueDate(value, new Date());
  return value;
}

function handleReadKeyDown(event: KeyboardEvent<HTMLButtonElement>, activate: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    activate();
  }
}

export function TaskFieldEditor({
  field,
  value,
  activeField,
  draft,
  dirty,
  pending,
  error,
  onActivate,
  onDraftChange,
  onSave,
  onCancel,
}: TaskFieldEditorProps) {
  const label = fieldLabel(field);
  const isEditing = activeField === field;
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!isEditing) return;
    (field === 'priority'
      ? selectRef.current
      : field === 'title'
        ? titleRef.current
        : inputRef.current
    )?.focus();
  }, [field, isEditing]);
  useLayoutEffect(() => {
    if (field !== 'title' || !isEditing || !titleRef.current) return;
    const textarea = titleRef.current;
    const resize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    resize();

    const container = textarea.parentElement;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let previousWidth = container.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const width = container.getBoundingClientRect().width;
      if (width === previousWidth) return;
      previousWidth = width;
      resize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [draft, field, isEditing]);

  if (!isEditing) {
    const content = readValue(field, value);
    return (
      <button
        type="button"
        aria-label={`${field === 'title' ? 'Task title' : label}: ${content}`}
        onDoubleClick={() => onActivate(field)}
        onKeyDown={(event) => handleReadKeyDown(event, () => onActivate(field))}
        className={
          field === 'title'
            ? 'w-full break-words whitespace-pre-wrap text-left text-2xl font-semibold leading-tight text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            : 'rounded-sm text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        }
      >
        {content || <span className="text-muted-foreground">Untitled task</span>}
      </button>
    );
  }

  const errorId = `task-${field}-error`;
  return (
    <div className="space-y-2">
      {field === 'priority' ? (
        <select
          ref={selectRef}
          aria-label={label}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          disabled={pending}
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">No priority</option>
          {priorityValues.map((priority) => (
            <option key={priority} value={priority}>
              {priorityLabels[priority]}
            </option>
          ))}
        </select>
      ) : field === 'title' ? (
        <textarea
          ref={titleRef}
          aria-label={label}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          disabled={pending}
          maxLength={255}
          rows={1}
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          className="block w-full break-words border-0 bg-transparent p-0 text-left text-2xl leading-tight text-foreground font-semibold resize-none overflow-hidden focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <input
          ref={inputRef}
          aria-label={label}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          disabled={pending}
          type={field === 'dueDate' ? 'date' : 'text'}
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        {!dirty && <span className="text-xs text-muted-foreground">No changes</span>}
      </div>
    </div>
  );
}
