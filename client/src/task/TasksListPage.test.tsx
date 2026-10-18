import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import { TasksListPage } from './TasksListPage';
import { TasksRouteLayout } from './TasksRouteLayout';
import type { TaskDetail, TaskListResponse, TaskSummary } from './types';

vi.mock('@/user/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    data: { id: 1, email: 'user@example.com' },
    isPending: false,
    isError: false,
  }),
}));

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

const response = (items: TaskSummary[]) => ({ data: { items } });
const detailResponse = (id: number): AxiosResponse<TaskDetail> =>
  ({
    data: {
      id,
      key: `TASK-${id}`,
      title: `Task ${id}`,
      priority: null,
      dueDate: null,
      inbox: false,
      completedAt: null,
      archivedAt: null,
      createdAt: '2026-10-18T10:00:00Z',
      updatedAt: '2026-10-18T10:00:00Z',
      description: null,
      deletedAt: null,
    },
  }) as AxiosResponse<TaskDetail>;

function renderTasks(initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const tasksRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/tasks',
    component: TasksRouteLayout,
  });
  const tasksIndexRoute = createRoute({
    getParentRoute: () => tasksRoute,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => ({
      task:
        typeof search.task === 'string' || typeof search.task === 'number'
          ? search.task
          : undefined,
    }),
    component: TasksListPage,
  });
  const routeTree = rootRoute.addChildren([tasksRoute.addChildren([tasksIndexRoute])]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  render(<RouterProvider router={router} />, { wrapper: Wrapper });
  return { router };
}

describe('TasksListPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pushes the first selection, replaces task switches, and supports Back and Forward', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(
      response([task(1, 'First task'), task(2, 'Second task')]) as AxiosResponse<TaskListResponse>
    );
    vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    const { router } = renderTasks('/tasks');

    fireEvent.click(await screen.findByRole('button', { name: 'Open TASK-1: First task' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 1 }));
    expect(router.state.location.state.horizonTaskNavigation).toEqual({
      kind: 'panel-from-list',
      taskId: 1,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open TASK-2: Second task' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 2 }));
    expect(router.state.location.state.horizonTaskNavigation).toEqual({
      kind: 'panel-from-list',
      taskId: 2,
    });

    await act(async () => router.history.back());
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    await act(async () => router.history.forward());
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 2 }));
    expect(screen.getByRole('button', { name: 'Open TASK-2: Second task' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('keeps a direct panel URL untrusted and avoids detail requests for malformed selection', async () => {
    const listSpy = vi
      .spyOn(taskApi, 'list')
      .mockResolvedValue(response([task(1, 'First task')]) as never);
    const detailSpy = vi.spyOn(taskApi, 'get');
    const { router } = renderTasks('/tasks?task=not-a-number');

    expect(await screen.findByRole('button', { name: 'Open TASK-1: First task' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(router.state.location.state.horizonTaskNavigation).toBeUndefined();
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(detailSpy).not.toHaveBeenCalled();
  });
});
