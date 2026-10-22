import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import { TaskCompletionProvider, useTaskCompletion } from './TaskCompletionProvider';
import { useUpdateTask } from './useUpdateTask';
import type { TaskDetail, TaskSummary } from './types';

vi.mock('./api', () => ({
  taskApi: {
    list: vi.fn(),
    get: vi.fn(),
    complete: vi.fn(),
    reopen: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
}));

function task(id: number, completedAt: string | null = null): TaskDetail {
  return {
    id,
    key: `TASK-${id}`,
    title: `Task ${id}`,
    priority: null,
    dueDate: null,
    inbox: false,
    completedAt,
    archivedAt: null,
    createdAt: '2026-10-22T00:00:00Z',
    updatedAt: '2026-10-22T00:00:00Z',
    description: null,
    deletedAt: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function disabledQuery(): Promise<TaskDetail> {
  throw new Error('The disabled test query should not execute.');
}

function Probe({ userId, value, name }: { userId: number; value: TaskDetail; name: string }) {
  const taskQuery = useQuery({
    queryKey: ['tasks', userId, 'detail', value.id],
    queryFn: disabledQuery,
    initialData: value,
    enabled: false,
  });
  const taskValue = taskQuery.data;
  const completion = useTaskCompletion(userId, taskValue);
  return (
    <div>
      <button
        type="button"
        role="checkbox"
        aria-checked={completion.completed}
        aria-label={`${completion.completed ? 'Reopen' : 'Complete'} ${taskValue.key} ${name}`}
        onClick={completion.toggle}
      />
      {completion.saving && <output>{name} Saving…</output>}
      {completion.error && (
        <div role="alert">
          <span>{name} could not be saved</span>
          <button type="button" onClick={completion.retry}>
            Retry {name}
          </button>
        </div>
      )}
    </div>
  );
}

function FieldPatchProbe({ userId, value }: { userId: number; value: TaskDetail }) {
  const update = useUpdateTask(userId);
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void update.updateTask(value.id, { title: 'Patched title' }).then(() => setDone(true));
      }}
    >
      {done ? 'Field saved' : 'Save field'}
    </button>
  );
}

function renderWithProvider(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TaskCompletionProvider>{children}</TaskCompletionProvider>
      </QueryClientProvider>
    ),
  };
}

function response(value: TaskDetail) {
  return { data: value } as never;
}

