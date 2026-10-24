/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { TaskDetail, TaskListResponse, TaskSummary } from './types';
import { taskApi } from './api';

export type LifecycleOperation = 'archive' | 'restore' | 'delete';

export interface LifecycleNotice {
  id: string;
  userId: number;
  taskId: number;
  taskKey: string;
  action: 'archive' | 'delete';
  error: string | null;
  retrying: boolean;
}

interface LifecycleState {
  pending: boolean;
  error: string | null;
}

interface RetryIntent {
  task: TaskSummary;
  operation: LifecycleOperation;
}

interface TaskLifecycleApi {
  run: (userId: number, task: TaskSummary, operation: LifecycleOperation) => Promise<boolean>;
  undo: (noticeId: string) => Promise<boolean>;
  dismiss: (noticeId: string) => void;
  notices: readonly LifecycleNotice[];
  stateFor: (
    userId: number,
    taskId: number
  ) => {
    pending: boolean;
    error: string | null;
    retry: () => void;
  };
}

const LifecycleContext = createContext<TaskLifecycleApi | null>(null);

function operationKey(userId: number, taskId: number) {
  return `${userId}:${taskId}`;
}

function summaryFromDetail(task: TaskDetail): TaskSummary {
  const {
    description: _description,
    deletedAt: _deletedAt,
    checklist: _checklist,
    ...summary
  } = task;
  return summary;
}

function responseError(operation: LifecycleOperation | 'undo') {
  return operation === 'undo'
    ? "Couldn't restore this task. Try again."
    : `Couldn't ${operation === 'delete' ? 'move this task to Trash' : `${operation} this task`}. Try again.`;
}

