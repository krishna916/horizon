import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { taskApi } from './api';
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
});

const response = (data: TaskDetail) => ({ data }) as AxiosResponse<TaskDetail>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
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
      () => new Promise((resolve) => (resolveDetail = resolve)) as Promise<AxiosResponse<TaskDetail>>
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
    expect(screen.queryByRole('button', { name: /archive|restore|delete|edit/i })).not.toBeInTheDocument();
  });

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
    render(<TaskDetailSurface taskId={0} surface="panel" onClose={onClose} />, { wrapper: Wrapper });

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
});
