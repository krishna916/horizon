import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import { TaskCompletionProvider, useTaskCompletion } from './TaskCompletionProvider';
import { TaskLifecycleProvider, useTaskLifecycle } from './TaskLifecycleProvider';
import type { TaskDetail, TaskListResponse, TaskSummary } from './types';

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return {
    ...original,
    taskApi: {
      ...original.taskApi,
      complete: vi.fn(),
      reopen: vi.fn(),
      archive: vi.fn(),
      restoreArchive: vi.fn(),
      softDelete: vi.fn(),
      restoreDeleted: vi.fn(),
    },
  };
});

const taskSummary = (id: number, fields: Partial<TaskSummary> = {}): TaskSummary => ({
  id,
  key: `TASK-${id}`,
  title: `Task ${id}`,
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-24T08:00:00Z',
  updatedAt: '2026-10-24T08:00:00Z',
  ...fields,
});

const taskDetail = (id: number, fields: Partial<TaskDetail> = {}): TaskDetail => ({
  ...taskSummary(id),
  description: null,
  deletedAt: null,
  checklist: [],
  ...fields,
});

const response = <T,>(data: T) => ({ data }) as AxiosResponse<T>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function retryDelete(lifecycle: ReturnType<typeof useTaskLifecycle>, noticeId: string) {
  const retry = (lifecycle as unknown as { retryDelete?: (id: string) => Promise<boolean> })
    .retryDelete;
  expect(retry).toBeTypeOf('function');
  return retry?.(noticeId) ?? Promise.resolve(false);
}

function Probe({
  userId,
  task,
  onReady,
  onCompletionReady,
}: {
  userId: number | undefined;
  task: TaskSummary;
  onReady: (lifecycle: ReturnType<typeof useTaskLifecycle>) => void;
  onCompletionReady: (toggle: () => boolean) => void;
}) {
  const lifecycle = useTaskLifecycle();
  const completion = useTaskCompletion(userId ?? 0, task);
  useEffect(() => {
    onReady(lifecycle);
  }, [lifecycle, onReady]);
  useEffect(() => {
    onCompletionReady(completion.toggle);
  }, [completion.toggle, onCompletionReady]);
  useQuery<TaskListResponse>({
    queryKey: ['tasks', userId],
    queryFn: async () => ({ items: [] }),
    enabled: false,
  });
  return null;
}

function createHarness(ownerId: number | undefined, task: TaskSummary) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let lifecycle: ReturnType<typeof useTaskLifecycle> | undefined;
  let toggleCompletion = () => false;
  function Wrapper({ children, userId }: { children: ReactNode; userId: number | undefined }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TaskCompletionProvider>
          <TaskLifecycleProvider key={userId ?? 'no-user'} userId={userId}>
            {children}
          </TaskLifecycleProvider>
        </TaskCompletionProvider>
      </QueryClientProvider>
    );
  }
  const onReady = (value: ReturnType<typeof useTaskLifecycle>) => {
    lifecycle = value;
  };
  const onCompletionReady = (toggle: () => boolean) => {
    toggleCompletion = toggle;
  };
  const view = render(
    <Wrapper userId={ownerId}>
      <Probe userId={ownerId} task={task} onReady={onReady} onCompletionReady={onCompletionReady} />
    </Wrapper>
  );
  return {
    ...view,
    queryClient,
    rerenderOwner: (nextUserId: number | undefined) =>
      view.rerender(
        <Wrapper userId={nextUserId}>
          <Probe
            userId={nextUserId}
            task={task}
            onReady={onReady}
            onCompletionReady={onCompletionReady}
          />
        </Wrapper>
      ),
    lifecycle: () => {
      if (!lifecycle) throw new Error('Lifecycle hook is not ready.');
      return lifecycle;
    },
    toggleCompletion: () => toggleCompletion(),
  };
}

