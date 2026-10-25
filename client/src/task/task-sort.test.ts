import { describe, expect, it } from 'vitest';
import type { TaskSections } from './task-view';
import type { TaskPriority, TaskSummary } from './types';
import { sortTaskSections } from './task-sort';

const task = (id: number, changes: Partial<TaskSummary> = {}): TaskSummary => ({
  id,
  key: `TASK-${id}`,
  title: `Task ${id}`,
  priority: 'MEDIUM',
  dueDate: '2026-10-24',
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  ...changes,
});

const ids = (tasks: TaskSummary[]) => tasks.map(({ id }) => id);

describe('sortTaskSections', () => {
  it('newestFirstUsesCreatedAtNotUpdatedAt and uses descending IDs for creation ties', () => {
    const tasks = [
      task(4, { createdAt: '2026-10-19T10:00:00Z', updatedAt: '2026-10-25T10:00:00Z' }),
      task(3, { createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z' }),
      task(5, { createdAt: '2026-10-20T10:00:00Z' }),
    ];

    expect(
      ids(sortTaskSections({ active: tasks, completed: [], archived: [] }, 'newest').active)
    ).toEqual([5, 3, 4]);
  });

  it('oldestFirstReversesCreationOrder and uses ascending IDs for creation ties', () => {
    const tasks = [
      task(4, { createdAt: '2026-10-19T10:00:00Z' }),
      task(5, { createdAt: '2026-10-20T10:00:00Z' }),
      task(3, { createdAt: '2026-10-20T10:00:00Z' }),
    ];

    expect(
      ids(sortTaskSections({ active: tasks, completed: [], archived: [] }, 'oldest').active)
    ).toEqual([4, 3, 5]);
  });

  it.each([
    ['due-earliest', [3, 2, 1, 5, 4]],
    ['due-latest', [1, 3, 2, 5, 4]],
  ] as const)(
    '%s sorts civil dates and puts undated tasks last with deterministic ties',
    (mode, expected) => {
      const tasks = [
        task(1, { dueDate: '2026-10-25', createdAt: '2026-10-20T10:00:00Z' }),
        task(2, { dueDate: '2026-10-01', createdAt: '2026-10-20T10:00:00Z' }),
        task(3, { dueDate: '2026-10-01', createdAt: '2026-10-21T10:00:00Z' }),
        task(4, { dueDate: null, createdAt: '2026-10-20T10:00:00Z' }),
        task(5, { dueDate: null, createdAt: '2026-10-21T10:00:00Z' }),
      ];

      expect(
        ids(sortTaskSections({ active: tasks, completed: [], archived: [] }, mode).active)
      ).toEqual(expected);
    }
  );

  it.each([
    ['priority-highest', ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', null]],
    ['priority-lowest', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', null]],
  ] as const)('%s orders all priorities and always puts null last', (mode, orderedPriorities) => {
    const priorities: (TaskPriority | null)[] = ['LOW', 'HIGH', null, 'CRITICAL', 'MEDIUM'];
    const tasks = priorities.map((priority, index) => task(index + 1, { priority }));

    const sorted = sortTaskSections({ active: tasks, completed: [], archived: [] }, mode).active;

    expect(sorted.map(({ priority }) => priority)).toEqual(orderedPriorities);
  });

  it('uses creation time then descending ID to break equal date and priority ties', () => {
    const tasks = [
      task(2, { dueDate: '2026-10-24', priority: 'HIGH', createdAt: '2026-10-20T10:00:00Z' }),
      task(3, { dueDate: '2026-10-24', priority: 'HIGH', createdAt: '2026-10-21T10:00:00Z' }),
      task(1, { dueDate: '2026-10-24', priority: 'HIGH', createdAt: '2026-10-20T10:00:00Z' }),
    ];
    const sections = { active: tasks, completed: [], archived: [] };

    expect(ids(sortTaskSections(sections, 'due-earliest').active)).toEqual([3, 2, 1]);
    expect(ids(sortTaskSections(sections, 'priority-highest').active)).toEqual([3, 2, 1]);
  });

  it('uses creation time then descending ID to order multiple unprioritized tasks in both directions', () => {
    const tasks = [
      task(4, { priority: null, createdAt: '2026-10-20T10:00:00Z' }),
      task(5, { priority: null, createdAt: '2026-10-21T10:00:00Z' }),
      task(6, { priority: null, createdAt: '2026-10-21T10:00:00Z' }),
    ];
    const sections = { active: tasks, completed: [], archived: [] };

    expect(ids(sortTaskSections(sections, 'priority-highest').active)).toEqual([6, 5, 4]);
    expect(ids(sortTaskSections(sections, 'priority-lowest').active)).toEqual([6, 5, 4]);
  });

  it('compares creation timestamps as instants and keeps due dates as civil dates', () => {
    const sameInstant = [
      task(7, { createdAt: '2026-10-24T10:00:00+02:00' }),
      task(8, { createdAt: '2026-10-24T08:00:00Z' }),
    ];
    const civilDates = [
      task(9, { dueDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' }),
      task(10, { dueDate: '2025-12-31', createdAt: '2025-12-31T23:00:00-08:00' }),
    ];

    expect(
      ids(sortTaskSections({ active: sameInstant, completed: [], archived: [] }, 'newest').active)
    ).toEqual([8, 7]);
    expect(
      ids(
        sortTaskSections({ active: civilDates, completed: [], archived: [] }, 'due-earliest').active
      )
    ).toEqual([10, 9]);
  });

  it('sorts each section independently without mutating buckets, arrays, or tasks', () => {
    const active = [task(1, { createdAt: '2026-10-19T10:00:00Z' }), task(2)];
    const completed = [
      task(3, { createdAt: '2026-10-19T10:00:00Z', completedAt: '2026-10-20T10:00:00Z' }),
      task(4, { completedAt: '2026-10-20T10:00:00Z' }),
    ];
    const archived = [
      task(5, { createdAt: '2026-10-19T10:00:00Z', archivedAt: '2026-10-20T10:00:00Z' }),
      task(6, { archivedAt: '2026-10-20T10:00:00Z' }),
    ];
    const sections: TaskSections = { active, completed, archived };
    const originalBuckets = { ...sections };
    const originalArrays = [active.slice(), completed.slice(), archived.slice()];
    const originalTasks = [...active, ...completed, ...archived].map((item) => ({ ...item }));

    const sorted = sortTaskSections(sections, 'newest');

    expect(Object.keys(sorted)).toEqual(['active', 'completed', 'archived']);
    expect(ids(sorted.active)).toEqual([2, 1]);
    expect(ids(sorted.completed)).toEqual([4, 3]);
    expect(ids(sorted.archived)).toEqual([6, 5]);
    expect(sorted).not.toBe(sections);
    expect(sorted.active).not.toBe(active);
    expect(sections).toEqual(originalBuckets);
    expect([active, completed, archived]).toEqual(originalArrays);
    expect([...active, ...completed, ...archived]).toEqual(originalTasks);
  });
});
