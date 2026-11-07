import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentOwnerRevision } from '@/user/session/sessionRuntime';
import { taskApi } from './api';
import { TaskCompletionProvider, useTaskCompletion } from './TaskCompletionProvider';
import type { TaskDetail, TaskSummary } from './types';

vi.mock('./api', () => ({
  taskApi: { get: vi.fn(), complete: vi.fn(), reopen: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const task: TaskDetail = {
  id: 1,
  key: 'TASK-1',
  title: 'Private task',
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  tags: [],
  description: null,
  deletedAt: null,
  checklist: [],
};

function CompletionProbe() {
  const query = useQuery({
    queryKey: ['tasks', 1, 'detail', 1],
    queryFn: vi.fn(),
    initialData: task,
    enabled: false,
  });
  const completion = useTaskCompletion(1, query.data);
  return (
    <button onClick={completion.toggle}>
      {completion.saving ? 'Saving task' : completion.completed ? 'Reopen task' : 'Complete task'}
    </button>
  );
}

function response(data: TaskDetail): AxiosResponse<TaskDetail> {
  return { data } as AxiosResponse<TaskDetail>;
}

describe('task completion session boundary', () => {
  beforeEach(() => {
    setCurrentOwnerRevision(0);
    vi.mocked(taskApi.complete).mockReset();
    vi.mocked(taskApi.reopen).mockReset();
    vi.mocked(taskApi.get).mockReset();
  });

  it('does not write a late completion response into a cache after session epoch changes', async () => {
    const pending = deferred<AxiosResponse<TaskDetail>>();
    vi.mocked(taskApi.complete).mockReturnValueOnce(pending.promise);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['tasks', 1], { items: [task as TaskSummary] });

    render(
      <QueryClientProvider client={queryClient}>
        <TaskCompletionProvider>
          <CompletionProbe />
        </TaskCompletionProvider>
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complete task' }));
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledTimes(1));

    setCurrentOwnerRevision(1);
    await act(async () =>
      pending.resolve(
        response({
          ...task,
          completedAt: '2026-11-07T12:00:00Z',
          updatedAt: '2026-11-07T12:00:00Z',
        })
      )
    );

    expect(queryClient.getQueryData<TaskDetail>(['tasks', 1, 'detail', 1])?.completedAt).toBeNull();
    expect(
      queryClient.getQueryData<{ items: TaskSummary[] }>(['tasks', 1])?.items[0]?.completedAt
    ).toBeNull();
  });
});
