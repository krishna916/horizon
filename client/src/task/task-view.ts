import type { TaskSummary } from './types';

export interface TaskSections {
  active: TaskSummary[];
  completed: TaskSummary[];
}

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function classifyTasks(tasks: readonly TaskSummary[], now: Date): TaskSections {
  const sections: TaskSections = { active: [], completed: [] };

  for (const task of tasks) {
    if (task.archivedAt !== null) {
      continue;
    }

    if (task.completedAt === null) {
      sections.active.push(task);
      continue;
    }

    const completedAt = new Date(task.completedAt);
    if (!Number.isNaN(completedAt.getTime()) && isSameLocalDay(completedAt, now)) {
      sections.completed.push(task);
    }
  }

  return sections;
}

export function formatTaskDueDate(dueDate: string, now: Date): string {
  const [year, month, day] = dueDate.split('-');
  const civilDate = new Date(Number(year), Number(month) - 1, Number(day), 12);

  if (isSameLocalDay(civilDate, now)) {
    return 'Today';
  }

  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(civilDate);
}
