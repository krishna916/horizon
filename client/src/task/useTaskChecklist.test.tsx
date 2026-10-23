import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { taskChecklistApi } from './api';
import type { ChecklistItem, TaskDetail } from './types';
import { useTaskChecklist } from './useTaskChecklist';

const item: ChecklistItem = {
  id: 4,
  title: 'Call florist',
  dueDate: '2026-10-28',
  completedAt: null,
  position: 0,
};

const detail = (id: number): TaskDetail => ({
  id,
  key: `TASK-${id}`,
  title: `Task ${id}`,
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  description: null,
  deletedAt: null,
  checklist: [],
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

describe('task checklist API', () => {
  it('uses task-scoped paths and payloads for every checklist operation', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: item } as never);
    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: item } as never);
    const putSpy = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: [item] } as never);
    const deleteSpy = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: undefined } as never);

    await taskChecklistApi.add(12, 'Call florist');
    await taskChecklistApi.patch(12, 4, { dueDate: '2026-10-28' });
    await taskChecklistApi.complete(12, 4);
    await taskChecklistApi.reopen(12, 4);
    await taskChecklistApi.reorder(12, [4, 3]);
    await taskChecklistApi.remove(12, 4);
    await taskChecklistApi.restore(12, 4);

    expect(postSpy.mock.calls).toEqual([
      ['/tasks/12/checklist-items', { title: 'Call florist' }],
      ['/tasks/12/checklist-items/4/complete'],
      ['/tasks/12/checklist-items/4/reopen'],
      ['/tasks/12/checklist-items/4/restore'],
    ]);
    expect(patchSpy).toHaveBeenCalledWith('/tasks/12/checklist-items/4', {
      dueDate: '2026-10-28',
    });
    expect(putSpy).toHaveBeenCalledWith('/tasks/12/checklist-items/order', { itemIds: [4, 3] });
    expect(deleteSpy).toHaveBeenCalledWith('/tasks/12/checklist-items/4');
  });
});

describe('useTaskChecklist', () => {
  it('refreshes only the owned task detail after a successful mutation', async () => {
    const addSpy = vi.spyOn(taskChecklistApi, 'add').mockResolvedValue({ data: item } as never);
    const { Wrapper, queryClient } = createWrapper();
    const ownedKey = ['tasks', 1, 'detail', 12] as const;
    const otherOwnerKey = ['tasks', 2, 'detail', 12] as const;
    const otherTaskKey = ['tasks', 1, 'detail', 13] as const;
    queryClient.setQueryData(ownedKey, detail(12));
    queryClient.setQueryData(otherOwnerKey, detail(12));
    queryClient.setQueryData(otherTaskKey, detail(13));
    const { result } = renderHook(() => useTaskChecklist(1, 12), { wrapper: Wrapper });

    await act(async () => {
      await result.current.addItem('Call florist');
    });

    expect(addSpy).toHaveBeenCalledWith(12, 'Call florist');
    expect(queryClient.getQueryState(ownedKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData<TaskDetail>(ownedKey)?.checklist).toEqual([item]);
    expect(queryClient.getQueryState(otherOwnerKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(otherTaskKey)?.isInvalidated).toBe(false);
  });

  it('does not let a stale mutation response affect a different selected task', async () => {
    let finishAdd!: (response: AxiosResponse<ChecklistItem>) => void;
    vi.spyOn(taskChecklistApi, 'add').mockImplementation(
      () => new Promise((resolve) => (finishAdd = resolve)) as never
    );
    const { Wrapper, queryClient } = createWrapper();
    const oldKey = ['tasks', 1, 'detail', 12] as const;
    const newKey = ['tasks', 1, 'detail', 13] as const;
    queryClient.setQueryData(oldKey, detail(12));
    queryClient.setQueryData(newKey, detail(13));
    const { result, rerender } = renderHook(({ taskId }) => useTaskChecklist(1, taskId), {
      initialProps: { taskId: 12 },
      wrapper: Wrapper,
    });

    let pending!: Promise<ChecklistItem>;
    act(() => {
      pending = result.current.addItem('Call florist');
    });
    await waitFor(() => expect(finishAdd).toBeTypeOf('function'));
    rerender({ taskId: 13 });
    await act(async () => {
      finishAdd({ data: item } as AxiosResponse<ChecklistItem>);
      await pending;
    });

    expect(queryClient.getQueryState(oldKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(newKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryData(newKey)).toEqual(detail(13));
  });

  it('invalidates only the selected task detail when a write has an ambiguous failure', async () => {
    vi.spyOn(taskChecklistApi, 'add').mockRejectedValue(new Error('connection lost'));
    const { Wrapper, queryClient } = createWrapper();
    const ownedKey = ['tasks', 1, 'detail', 12] as const;
    const otherKey = ['tasks', 1, 'detail', 13] as const;
    queryClient.setQueryData(ownedKey, detail(12));
    queryClient.setQueryData(otherKey, detail(13));
    const { result } = renderHook(() => useTaskChecklist(1, 12), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.addItem('Call florist')).rejects.toThrow('connection lost');
    });

    expect(result.current.isError).toBe(true);
    expect(queryClient.getQueryState(ownedKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });
});
