import type { TaskSections } from './task-view';
import type { TaskSummary } from './types';

export type TaskSortMode =
  'newest' | 'oldest' | 'due-earliest' | 'due-latest' | 'priority-highest' | 'priority-lowest';

const priorityRank = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
} as const;

function compareNumbers(left: number, right: number) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareCreationDescending(left: TaskSummary, right: TaskSummary) {
  return (
    compareNumbers(Date.parse(right.createdAt), Date.parse(left.createdAt)) ||
    compareNumbers(right.id, left.id)
  );
}

function compareCreationAscending(left: TaskSummary, right: TaskSummary) {
  return (
    compareNumbers(Date.parse(left.createdAt), Date.parse(right.createdAt)) ||
    compareNumbers(left.id, right.id)
  );
}

function compareDueDates(left: TaskSummary, right: TaskSummary, mode: TaskSortMode) {
  if (left.dueDate === null && right.dueDate !== null) return 1;
  if (left.dueDate !== null && right.dueDate === null) return -1;
  if (left.dueDate === null && right.dueDate === null) {
    return compareCreationDescending(left, right);
  }

  const leftDate = left.dueDate!;
  const rightDate = right.dueDate!;
  let dateOrder = 0;
  if (leftDate < rightDate) dateOrder = -1;
  if (leftDate > rightDate) dateOrder = 1;
  if (dateOrder === 0) return compareCreationDescending(left, right);
  if (mode === 'due-earliest') return dateOrder;
  return -dateOrder;
}

function comparePriorities(left: TaskSummary, right: TaskSummary, mode: TaskSortMode) {
  if (left.priority === null && right.priority !== null) return 1;
  if (left.priority !== null && right.priority === null) return -1;
  if (left.priority === null && right.priority === null) {
    return compareCreationDescending(left, right);
  }

  const leftPriority = left.priority!;
  const rightPriority = right.priority!;
  const priorityOrder = compareNumbers(priorityRank[rightPriority], priorityRank[leftPriority]);
  if (priorityOrder === 0) return compareCreationDescending(left, right);
  if (mode === 'priority-highest') return priorityOrder;
  return -priorityOrder;
}

function compareTasks(left: TaskSummary, right: TaskSummary, mode: TaskSortMode) {
  switch (mode) {
    case 'newest':
      return compareCreationDescending(left, right);
    case 'oldest':
      return compareCreationAscending(left, right);
    case 'due-earliest':
    case 'due-latest':
      return compareDueDates(left, right, mode);
    case 'priority-highest':
    case 'priority-lowest':
      return comparePriorities(left, right, mode);
  }
}

export function sortTaskSections(sections: TaskSections, mode: TaskSortMode): TaskSections {
  const sort = (tasks: TaskSummary[]) =>
    [...tasks].sort((left, right) => compareTasks(left, right, mode));

  return {
    active: sort(sections.active),
    completed: sort(sections.completed),
    archived: sort(sections.archived),
  };
}
