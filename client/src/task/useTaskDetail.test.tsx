import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { taskApi } from './api';
import type { TaskDetail } from './types';
import { useTaskDetail } from './useTaskDetail';

const task = (id: number, title: string): TaskDetail => ({
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
  description: null,
  deletedAt: null,
  checklist: [],
});

const response = (data: TaskDetail) => ({ data }) as AxiosResponse<TaskDetail>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

describe('task detail query', () => {
  let getSpy: MockInstance<typeof apiClient.get>;

  beforeEach(() => {
    getSpy = vi.spyOn(apiClient, 'get');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests the existing task detail endpoint and returns its complete DTO', async () => {
    const detail = task(7, 'Review the release notes');
    getSpy.mockResolvedValue(response(detail) as never);

    await expect(taskApi.get(7)).resolves.toMatchObject({
      data: {
        id: 7,
        key: 'TASK-7',
        title: 'Review the release notes',
        priority: null,
        dueDate: null,
        inbox: false,
        completedAt: null,
        archivedAt: null,
        createdAt: '2026-10-18T10:00:00Z',
        updatedAt: '2026-10-18T10:00:00Z',
        description: null,
        deletedAt: null,
        checklist: [],
      },
    });

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('/tasks/7');
  });

  it.each([
    { userId: undefined, taskId: 7 },
    { userId: 1, taskId: null },
    { userId: 1, taskId: 0 },
    { userId: 1, taskId: -1 },
    { userId: 1, taskId: 1.5 },
    { userId: 1, taskId: Number.MAX_SAFE_INTEGER + 1 },
  ])('does not fetch for a missing owner or invalid ID (%o)', ({ userId, taskId }) => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskDetail(userId, taskId), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('keeps account and task detail caches isolated when selection changes', async () => {
    getSpy
      .mockResolvedValueOnce(response(task(7, 'Account one task seven')) as never)
      .mockResolvedValueOnce(response(task(7, 'Account two task seven')) as never)
      .mockResolvedValueOnce(response(task(8, 'Account one task eight')) as never);
    const { Wrapper } = createWrapper();
    const { result, rerender } = renderHook(({ userId, taskId }) => useTaskDetail(userId, taskId), {
      initialProps: { userId: 1 as number | undefined, taskId: 7 as number | null },
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.data?.title).toBe('Account one task seven'));

    rerender({ userId: 2, taskId: 7 });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data?.title).toBe('Account two task seven'));

    rerender({ userId: 1, taskId: 8 });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data?.title).toBe('Account one task eight'));

    expect(getSpy).toHaveBeenCalledTimes(3);
    expect(getSpy).toHaveBeenNthCalledWith(1, '/tasks/7');
    expect(getSpy).toHaveBeenNthCalledWith(2, '/tasks/7');
    expect(getSpy).toHaveBeenNthCalledWith(3, '/tasks/8');
  });

  it('never presents a delayed previous task after selecting a different task', async () => {
    let resolveTaskSeven!: (value: AxiosResponse<TaskDetail>) => void;
    getSpy
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTaskSeven = resolve;
          }) as never
      )
      .mockResolvedValueOnce(response(task(8, 'Selected task eight')) as never);
    const { Wrapper } = createWrapper();
    const { result, rerender } = renderHook(({ taskId }) => useTaskDetail(1, taskId), {
      initialProps: { taskId: 7 as number | null },
      wrapper: Wrapper,
    });

    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('/tasks/7'));
    rerender({ taskId: 8 });

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data?.title).toBe('Selected task eight'));

    await act(async () => {
      resolveTaskSeven(response(task(7, 'Delayed task seven')));
    });

    expect(result.current.data?.title).toBe('Selected task eight');
  });

  it('does not retry a known not-found response', async () => {
    getSpy.mockRejectedValue(
      Object.assign(new Error('not found'), {
        isAxiosError: true,
        response: { status: 404 },
      })
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1, retryDelay: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(() => useTaskDetail(1, 7), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});
