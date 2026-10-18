import { Calendar } from 'lucide-react';
import { formatTaskDueDate } from './task-view';
import type { TaskPriority, TaskSummary } from './types';

interface TaskRowProps {
  task: TaskSummary;
  now: Date;
  completed: boolean;
}

const priorityLabels: Record<TaskPriority, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export function TaskRow({ task, now, completed }: TaskRowProps) {
  return (
    <li className="border-b border-border px-4 py-4 last:border-b-0 sm:px-6">
      <div className="min-w-0">
        <p
          className={
            completed
              ? 'truncate text-base text-muted-foreground line-through'
              : 'truncate text-base text-foreground'
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
    </li>
  );
}
