import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { taskApi } from './api';
import type { TaskDetail, TaskListResponse, TaskSummary, UpdateTaskPayload } from './types';
import { useUpdateTask } from './useUpdateTask';

const detail = (changes: Partial<TaskDetail> = {}): TaskDetail => ({
  id: 7,
  key: 'TASK-7',
  title: 'Updated title',
  priority: 'HIGH',
  dueDate: '2026-10-21',
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T11:00:00Z',
  description: { type: 'doc', content: [{ type: 'text', text: 'Keep this description.' }] },
  deletedAt: null,
  checklist: [],
  ...changes,
});

const summary = (changes: Partial<TaskSummary> = {}): TaskSummary => {
  const {
    description: _description,
    deletedAt: _deletedAt,
    checklist: _checklist,
    ...taskSummary
  } = detail(changes);
  return taskSummary;
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

afterEach(() => vi.restoreAllMocks());

describe('task update API', () => {
  it.each([
    [{ title: 'Updated title' }, '/tasks/7'],
    [{ priority: null }, '/tasks/7'],
    [{ dueDate: null }, '/tasks/7'],
    [{ description: { type: 'doc', content: [{ type: 'paragraph' }] } }, '/tasks/7'],
    [{ description: null }, '/tasks/7'],
  ] as const)('sends only the requested field patch %o', async (patch, path) => {
    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: detail() } as never);

    await taskApi.update(7, patch);

    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledWith(path, patch);
  });
});

