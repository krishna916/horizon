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
      archived: [],
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
      archived: [],
    });
  });

  it('compares offset timestamps by browser-local calendar day when UTC dates differ', () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata';

    try {
      const now = new Date(2026, 9, 18, 12);
      const completionTime = new Date(2026, 9, 18, 0, 10);
      const completed = summary(1, { completedAt: withLocalOffset(completionTime) });

      expect(new Date(completed.completedAt!).getUTCDate()).not.toBe(now.getUTCDate());
      expect(classifyTasks([completed], now).completed).toEqual([completed]);
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimeZone;
      }
    }
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

  it('optimisticReopenFromCompletedMovesToActiveBeforeResponse', () => {
    const completed = summary(1, { completedAt: '2026-10-18T09:00:00Z' });

    expect(
      classifyTasks([completed], new Date(2026, 9, 18, 12), new Set(), new Map([[1, false]]))
    ).toEqual({ active: [completed], completed: [], archived: [] });
  });

  it('optimisticCompleteUsesRetainedActiveWithoutFakePersistedTimestamp', () => {
    const incomplete = summary(1);

    expect(
      classifyTasks([incomplete], new Date(2026, 9, 18, 12), new Set([1]), new Map([[1, true]]))
    ).toEqual({ active: [incomplete], completed: [], archived: [] });
    expect(incomplete.completedAt).toBeNull();
  });

  it('retainedCompletedTaskBelongsOnlyToActive', () => {
    const completed = summary(1, { completedAt: '2026-10-18T09:00:00Z' });

    expect(
      classifyTasks([completed], new Date(2026, 9, 18, 12), new Set([1]), new Map([[1, true]]))
    ).toEqual({ active: [completed], completed: [], archived: [] });
  });

  it('archivedTaskCannotBeRetained', () => {
    const archived = summary(1, {
      completedAt: '2026-10-18T09:00:00Z',
      archivedAt: '2026-10-18T10:00:00Z',
    });

    expect(
      classifyTasks([archived], new Date(2026, 9, 18, 12), new Set([1]), new Map([[1, false]]))
    ).toEqual({ active: [], completed: [], archived: [] });
  });

  it('oldCompletionFollowsHistoricalVisibilityAfterReentry', () => {
    const historical = summary(1, { completedAt: '2026-10-16T09:00:00Z' });

    expect(classifyTasks([historical], new Date(2026, 9, 18, 12), new Set(), new Map())).toEqual({
      active: [],
      completed: [],
      archived: [],
    });
  });

  it('historicalCompletionRequiresHistorySwitch', () => {
    const historical = summary(1, { completedAt: '2026-10-16T09:00:00Z' });
    const now = new Date(2026, 9, 18, 12);

    expect(classifyTasks([historical], now).completed).toEqual([]);
    expect(
      classifyTasks([historical], now, new Set(), new Map(), {
        showCompletedHistory: true,
        showArchivedTasks: false,
      }).completed
    ).toEqual([historical]);
  });

  it('archivedWinsOverCompletionAndIgnoresRetention', () => {
    const archivedCompleted = summary(1, {
      completedAt: '2026-10-16T09:00:00Z',
      archivedAt: '2026-10-17T10:00:00Z',
    });
    const sections = classifyTasks(
      [archivedCompleted],
      new Date(2026, 9, 18, 12),
      new Set([1]),
      new Map([[1, false]]),
      { showCompletedHistory: true, showArchivedTasks: true }
    );

    expect(sections).toEqual({ active: [], completed: [], archived: [archivedCompleted] });
  });

  it('independentArchivedAndHistorySwitches', () => {
    const historical = summary(1, { completedAt: '2026-10-16T09:00:00Z' });
    const archived = summary(2, { archivedAt: '2026-10-17T10:00:00Z' });
    const tasks = [historical, archived];
    const now = new Date(2026, 9, 18, 12);

    expect(
      classifyTasks(tasks, now, new Set(), new Map(), {
        showCompletedHistory: true,
        showArchivedTasks: false,
      })
    ).toEqual({ active: [], completed: [historical], archived: [] });
    expect(
      classifyTasks(tasks, now, new Set(), new Map(), {
        showCompletedHistory: false,
        showArchivedTasks: true,
      })
    ).toEqual({ active: [], completed: [], archived: [archived] });
  });

  it('preservesInputOrderAcrossBuckets', () => {
    const tasks = [
      summary(1, { completedAt: '2026-10-16T09:00:00Z' }),
      summary(2),
      summary(3, { completedAt: '2026-10-18T09:00:00Z' }),
      summary(4, { archivedAt: '2026-10-17T10:00:00Z' }),
    ];
    const original = [...tasks];
    const sections = classifyTasks(tasks, new Date(2026, 9, 18, 12), new Set(), new Map(), {
      showCompletedHistory: true,
      showArchivedTasks: true,
    });

    expect(sections).toEqual({
      active: [tasks[1]],
      completed: [tasks[0], tasks[2]],
      archived: [tasks[3]],
    });
    expect(tasks).toEqual(original);
  });

  it('optimisticReopenAndRetainedCompletionStillWork', () => {
    const retained = summary(1, { completedAt: '2026-10-18T09:00:00Z' });
    const reopened = summary(2, { completedAt: '2026-10-18T09:00:00Z' });
    const sections = classifyTasks(
      [retained, reopened],
      new Date(2026, 9, 18, 12),
      new Set([1]),
      new Map([[2, false]])
    );

    expect(sections).toEqual({ active: [retained, reopened], completed: [], archived: [] });
  });

  it('kolkataMidnightOffsetBoundary', () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata';

    try {
      const justBeforeMidnight = summary(1, { completedAt: '2026-10-25T18:29:59Z' });
      const justAfterMidnight = summary(2, { completedAt: '2026-10-25T18:30:01Z' });
      const now = new Date('2026-10-25T18:30:01Z');

      expect(
        justAfterMidnight.completedAt && new Date(justAfterMidnight.completedAt).getDate()
      ).toBe(26);
      expect(classifyTasks([justBeforeMidnight, justAfterMidnight], now).completed).toEqual([
        justAfterMidnight,
      ]);
      expect(
        classifyTasks([justBeforeMidnight, justAfterMidnight], now, new Set(), new Map(), {
          showCompletedHistory: true,
          showArchivedTasks: false,
        }).completed
      ).toEqual([justBeforeMidnight, justAfterMidnight]);
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimeZone;
      }
    }
  });

  it('doesNotIncludeInvalidCompletionTimestampInHistory', () => {
    const invalid = summary(1, { completedAt: 'not-a-timestamp' });

    expect(
      classifyTasks([invalid], new Date(2026, 9, 18, 12), new Set(), new Map(), {
        showCompletedHistory: true,
        showArchivedTasks: false,
      })
    ).toEqual({ active: [], completed: [], archived: [] });
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
