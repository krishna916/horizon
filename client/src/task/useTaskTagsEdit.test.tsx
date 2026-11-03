import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import type { TaskDetail, TaskTagSelection } from './types';
import { useTaskTagsEdit } from './useTaskTagsEdit';

const task = (id: number, tags: TaskDetail['tags'] = []): TaskDetail => ({
  id,
  key: `TASK-${id}`,
  title: `Task ${id}`,
  priority: null,
  dueDate: null,
  inbox: true,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  tags,
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

function deferredUpdates() {
  const pending: Array<{
    resolve: (response: AxiosResponse<TaskDetail>) => void;
    reject: (error: Error) => void;
  }> = [];
  vi.spyOn(taskApi, 'update').mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      })
  );
  return pending;
}

afterEach(() => vi.restoreAllMocks());

describe('useTaskTagsEdit', () => {
  it('releases the new task editor while an old task patch is pending', async () => {
    const pending = deferredUpdates();
    const { Wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ currentTask, userId }) => useTaskTagsEdit(currentTask, userId),
      { initialProps: { currentTask: task(7), userId: 1 }, wrapper: Wrapper }
    );

    act(() => result.current.activate());
    act(() => result.current.change([{ name: 'Architecture' }]));
    let oldSave!: Promise<boolean>;
    act(() => {
      oldSave = result.current.save();
    });
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(pending).toHaveLength(1));

    rerender({ currentTask: task(8, [{ id: 22, name: 'Backend' }]), userId: 1 });
    expect(result.current.pending).toBe(false);
    expect(result.current.editing).toBe(false);
    act(() => result.current.activate());
    expect(result.current.editing).toBe(true);
    expect(result.current.draft).toEqual([{ id: 22 }]);

    await act(async () => {
      pending[0]!.resolve({
        data: task(7, [{ id: 21, name: 'Architecture' }]),
      } as AxiosResponse<TaskDetail>);
      await expect(oldSave).resolves.toBe(false);
    });
    expect(result.current.editing).toBe(true);
    expect(result.current.pending).toBe(false);
    expect(result.current.draft).toEqual([{ id: 22 }]);
  });

  it('ignores an old owner save after switching away and back while a new save is pending', async () => {
    const pending = deferredUpdates();
    const { Wrapper } = createWrapper();
    const { result, rerender } = renderHook(({ userId }) => useTaskTagsEdit(task(7), userId), {
      initialProps: { userId: 1 },
      wrapper: Wrapper,
    });

    act(() => result.current.activate());
    act(() => result.current.change([{ name: 'Owner one draft' }]));
    let oldSave!: Promise<boolean>;
    act(() => {
      oldSave = result.current.save();
    });
    await waitFor(() => expect(pending).toHaveLength(1));

    rerender({ userId: 2 });
    expect(result.current.pending).toBe(false);
    act(() => result.current.activate());
    act(() => result.current.change([{ name: 'Owner two draft' }]));
    let ownerTwoSave!: Promise<boolean>;
    act(() => {
      ownerTwoSave = result.current.save();
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(result.current.pending).toBe(true);

    rerender({ userId: 1 });
    expect(result.current.pending).toBe(false);
    act(() => result.current.activate());
    act(() => result.current.change([{ name: 'Owner one current draft' }]));
    let currentSave!: Promise<boolean>;
    act(() => {
      currentSave = result.current.save();
    });
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(result.current.pending).toBe(true);

    await act(async () => {
      pending[0]!.reject(new Error('stale failure'));
      await expect(oldSave).resolves.toBe(false);
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.editing).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.draft).toEqual([
      { name: 'Owner one current draft' },
    ] satisfies TaskTagSelection[]);

    await act(async () => {
      pending[1]!.resolve({
        data: task(7, [{ id: 22, name: 'Owner two draft' }]),
      } as AxiosResponse<TaskDetail>);
      await expect(ownerTwoSave).resolves.toBe(false);
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.draft).toEqual([{ name: 'Owner one current draft' }]);

    await act(async () => {
      pending[2]!.resolve({
        data: task(7, [{ id: 21, name: 'Owner one current draft' }]),
      } as AxiosResponse<TaskDetail>);
      await expect(currentSave).resolves.toBe(true);
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.editing).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
