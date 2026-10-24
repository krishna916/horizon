import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { taskApi } from './api';
import { TaskCompletionProvider } from './TaskCompletionProvider';
import { TaskDetailSurface } from './TaskDetailSurface';
import type { TaskDetail } from './types';

const { mockUseCurrentUser } = vi.hoisted(() => ({ mockUseCurrentUser: vi.fn() }));

vi.mock('@/user/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

const detail = (id: number, title: string): TaskDetail => ({
  id,
  key: `TASK-${id}`,
  title,
  priority: 'HIGH',
  dueDate: '2026-10-25',
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-18T10:00:00Z',
  updatedAt: '2026-10-18T10:00:00Z',
  description: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `${title} description` }] }],
  },
  deletedAt: null,
  checklist: [],
});

const response = (data: TaskDetail) => ({ data }) as AxiosResponse<TaskDetail>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
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
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  });
}

describe('TaskDetailSurface', () => {
  let getSpy: MockInstance<typeof taskApi.get>;

  beforeEach(() => {
    authenticateAs(1);
    getSpy = vi.spyOn(taskApi, 'get');
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows loading then server data and working panel navigation controls', async () => {
    let resolveDetail!: (value: AxiosResponse<TaskDetail>) => void;
    getSpy.mockImplementation(
      () =>
        new Promise((resolve) => (resolveDetail = resolve)) as Promise<AxiosResponse<TaskDetail>>
    );
    const onClose = vi.fn();
    const onOpenFullPage = vi.fn();
    const { Wrapper } = createWrapper();

    render(
      <TaskDetailSurface
        taskId={7}
        surface="panel"
        onClose={onClose}
        onOpenFullPage={onOpenFullPage}
      />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText('Loading task details…')).toBeInTheDocument();
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(7));
    resolveDetail(response(detail(7, 'Review the release notes')));

    expect(await screen.findByText('TASK-7')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review the release notes' })).toBeInTheDocument();
    expect(screen.getByText('Review the release notes description')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open full page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));
    expect(onOpenFullPage).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Task title: Review the release notes' })
    ).toBeVisible();
  });

  it.each(['panel', 'page'] as const)(
    'renders the same checklist in the %s detail surface',
    async (surface) => {
      getSpy.mockResolvedValue({
        data: {
          ...detail(7, 'Review the release notes'),
          checklist: [
            {
              id: 31,
              title: 'Call florist',
              dueDate: '2026-10-28',
              completedAt: null,
              position: 0,
            },
          ],
        },
      } as never);
      const { Wrapper } = createWrapper();
      render(<TaskDetailSurface taskId={7} surface={surface} />, { wrapper: Wrapper });

      expect(await screen.findByText('Call florist')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Set due date for Call florist' })
      ).toBeInTheDocument();
    }
  );

  it('shows the same generic unavailable state for 404 and never leaves the prior task visible', async () => {
    getSpy
      .mockResolvedValueOnce(response(detail(7, 'Private previous task')) as never)
      .mockRejectedValueOnce(
        Object.assign(new Error('not found'), {
          isAxiosError: true,
          response: { status: 404 },
        })
      );
    const { Wrapper } = createWrapper();
    const view = render(<TaskDetailSurface taskId={7} surface="panel" />, { wrapper: Wrapper });

    expect(await screen.findByText('Private previous task')).toBeInTheDocument();
    view.rerender(<TaskDetailSurface taskId={8} surface="panel" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/task is unavailable/i);
    expect(screen.queryByText('Private previous task')).not.toBeInTheDocument();
    expect(screen.queryByText('TASK-7')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Task title:/ })).not.toBeInTheDocument();
  });

  it('offers retry for transient errors and refetches the selected detail', async () => {
    getSpy
      .mockRejectedValueOnce(
        Object.assign(new Error('service unavailable'), {
          isAxiosError: true,
          response: { status: 503 },
        })
      )
      .mockResolvedValueOnce(response(detail(7, 'Recovered task')) as never);
    const { Wrapper } = createWrapper();
    render(<TaskDetailSurface taskId={7} surface="panel" />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'Retry task details' }));
    expect(await screen.findByText('Recovered task')).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it('does not fetch for invalid IDs and gives a working close action', () => {
    const onClose = vi.fn();
    const { Wrapper } = createWrapper();
    render(<TaskDetailSurface taskId={0} surface="panel" onClose={onClose} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/task is unavailable/i);
    fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('hides cached detail while the session is pending or invalid', async () => {
    getSpy.mockResolvedValue(response(detail(7, 'Cached private task')) as never);
    const { Wrapper } = createWrapper();
    const view = render(<TaskDetailSurface taskId={7} surface="panel" />, { wrapper: Wrapper });
    expect(await screen.findByText('Cached private task')).toBeInTheDocument();

    mockUseCurrentUser.mockReturnValue({
      data: undefined,
      isPending: false,
      isFetching: true,
      isError: false,
      refetch: vi.fn(),
    });
    view.rerender(<TaskDetailSurface taskId={7} surface="panel" />);

    expect(screen.getByText('Verifying session…')).toBeInTheDocument();
    expect(screen.queryByText('Cached private task')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Task title:/ })).not.toBeInTheDocument();
  });

  it('does not expose one user cache when the same task is selected under another account', async () => {
    getSpy
      .mockResolvedValueOnce(response(detail(7, 'Account one private task')) as never)
      .mockImplementationOnce(() => new Promise(() => {}) as Promise<AxiosResponse<TaskDetail>>);
    const { Wrapper } = createWrapper();
    const view = render(<TaskDetailSurface taskId={7} surface="panel" />, { wrapper: Wrapper });
    expect(await screen.findByText('Account one private task')).toBeInTheDocument();

    authenticateAs(2);
    view.rerender(<TaskDetailSurface taskId={7} surface="panel" />);

    expect(screen.getByText('Loading task details…')).toBeInTheDocument();
    expect(screen.queryByText('Account one private task')).not.toBeInTheDocument();
  });

  it.each(['panel', 'page'] as const)(
    'supports title, priority, and due-date editing in the %s surface',
    async (surface) => {
      getSpy.mockResolvedValue(response(detail(7, 'Review the release notes')) as never);
      const updateSpy = vi.spyOn(taskApi, 'update').mockImplementation(
        async (id, patch) =>
          ({
            data: { ...detail(id, 'Review the release notes'), ...patch },
          }) as never
      );
      const { Wrapper } = createWrapper();
      render(<TaskDetailSurface taskId={7} surface={surface} />, { wrapper: Wrapper });

      fireEvent.doubleClick(
        await screen.findByRole('button', { name: 'Task title: Review the release notes' })
      );
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Updated release notes' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByRole('button', { name: 'Task title: Updated release notes' });

      fireEvent.doubleClick(screen.getByRole('button', { name: 'Priority: High' }));
      fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'LOW' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByRole('button', { name: 'Priority: Low' });

      fireEvent.doubleClick(screen.getByRole('button', { name: /Due date:/ }));
      fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-27' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(3));
      expect(updateSpy).toHaveBeenNthCalledWith(1, 7, { title: 'Updated release notes' });
      expect(updateSpy).toHaveBeenNthCalledWith(2, 7, { priority: 'LOW' });
      expect(updateSpy).toHaveBeenNthCalledWith(3, 7, { dueDate: '2026-10-27' });
    }
  );

  it('edits completed and archived tasks and discards a draft when switching task identity', async () => {
    getSpy.mockImplementation(
      async (id) =>
        ({
          data: {
            ...detail(id, `Task ${id}`),
            completedAt: id === 7 ? '2026-10-19T10:00:00Z' : null,
            archivedAt: id === 7 ? '2026-10-19T11:00:00Z' : null,
          },
        }) as never
    );
    const updateSpy = vi
      .spyOn(taskApi, 'update')
      .mockResolvedValue({ data: detail(7, 'Task 7') } as never);
    const { Wrapper } = createWrapper();
    const view = render(<TaskDetailSurface taskId={7} surface="page" />, { wrapper: Wrapper });

    fireEvent.doubleClick(await screen.findByRole('button', { name: 'Task title: Task 7' }));
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Updated completed task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(7, { title: 'Updated completed task' })
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Task title: Task 7' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Old draft' } });
    view.rerender(<TaskDetailSurface taskId={8} surface="page" />);

    expect(await screen.findByRole('button', { name: 'Task title: Task 8' })).toBeVisible();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('preserves a dirty field draft while the current owner is being reverified', async () => {
    getSpy.mockResolvedValue(response(detail(7, 'Draft survives revalidation')) as never);
    const { Wrapper } = createWrapper();
    const view = render(<TaskDetailSurface taskId={7} surface="panel" />, { wrapper: Wrapper });
    fireEvent.doubleClick(
      await screen.findByRole('button', { name: 'Task title: Draft survives revalidation' })
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Unsaved same-owner draft' },
    });

    mockUseCurrentUser.mockReturnValue({
      data: { id: 1, email: 'user-1@example.com' },
      isPending: false,
      isFetching: true,
      isError: false,
      refetch: vi.fn(),
    });
    view.rerender(<TaskDetailSurface taskId={7} surface="panel" />);

    expect(screen.getByText('Verifying session…')).toBeVisible();
    expect(
      view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Title"]')?.value
    ).toBe('Unsaved same-owner draft');

    authenticateAs(1);
    view.rerender(<TaskDetailSurface taskId={7} surface="panel" />);
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Unsaved same-owner draft');
  });

  it('forwards completion intent from the panel and leaves the dedicated page unretained', async () => {
    getSpy.mockResolvedValue(response(detail(7, 'Panel completion')) as never);
    vi.spyOn(taskApi, 'complete').mockResolvedValue({
      data: { ...detail(7, 'Panel completion'), completedAt: '2026-10-22T10:00:00Z' },
    } as never);
    const onCompletionIntent = vi.fn();
    const { Wrapper } = createWrapper();
    const view = render(
      <TaskDetailSurface taskId={7} surface="panel" onCompletionIntent={onCompletionIntent} />,
      { wrapper: Wrapper }
    );

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete TASK-7' }));
    await waitFor(() => expect(onCompletionIntent).toHaveBeenCalledWith(7, true));
    view.rerender(
      <TaskDetailSurface taskId={7} surface="page" onCompletionIntent={onCompletionIntent} />
    );
    expect(await screen.findByRole('checkbox', { name: 'Reopen TASK-7' })).toBeInTheDocument();
  });
});
