import type { MouseEvent } from 'react';
import { RichTextEditor } from '@/components/rich-text/RichTextEditor';
import type { RichTextDocument } from '@/components/rich-text/richTextDocument';
import { RichTextViewer } from '@/components/rich-text/RichTextViewer';

interface TaskDescriptionFieldProps {
  readonly value: RichTextDocument | null;
  readonly unavailable?: boolean;
  readonly editing: boolean;
  readonly draft: RichTextDocument | null;
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly blocked: boolean;
  readonly error: string | null;
  readonly onActivate: () => void;
  readonly onChange: (value: RichTextDocument | null) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

export function TaskDescriptionField({
  value,
  unavailable = false,
  editing,
  draft,
  dirty,
  pending,
  blocked,
  error,
  onActivate,
  onChange,
  onSave,
  onCancel,
}: TaskDescriptionFieldProps) {
  if (editing) {
    return (
      <section aria-label="Edit task description" className="space-y-3">
        <RichTextEditor
          value={draft}
          onChange={onChange}
          disabled={pending}
          ariaLabel="Task description"
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
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
      </section>
    );
  }

  if (unavailable) {
    return (
      <div aria-label="Unavailable task description" className="space-y-2">
        <RichTextViewer value={value} />
        <p className="text-sm text-muted-foreground">
          This saved description is unavailable in this version and has been preserved.
        </p>
      </div>
    );
  }

  if (!value) {
    return (
      <button
        type="button"
        onClick={onActivate}
        disabled={blocked}
        className="rounded-sm text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        Add description…
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div
        onDoubleClick={(event) => handleActivationMouse(event, onActivate, blocked)}
        className="cursor-text rounded-sm"
      >
        <RichTextViewer value={value} />
      </div>
      <button
        type="button"
        aria-label="Edit task description"
        onClick={onActivate}
        disabled={blocked}
        className="rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        Edit description
      </button>
    </div>
  );
}

function isLinkTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('a') !== null;
}

function handleActivationMouse(
  event: MouseEvent<HTMLDivElement>,
  activate: () => void,
  blocked: boolean
) {
  if (!blocked && !isLinkTarget(event.target)) activate();
}
