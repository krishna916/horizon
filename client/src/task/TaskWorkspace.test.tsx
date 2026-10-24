import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import { TaskCompletionProvider } from './TaskCompletionProvider';
import type { TaskDetail, TaskListResponse, TaskSummary } from './types';
import { TaskWorkspace } from './TaskWorkspace';

const { mockUseCurrentUser } = vi.hoisted(() => ({ mockUseCurrentUser: vi.fn() }));

vi.mock('@/user/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

const todayString = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const task = (id: number, title: string, changes: Partial<TaskSummary> = {}): TaskSummary => ({
  id,
  key: `TASK-${id}`,
  title,
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...changes,
});

const response = (items: TaskSummary[]) => ({ data: { items } }) as AxiosResponse<TaskListResponse>;

const detail = (id: number, title: string, completedAt: string | null = null): TaskDetail => ({
  ...task(id, title, { completedAt }),
  description: null,
  deletedAt: null,
  checklist: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TaskCompletionProvider>{children}</TaskCompletionProvider>
      </QueryClientProvider>
    );
  }
  return { Wrapper, queryClient };
}

function authenticateAs(id: number) {
  mockUseCurrentUser.mockReturnValue({
    data: { id, email: `user-${id}@example.com` },
    isPending: false,
    isError: false,
  });
}

