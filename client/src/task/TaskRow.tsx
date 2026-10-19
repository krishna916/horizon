import { Calendar } from 'lucide-react';
import { formatTaskDueDate } from './task-view';
import type { TaskPriority, TaskSummary } from './types';

interface TaskRowProps {
  readonly task: TaskSummary;
  readonly now: Date;
  readonly completed: boolean;
  readonly onOpen: (taskId: number) => void;
  readonly selected: boolean;
}

const priorityLabels: Record<TaskPriority, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export function TaskRow({ task, now, completed, onOpen, selected }: TaskRowProps) {
  return (
    <li className="border-b border-border px-4 py-4 last:border-b-0 sm:px-6">
      <button
        type="button"
        aria-label={`Open ${task.key}: ${task.title}`}
        aria-pressed={selected}
        onClick={() => onOpen(task.id)}
        className={`block w-full min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'bg-muted/70' : ''}`}
      >
        <div className="min-w-0">
          <p
            className={
              completed
                ? 'break-words text-base text-muted-foreground line-through'
                : 'break-words text-base text-foreground'
            }
          >
            {task.title}
          </p>
          <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{task.key}</span>
            {task.priority && (
              <span
                className={
                  task.priority === 'CRITICAL'
                    ? 'rounded px-1.5 py-0.5 font-medium text-primary-foreground bg-primary'
                    : 'rounded px-1.5 py-0.5 font-medium bg-muted text-muted-foreground'
                }
              >
                {priorityLabels[task.priority]}
              </span>
            )}
            {task.dueDate && (
              <span className="inline-flex items-center gap-1">
                <Calendar aria-hidden="true" className="size-3.5" />
                {formatTaskDueDate(task.dueDate, now)}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
