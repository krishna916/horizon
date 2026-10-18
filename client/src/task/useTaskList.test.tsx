import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { taskApi } from './api';
import type { TaskListResponse, TaskSummary } from './types';
import { useTaskList } from './useTaskList';

const task = (id: number, title: string): TaskSummary => ({
  id,
  key: `TASK-${id}`,
  title,
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-18T10:00:00Z',
  updatedAt: '2026-10-18T10:00:00Z',
});

const response = (items: TaskSummary[]) => ({ data: { items } }) as AxiosResponse<TaskListResponse>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

describe('task list query', () => {
  let getSpy: MockInstance<typeof apiClient.get>;

  beforeEach(() => {
    getSpy = vi.spyOn(apiClient, 'get');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests the shared authenticated tasks endpoint and returns the response envelope', async () => {
    getSpy.mockResolvedValue(response([task(7, 'Review the release notes')]) as never);

    await expect(taskApi.list()).resolves.toMatchObject({
      data: { items: [{ id: 7, title: 'Review the release notes' }] },
    });

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('/tasks');
  });

  it('does not request tasks until a user ID is available', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskList(undefined), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('loads the authenticated user task list', async () => {
    getSpy.mockResolvedValue(response([task(1, 'User one task')]) as never);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useTaskList(1), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data?.items[0]?.title).toBe('User one task'));
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('/tasks');
  });

  it('does not expose the previous account data while a different user list is pending', async () => {
    let resolveSecondUser!: (value: AxiosResponse<TaskListResponse>) => void;
    getSpy
      .mockResolvedValueOnce(response([task(1, 'Account one private task')]) as never)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondUser = resolve;
          }) as never
      );

    const { Wrapper } = createWrapper();
    const { result, rerender } = renderHook(({ userId }) => useTaskList(userId), {
      initialProps: { userId: 1 as number | undefined },
      wrapper: Wrapper,
    });

    await waitFor(() =>
      expect(result.current.data?.items[0]?.title).toBe('Account one private task')
    );

    rerender({ userId: 2 });

    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe('fetching');

    await act(async () => {
      resolveSecondUser(response([task(2, 'Account two private task')]));
    });

    await waitFor(() =>
      expect(result.current.data?.items[0]?.title).toBe('Account two private task')
    );
    expect(result.current.data?.items.map(({ title }) => title)).not.toContain(
      'Account one private task'
    );
  });

  it('uses only the matching user cache when switching accounts back', async () => {
    getSpy.mockResolvedValue(response([task(1, 'Account one private task')]) as never);
    const { Wrapper } = createWrapper();
    const { result, rerender } = renderHook(({ userId }) => useTaskList(userId), {
      initialProps: { userId: 1 as number | undefined },
      wrapper: Wrapper,
    });

    await waitFor(() =>
      expect(result.current.data?.items[0]?.title).toBe('Account one private task')
    );
    rerender({ userId: 2 });
    await waitFor(() =>
      expect(result.current.data?.items[0]?.title).toBe('Account one private task')
    );

    rerender({ userId: 1 });

    expect(result.current.data?.items.map(({ title }) => title)).toEqual([
      'Account one private task',
    ]);
  });
});
