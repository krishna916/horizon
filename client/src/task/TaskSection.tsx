import { ChevronDown } from 'lucide-react';
import { TaskRow } from './TaskRow';
import type { TaskSummary } from './types';

interface TaskSectionProps {
  readonly title: 'Active' | 'Completed' | 'Archived';
  readonly tasks: readonly TaskSummary[];
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly now: Date;
  readonly userId: number;
  readonly onCompletionIntent?: (taskId: number, completed: boolean) => void;
  readonly onOpen: (taskId: number) => void;
  readonly onDeleted?: (taskId: number) => void;
  readonly selectedTaskId: number | null;
}

export function TaskSection({
  title,
  tasks,
  expanded,
  onExpandedChange,
  now,
  userId,
  onCompletionIntent,
  onOpen,
  onDeleted,
  selectedTaskId,
}: TaskSectionProps) {
  const headingId = `task-section-${title.toLowerCase()}`;
  const contentId = `task-section-${title.toLowerCase()}-content`;
  const handleCompletionIntent = (taskId: number, completed: boolean) => {
    if (title === 'Active' || !completed) onCompletionIntent?.(taskId, completed);
  };

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2
            id={headingId}
            className="text-sm font-semibold uppercase tracking-wide text-foreground"
          >
            {title}
          </h2>
          <span className="text-sm text-muted-foreground">{tasks.length}</span>
        </div>
        <button
          type="button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title} section`}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => onExpandedChange(!expanded)}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            aria-hidden="true"
            className={`size-4 transition-transform ${expanded ? '' : '-rotate-90'}`}
          />
        </button>
      </div>
      <div id={contentId} aria-labelledby={headingId} hidden={!expanded}>
        {tasks.length > 0 ? (
          <ul className="overflow-hidden rounded-lg border border-border">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                now={now}
                userId={userId}
                onCompletionIntent={handleCompletionIntent}
                onOpen={onOpen}
                onDeleted={onDeleted}
                selected={task.id === selectedTaskId}
              />
            ))}
          </ul>
        ) : (
          title === 'Active' && (
            <p className="py-4 text-sm text-muted-foreground">No active tasks.</p>
          )
        )}
      </div>
    </section>
  );
}