describe('TaskWorkspace', () => {
  let listSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listSpy = vi.spyOn(taskApi, 'list');
    vi.spyOn(taskApi, 'get').mockImplementation(
      async (id) =>
        ({
          data: detail(id, `Task ${id}`),
        }) as never
    );
    authenticateAs(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the workspace heading and a calm pending state without rows or empty copy', () => {
    listSpy.mockReturnValue(new Promise(() => {}) as never);
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });

    expect(screen.getByRole('heading', { name: 'All Tasks' })).toHaveClass(
      '!text-5xl',
      '!m-0',
      'font-medium',
      '!leading-[1.15]',
      '!tracking-[-0.03em]',
      'max-[1250px]:!text-[40px]'
    );
    expect(screen.getByText('Stay organized and clear the path ahead.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(screen.queryByText('No active tasks.')).not.toBeInTheDocument();
    expect(screen.queryByText(/TASK-/)).not.toBeInTheDocument();
  });

  it('shows a loading state while the initial session is being checked', () => {
    mockUseCurrentUser.mockReturnValue({
      data: undefined,
      isPending: true,
      isFetching: true,
      isError: false,
      refetch: vi.fn(),
    });
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });

    expect(screen.getByRole('heading', { name: 'All Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your Tasks workspace…');
    expect(listSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/TASK-/)).not.toBeInTheDocument();
  });

  it('shows a session-verification state instead of cached tasks during revalidation', async () => {
    listSpy.mockResolvedValue(response([task(1, 'Cached private task')]) as never);
    const { Wrapper } = createWrapper();
    const view = render(<TaskWorkspace />, { wrapper: Wrapper });

    expect(await screen.findByText('Cached private task')).toBeInTheDocument();
    mockUseCurrentUser.mockReturnValue({
      data: { id: 1, email: 'user-1@example.com' },
      isPending: false,
      isFetching: true,
      isError: false,
      refetch: vi.fn(),
    });
    view.rerender(<TaskWorkspace />);

    expect(screen.getByRole('status')).toHaveTextContent('Verifying session…');
    expect(screen.queryByText('Cached private task')).not.toBeInTheDocument();
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('hides the create draft while the same account is being revalidated and restores it afterward', async () => {
    listSpy.mockResolvedValue(response([]));
    const { Wrapper } = createWrapper();
    const onDirtyChange = vi.fn();
    const view = render(
      <TaskWorkspace selection={{ kind: 'create' }} onCreationDirtyChange={onDirtyChange} />,
      { wrapper: Wrapper }
    );

    const title = await screen.findByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Private same-user draft' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description (optional)' }), {
      target: { value: 'Keep this through session verification.' },
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    mockUseCurrentUser.mockReturnValue({
      data: { id: 1, email: 'user-1@example.com' },
      isPending: false,
      isFetching: true,
      isError: false,
    });
    view.rerender(
      <TaskWorkspace selection={{ kind: 'create' }} onCreationDirtyChange={onDirtyChange} />
    );

    expect(screen.getByText('Verifying your session…')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument();
    expect(screen.queryByText('Private same-user draft')).not.toBeInTheDocument();

    authenticateAs(1);
    view.rerender(
      <TaskWorkspace selection={{ kind: 'create' }} onCreationDirtyChange={onDirtyChange} />
    );

    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue(
      'Private same-user draft'
    );
    expect(screen.getByRole('textbox', { name: 'Description (optional)' })).toHaveValue(
      'Keep this through session verification.'
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('resets drafts on account change and ignores an old account create response', async () => {
    listSpy.mockResolvedValue(response([]));
    const createSpy = vi.spyOn(taskApi, 'create');
    let resolveAccountOneCreate!: (result: AxiosResponse<TaskDetail>) => void;
    createSpy
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAccountOneCreate = resolve;
          }) as Promise<AxiosResponse<TaskDetail>>
      )
      .mockResolvedValueOnce({ data: detail(12, 'Account two task') } as AxiosResponse<TaskDetail>);
    const { Wrapper, queryClient } = createWrapper();
    const onCreated = vi.fn();
    const onDirtyChange = vi.fn();
    const view = render(
      <TaskWorkspace
        selection={{ kind: 'create' }}
        onCreated={onCreated}
        onCreationDirtyChange={onDirtyChange}
      />,
      { wrapper: Wrapper }
    );

    fireEvent.change(await screen.findByRole('textbox', { name: 'Title' }), {
      target: { value: 'Account one private draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const accountOneRequestKey = createSpy.mock.calls[0]?.[1];

    authenticateAs(2);
    view.rerender(
      <TaskWorkspace
        selection={{ kind: 'create' }}
        onCreated={onCreated}
        onCreationDirtyChange={onDirtyChange}
      />
    );

    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('');
    expect(screen.queryByText('Account one private draft')).not.toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Account two task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(2));
    const accountTwoRequestKey = createSpy.mock.calls[1]?.[1];
    expect(accountTwoRequestKey).not.toBe(accountOneRequestKey);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveAccountOneCreate({
        data: detail(11, 'Account one private draft'),
      } as AxiosResponse<TaskDetail>);
    });

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['tasks', 1, 'detail', 11])).toBeUndefined();
    expect(queryClient.getQueryData(['tasks', 2, 'detail', 12])).toMatchObject({
      id: 12,
      title: 'Account two task',
    });
  });

  it('does not expose cached tasks when session verification fails', () => {
    const refetch = vi.fn();
    mockUseCurrentUser.mockReturnValue({
      data: { id: 1, email: 'user-1@example.com' },
      isPending: false,
      isFetching: false,
      isError: true,
      refetch,
    });
    const { Wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(['tasks', 1], { items: [task(1, 'Stale private task')] });

    render(<TaskWorkspace />, { wrapper: Wrapper });

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't verify your session/i);
    expect(screen.queryByText('Stale private task')).not.toBeInTheDocument();
    expect(listSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders persisted active and today-completed tasks while hiding archived and historical tasks', async () => {
    const now = new Date();
    const active = task(1, 'Renew passport', {
      priority: 'CRITICAL',
      dueDate: todayString(now),
      inbox: true,
    });
    const completed = task(2, 'Send signed agreement', { completedAt: now.toISOString() });
    const yesterday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
      12
    ).toISOString();
    const historical = task(3, 'Old completed task', { completedAt: yesterday });
    const archived = task(4, 'Archived task', { archivedAt: now.toISOString() });
    const archivedCompleted = task(5, 'Archived completed task', {
      completedAt: now.toISOString(),
      archivedAt: now.toISOString(),
    });
    listSpy.mockResolvedValue(
      response([active, completed, historical, archived, archivedCompleted]) as never
    );
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });

    expect(await screen.findByText('Renew passport')).toBeInTheDocument();
    expect(screen.getByText('TASK-1')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByText('Send signed agreement')).toBeInTheDocument();
    expect(screen.queryByText('Old completed task')).not.toBeInTheDocument();
    expect(screen.queryByText('Archived task')).not.toBeInTheDocument();
    expect(screen.queryByText('Archived completed task')).not.toBeInTheDocument();
    expect(screen.queryByText(/description/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Open TASK-1: Renew passport' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open TASK-2: Send signed agreement' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty', []],
    ['archived-only', [task(1, 'Archived', { archivedAt: new Date().toISOString() })]],
    [
      'historical-only',
      [
        task(1, 'Historical', {
          completedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        }),
      ],
    ],
  ] as Array<[string, TaskSummary[]]>)(
    'shows Active empty state for %s and omits Completed',
    async (_case, items) => {
      listSpy.mockResolvedValue(response(items) as never);
      const { Wrapper } = createWrapper();

      render(<TaskWorkspace />, { wrapper: Wrapper });

      expect(await screen.findByText('No active tasks.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Active' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Completed' })).not.toBeInTheDocument();
    }
  );

  it('hides stale rows on request failure and retries successfully', async () => {
    listSpy
      .mockResolvedValueOnce(response([task(1, 'Previously loaded task')]) as never)
      .mockRejectedValueOnce(new Error('network unavailable'));
    const { Wrapper, queryClient } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });
    expect(await screen.findByText('Previously loaded task')).toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks', 1] });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load your tasks/i);
    expect(screen.queryByText('Previously loaded task')).not.toBeInTheDocument();
    listSpy.mockResolvedValueOnce(response([task(2, 'Recovered task')]) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Recovered task')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not show the previous account task while a new account query is pending', async () => {
    let resolveUserTwo!: (result: AxiosResponse<TaskListResponse>) => void;
    listSpy
      .mockResolvedValueOnce(response([task(1, 'Account one private task')]) as never)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveUserTwo = resolve;
          }) as never
      );
    const { Wrapper } = createWrapper();
    const view = render(<TaskWorkspace />, { wrapper: Wrapper });

    expect(await screen.findByText('Account one private task')).toBeInTheDocument();
    authenticateAs(2);
    view.rerender(<TaskWorkspace />);

    expect(screen.queryByText('Account one private task')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);

    await act(async () => {
      resolveUserTwo(response([task(2, 'Account two private task')]));
    });

    expect(await screen.findByText('Account two private task')).toBeInTheDocument();
    expect(screen.queryByText('Account one private task')).not.toBeInTheDocument();
  });

  it.each([
    ['pending', { data: undefined, isPending: true, isFetching: true, isError: false }],
    ['error', { data: undefined, isPending: false, isFetching: false, isError: true }],
    ['missing user', { data: undefined, isPending: false, isFetching: false, isError: false }],
  ])('does not request or render task rows while current user is %s', (_state, authState) => {
    mockUseCurrentUser.mockReturnValue(authState);
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });

    expect(listSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/TASK-/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'All Tasks' })).toBeInTheDocument();
  });

  it('regroups cached tasks at midnight and after tab resume without another API request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 23, 59, 50));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const active = task(1, 'Still active');
    const completed = task(2, 'Completed before midnight', {
      completedAt: new Date(2026, 9, 18, 23, 30).toISOString(),
    });
    listSpy.mockResolvedValue(response([active, completed]) as never);
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('Completed before midnight')).toBeInTheDocument();
    expect(listSpy).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole('heading', { name: 'Completed' })).not.toBeInTheDocument();
    expect(screen.getByText('Still active')).toBeInTheDocument();

    vi.setSystemTime(new Date(2026, 9, 20, 9));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.queryByRole('heading', { name: 'Completed' })).not.toBeInTheDocument();
    vi.setSystemTime(new Date(2026, 9, 21, 9));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the task list visible beside the selected private detail and wires panel actions', async () => {
    listSpy.mockResolvedValue(response([task(7, 'Selected task')]) as never);
    const detailSpy = vi.spyOn(taskApi, 'get').mockResolvedValue({
      data: {
        ...task(7, 'Selected task'),
        description: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Private details' }] }],
        },
        deletedAt: null,
        checklist: [],
      } satisfies TaskDetail,
    } as never);
    const onClose = vi.fn();
    const onOpenFullPage = vi.fn();
    const { Wrapper } = createWrapper();

    render(
      <TaskWorkspace
        selection={{ kind: 'valid', id: 7 }}
        onClosePanel={onClose}
        onOpenFullPage={onOpenFullPage}
      />,
      { wrapper: Wrapper }
    );

    expect(await screen.findByText('Selected task')).toBeInTheDocument();
    expect(await screen.findByText('Private details')).toBeInTheDocument();
    expect(detailSpy).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole('button', { name: 'Open full page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));
    expect(onOpenFullPage).toHaveBeenCalledWith(7);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('completedRowStaysCheckedInActiveAndReopens', async () => {
    listSpy.mockResolvedValue(response([task(1, 'Reversible task')]) as never);
    vi.spyOn(taskApi, 'complete').mockResolvedValue({
      data: detail(1, 'Reversible task', todayString() + 'T10:00:00Z'),
    } as never);
    vi.spyOn(taskApi, 'reopen').mockResolvedValue({ data: detail(1, 'Reversible task') } as never);
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete TASK-1' }));
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('1');
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Completed' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Reopen TASK-1' }));
    expect(screen.getByRole('checkbox', { name: 'Complete TASK-1' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('1');
    expect(screen.queryByRole('heading', { name: 'Completed' })).not.toBeInTheDocument();
  });

  it('rapidReopenThenCompleteKeepsLatestCompletionInActive', async () => {
    const active = task(1, 'Rapidly toggled task');
    const completedAt = todayString() + 'T10:00:00Z';
    const reopenPending = deferred<Awaited<ReturnType<typeof taskApi.reopen>>>();
    const completePending = deferred<Awaited<ReturnType<typeof taskApi.complete>>>();
    listSpy.mockResolvedValue(response([active]) as never);
    vi.spyOn(taskApi, 'complete')
      .mockResolvedValueOnce({ data: detail(1, active.title, completedAt) } as never)
      .mockReturnValueOnce(completePending.promise);
    vi.spyOn(taskApi, 'reopen').mockReturnValue(reopenPending.promise);
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete TASK-1' }));
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reopen TASK-1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1' }));

    await act(async () => reopenPending.resolve({ data: detail(1, active.title) } as never));
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledTimes(2));
    await act(async () =>
      completePending.resolve({ data: detail(1, active.title, completedAt) } as never)
    );

    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('1');
    expect(screen.queryByRole('heading', { name: 'Completed' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('failedReopenKeepsPreviouslyRetainedCompletedTaskInActive', async () => {
    const active = task(1, 'Retained after failed reopen');
    const completedAt = todayString() + 'T10:00:00Z';
    listSpy.mockResolvedValue(response([active]) as never);
    vi.spyOn(taskApi, 'complete').mockResolvedValue({
      data: detail(1, active.title, completedAt),
    } as never);
    vi.spyOn(taskApi, 'reopen').mockRejectedValue(new Error('service unavailable'));
    vi.spyOn(taskApi, 'get')
      .mockResolvedValueOnce({ data: detail(1, active.title) } as never)
      .mockResolvedValueOnce({ data: detail(1, active.title, completedAt) } as never);
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete TASK-1' }));
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reopen TASK-1' }));

    expect(screen.getByRole('checkbox', { name: 'Complete TASK-1' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save TASK-1.');
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('1');
    expect(screen.queryByRole('heading', { name: 'Completed' })).not.toBeInTheDocument();
    expect(screen.getAllByText(active.title)).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Retry TASK-1 completion save' })
    ).toBeInTheDocument();
  });

  it('retryFailedReopenEventuallyClearsRetentionOnConfirmedSuccess', async () => {
    const active = task(1, 'Reopened then completed again');
    const completedAt = todayString() + 'T10:00:00Z';
    listSpy.mockResolvedValue(response([active]) as never);
    vi.spyOn(taskApi, 'complete')
      .mockResolvedValueOnce({ data: detail(1, active.title, completedAt) } as never)
      .mockResolvedValueOnce({ data: detail(1, active.title, completedAt) } as never);
    vi.spyOn(taskApi, 'reopen')
      .mockRejectedValueOnce(new Error('service unavailable'))
      .mockResolvedValueOnce({ data: detail(1, active.title) } as never);
    vi.spyOn(taskApi, 'get')
      .mockResolvedValueOnce({ data: detail(1, active.title) } as never)
      .mockResolvedValueOnce({ data: detail(1, active.title, completedAt) } as never)
      .mockResolvedValue({ data: detail(1, active.title) } as never);
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete TASK-1' }));
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reopen TASK-1' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry TASK-1 completion save' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Complete TASK-1' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-1' }));
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('1');
    expect(screen.queryByRole('heading', { name: 'Completed' })).not.toBeInTheDocument();
  });

  it('failedReopenOfPreexistingCompletedTaskReturnsToCompleted', async () => {
    const completedAt = todayString() + 'T10:00:00Z';
    const completed = task(1, 'Preexisting completed task', { completedAt });
    listSpy.mockResolvedValue(response([completed]) as never);
    vi.spyOn(taskApi, 'reopen').mockRejectedValue(new Error('service unavailable'));
    vi.spyOn(taskApi, 'get').mockResolvedValue({
      data: detail(1, completed.title, completedAt),
    } as never);
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Reopen TASK-1' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save TASK-1.');
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('heading', { name: 'Completed' }).parentElement).toHaveTextContent('1');
    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('0');
  });

  it('listUnmountAfterFailedReopenReclassifiesFromPersistedTimestamp', async () => {
    const active = task(1, 'Reclassify after leaving list');
    const completedAt = todayString() + 'T10:00:00Z';
    listSpy
      .mockResolvedValueOnce(response([active]) as never)
      .mockResolvedValueOnce(response([task(1, active.title, { completedAt })]) as never);
    vi.spyOn(taskApi, 'complete').mockResolvedValue({
      data: detail(1, active.title, completedAt),
    } as never);
    vi.spyOn(taskApi, 'reopen').mockRejectedValue(new Error('service unavailable'));
    vi.spyOn(taskApi, 'get')
      .mockResolvedValueOnce({ data: detail(1, active.title) } as never)
      .mockResolvedValueOnce({ data: detail(1, active.title, completedAt) } as never);
    const { Wrapper } = createWrapper();
    const view = render(<TaskWorkspace />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete TASK-1' }));
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reopen TASK-1' }));
    await screen.findByRole('alert');

    view.unmount();
    render(<TaskWorkspace />, { wrapper: Wrapper });

    expect(await screen.findByRole('heading', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('0');
  });

  it('panelSwitchAndReturnPreserveRetention', async () => {
    const active = task(1, 'Panel retained task');
    listSpy.mockResolvedValue(response([active]) as never);
    vi.spyOn(taskApi, 'complete').mockResolvedValue({
      data: detail(1, active.title, todayString() + 'T10:00:00Z'),
    } as never);
    vi.spyOn(taskApi, 'get').mockResolvedValue({ data: detail(1, active.title) } as never);
    const { Wrapper } = createWrapper();
    const view = render(<TaskWorkspace onClosePanel={vi.fn()} />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete TASK-1' }));
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());

    view.rerender(<TaskWorkspace selection={{ kind: 'valid', id: 1 }} onClosePanel={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Close task details' })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { name: 'Reopen TASK-1' })).toHaveLength(2);
    view.rerender(<TaskWorkspace onClosePanel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('1');
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1' })).toBeInTheDocument();
  });

  it('unmountRemountClearsRetentionAndUsesPersistedTimestamp', async () => {
    const active = task(1, 'Fresh entry task');
    const completed = task(1, 'Fresh entry task', { completedAt: todayString() + 'T10:00:00Z' });
    listSpy
      .mockResolvedValueOnce(response([active]) as never)
      .mockResolvedValueOnce(response([completed]) as never);
    vi.spyOn(taskApi, 'complete').mockResolvedValue({
      data: detail(1, active.title, todayString() + 'T10:00:00Z'),
    } as never);
    const firstWrapper = createWrapper();
    const view = render(<TaskWorkspace />, { wrapper: firstWrapper.Wrapper });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete TASK-1' }));
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('1');

    view.unmount();
    const secondWrapper = createWrapper();
    render(<TaskWorkspace />, { wrapper: secondWrapper.Wrapper });

    expect(await screen.findByRole('heading', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('0');
    expect(screen.queryByRole('checkbox', { name: /TASK-1/ })).toBeInTheDocument();
  });

  it('ownerSwitchClearsRetention', async () => {
    const active = task(1, 'Owner scoped task');
    const otherOwnersCompletedTask = task(1, 'Owner scoped task', {
      completedAt: todayString() + 'T10:00:00Z',
    });
    listSpy
      .mockResolvedValueOnce(response([active]) as never)
      .mockResolvedValueOnce(response([otherOwnersCompletedTask]) as never);
    vi.spyOn(taskApi, 'complete').mockResolvedValue({
      data: detail(1, active.title, todayString() + 'T10:00:00Z'),
    } as never);
    const { Wrapper } = createWrapper();
    const view = render(<TaskWorkspace />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete TASK-1' }));
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());

    authenticateAs(2);
    view.rerender(<TaskWorkspace />);

    expect(await screen.findByRole('heading', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('0');
  });

  it('noDuplicateRowsOrCounts', async () => {
    const retained = task(1, 'Retained row');
    const completed = task(2, 'Persisted completed row', {
      completedAt: todayString() + 'T10:00:00Z',
    });
    listSpy.mockResolvedValue(response([retained, completed]) as never);
    vi.spyOn(taskApi, 'complete').mockResolvedValue({
      data: detail(1, retained.title, todayString() + 'T10:00:00Z'),
    } as never);
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete TASK-1' }));
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());

    expect(screen.getAllByText('Retained row')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Active' }).parentElement).toHaveTextContent('1');
    expect(screen.getByRole('heading', { name: 'Completed' }).parentElement).toHaveTextContent('1');
  });
});
