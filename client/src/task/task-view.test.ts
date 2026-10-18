import { describe, expect, it } from 'vitest';
import type { TaskSummary } from './types';
import { classifyTasks, formatTaskDueDate } from './task-view';

const summary = (id: number, changes: Partial<TaskSummary> = {}): TaskSummary => ({
  id,
  key: `TASK-${id}`,
  title: `Task ${id}`,
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-18T10:00:00Z',
  updatedAt: '2026-10-18T10:00:00Z',
  ...changes,
});

function withLocalOffset(date: Date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offset);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

describe('classifyTasks', () => {
  it('keeps incomplete non-archived tasks active, including inbox tasks', () => {
    const active = summary(1);
    const inbox = summary(2, { inbox: true });

    expect(classifyTasks([active, inbox], new Date(2026, 9, 18, 12))).toEqual({
      active: [active, inbox],
      completed: [],
    });
  });

  it('includes only non-archived tasks completed on the current local day', () => {
    const now = new Date(2026, 9, 18, 12);
    const today = summary(1, { completedAt: withLocalOffset(new Date(2026, 9, 18, 9)) });
    const yesterday = summary(2, { completedAt: withLocalOffset(new Date(2026, 9, 17, 23, 59)) });
    const archivedToday = summary(3, {
      completedAt: withLocalOffset(new Date(2026, 9, 18, 10)),
      archivedAt: '2026-10-18T11:00:00Z',
    });

    expect(classifyTasks([today, yesterday, archivedToday], now)).toEqual({
      active: [],
      completed: [today],
    });
  });

  it('compares offset timestamps by browser-local calendar day when UTC dates differ', () => {
    const now = new Date(2026, 9, 18, 12);
    const completionTime =
      now.getTimezoneOffset() > 0
        ? new Date(2026, 9, 18, 23, 30)
        : new Date(2026, 9, 18, 0, 10);
    const completed = summary(1, { completedAt: withLocalOffset(completionTime) });

    expect(new Date(completed.completedAt!).getUTCDate()).not.toBe(now.getUTCDate());
    expect(classifyTasks([completed], now).completed).toEqual([completed]);
  });

  it('ignores invalid completion timestamps and does not mutate or reorder the input', () => {
    const now = new Date(2026, 9, 18, 12);
    const tasks = [
      summary(1),
      summary(2, { completedAt: 'not-a-timestamp' }),
      summary(3, { completedAt: withLocalOffset(new Date(2026, 9, 18, 8)) }),
      summary(4),
    ];
    const original = [...tasks];

    const sections = classifyTasks(tasks, now);

    expect(sections.active).toEqual([tasks[0], tasks[3]]);
    expect(sections.completed).toEqual([tasks[2]]);
    expect(tasks).toEqual(original);
  });
});

describe('formatTaskDueDate', () => {
  it('shows Today when a civil due date matches the browser-local date', () => {
    expect(formatTaskDueDate('2026-10-18', new Date(2026, 9, 18, 23, 59))).toBe('Today');
  });

  it('formats another civil date without shifting it through UTC', () => {
    expect(formatTaskDueDate('2026-10-24', new Date(2026, 9, 18, 12))).toBe('Oct 24');
    expect(formatTaskDueDate('2026-01-01', new Date(2025, 11, 31, 23, 59))).toBe('Jan 1');
  });
});
