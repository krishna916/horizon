import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import { TaskLifecycleNoticeList } from './TaskLifecycleNoticeList';
import { TaskLifecycleProvider, useTaskLifecycle } from './TaskLifecycleProvider';
import type { TaskDetail, TaskSummary } from './types';

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return {
    ...original,
    taskApi: {
      ...original.taskApi,
      archive: vi.fn(),
      restoreArchive: vi.fn(),
      softDelete: vi.fn(),
      restoreDeleted: vi.fn(),
    },
  };
});

const task = (id: number, fields: Partial<TaskSummary> = {}): TaskSummary => ({
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
  ...task(id),
  description: null,
  deletedAt: null,
  checklist: [],
  ...fields,
});

const response = <T,>(data: T) => ({ data }) as AxiosResponse<T>;

function renderNotices() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Controls() {
    const lifecycle = useTaskLifecycle();
    return (
      <div>
        <button onClick={() => void lifecycle.run(1, task(1), 'archive')}>Archive first</button>
        <button onClick={() => void lifecycle.run(1, task(2), 'delete')}>Delete second</button>
      </div>
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskLifecycleProvider userId={1}>
        <Controls />
        <TaskLifecycleNoticeList />
      </TaskLifecycleProvider>
    </QueryClientProvider>
  );
}

describe('TaskLifecycleNoticeList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows multiple task-specific notices until each is undone or dismissed', async () => {
    vi.mocked(taskApi.archive).mockResolvedValue(
      response(taskDetail(1, { archivedAt: '2026-10-24T09:00:00Z' }))
    );
    vi.mocked(taskApi.softDelete).mockResolvedValue(response(undefined));
    vi.mocked(taskApi.restoreArchive).mockResolvedValue(response(taskDetail(1)));
    vi.mocked(taskApi.restoreDeleted).mockResolvedValue(response(taskDetail(2)));
    renderNotices();

    fireEvent.click(screen.getByRole('button', { name: 'Archive first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete second' }));

    expect(await screen.findByText('TASK-1 archived')).toBeInTheDocument();
    expect(screen.getByText('TASK-2 moved to Trash')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Undo/ })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Undo TASK-1 archive' }));
    await waitFor(() => expect(screen.queryByText('TASK-1 archived')).not.toBeInTheDocument());
    expect(screen.getByText('TASK-2 moved to Trash')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss TASK-2 notice' }));
    expect(screen.queryByText('TASK-2 moved to Trash')).not.toBeInTheDocument();
  });

  it('keeps a failed Undo notice visible with an in-place Retry action', async () => {
    vi.mocked(taskApi.archive).mockResolvedValue(
      response(taskDetail(1, { archivedAt: '2026-10-24T09:00:00Z' }))
    );
    vi.mocked(taskApi.restoreArchive)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response(taskDetail(1)));
    renderNotices();

    fireEvent.click(screen.getByRole('button', { name: 'Archive first' }));
    expect(await screen.findByText('TASK-1 archived')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo TASK-1 archive' }));

    expect(await screen.findByText("Couldn't restore this task. Try again.")).toBeInTheDocument();
    expect(screen.getByText('TASK-1 archived')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry undo for TASK-1' }));
    await waitFor(() => expect(screen.queryByText('TASK-1 archived')).not.toBeInTheDocument());
    expect(taskApi.restoreArchive).toHaveBeenCalledTimes(2);
  });

  it('does not expire notices automatically', async () => {
    vi.useFakeTimers();
    vi.mocked(taskApi.archive).mockResolvedValue(
      response(taskDetail(1, { archivedAt: '2026-10-24T09:00:00Z' }))
    );
    try {
      renderNotices();
      fireEvent.click(screen.getByRole('button', { name: 'Archive first' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(screen.getByText('TASK-1 archived')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
