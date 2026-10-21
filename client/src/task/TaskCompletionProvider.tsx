/* eslint-disable react-refresh/only-export-components */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TaskDetail, TaskSummary } from './types';
import { taskApi } from './api';

interface CompletionEntry {
  readonly userId: number;
  readonly taskId: number;
  readonly confirmedAt: string | null;
  readonly desired: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  readonly retryDesired: boolean | null;
  readonly version: number;
}

interface CompletionContextValue {
  readonly entries: ReadonlyMap<string, CompletionEntry>;
  readonly toggle: (userId: number, task: TaskSummary) => boolean;
  readonly retry: (userId: number, task: TaskSummary) => void;
}

const CompletionContext = createContext<CompletionContextValue | null>(null);

function entryKey(userId: number, taskId: number): string {
  return `${userId}:${taskId}`;
}

function setCompletionInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: number,
  taskId: number,
  completedAt: string | null,
  updatedAt: string
) {
  const detailKey = ['tasks', userId, 'detail', taskId] as const;
  const listKey = ['tasks', userId] as const;
  queryClient.setQueryData<TaskDetail>(detailKey, (current) =>
    current ? { ...current, completedAt, updatedAt } : current
  );
  queryClient.setQueryData<{ items: TaskSummary[] }>(listKey, (current) =>
    current
      ? {
          items: current.items.map((item) =>
            item.id === taskId ? { ...item, completedAt, updatedAt } : item
          ),
        }
      : current
  );
}

export function TaskCompletionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<Map<string, CompletionEntry>>(() => new Map());
  const entriesRef = useRef(entries);
  const running = useRef(new Set<string>());

  const publish = useCallback((update: (current: Map<string, CompletionEntry>) => void) => {
    const next = new Map(entriesRef.current);
    update(next);
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const run = useCallback(
    async (key: string) => {
      if (running.current.has(key)) return;
      running.current.add(key);
      try {
        while (true) {
          const current = entriesRef.current.get(key);
          if (!current) return;
          const confirmed = current.confirmedAt !== null;
          if (current.desired === confirmed) {
            publish((next) => next.delete(key));
            return;
          }

          const requestedValue = current.desired;
          const requestedVersion = current.version;
          const request = requestedValue
            ? taskApi.complete(current.taskId)
            : taskApi.reopen(current.taskId);

          try {
            const response = await request;
            const task = response.data;
            setCompletionInCache(
              queryClient,
              current.userId,
              current.taskId,
              task.completedAt,
              task.updatedAt
            );
            const latest = entriesRef.current.get(key);
            if (!latest) return;
            const confirmedAt = task.completedAt;
            if (latest.desired === (confirmedAt !== null)) {
              publish((next) => next.delete(key));
              return;
            }
            publish((next) => {
              const entry = next.get(key);
              if (entry) next.set(key, { ...entry, confirmedAt, saving: true, error: null });
            });
          } catch {
            let confirmedAt = entriesRef.current.get(key)?.confirmedAt ?? null;
            try {
              const reconciled = await taskApi.get(current.taskId);
              confirmedAt = reconciled.data.completedAt;
              setCompletionInCache(
                queryClient,
                current.userId,
                current.taskId,
                confirmedAt,
                reconciled.data.updatedAt
              );
            } catch {
              // Preserve the last confirmed state when the authoritative read also fails.
            }

            const latest = entriesRef.current.get(key);
            if (!latest) return;
            if (latest.version > requestedVersion) {
              publish((next) => {
                const entry = next.get(key);
                if (entry) {
                  next.set(key, {
                    ...entry,
                    confirmedAt,
                    saving: true,
                    error: null,
                    retryDesired: null,
                  });
                }
              });
              continue;
            }

            const confirmedValue = confirmedAt !== null;
            if (latest.desired === confirmedValue) {
              publish((next) => next.delete(key));
              return;
            }
            publish((next) => {
              const entry = next.get(key);
              if (entry) {
                next.set(key, {
                  ...entry,
                  confirmedAt,
                  desired: confirmedValue,
                  saving: false,
                  error: "We couldn't save this completion change.",
                  retryDesired: latest.desired,
                });
              }
            });
            return;
          }
        }
      } finally {
        running.current.delete(key);
      }
    },
    [publish, queryClient]
  );

  const prepare = useCallback(
    (userId: number, task: TaskSummary, desired: boolean, retryDesired: boolean | null) => {
      const key = entryKey(userId, task.id);
      const existing = entriesRef.current.get(key);
      const nextEntry: CompletionEntry = {
        userId,
        taskId: task.id,
        confirmedAt: existing ? existing.confirmedAt : task.completedAt,
        desired,
        saving: true,
        error: null,
        retryDesired,
        version: (existing?.version ?? 0) + 1,
      };
      publish((next) => next.set(key, nextEntry));
      void queryClient.cancelQueries({ queryKey: ['tasks', userId], exact: true });
      void queryClient.cancelQueries({
        queryKey: ['tasks', userId, 'detail', task.id],
        exact: true,
      });
      void run(key);
      return desired;
    },
    [publish, queryClient, run]
  );

  const toggle = useCallback(
    (userId: number, task: TaskSummary) => {
      const existing = entriesRef.current.get(entryKey(userId, task.id));
      const visibleValue = existing?.desired ?? task.completedAt !== null;
      return prepare(userId, task, !visibleValue, null);
    },
    [prepare]
  );

  const retry = useCallback(
    (userId: number, task: TaskSummary) => {
      const key = entryKey(userId, task.id);
      const existing = entriesRef.current.get(key);
      if (!existing || existing.retryDesired === null) return;
      prepare(userId, task, existing.retryDesired, null);
    },
    [prepare]
  );

  const value = useMemo<CompletionContextValue>(
    () => ({ entries, toggle, retry }),
    [entries, retry, toggle]
  );

  return <CompletionContext.Provider value={value}>{children}</CompletionContext.Provider>;
}

export function useTaskCompletion(userId: number, task: TaskSummary) {
  const context = useContext(CompletionContext);
  if (!context) throw new Error('useTaskCompletion must be used inside TaskCompletionProvider.');
  const entry = context.entries.get(entryKey(userId, task.id));
  return {
    completed: entry?.desired ?? task.completedAt !== null,
    saving: entry?.saving ?? false,
    error: entry?.error ?? null,
    toggle: () => context.toggle(userId, task),
    retry: () => context.retry(userId, task),
  };
}

export function useTaskCompletionSnapshot(userId: number): ReadonlyMap<number, boolean> {
  const context = useContext(CompletionContext);
  if (!context)
    throw new Error('useTaskCompletionSnapshot must be used inside TaskCompletionProvider.');
  return useMemo(() => {
    const snapshot = new Map<number, boolean>();
    for (const entry of context.entries.values()) {
      if (entry.userId === userId) snapshot.set(entry.taskId, entry.desired);
    }
    return snapshot;
  }, [context.entries, userId]);
}