describe('TaskLifecycleProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('patches archive and restore facts into owner-scoped list and detail caches', async () => {
    const task = taskSummary(7);
    const harness = createHarness(1, task);
    const listKey = ['tasks', 1] as const;
    const detailKey = ['tasks', 1, 'detail', 7] as const;
    harness.queryClient.setQueryData<TaskListResponse>(listKey, { items: [task] });
    harness.queryClient.setQueryData(detailKey, taskDetail(7));
    vi.mocked(taskApi.archive).mockResolvedValue(
      response(
        taskDetail(7, { archivedAt: '2026-10-24T09:00:00Z', updatedAt: '2026-10-24T09:00:00Z' })
      )
    );

    await act(async () => {
      await harness.lifecycle().run(1, task, 'archive');
    });

    expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items[0]?.archivedAt).toBe(
      '2026-10-24T09:00:00Z'
    );
    expect(harness.queryClient.getQueryData<TaskDetail>(detailKey)?.archivedAt).toBe(
      '2026-10-24T09:00:00Z'
    );
    expect(harness.lifecycle().notices).toHaveLength(1);
    expect(harness.lifecycle().notices[0]?.action).toBe('archive');

    vi.mocked(taskApi.restoreArchive).mockResolvedValue(
      response(taskDetail(7, { updatedAt: '2026-10-24T10:00:00Z' }))
    );
    await act(async () => {
      await harness.lifecycle().run(1, task, 'restore');
    });

    expect(
      harness.queryClient.getQueryData<TaskSummary[]>(listKey)?.[0]?.archivedAt
    ).toBeUndefined();
    expect(
      harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items[0]?.archivedAt
    ).toBeNull();
    expect(harness.queryClient.getQueryData<TaskDetail>(detailKey)?.archivedAt).toBeNull();
    expect(harness.lifecycle().notices).toHaveLength(0);
  });

  it('keeps a task visible until delete is confirmed, then retains an Undo notice', async () => {
    const task = taskSummary(8);
    const pendingDelete = deferred<AxiosResponse<void>>();
    const harness = createHarness(1, task);
    const listKey = ['tasks', 1] as const;
    harness.queryClient.setQueryData<TaskListResponse>(listKey, { items: [task] });
    vi.mocked(taskApi.softDelete).mockReturnValue(pendingDelete.promise);
    vi.mocked(taskApi.restoreDeleted).mockResolvedValue(response(taskDetail(8)));

    let result!: Promise<boolean>;
    await act(async () => {
      result = harness.lifecycle().run(1, task, 'delete');
      await Promise.resolve();
      expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items).toHaveLength(1);
      pendingDelete.resolve(response(undefined));
      await result;
    });

    expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items).toEqual([]);
    expect(harness.lifecycle().notices).toHaveLength(1);
    expect(harness.lifecycle().notices[0]?.action).toBe('delete');
    await act(async () => {
      expect(await harness.lifecycle().undo(harness.lifecycle().notices[0]!.id)).toBe(true);
    });
  });

  it('keeps concurrent task fields and completion changes while an archive request resolves', async () => {
    const task = taskSummary(9);
    const pendingArchive = deferred<AxiosResponse<TaskDetail>>();
    const harness = createHarness(1, task);
    const listKey = ['tasks', 1] as const;
    const detailKey = ['tasks', 1, 'detail', 9] as const;
    harness.queryClient.setQueryData<TaskListResponse>(listKey, { items: [task] });
    harness.queryClient.setQueryData<TaskDetail>(detailKey, taskDetail(9));
    vi.mocked(taskApi.archive).mockReturnValue(pendingArchive.promise);

    let result!: Promise<boolean>;
    await act(async () => {
      result = harness.lifecycle().run(1, task, 'archive');
      await Promise.resolve();
    });
    const concurrentSummary = taskSummary(9, {
      title: 'Edited while archiving',
      completedAt: '2026-10-24T08:30:00Z',
    });
    harness.queryClient.setQueryData<TaskListResponse>(listKey, { items: [concurrentSummary] });
    harness.queryClient.setQueryData<TaskDetail>(detailKey, taskDetail(9, concurrentSummary));

    await act(async () => {
      pendingArchive.resolve(
        response(
          taskDetail(9, { archivedAt: '2026-10-24T09:00:00Z', updatedAt: '2026-10-24T09:00:00Z' })
        )
      );
      await result;
    });

    expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items[0]).toMatchObject({
      title: 'Edited while archiving',
      completedAt: '2026-10-24T08:30:00Z',
      archivedAt: '2026-10-24T09:00:00Z',
    });
    expect(harness.queryClient.getQueryData<TaskDetail>(detailKey)).toMatchObject({
      title: 'Edited while archiving',
      completedAt: '2026-10-24T08:30:00Z',
      archivedAt: '2026-10-24T09:00:00Z',
    });
  });

  it('keeps a confirmed archive when an earlier completion response arrives late', async () => {
    const task = taskSummary(11);
    const pendingCompletion = deferred<AxiosResponse<TaskDetail>>();
    const harness = createHarness(1, task);
    const listKey = ['tasks', 1] as const;
    const detailKey = ['tasks', 1, 'detail', 11] as const;
    harness.queryClient.setQueryData<TaskListResponse>(listKey, { items: [task] });
    harness.queryClient.setQueryData<TaskDetail>(detailKey, taskDetail(11));
    vi.mocked(taskApi.complete).mockReturnValue(pendingCompletion.promise);
    vi.mocked(taskApi.archive).mockResolvedValue(
      response(taskDetail(11, { archivedAt: '2026-10-24T09:00:00Z' }))
    );

    act(() => {
      harness.toggleCompletion();
    });
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledWith(11));
    await act(async () => {
      await harness.lifecycle().run(1, task, 'archive');
    });

    await act(async () => {
      pendingCompletion.resolve(
        response(
          taskDetail(11, { completedAt: '2026-10-24T09:30:00Z', updatedAt: '2026-10-24T09:30:00Z' })
        )
      );
      await pendingCompletion.promise;
    });

    expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items[0]).toMatchObject({
      completedAt: '2026-10-24T09:30:00Z',
      archivedAt: '2026-10-24T09:00:00Z',
    });
    expect(harness.queryClient.getQueryData<TaskDetail>(detailKey)).toMatchObject({
      completedAt: '2026-10-24T09:30:00Z',
      archivedAt: '2026-10-24T09:00:00Z',
    });
  });

  it('does not resurrect a deleted task when an earlier completion response arrives late', async () => {
    const task = taskSummary(12);
    const pendingCompletion = deferred<AxiosResponse<TaskDetail>>();
    const harness = createHarness(1, task);
    const listKey = ['tasks', 1] as const;
    const detailKey = ['tasks', 1, 'detail', 12] as const;
    harness.queryClient.setQueryData<TaskListResponse>(listKey, { items: [task] });
    harness.queryClient.setQueryData<TaskDetail>(detailKey, taskDetail(12));
    vi.mocked(taskApi.complete).mockReturnValue(pendingCompletion.promise);
    vi.mocked(taskApi.softDelete).mockResolvedValue(response(undefined));

    act(() => {
      harness.toggleCompletion();
    });
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledWith(12));
    await act(async () => {
      await harness.lifecycle().run(1, task, 'delete');
    });
    await act(async () => {
      pendingCompletion.resolve(response(taskDetail(12, { completedAt: '2026-10-24T09:30:00Z' })));
      await pendingCompletion.promise;
    });

    expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items).toEqual([]);
    expect(harness.queryClient.getQueryData<TaskDetail>(detailKey)).toBeUndefined();
  });

  it('keeps notices for multiple tasks independently undoable', async () => {
    const first = taskSummary(1);
    const second = taskSummary(2);
    const harness = createHarness(1, first);
    vi.mocked(taskApi.archive).mockImplementation(async (id) =>
      response(taskDetail(id, { archivedAt: '2026-10-24T09:00:00Z' }))
    );

    await act(async () => {
      await harness.lifecycle().run(1, first, 'archive');
      await harness.lifecycle().run(1, second, 'archive');
    });

    expect(harness.lifecycle().notices.map(({ taskId }) => taskId)).toEqual([1, 2]);
    vi.mocked(taskApi.restoreArchive).mockResolvedValue(response(taskDetail(1)));
    await act(async () => {
      await harness.lifecycle().undo(harness.lifecycle().notices[0]!.id);
    });
    expect(harness.lifecycle().notices.map(({ taskId }) => taskId)).toEqual([2]);
  });

  it('preserves confirmed state after failure and retries the failed operation', async () => {
    const task = taskSummary(3);
    const harness = createHarness(1, task);
    const listKey = ['tasks', 1] as const;
    harness.queryClient.setQueryData<TaskListResponse>(listKey, { items: [task] });
    vi.mocked(taskApi.archive)
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(response(taskDetail(3, { archivedAt: '2026-10-24T09:00:00Z' })));

    await act(async () => {
      expect(await harness.lifecycle().run(1, task, 'archive')).toBe(false);
    });
    expect(
      harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items[0]?.archivedAt
    ).toBeNull();
    expect(harness.lifecycle().stateFor(1, 3).error).toBeTruthy();

    await act(async () => {
      harness.lifecycle().stateFor(1, 3).retry();
    });
    await waitFor(() =>
      expect(
        harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items[0]?.archivedAt
      ).toBe('2026-10-24T09:00:00Z')
    );
  });

  it('keeps uncertain delete visible until an idempotent retry confirms it', async () => {
    const task = taskSummary(10);
    const harness = createHarness(1, task);
    const listKey = ['tasks', 1] as const;
    harness.queryClient.setQueryData<TaskListResponse>(listKey, { items: [task] });
    vi.mocked(taskApi.softDelete)
      .mockRejectedValueOnce(new Error('request timed out'))
      .mockResolvedValueOnce(response(undefined));

    await act(async () => {
      expect(await harness.lifecycle().run(1, task, 'delete')).toBe(false);
    });
    expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items).toHaveLength(1);
    expect(harness.lifecycle().notices).toMatchObject([
      { kind: 'delete-unconfirmed', taskId: 10, action: 'delete' },
    ]);

    await act(async () => {
      harness.lifecycle().stateFor(1, 10).retry();
    });
    await waitFor(() =>
      expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items).toEqual([])
    );
    expect(harness.lifecycle().notices).toHaveLength(1);
    expect(harness.lifecycle().notices[0]?.kind).toBe('undo');
    expect(taskApi.softDelete).toHaveBeenCalledTimes(2);
  });

  it('retains delete recovery after the server deleted the task and a list refetch removes its row', async () => {
    const task = taskSummary(20);
    const harness = createHarness(1, task);
    const listKey = ['tasks', 1] as const;
    let serverDeleted = false;
    harness.queryClient.setQueryData<TaskListResponse>(listKey, { items: [task] });
    vi.mocked(taskApi.softDelete)
      .mockImplementationOnce(async () => {
        serverDeleted = true;
        throw new Error('response lost after commit');
      })
      .mockResolvedValueOnce(response(undefined));
    vi.mocked(taskApi.restoreDeleted).mockResolvedValue(response(taskDetail(20)));

    await act(async () => {
      expect(await harness.lifecycle().run(1, task, 'delete')).toBe(false);
    });
    await act(async () => {
      await harness.queryClient.fetchQuery({
        queryKey: listKey,
        queryFn: async () => ({ items: serverDeleted ? [] : [task] }),
      });
    });
    expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items).toEqual([]);
    expect(harness.lifecycle().notices).toHaveLength(1);
    const unconfirmed = harness.lifecycle().notices[0]!;
    expect(unconfirmed).toMatchObject({ kind: 'delete-unconfirmed', taskId: 20, action: 'delete' });

    await act(async () => {
      expect(await retryDelete(harness.lifecycle(), unconfirmed.id)).toBe(true);
    });
    expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items).toEqual([]);
    expect(harness.lifecycle().notices).toHaveLength(1);
    expect(harness.lifecycle().notices[0]).toMatchObject({
      kind: 'undo',
      taskId: 20,
      action: 'delete',
    });

    await act(async () => {
      expect(await harness.lifecycle().undo(harness.lifecycle().notices[0]!.id)).toBe(true);
    });
    expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items).toHaveLength(1);
  });

  it('keeps one unconfirmed delete notice across repeated retry failures and alongside other tasks', async () => {
    const deletedTask = taskSummary(21);
    const archivedTask = taskSummary(22);
    const harness = createHarness(1, deletedTask);
    vi.mocked(taskApi.softDelete)
      .mockRejectedValueOnce(new Error('response lost'))
      .mockRejectedValueOnce(new Error('still unavailable'))
      .mockResolvedValueOnce(response(undefined));
    vi.mocked(taskApi.archive).mockResolvedValue(
      response(taskDetail(22, { archivedAt: '2026-10-24T09:00:00Z' }))
    );

    await act(async () => {
      expect(await harness.lifecycle().run(1, deletedTask, 'delete')).toBe(false);
    });
    const firstNotice = harness.lifecycle().notices[0]!;
    expect(firstNotice.kind).toBe('delete-unconfirmed');
    await act(async () => {
      expect(await retryDelete(harness.lifecycle(), firstNotice.id)).toBe(false);
    });
    expect(harness.lifecycle().notices).toHaveLength(1);
    expect(harness.lifecycle().notices[0]).toMatchObject({
      id: firstNotice.id,
      kind: 'delete-unconfirmed',
      taskId: 21,
      retrying: false,
    });

    await act(async () => {
      expect(await harness.lifecycle().run(1, archivedTask, 'archive')).toBe(true);
    });
    expect(harness.lifecycle().notices.map(({ taskId, kind }) => ({ taskId, kind }))).toEqual([
      { taskId: 21, kind: 'delete-unconfirmed' },
      { taskId: 22, kind: 'undo' },
    ]);

    await act(async () => {
      expect(await retryDelete(harness.lifecycle(), firstNotice.id)).toBe(true);
    });
    expect(harness.lifecycle().notices.map(({ taskId, kind }) => ({ taskId, kind }))).toEqual([
      { taskId: 22, kind: 'undo' },
      { taskId: 21, kind: 'undo' },
    ]);
    expect(taskApi.softDelete).toHaveBeenCalledTimes(3);
  });

  it('dismisses an unconfirmed delete without presenting it as a successful delete', async () => {
    const task = taskSummary(23);
    const harness = createHarness(1, task);
    vi.mocked(taskApi.softDelete).mockRejectedValueOnce(new Error('response lost'));

    await act(async () => {
      expect(await harness.lifecycle().run(1, task, 'delete')).toBe(false);
    });
    const notice = harness.lifecycle().notices[0]!;
    expect(notice.kind).toBe('delete-unconfirmed');
    await act(async () => harness.lifecycle().dismiss(notice.id));

    expect(harness.lifecycle().notices).toEqual([]);
    expect(taskApi.restoreDeleted).not.toHaveBeenCalled();
  });

  it('keeps confirmed archive and delete undo flows unchanged', async () => {
    const archivedTask = taskSummary(24);
    const deletedTask = taskSummary(25);
    const harness = createHarness(1, archivedTask);
    vi.mocked(taskApi.archive).mockResolvedValue(
      response(taskDetail(24, { archivedAt: '2026-10-24T09:00:00Z' }))
    );
    vi.mocked(taskApi.restoreArchive).mockResolvedValue(response(taskDetail(24)));
    vi.mocked(taskApi.softDelete).mockResolvedValue(response(undefined));
    vi.mocked(taskApi.restoreDeleted).mockResolvedValue(response(taskDetail(25)));

    await act(async () => {
      await harness.lifecycle().run(1, archivedTask, 'archive');
    });
    const archiveNotice = harness.lifecycle().notices[0]!;
    expect(archiveNotice.kind).toBe('undo');
    await act(async () => {
      expect(await harness.lifecycle().undo(archiveNotice.id)).toBe(true);
      await harness.lifecycle().run(1, deletedTask, 'delete');
    });
    const deleteNotice = harness.lifecycle().notices[0]!;
    expect(deleteNotice).toMatchObject({ kind: 'undo', action: 'delete', taskId: 25 });
    await act(async () => {
      expect(await harness.lifecycle().undo(deleteNotice.id)).toBe(true);
    });
    expect(harness.lifecycle().notices).toEqual([]);
    expect(taskApi.restoreDeleted).toHaveBeenCalledWith(25);
  });

  it('retains a failed Undo notice with retry feedback', async () => {
    const task = taskSummary(4);
    const harness = createHarness(1, task);
    vi.mocked(taskApi.archive).mockResolvedValue(
      response(taskDetail(4, { archivedAt: '2026-10-24T09:00:00Z' }))
    );
    await act(async () => {
      await harness.lifecycle().run(1, task, 'archive');
    });
    const noticeId = harness.lifecycle().notices[0]!.id;
    vi.mocked(taskApi.restoreArchive).mockRejectedValueOnce(new Error('offline'));

    await act(async () => {
      expect(await harness.lifecycle().undo(noticeId)).toBe(false);
    });

    expect(harness.lifecycle().notices[0]?.id).toBe(noticeId);
    expect(harness.lifecycle().notices[0]?.error).toBeTruthy();
    vi.mocked(taskApi.restoreArchive).mockResolvedValue(response(taskDetail(4)));
    await act(async () => {
      await harness.lifecycle().undo(noticeId);
    });
    expect(harness.lifecycle().notices).toHaveLength(0);
  });

  it('restores deleted archived completed task facts and checklist from the server', async () => {
    const completedAt = '2026-10-20T12:00:00Z';
    const archivedAt = '2026-10-21T12:00:00Z';
    const task = taskSummary(5, { completedAt, archivedAt });
    const restored = taskDetail(5, {
      completedAt,
      archivedAt,
      checklist: [{ id: 99, title: 'Keep', dueDate: null, completedAt, position: 0 }],
    });
    const harness = createHarness(1, task);
    const listKey = ['tasks', 1] as const;
    const detailKey = ['tasks', 1, 'detail', 5] as const;
    harness.queryClient.setQueryData<TaskListResponse>(listKey, { items: [task] });
    harness.queryClient.setQueryData(detailKey, { ...restored, deletedAt: '2026-10-22T12:00:00Z' });
    vi.mocked(taskApi.softDelete).mockResolvedValue(response(undefined));
    await act(async () => {
      await harness.lifecycle().run(1, task, 'delete');
    });
    vi.mocked(taskApi.restoreDeleted).mockResolvedValue(response(restored));

    await act(async () => {
      await harness.lifecycle().undo(harness.lifecycle().notices[0]!.id);
    });

    expect(harness.queryClient.getQueryData<TaskListResponse>(listKey)?.items[0]).toMatchObject({
      completedAt,
      archivedAt,
    });
    expect(harness.queryClient.getQueryData<TaskDetail>(detailKey)).toMatchObject({
      completedAt,
      archivedAt,
      deletedAt: null,
      checklist: [{ id: 99 }],
    });
  });

  it('clears notices and pending errors when the current owner changes', async () => {
    const task = taskSummary(6);
    const harness = createHarness(1, task);
    vi.mocked(taskApi.archive).mockResolvedValue(
      response(taskDetail(6, { archivedAt: '2026-10-24T09:00:00Z' }))
    );
    await act(async () => {
      await harness.lifecycle().run(1, task, 'archive');
    });
    expect(harness.lifecycle().notices).toHaveLength(1);

    harness.rerenderOwner(2);
    await waitFor(() => expect(harness.lifecycle().notices).toHaveLength(0));
  });
});
