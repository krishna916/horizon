import type { TaskSummary } from './types';

export interface TaskSections {
  active: TaskSummary[];
  completed: TaskSummary[];
  archived: TaskSummary[];
}

export interface TaskVisibilityOptions {
  readonly showCompletedHistory: boolean;
  readonly showArchivedTasks: boolean;
}

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function classifyTasks(
  tasks: readonly TaskSummary[],
  now: Date,
  retainedCompletedIds: ReadonlySet<number> = new Set(),
  effectiveCompletedById: ReadonlyMap<number, boolean> = new Map(),
  visibility: TaskVisibilityOptions = { showCompletedHistory: false, showArchivedTasks: false }
): TaskSections {
  const sections: TaskSections = { active: [], completed: [], archived: [] };
  const startOfLocalDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const task of tasks) {
    if (task.archivedAt !== null) {
      if (visibility.showArchivedTasks) sections.archived.push(task);
      continue;
    }

    const completed = effectiveCompletedById.get(task.id) ?? task.completedAt !== null;
    if (!completed || retainedCompletedIds.has(task.id)) {
      sections.active.push(task);
      continue;
    }

    const completedAt = task.completedAt === null ? now : new Date(task.completedAt);
    if (
      !Number.isNaN(completedAt.getTime()) &&
      (isSameLocalDay(completedAt, now) ||
        (visibility.showCompletedHistory && completedAt.getTime() < startOfLocalDay.getTime()))
    ) {
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
