import { formatTaskDueDate } from './task-view';
import type { TaskPriority } from './types';
import type { TaskDetail } from './types';
import { getTaskDescriptionText } from './taskDescriptionText';

interface TaskDetailViewProps {
  readonly task: TaskDetail;
}

const priorityLabels: Record<TaskPriority, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export function TaskDetailView({ task }: TaskDetailViewProps) {
  const description = getTaskDescriptionText(task.description);

  return (
    <div className="space-y-6 px-6 py-7">
      <h1 className="break-words text-2xl font-semibold leading-tight text-foreground">
        {task.title}
      </h1>
      {description && (
        <p className="break-words whitespace-pre-wrap text-base leading-7 text-muted-foreground">
          {description}
        </p>
      )}
      {(task.priority || task.dueDate) && (
        <dl className="flex flex-wrap gap-x-6 gap-y-3 border-t border-border pt-5 text-sm">
          {task.priority && (
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">Priority</dt>
              <dd>
                <span
                  className={
                    task.priority === 'CRITICAL'
                      ? 'rounded px-1.5 py-0.5 font-medium text-primary-foreground bg-primary'
                      : 'rounded px-1.5 py-0.5 font-medium bg-muted text-muted-foreground'
                  }
                >
                  {priorityLabels[task.priority]}
                </span>
              </dd>
            </div>
          )}
          {task.dueDate && (
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">Due date</dt>
              <dd className="text-foreground">
                <time dateTime={task.dueDate}>{formatTaskDueDate(task.dueDate, new Date())}</time>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
