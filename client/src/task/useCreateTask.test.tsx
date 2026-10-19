import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { taskApi } from './api';
import type { TaskDetail, TaskListResponse, TaskSummary } from './types';
import { useCreateTask } from './useCreateTask';

const detail = (id: number): TaskDetail => ({
  id,
  key: `TASK-${id}`,
  title: 'Created task',
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  description: null,
  deletedAt: null,
});

const summary = (id: number): TaskSummary => ({
  id,
  key: `TASK-${id}`,
  title: 'Created task',
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
});

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

describe('task creation API', () => {
  it('sends the supplied payload with its request key header', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: detail(8) } as never);
    const payload = { title: 'Created task', dueDate: '2026-10-21' };

    await taskApi.create(payload, 'request-uuid');

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith('/tasks', payload, {
      headers: { 'Idempotency-Key': 'request-uuid' },
    });
  });
});

describe('useCreateTask', () => {
  it('updates only the matching user cache, reconciles one summary and invalidates the list', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: detail(8) } as never);
    const { Wrapper, queryClient } = createWrapper();
    const listKey = ['tasks', 1] as const;
    const otherListKey = ['tasks', 2] as const;
    queryClient.setQueryData<TaskListResponse>(listKey, { items: [summary(3), summary(8)] });
    queryClient.setQueryData<TaskListResponse>(otherListKey, { items: [summary(9)] });

    const { result } = renderHook(() => useCreateTask(1), { wrapper: Wrapper });
    await act(async () => {
      await result.current.createTask({ title: 'Created task' }, 'request-uuid');
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['tasks', 1, 'detail', 8])).toEqual(detail(8));
    expect(queryClient.getQueryData(['tasks', 2, 'detail', 8])).toBeUndefined();
    expect(queryClient.getQueryData<TaskListResponse>(listKey)?.items.map(({ id }) => id)).toEqual([
      8, 3,
    ]);
    expect(
      queryClient.getQueryData<TaskListResponse>(otherListKey)?.items.map(({ id }) => id)
    ).toEqual([9]);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it('does not retry a rejected create request automatically', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('network error'));
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateTask(1), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.createTask({ title: 'Created task' }, 'request-uuid')
      ).rejects.toThrow('network error');
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('does not write a late response into another account cache after the owner changes', async () => {
    let resolveRequest!: (response: AxiosResponse<TaskDetail>) => void;
    vi.spyOn(apiClient, 'post').mockImplementation(
      () => new Promise((resolve) => (resolveRequest = resolve)) as never
    );
    const { Wrapper, queryClient } = createWrapper();
    const { result, rerender } = renderHook(({ userId }) => useCreateTask(userId), {
      initialProps: { userId: 1 },
      wrapper: Wrapper,
    });

    let pending!: Promise<TaskDetail>;
    act(() => {
      pending = result.current.createTask({ title: 'Created task' }, 'request-uuid');
    });
    await waitFor(() => expect(resolveRequest).toBeTypeOf('function'));
    rerender({ userId: 2 });
    await act(async () => {
      resolveRequest({ data: detail(8) } as AxiosResponse<TaskDetail>);
      await pending;
    });

    expect(queryClient.getQueryData(['tasks', 2, 'detail', 8])).toBeUndefined();
    expect(queryClient.getQueryData<TaskListResponse>(['tasks', 2])).toBeUndefined();
  });
});
