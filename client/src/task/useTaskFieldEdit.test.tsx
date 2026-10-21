import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail } from './types';
import { useTaskFieldEdit } from './useTaskFieldEdit';
import { taskApi } from './api';

const task: TaskDetail = {
  id: 7,
  key: 'TASK-7',
  title: 'First task',
  priority: 'HIGH',
  dueDate: '2026-10-21',
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  description: null,
  deletedAt: null,
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

describe('useTaskFieldEdit', () => {
  it('starts read-only and protects a changed draft from another field activation', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskFieldEdit(task, 1), { wrapper: Wrapper });

    expect(result.current.activeField).toBeNull();
    act(() => result.current.activate('title'));
    expect(result.current.draft).toBe('First task');
    act(() => result.current.setDraft('Renamed task'));

    expect(result.current.dirty).toBe(true);
    act(() => result.current.activate('priority'));
    expect(result.current.activeField).toBe('title');
    expect(result.current.draft).toBe('Renamed task');
  });

  it('allows a pristine editor to switch fields without making a draft dirty', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskFieldEdit(task, 1), { wrapper: Wrapper });

    act(() => result.current.activate('title'));
    act(() => result.current.activate('dueDate'));

    expect(result.current.activeField).toBe('dueDate');
    expect(result.current.draft).toBe('2026-10-21');
    expect(result.current.dirty).toBe(false);
  });

  it('trims and saves only the changed title, then closes the editor on success', async () => {
    const updateSpy = vi.spyOn(taskApi, 'update').mockResolvedValue({
      data: { ...task, title: 'Renamed task' },
    } as never);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskFieldEdit(task, 1), { wrapper: Wrapper });
    act(() => result.current.activate('title'));
    act(() => result.current.setDraft('  Renamed task  '));

    let saved!: boolean;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(saved).toBe(true);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(7, { title: 'Renamed task' });
    expect(result.current.activeField).toBeNull();
    expect(result.current.dirty).toBe(false);
  });

  it('restores the original value when Cancel is pressed', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskFieldEdit(task, 1), { wrapper: Wrapper });
    act(() => result.current.activate('title'));
    act(() => result.current.setDraft('Discarded draft'));
    act(() => result.current.cancel());

    expect(result.current.activeField).toBeNull();
    expect(result.current.draft).toBe('First task');
    expect(result.current.dirty).toBe(false);
  });

  it.each([
    ['', 'A title is required.'],
    ['   ', 'A title is required.'],
    ['x'.repeat(256), 'Title must be 255 characters or fewer.'],
  ])('rejects invalid title input %j without sending a request', async (value, message) => {
    const updateSpy = vi.spyOn(taskApi, 'update');
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskFieldEdit(task, 1), { wrapper: Wrapper });
    act(() => result.current.activate('title'));
    act(() => result.current.setDraft(value));

    await act(async () => {
      await expect(result.current.save()).resolves.toBe(false);
    });

    expect(result.current.error).toBe(message);
    expect(result.current.draft).toBe(value);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['priority', '', { priority: null }],
    ['priority', 'CRITICAL', { priority: 'CRITICAL' }],
    ['dueDate', '', { dueDate: null }],
    ['dueDate', '2026-10-24', { dueDate: '2026-10-24' }],
  ] as const)('saves %s field value %j as a single-property patch', async (field, value, patch) => {
    vi.spyOn(taskApi, 'update').mockResolvedValue({ data: task } as never);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskFieldEdit(task, 1), { wrapper: Wrapper });
    act(() => result.current.activate(field));
    act(() => result.current.setDraft(value));

    await act(async () => {
      await expect(result.current.save()).resolves.toBe(true);
    });

    expect(taskApi.update).toHaveBeenCalledWith(7, patch);
  });

  it('does not save an unchanged field', async () => {
    const updateSpy = vi.spyOn(taskApi, 'update');
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskFieldEdit(task, 1), { wrapper: Wrapper });
    act(() => result.current.activate('title'));

    await act(async () => {
      await expect(result.current.save()).resolves.toBe(true);
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.current.activeField).toBeNull();
  });

  it('blocks a second save while the original request is pending', async () => {
    let finish!: (value: { data: TaskDetail }) => void;
    const updateSpy = vi
      .spyOn(taskApi, 'update')
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)) as never);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskFieldEdit(task, 1), { wrapper: Wrapper });
    act(() => result.current.activate('title'));
    act(() => result.current.setDraft('Renamed task'));

    let first!: Promise<boolean>;
    act(() => {
      first = result.current.save();
    });
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => {
      await expect(result.current.save()).resolves.toBe(false);
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(result.current.dirty).toBe(true);
    finish({ data: { ...task, title: 'Renamed task' } });
    await act(async () => {
      await expect(first).resolves.toBe(true);
    });
  });

  it('keeps a failed server field error and draft, then allows retry with the same value', async () => {
    const updateSpy = vi
      .spyOn(taskApi, 'update')
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { data: { errors: { title: 'Title is already in use.' } } },
      })
      .mockResolvedValueOnce({ data: { ...task, title: 'Renamed task' } } as never);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskFieldEdit(task, 1), { wrapper: Wrapper });
    act(() => result.current.activate('title'));
    act(() => result.current.setDraft('Renamed task'));

    await act(async () => {
      await expect(result.current.save()).resolves.toBe(false);
    });
    expect(result.current.error).toBe('Title is already in use.');
    expect(result.current.draft).toBe('Renamed task');
    expect(result.current.dirty).toBe(true);

    await act(async () => {
      await expect(result.current.save()).resolves.toBe(true);
    });
    expect(updateSpy).toHaveBeenNthCalledWith(1, 7, { title: 'Renamed task' });
    expect(updateSpy).toHaveBeenNthCalledWith(2, 7, { title: 'Renamed task' });
    expect(result.current.activeField).toBeNull();
  });

  it('retains a draft after a network failure and retries the same field value manually', async () => {
    const updateSpy = vi
      .spyOn(taskApi, 'update')
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ data: { ...task, title: 'Renamed task' } } as never);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskFieldEdit(task, 1), { wrapper: Wrapper });
    act(() => result.current.activate('title'));
    act(() => result.current.setDraft('Renamed task'));

    await act(async () => {
      await expect(result.current.save()).resolves.toBe(false);
    });
    expect(result.current.error).toMatch(/draft is still here/i);
    expect(result.current.draft).toBe('Renamed task');
    expect(result.current.dirty).toBe(true);

    await act(async () => {
      await expect(result.current.save()).resolves.toBe(true);
    });
    expect(updateSpy).toHaveBeenNthCalledWith(1, 7, { title: 'Renamed task' });
    expect(updateSpy).toHaveBeenNthCalledWith(2, 7, { title: 'Renamed task' });
  });
});
