import { Button } from '@/components/ui/button';
import { TaskTagSelector } from './TaskTagSelector';
import type { TaskDetail } from './types';
import type { TaskTagsEditState } from './useTaskTagsEdit';

interface TaskTagsFieldProps {
  readonly task: TaskDetail;
  readonly userId: number;
  readonly edit: TaskTagsEditState;
  readonly blocked: boolean;
}

export function TaskTagsField({ task, userId, edit, blocked }: TaskTagsFieldProps) {
  if (!edit.editing) {
    return (
      <div
        className="flex flex-wrap items-center gap-2"
        onDoubleClick={() => {
          if (!blocked) edit.activate();
        }}
      >
        {task.tags.length > 0 ? (
          task.tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 text-sm text-foreground"
            >
              {tag.name}
            </span>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">No tags yet</span>
        )}
        <button
          type="button"
          aria-label="Edit tags"
          disabled={blocked}
          onClick={edit.activate}
          className="rounded-sm px-1.5 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <TaskTagSelector
        value={edit.draft}
        onChange={edit.change}
        userId={userId}
        knownTags={task.tags}
        disabled={edit.pending}
      />
      {edit.error && (
        <p role="alert" className="text-sm text-destructive">
          {edit.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={() => void edit.save()} disabled={edit.pending}>
          {edit.pending ? 'Saving…' : 'Save tags'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={edit.cancel}
          disabled={edit.pending}
        >
          Cancel tags
        </Button>
      </div>
    </div>
  );
}