describe('useUpdateTask', () => {
  it.each([
    {
      patch: {
        description: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }],
        },
      },
      description: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }],
      },
    },
    { patch: { description: null }, description: null },
  ])(
    'reconciles a successful description patch from the server response: $patch',
    async ({ patch, description }) => {
      const updated = detail({ description, updatedAt: '2026-10-24T12:00:00Z' });
      const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: updated } as never);
      const { Wrapper, queryClient } = createWrapper();
      queryClient.setQueryData(
        ['tasks', 1, 'detail', 7],
        detail({
          description: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original' }] }],
          },
        })
      );
      queryClient.setQueryData<TaskListResponse>(['tasks', 1], { items: [summary()] });

      const { result } = renderHook(() => useUpdateTask(1), { wrapper: Wrapper });
      await act(async () => {
        await result.current.updateTask(7, patch);
      });

      expect(patchSpy).toHaveBeenCalledWith('/tasks/7', patch);
      expect(queryClient.getQueryData<TaskDetail>(['tasks', 1, 'detail', 7])).toMatchObject({
        description,
        updatedAt: '2026-10-24T12:00:00Z',
      });
      const [listItem] = queryClient.getQueryData<TaskListResponse>(['tasks', 1])!.items;
      expect(listItem).not.toHaveProperty('description');
      expect(listItem?.updatedAt).toBe('2026-10-24T12:00:00Z');
    }
  );

  it('updates only the matching detail and present list summary, then invalidates that list', async () => {
    const updated = detail({ title: 'Renamed task', priority: null, dueDate: null });
    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: updated } as never);
    const { Wrapper, queryClient } = createWrapper();
    const listKey = ['tasks', 1] as const;
    const otherListKey = ['tasks', 2] as const;
    const existingSummary = summary({ id: 8, key: 'TASK-8', title: 'Other task' });
    queryClient.setQueryData<TaskListResponse>(listKey, {
      items: [summary({ id: 7, title: 'Original title' }), existingSummary],
    });
    queryClient.setQueryData<TaskListResponse>(otherListKey, { items: [summary({ id: 7 })] });
    queryClient.setQueryData(['tasks', 1, 'detail', 7], detail({ title: 'Original title' }));
    queryClient.setQueryData(['tasks', 2, 'detail', 7], detail({ title: 'Other account copy' }));

    const { result } = renderHook(() => useUpdateTask(1), { wrapper: Wrapper });
    let saved!: TaskDetail;
    await act(async () => {
      saved = await result.current.updateTask(7, { priority: null });
    });

    expect(patchSpy).toHaveBeenCalledWith('/tasks/7', { priority: null });
    expect(saved).toEqual(updated);
    expect(saved.description).toEqual(detail().description);
    expect(queryClient.getQueryData(['tasks', 1, 'detail', 7])).toEqual(
      detail({ title: 'Original title', priority: null })
    );
    expect(queryClient.getQueryData(['tasks', 2, 'detail', 7])).toMatchObject({
      title: 'Other account copy',
    });
    expect(queryClient.getQueryData<TaskListResponse>(listKey)?.items).toEqual([
      summary({ id: 7, title: 'Original title', priority: null }),
      existingSummary,
    ]);
    expect(queryClient.getQueryData<TaskListResponse>(otherListKey)?.items[0]?.title).toBe(
      'Updated title'
    );
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherListKey)?.isInvalidated).toBe(false);
  });

  it('leaves an absent list entry absent while updating the detail cache', async () => {
    const updated = detail();
    vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: updated } as never);
    const { Wrapper, queryClient } = createWrapper();
    const listKey = ['tasks', 1] as const;
    queryClient.setQueryData<TaskListResponse>(listKey, { items: [summary({ id: 8 })] });

    const { result } = renderHook(() => useUpdateTask(1), { wrapper: Wrapper });
    await act(async () => {
      await result.current.updateTask(7, { title: 'Updated title' });
    });

    expect(queryClient.getQueryData<TaskListResponse>(listKey)?.items.map(({ id }) => id)).toEqual([
      8,
    ]);
    expect(queryClient.getQueryData(['tasks', 1, 'detail', 7])).toEqual(updated);
  });

  it.each([
    new Error('400 validation failure'),
    new Error('500 server failure'),
    new Error('404 unavailable'),
    new Error('network failure'),
  ])('does not replace cache state when the PATCH fails (%s)', async (error) => {
    vi.spyOn(apiClient, 'patch').mockRejectedValue(error);
    const { Wrapper, queryClient } = createWrapper();
    const previousDetail = detail({ title: 'Original title' });
    const previousList: TaskListResponse = { items: [summary({ title: 'Original title' })] };
    queryClient.setQueryData(['tasks', 1, 'detail', 7], previousDetail);
    queryClient.setQueryData(['tasks', 1], previousList);

    const { result } = renderHook(() => useUpdateTask(1), { wrapper: Wrapper });
    await act(async () => {
      await expect(
        result.current.updateTask(7, { title: 'Updated title' } satisfies UpdateTaskPayload)
      ).rejects.toBe(error);
    });

    expect(queryClient.getQueryData(['tasks', 1, 'detail', 7])).toEqual(previousDetail);
    expect(queryClient.getQueryData(['tasks', 1])).toEqual(previousList);
    expect(queryClient.getQueryState(['tasks', 1])?.isInvalidated).toBe(false);
  });

  it('does not write a late response into a different account cache', async () => {
    let resolveRequest!: (response: AxiosResponse<TaskDetail>) => void;
    vi.spyOn(apiClient, 'patch').mockImplementation(
      () => new Promise((resolve) => (resolveRequest = resolve)) as never
    );
    const { Wrapper, queryClient } = createWrapper();
    const { result, rerender } = renderHook(({ userId }) => useUpdateTask(userId), {
      initialProps: { userId: 1 },
      wrapper: Wrapper,
    });

    let pending!: Promise<TaskDetail>;
    act(() => {
      pending = result.current.updateTask(7, { title: 'Updated title' });
    });
    await waitFor(() => expect(resolveRequest).toBeTypeOf('function'));
    rerender({ userId: 2 });
    await act(async () => {
      resolveRequest({ data: detail() } as AxiosResponse<TaskDetail>);
      await pending;
    });

    expect(queryClient.getQueryData(['tasks', 1, 'detail', 7])).toBeUndefined();
    expect(queryClient.getQueryData(['tasks', 2, 'detail', 7])).toBeUndefined();
    expect(queryClient.getQueryData<TaskListResponse>(['tasks', 1])).toBeUndefined();
    expect(queryClient.getQueryData<TaskListResponse>(['tasks', 2])).toBeUndefined();
  });
});
