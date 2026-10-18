import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import type { TaskListResponse, TaskSummary } from './types';
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
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
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
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
    ['pending', { data: undefined, isPending: true, isError: false }],
    ['error', { data: undefined, isPending: false, isError: true }],
    ['missing user', { data: undefined, isPending: false, isError: false }],
  ])('does not request or render tasks while current user is %s', (_state, authState) => {
    mockUseCurrentUser.mockReturnValue(authState);
    const { Wrapper } = createWrapper();

    render(<TaskWorkspace />, { wrapper: Wrapper });

    expect(listSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('All Tasks')).not.toBeInTheDocument();
    expect(screen.queryByText(/TASK-/)).not.toBeInTheDocument();
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
});
