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
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCreationDescending(left: TaskSummary, right: TaskSummary) {
  return (
    compareNumbers(Date.parse(right.createdAt), Date.parse(left.createdAt)) ||
    compareNumbers(right.id, left.id)
  );
}

function compareTasks(left: TaskSummary, right: TaskSummary, mode: TaskSortMode) {
  if (mode === 'newest') {
    return (
      compareNumbers(Date.parse(right.createdAt), Date.parse(left.createdAt)) ||
      compareNumbers(right.id, left.id)
    );
  }

  if (mode === 'oldest') {
    return (
      compareNumbers(Date.parse(left.createdAt), Date.parse(right.createdAt)) ||
      compareNumbers(left.id, right.id)
    );
  }

  if (mode === 'due-earliest' || mode === 'due-latest') {
    if (left.dueDate === null || right.dueDate === null) {
      if (left.dueDate === null && right.dueDate !== null) return 1;
      if (left.dueDate !== null && right.dueDate === null) return -1;
      return compareCreationDescending(left, right);
    }

    const dateOrder = left.dueDate < right.dueDate ? -1 : left.dueDate > right.dueDate ? 1 : 0;
    if (dateOrder !== 0) return mode === 'due-earliest' ? dateOrder : -dateOrder;
    return compareCreationDescending(left, right);
  }

  if (left.priority === null || right.priority === null) {
    if (left.priority === null && right.priority !== null) return 1;
    if (left.priority !== null && right.priority === null) return -1;
    return compareCreationDescending(left, right);
  }

  const priorityOrder = compareNumbers(priorityRank[right.priority], priorityRank[left.priority]);
  if (priorityOrder !== 0) return mode === 'priority-highest' ? priorityOrder : -priorityOrder;
  return compareCreationDescending(left, right);
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
