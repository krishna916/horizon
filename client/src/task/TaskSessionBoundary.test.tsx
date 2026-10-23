import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import { TaskCompletionProvider } from './TaskCompletionProvider';
import { TaskWorkspace } from './TaskWorkspace';
import type { TaskDetail, TaskListResponse, TaskSummary } from './types';
import { userApi } from '@/user/api';
import type { CurrentUserResponse } from '@/user/types';

const response = <T,>(data: T) => ({ data }) as AxiosResponse<T>;

const task = (id: number, title: string): TaskSummary => ({
  id,
  key: `TASK-${id}`,
  title,
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-18T10:00:00Z',
  updatedAt: '2026-10-18T10:00:00Z',
});

const taskDetail = (id: number, title: string): TaskDetail => ({
  ...task(id, title),
  description: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }],
  },
  deletedAt: null,
  checklist: [],
});

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

  return Wrapper;
}

describe('TaskWorkspace session boundary', () => {
  afterEach(() => {
    cleanup();
    focusManager.setFocused(undefined);
    vi.restoreAllMocks();
  });

  it('hides cached tasks while revalidating a shared session changed in another tab', async () => {
    let resolveCurrentUser!: (result: AxiosResponse<CurrentUserResponse>) => void;
    let sharedSessionUserId = 1;
    const currentUserSpy = vi.spyOn(userApi, 'getCurrentUser');
    const taskListSpy = vi.spyOn(taskApi, 'list');
    const taskDetailSpy = vi.spyOn(taskApi, 'get').mockImplementation(async () => {
      if (sharedSessionUserId === 1) {
        return response(taskDetail(1, 'Account one private detail')) as AxiosResponse<TaskDetail>;
      }
      throw Object.assign(new Error('not found'), {
        isAxiosError: true,
        response: { status: 404 },
      });
    });
    currentUserSpy
      .mockResolvedValueOnce(response({ id: 1, email: 'user-1@example.com' }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCurrentUser = resolve;
          }) as Promise<AxiosResponse<CurrentUserResponse>>
      );
    taskListSpy.mockImplementation(
      async () =>
        response({
          items: [
            sharedSessionUserId === 1
              ? task(1, 'Account one private task')
              : task(2, 'Account two private task'),
          ],
        }) as AxiosResponse<TaskListResponse>
    );

    render(<TaskWorkspace selection={{ kind: 'valid', id: 1 }} />, { wrapper: createWrapper() });
    expect(await screen.findByText('Account one private task')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Account one private detail' })
    ).toBeInTheDocument();

    act(() => focusManager.setFocused(false));
    sharedSessionUserId = 2;
    expect(screen.getByText('Account one private task')).toBeInTheDocument();
    act(() => focusManager.setFocused(true));

    await waitFor(() => expect(currentUserSpy).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByText('Verifying session…')).toHaveLength(2);
    expect(screen.queryByText('Account one private task')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Account one private detail' })
    ).not.toBeInTheDocument();
    expect(taskListSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCurrentUser(response({ id: 2, email: 'user-2@example.com' }));
    });

    expect(await screen.findByText('Account two private task')).toBeInTheDocument();
    expect(screen.queryByText('Account one private task')).not.toBeInTheDocument();
    expect(taskListSpy).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('alert')).toHaveTextContent(/task is unavailable/i);
    expect(
      screen.queryByRole('heading', { name: 'Account one private detail' })
    ).not.toBeInTheDocument();
    expect(taskDetailSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps private tasks hidden and explains when shared-session verification fails', async () => {
    const currentUserSpy = vi.spyOn(userApi, 'getCurrentUser');
    const taskListSpy = vi.spyOn(taskApi, 'list');
    vi.spyOn(taskApi, 'get').mockResolvedValue(
      response(taskDetail(1, 'Account one private detail')) as AxiosResponse<TaskDetail>
    );
    currentUserSpy
      .mockResolvedValueOnce(response({ id: 1, email: 'user-1@example.com' }))
      .mockRejectedValueOnce(new Error('session expired'));
    taskListSpy.mockResolvedValue(
      response({ items: [task(1, 'Account one private task')] }) as AxiosResponse<TaskListResponse>
    );

    render(<TaskWorkspace selection={{ kind: 'valid', id: 1 }} />, { wrapper: createWrapper() });
    expect(await screen.findByText('Account one private task')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Account one private detail' })
    ).toBeInTheDocument();

    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));

    const alerts = await screen.findAllByRole('alert');
    expect(
      alerts.some((alert) => /couldn't verify your session/i.test(alert.textContent ?? ''))
    ).toBe(true);
    expect(screen.queryByText('Account one private task')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Account one private detail' })
    ).not.toBeInTheDocument();
    expect(taskListSpy).toHaveBeenCalledTimes(1);
  });
});
