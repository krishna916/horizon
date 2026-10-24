import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import type { TaskDetail, TaskSummary } from './types';
import { TaskCompletionGateDialog, useTaskCompletionGate } from './TaskCompletionGate';

const task: TaskSummary = {
  id: 7,
  key: 'TASK-7',
  title: 'Review the release notes',
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
};

const detail = (
  checklist: TaskDetail['checklist'],
  changes: Partial<TaskDetail> = {}
): TaskDetail => ({
  ...task,
  description: null,
  deletedAt: null,
  checklist,
  ...changes,
});

function GateProbe({
  completed = false,
  proceed,
  userId = 1,
  gateTask = task,
}: {
  completed?: boolean;
  proceed: () => void;
  userId?: number;
  gateTask?: TaskSummary;
}) {
  const gate = useTaskCompletionGate(userId, gateTask, completed, proceed);
  return (
    <>
      <button type="button" onClick={gate.requestToggle}>
        Request completion
      </button>
      {gate.checking && <p role="status">Checking checklist…</p>}
      {gate.error && (
        <div role="alert">
          <p>{gate.error}</p>
          <button type="button" onClick={gate.retry}>
            Retry checklist check
          </button>
        </div>
      )}
      <TaskCompletionGateDialog
        taskKey={gateTask.key}
        unfinishedCount={gate.unfinishedCount}
        onConfirm={gate.confirm}
        onCancel={gate.cancel}
      />
    </>
  );
}

function renderGate(proceed = vi.fn(), completed = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const view = render(<GateProbe completed={completed} proceed={proceed} />, { wrapper: Wrapper });
  return { ...view, proceed, queryClient };
}

describe('task completion gate', () => {
  it('fetches detail only on completion intent and completes without a dialog when the checklist is clear', async () => {
    const getSpy = vi.spyOn(taskApi, 'get').mockResolvedValue({ data: detail([]) } as never);
    const { proceed } = renderGate();
    expect(getSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Request completion' }));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(7));
    await waitFor(() => expect(proceed).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows confirmation for unfinished items without writing completion before confirmation', async () => {
    vi.spyOn(taskApi, 'get').mockResolvedValue({
      data: detail([
        { id: 1, title: 'Call florist', dueDate: null, completedAt: null, position: 0 },
        {
          id: 2,
          title: 'Book a table',
          dueDate: null,
          completedAt: '2026-10-22T10:00:00Z',
          position: 1,
        },
      ]),
    } as never);
    const { proceed } = renderGate();

    fireEvent.click(screen.getByRole('button', { name: 'Request completion' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      '1 checklist item is unfinished'
    );
    expect(proceed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Complete Anyway' }));
    await waitFor(() => expect(proceed).toHaveBeenCalledTimes(1));
  });

  it('leaves the parent untouched when confirmation is canceled', async () => {
    vi.spyOn(taskApi, 'get').mockResolvedValue({
      data: detail([
        { id: 1, title: 'Call florist', dueDate: null, completedAt: null, position: 0 },
      ]),
    } as never);
    const { proceed } = renderGate();
    fireEvent.click(screen.getByRole('button', { name: 'Request completion' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel completion' }));
    expect(proceed).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not complete after a failed detail read and allows Retry', async () => {
    const getSpy = vi
      .spyOn(taskApi, 'get')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: detail([]) } as never);
    const { proceed } = renderGate();
    fireEvent.click(screen.getByRole('button', { name: 'Request completion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check checklist items.');
    expect(proceed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry checklist check' }));
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(proceed).toHaveBeenCalledTimes(1));
  });

  it('coalesces repeated clicks while one checklist read is pending', async () => {
    let resolveDetail!: (response: AxiosResponse<TaskDetail>) => void;
    const getSpy = vi
      .spyOn(taskApi, 'get')
      .mockImplementation(() => new Promise((resolve) => (resolveDetail = resolve)) as never);
    const { proceed } = renderGate();

    fireEvent.click(screen.getByRole('button', { name: 'Request completion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Request completion' }));
    expect(getSpy).toHaveBeenCalledTimes(1);

    await act(async () => resolveDetail({ data: detail([]) } as AxiosResponse<TaskDetail>));
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('merges checklist results without replacing newer cached parent fields', async () => {
    vi.spyOn(taskApi, 'get').mockResolvedValue({
      data: detail([], { title: 'Stale server title' }),
    } as never);
    const { proceed, queryClient } = renderGate();
    queryClient.setQueryData(
      ['tasks', 1, 'detail', task.id],
      detail([], { title: 'Fresh field patch' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Request completion' }));
    await waitFor(() => expect(proceed).toHaveBeenCalledTimes(1));
    expect(queryClient.getQueryData<TaskDetail>(['tasks', 1, 'detail', task.id])?.title).toBe(
      'Fresh field patch'
    );
  });

  it('ignores a pending check after switching owner and task', async () => {
    let resolveDetail!: (response: AxiosResponse<TaskDetail>) => void;
    vi.spyOn(taskApi, 'get').mockImplementation(
      () => new Promise((resolve) => (resolveDetail = resolve)) as never
    );
    const proceed = vi.fn();
    const { queryClient, rerender } = renderGate(proceed);
    const cached = detail([
      { id: 1, title: 'Keep this checklist', dueDate: null, completedAt: null, position: 0 },
    ]);
    queryClient.setQueryData(['tasks', 1, 'detail', task.id], cached);

    fireEvent.click(screen.getByRole('button', { name: 'Request completion' }));
    await waitFor(() => expect(resolveDetail).toBeTypeOf('function'));
    rerender(
      <GateProbe userId={2} gateTask={{ ...task, id: 8, key: 'TASK-8' }} proceed={proceed} />
    );

    await act(async () => resolveDetail({ data: detail([]) } as AxiosResponse<TaskDetail>));
    expect(proceed).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['tasks', 1, 'detail', task.id])).toEqual(cached);
    expect(screen.queryByText('Checking checklist…')).not.toBeInTheDocument();
  });

  it('reopens a completed parent immediately without a checklist warning', () => {
    const getSpy = vi.spyOn(taskApi, 'get');
    const proceed = vi.fn();
    renderGate(proceed, true);
    fireEvent.click(screen.getByRole('button', { name: 'Request completion' }));

    expect(proceed).toHaveBeenCalledTimes(1);
    expect(getSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('applies the same warning to an archived parent task', async () => {
    vi.spyOn(taskApi, 'get').mockResolvedValue({
      data: detail(
        [{ id: 1, title: 'Call florist', dueDate: null, completedAt: null, position: 0 }],
        { archivedAt: '2026-10-21T00:00:00Z' }
      ),
    } as never);
    const { proceed } = renderGate();
    fireEvent.click(screen.getByRole('button', { name: 'Request completion' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(proceed).not.toHaveBeenCalled();
  });

  it('ignores a late completion check after the visible task state has reversed', async () => {
    let resolveDetail!: (response: AxiosResponse<TaskDetail>) => void;
    vi.spyOn(taskApi, 'get').mockImplementation(
      () => new Promise((resolve) => (resolveDetail = resolve)) as never
    );
    const proceed = vi.fn();
    const { rerender } = renderGate(proceed);
    fireEvent.click(screen.getByRole('button', { name: 'Request completion' }));
    await waitFor(() => expect(resolveDetail).toBeTypeOf('function'));
    rerender(<GateProbe completed proceed={proceed} />);

    await act(async () => resolveDetail({ data: detail([]) } as AxiosResponse<TaskDetail>));
    expect(proceed).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