describe('TaskCompletionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('oneClickImmediatelyUpdatesAllSurfacesAndShowsSaving', async () => {
    const pending = deferred<Awaited<ReturnType<typeof taskApi.complete>>>();
    vi.mocked(taskApi.complete).mockReturnValue(pending.promise);
    const initial = task(1);
    renderWithProvider(
      <>
        <Probe userId={1} value={initial} name="row" />
        <Probe userId={1} value={initial} name="detail" />
      </>
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));

    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1 row' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1 detail' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByText('row Saving…')).toBeInTheDocument();
    expect(screen.getByText('detail Saving…')).toBeInTheDocument();
    expect(taskApi.complete).toHaveBeenCalledTimes(1);

    await act(async () =>
      pending.resolve(response({ ...initial, completedAt: '2026-10-22T01:00:00Z' }))
    );
    await waitFor(() => expect(screen.queryByText('row Saving…')).not.toBeInTheDocument());
  });

  it('rapidCompleteReopenCompleteCoalescesAndSerializes', async () => {
    const first = deferred<Awaited<ReturnType<typeof taskApi.complete>>>();
    vi.mocked(taskApi.complete)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(response({ ...task(1), completedAt: '2026-10-22T01:00:00Z' }));
    vi.mocked(taskApi.reopen).mockResolvedValue(response(task(1)));
    renderWithProvider(<Probe userId={1} value={task(1)} name="row" />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reopen TASK-1 row' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1 row' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(taskApi.complete).toHaveBeenCalledTimes(1);
    expect(taskApi.reopen).not.toHaveBeenCalled();

    await act(async () =>
      first.resolve(response({ ...task(1), completedAt: '2026-10-22T01:00:00Z' }))
    );
    await waitFor(() => expect(screen.queryByText('row Saving…')).not.toBeInTheDocument());
    expect(taskApi.complete).toHaveBeenCalledTimes(1);
    expect(taskApi.reopen).not.toHaveBeenCalled();
  });

  it('differentTasksSaveIndependently', () => {
    vi.mocked(taskApi.complete).mockImplementation(() => new Promise(() => {}));
    renderWithProvider(
      <>
        <Probe userId={1} value={task(1)} name="one" />
        <Probe userId={1} value={task(2)} name="two" />
      </>
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 one' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-2 two' }));

    expect(taskApi.complete).toHaveBeenCalledTimes(2);
    expect(screen.getByText('one Saving…')).toBeInTheDocument();
    expect(screen.getByText('two Saving…')).toBeInTheDocument();
  });

  it('outOfOrderQueryResponsesCannotRevertNewerIntent', async () => {
    const pending = deferred<Awaited<ReturnType<typeof taskApi.complete>>>();
    vi.mocked(taskApi.complete).mockReturnValue(pending.promise);
    const initial = task(1);
    const { queryClient } = renderWithProvider(<Probe userId={1} value={initial} name="row" />);
    queryClient.setQueryData(['tasks', 1], { items: [initial] });
    queryClient.setQueryData(['tasks', 1, 'detail', 1], initial);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));
    act(() => {
      queryClient.setQueryData(['tasks', 1], { items: [initial] });
      queryClient.setQueryData(['tasks', 1, 'detail', 1], initial);
    });
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1 row' })).toHaveAttribute(
      'aria-checked',
      'true'
    );

    await act(async () =>
      pending.resolve(response({ ...initial, completedAt: '2026-10-22T01:00:00Z' }))
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryData<TaskDetail>(['tasks', 1, 'detail', 1])?.completedAt
      ).not.toBeNull()
    );
    expect(
      queryClient.getQueryData<{ items: TaskSummary[] }>(['tasks', 1])?.items[0]?.completedAt
    ).not.toBeNull();
  });

  it('lateListRefetchCannotOverwriteConfirmedCompletion', async () => {
    const completion = deferred<Awaited<ReturnType<typeof taskApi.complete>>>();
    const staleList = deferred<{ items: TaskSummary[] }>();
    vi.mocked(taskApi.complete).mockReturnValue(completion.promise);
    const initial = task(1);
    const { queryClient } = renderWithProvider(<Probe userId={1} value={initial} name="row" />);
    queryClient.setQueryData(['tasks', 1], { items: [initial] });
    queryClient.setQueryData(['tasks', 1, 'detail', 1], initial);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));
    const staleFetch = queryClient.fetchQuery({
      queryKey: ['tasks', 1],
      queryFn: () => staleList.promise,
    });

    await act(async () =>
      completion.resolve(response({ ...initial, completedAt: '2026-10-22T01:00:00Z' }))
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ items: TaskSummary[] }>(['tasks', 1])?.items[0]?.completedAt
      ).not.toBeNull()
    );
    await act(async () => staleList.resolve({ items: [initial] }));
    await staleFetch;

    expect(
      queryClient.getQueryData<{ items: TaskSummary[] }>(['tasks', 1])?.items[0]?.completedAt
    ).not.toBeNull();
    expect(
      queryClient.getQueryData<TaskDetail>(['tasks', 1, 'detail', 1])?.completedAt
    ).not.toBeNull();
  });

  it('timeoutReconcilesCommittedServerStateBeforeRetry', async () => {
    const initial = task(1);
    vi.mocked(taskApi.complete).mockRejectedValue(new Error('timeout'));
    vi.mocked(taskApi.get).mockResolvedValue(
      response({ ...initial, completedAt: '2026-10-22T01:00:00Z' })
    );
    const { queryClient } = renderWithProvider(<Probe userId={1} value={initial} name="row" />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));

    await waitFor(() => expect(screen.queryByText('row Saving…')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1 row' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(taskApi.get).toHaveBeenCalledWith(1);
    expect(
      queryClient.getQueryData<TaskDetail>(['tasks', 1, 'detail', 1])?.completedAt
    ).not.toBeNull();
  });

  it('failureRollsBackAndRetryPersistsLatestIntent', async () => {
    const initial = task(1);
    const failed = deferred<Awaited<ReturnType<typeof taskApi.complete>>>();
    vi.mocked(taskApi.complete)
      .mockReturnValueOnce(failed.promise)
      .mockResolvedValue(response({ ...initial, completedAt: '2026-10-22T01:00:00Z' }));
    vi.mocked(taskApi.get).mockResolvedValue(response(initial));
    renderWithProvider(<Probe userId={1} value={initial} name="row" />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));
    await act(async () => failed.reject(new Error('offline')));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry row' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1 row' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(taskApi.complete).toHaveBeenCalledTimes(2);
  });

  it('oldUserResponseIsIgnoredAfterAccountSwitch', async () => {
    const pending = deferred<Awaited<ReturnType<typeof taskApi.complete>>>();
    vi.mocked(taskApi.complete).mockReturnValue(pending.promise);
    const initial = task(1);
    const { rerender, queryClient } = renderWithProvider(
      <Probe userId={1} value={initial} name="user" />
    );
    queryClient.setQueryData(['tasks', 2, 'detail', 1], { ...initial, title: 'Other owner task' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 user' }));
    rerender(
      <QueryClientProvider client={queryClient}>
        <TaskCompletionProvider>
          <Probe userId={2} value={{ ...initial, title: 'Other owner task' }} name="user" />
        </TaskCompletionProvider>
      </QueryClientProvider>
    );
    await act(async () =>
      pending.resolve(response({ ...initial, completedAt: '2026-10-22T01:00:00Z' }))
    );

    expect(screen.getByRole('checkbox', { name: 'Complete TASK-1 user' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(queryClient.getQueryData<TaskDetail>(['tasks', 2, 'detail', 1])?.completedAt).toBeNull();
  });

  it('failedPostAndFailedGetAfterRapidReopenShowsPersistentRetry', async () => {
    const initial = task(1);
    const pending = deferred<Awaited<ReturnType<typeof taskApi.complete>>>();
    vi.mocked(taskApi.complete).mockReturnValue(pending.promise);
    vi.mocked(taskApi.get).mockRejectedValue(new Error('unavailable'));
    renderWithProvider(<Probe userId={1} value={initial} name="row" />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reopen TASK-1 row' }));
    await act(async () => pending.reject(new Error('timeout after possible commit')));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(screen.queryByText('row Saving…')).not.toBeInTheDocument();
    expect(taskApi.get).toHaveBeenCalledTimes(1);
    expect(taskApi.reopen).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry row' })).toBeInTheDocument();
  });

  it('unknownOutcomeRetryStillFailsGetKeepsError', async () => {
    const initial = task(1);
    vi.mocked(taskApi.complete).mockRejectedValue(new Error('timeout'));
    vi.mocked(taskApi.get).mockRejectedValue(new Error('unavailable'));
    renderWithProvider(<Probe userId={1} value={initial} name="row" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));

    const retry = await screen.findByRole('button', { name: 'Retry row' });
    fireEvent.click(retry);

    await waitFor(() => expect(taskApi.get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry row' })).toBeInTheDocument();
    expect(screen.queryByText('row Saving…')).not.toBeInTheDocument();
    expect(taskApi.complete).toHaveBeenCalledTimes(1);
  });

  it('unknownOutcomeRetryReconcilesAndPersistsLatestIntent', async () => {
    const initial = task(1);
    const completedAt = '2026-10-22T01:00:00Z';
    vi.mocked(taskApi.complete).mockRejectedValue(new Error('timeout'));
    vi.mocked(taskApi.get)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue(response({ ...initial, completedAt }));
    vi.mocked(taskApi.reopen).mockResolvedValue(response(initial));
    const { queryClient } = renderWithProvider(<Probe userId={1} value={initial} name="row" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reopen TASK-1 row' }));
    await screen.findByRole('button', { name: 'Retry row' });

    fireEvent.click(screen.getByRole('button', { name: 'Retry row' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(taskApi.get).toHaveBeenCalledTimes(2);
    expect(taskApi.reopen).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<TaskDetail>(['tasks', 1, 'detail', 1])?.completedAt).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('knownReconciliationMatchingLatestIntentFinishesCleanly', async () => {
    const initial = task(1);
    const pending = deferred<Awaited<ReturnType<typeof taskApi.complete>>>();
    vi.mocked(taskApi.complete).mockReturnValue(pending.promise);
    vi.mocked(taskApi.get).mockResolvedValue(response(initial));
    renderWithProvider(<Probe userId={1} value={initial} name="row" />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reopen TASK-1 row' }));
    await act(async () => pending.reject(new Error('timeout')));

    await waitFor(() => expect(screen.queryByText('row Saving…')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(taskApi.get).toHaveBeenCalledTimes(1);
    expect(taskApi.reopen).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('unknownFailureDoesNotLeakAcrossUsers', async () => {
    const initial = task(1);
    vi.mocked(taskApi.complete).mockRejectedValue(new Error('timeout'));
    vi.mocked(taskApi.get).mockRejectedValue(new Error('unavailable'));
    const { rerender, queryClient } = renderWithProvider(
      <Probe userId={1} value={initial} name="user" />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 user' }));
    await screen.findByRole('button', { name: 'Retry user' });
    queryClient.setQueryData(['tasks', 2, 'detail', 1], { ...initial, title: 'Other owner task' });

    rerender(
      <QueryClientProvider client={queryClient}>
        <TaskCompletionProvider>
          <Probe userId={2} value={{ ...initial, title: 'Other owner task' }} name="user" />
        </TaskCompletionProvider>
      </QueryClientProvider>
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry user' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Complete TASK-1 user' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('fieldPatchResponseCannotOverwriteCompletion', async () => {
    const patch = deferred<Awaited<ReturnType<typeof taskApi.update>>>();
    const initial = task(1);
    vi.mocked(taskApi.update).mockReturnValue(patch.promise);
    vi.mocked(taskApi.complete).mockResolvedValue(
      response({ ...initial, completedAt: '2026-10-22T01:00:00Z' })
    );
    const { queryClient } = renderWithProvider(
      <>
        <Probe userId={1} value={initial} name="row" />
        <FieldPatchProbe userId={1} value={initial} />
      </>
    );
    queryClient.setQueryData(['tasks', 1, 'detail', 1], initial);
    queryClient.setQueryData(['tasks', 1], { items: [initial] });

    fireEvent.click(screen.getByRole('button', { name: 'Save field' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1 row' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1 row' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    );
    await act(async () => patch.resolve(response({ ...initial, title: 'Patched title' })));

    await waitFor(() => expect(screen.getByText('Field saved')).toBeInTheDocument());
    expect(queryClient.getQueryData<TaskDetail>(['tasks', 1, 'detail', 1])?.completedAt).toBe(
      '2026-10-22T01:00:00Z'
    );
    expect(
      queryClient.getQueryData<{ items: TaskSummary[] }>(['tasks', 1])?.items[0]?.completedAt
    ).toBe('2026-10-22T01:00:00Z');
  });
});