export function TaskLifecycleProvider({
  userId,
  children,
}: {
  userId: number | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [notices, setNotices] = useState<LifecycleNotice[]>([]);
  const [states, setStates] = useState<Map<string, LifecycleState>>(() => new Map());
  const noticesRef = useRef(notices);
  const statesRef = useRef(states);
  const retryIntentsRef = useRef(new Map<string, RetryIntent>());
  const runningRef = useRef(new Map<string, Promise<boolean>>());
  const currentUserIdRef = useRef(userId);

  const publishNotices = useCallback(
    (update: (current: LifecycleNotice[]) => LifecycleNotice[]) => {
      const next = update(noticesRef.current);
      noticesRef.current = next;
      setNotices(next);
    },
    []
  );

  const publishState = useCallback((key: string, state: LifecycleState | null) => {
    const next = new Map(statesRef.current);
    if (state) next.set(key, state);
    else next.delete(key);
    statesRef.current = next;
    setStates(next);
  }, []);

  const reconcileTask = useCallback(
    async (ownerId: number, task: TaskDetail, mode: 'lifecycle' | 'restore-deleted') => {
      const listKey = ['tasks', ownerId] as const;
      const detailKey = ['tasks', ownerId, 'detail', task.id] as const;
      await Promise.all([
        queryClient.cancelQueries({ queryKey: listKey, exact: true }),
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      if (mode === 'restore-deleted') {
        queryClient.setQueryData<TaskDetail>(detailKey, task);
        queryClient.setQueryData<TaskListResponse>(listKey, (current) => {
          if (!current) return current;
          const items = current.items.filter((item) => item.id !== task.id);
          items.push(summaryFromDetail(task));
          items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
          return { ...current, items };
        });
      } else {
        queryClient.setQueryData<TaskDetail>(detailKey, (current) =>
          current ? { ...current, archivedAt: task.archivedAt, updatedAt: task.updatedAt } : task
        );
        queryClient.setQueryData<TaskListResponse>(listKey, (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.id === task.id
                    ? { ...item, archivedAt: task.archivedAt, updatedAt: task.updatedAt }
                    : item
                ),
              }
            : current
        );
      }
      void queryClient.invalidateQueries({ queryKey: listKey, exact: true });
    },
    [queryClient]
  );

  const removeDeletedTask = useCallback(
    async (ownerId: number, taskId: number) => {
      const listKey = ['tasks', ownerId] as const;
      const detailKey = ['tasks', ownerId, 'detail', taskId] as const;
      await Promise.all([
        queryClient.cancelQueries({ queryKey: listKey, exact: true }),
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      queryClient.setQueryData<TaskListResponse>(listKey, (current) =>
        current
          ? { ...current, items: current.items.filter((item) => item.id !== taskId) }
          : current
      );
      queryClient.removeQueries({ queryKey: detailKey, exact: true });
      void queryClient.invalidateQueries({ queryKey: listKey, exact: true });
    },
    [queryClient]
  );

  const run = useCallback(
    (ownerId: number, task: TaskSummary, operation: LifecycleOperation): Promise<boolean> => {
      if (currentUserIdRef.current !== ownerId) return Promise.resolve(false);
      const key = operationKey(ownerId, task.id);
      const inFlight = runningRef.current.get(key);
      if (inFlight) return inFlight;

      const request = (async () => {
        retryIntentsRef.current.set(key, { task, operation });
        publishState(key, { pending: true, error: null });
        const listKey = ['tasks', ownerId] as const;
        const detailKey = ['tasks', ownerId, 'detail', task.id] as const;
        await Promise.all([
          queryClient.cancelQueries({ queryKey: listKey, exact: true }),
          queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
        ]);
        try {
          if (operation === 'delete') {
            await taskApi.softDelete(task.id);
            await removeDeletedTask(ownerId, task.id);
          } else {
            const response =
              operation === 'archive'
                ? await taskApi.archive(task.id)
                : await taskApi.restoreArchive(task.id);
            await reconcileTask(ownerId, response.data, 'lifecycle');
          }
          retryIntentsRef.current.delete(key);
          if (currentUserIdRef.current === ownerId) {
            publishState(key, null);
            publishNotices((current) => {
              const remaining = current.filter(
                (notice) => notice.userId !== ownerId || notice.taskId !== task.id
              );
              if (operation === 'archive' || operation === 'delete') {
                remaining.push({
                  id: `${ownerId}:${task.id}:${Date.now()}`,
                  userId: ownerId,
                  taskId: task.id,
                  taskKey: task.key,
                  action: operation,
                  error: null,
                  retrying: false,
                });
              }
              return remaining;
            });
          }
          return true;
        } catch {
          if (currentUserIdRef.current === ownerId) {
            publishState(key, { pending: false, error: responseError(operation) });
          }
          return false;
        }
      })();
      runningRef.current.set(key, request);
      void request.finally(() => {
        if (runningRef.current.get(key) === request) runningRef.current.delete(key);
      });
      return request;
    },
    [publishNotices, publishState, queryClient, reconcileTask, removeDeletedTask]
  );

  const undo = useCallback(
    async (noticeId: string): Promise<boolean> => {
      const notice = noticesRef.current.find((item) => item.id === noticeId);
      if (!notice || currentUserIdRef.current !== notice.userId) return false;
      const key = operationKey(notice.userId, notice.taskId);
      publishNotices((current) =>
        current.map((item) =>
          item.id === noticeId ? { ...item, error: null, retrying: true } : item
        )
      );
      try {
        if (notice.action === 'archive') {
          const response = await taskApi.restoreArchive(notice.taskId);
          await reconcileTask(notice.userId, response.data, 'lifecycle');
        } else {
          const response = await taskApi.restoreDeleted(notice.taskId);
          await reconcileTask(notice.userId, response.data, 'restore-deleted');
        }
        publishNotices((current) => current.filter((item) => item.id !== noticeId));
        publishState(key, null);
        retryIntentsRef.current.delete(key);
        return true;
      } catch {
        publishNotices((current) =>
          current.map((item) =>
            item.id === noticeId ? { ...item, error: responseError('undo'), retrying: false } : item
          )
        );
        return false;
      }
    },
    [publishNotices, publishState, reconcileTask]
  );

  const dismiss = useCallback(
    (noticeId: string) =>
      publishNotices((current) => current.filter((item) => item.id !== noticeId)),
    [publishNotices]
  );

  const stateFor = useCallback(
    (ownerId: number, taskId: number) => {
      const key = operationKey(ownerId, taskId);
      const state = states.get(key);
      return {
        pending: state?.pending ?? false,
        error: state?.error ?? null,
        retry: () => {
          const intent = retryIntentsRef.current.get(key);
          if (intent) void run(ownerId, intent.task, intent.operation);
        },
      };
    },
    [run, states]
  );

  return (
    <LifecycleContext.Provider value={{ run, undo, dismiss, notices, stateFor }}>
      {children}
    </LifecycleContext.Provider>
  );
}

export function useTaskLifecycle(): TaskLifecycleApi {
  const lifecycle = useContext(LifecycleContext);
  if (!lifecycle) throw new Error('useTaskLifecycle must be used inside TaskLifecycleProvider.');
  return lifecycle;
}
