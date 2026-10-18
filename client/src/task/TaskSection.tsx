import { TaskRow } from './TaskRow';
import type { TaskSummary } from './types';

interface TaskSectionProps {
  readonly title: 'Active' | 'Completed';
  readonly tasks: readonly TaskSummary[];
  readonly now: Date;
}

export function TaskSection({ title, tasks, now }: TaskSectionProps) {
  const completed = title === 'Completed';
  const headingId = `task-section-${title.toLowerCase()}`;

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <h2
          id={headingId}
          className="text-sm font-semibold uppercase tracking-wide text-foreground"
        >
          {title}
        </h2>
        <span className="text-sm text-muted-foreground">{tasks.length}</span>
      </div>
      {tasks.length > 0 ? (
        <ul className="overflow-hidden rounded-lg border border-border">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} now={now} completed={completed} />
          ))}
        </ul>
      ) : (
        title === 'Active' && <p className="py-4 text-sm text-muted-foreground">No active tasks.</p>
      )}
    </section>
  );
}
