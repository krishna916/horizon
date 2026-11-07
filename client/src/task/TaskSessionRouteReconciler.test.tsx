import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userApi } from '@/user/api';
import { SessionOwnedTree } from '@/app/SessionOwnedTree';
import { AuthSessionProvider, useAuthSession } from '@/user/session/AuthSessionProvider';
import { taskApi } from './api';
import { TaskDraftNavigationGuard, useTaskDraftGuard } from './TaskDraftNavigationGuard';
import type { TaskDetail } from './types';
import { TasksRouteReconciler } from './TaskSessionRouteReconciler';

vi.mock('@/user/api', () => ({ userApi: { getCurrentUser: vi.fn() } }));

function response<T>(data: T): AxiosResponse<T> {
  return { data } as AxiosResponse<T>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function SessionSwitch() {
  const { acceptLocalAuthentication } = useAuthSession();
  return (
    <button onClick={() => acceptLocalAuthentication({ id: 2, email: 'two@example.com' })}>
      Switch owner
    </button>
  );
}

function RouteProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  const draftGuard = useTaskDraftGuard();
  return (
    <>
      <p data-testid="location">
        {location.pathname}
        {location.searchStr}
      </p>
      <SessionSwitch />
      <button
        onClick={() =>
          draftGuard?.register({
            id: 'test-draft',
            kind: 'field',
            dirty: true,
            pending: false,
            discard: () => {},
          })
        }
      >
        Create dirty draft
      </button>
      <button
        onClick={() =>
          void navigate({ to: '/tasks', search: { task: undefined, create: undefined } })
        }
      >
        Go to task list
      </button>
    </>
  );
}

function renderRoute(initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const tasksRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/tasks',
    component: () => (
      <TaskDraftNavigationGuard>
        <TasksRouteReconciler />
        <Outlet />
      </TaskDraftNavigationGuard>
    ),
  });
  const tasksIndexRoute = createRoute({
    getParentRoute: () => tasksRoute,
    path: '/',
    component: RouteProbe,
  });
  const taskPageRoute = createRoute({
    getParentRoute: () => tasksRoute,
    path: '$id',
    component: RouteProbe,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([tasksRoute.addChildren([tasksIndexRoute, taskPageRoute])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <SessionOwnedTree>
          <RouterProvider router={router} />
        </SessionOwnedTree>
      </AuthSessionProvider>
    </QueryClientProvider>
  );
  return router;
}

describe('TasksRouteReconciler', () => {
  beforeEach(() => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as Awaited<ReturnType<typeof userApi.getCurrentUser>>);
  });

  afterEach(() => vi.restoreAllMocks());

  it('replaces a non-owned full-page task URL after a confirmed 404', async () => {
    vi.spyOn(taskApi, 'get').mockRejectedValue(
      Object.assign(new Error('not found'), {
        response: { status: 404 },
      })
    );
    const router = renderRoute('/tasks/41');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/tasks/41'));

    fireEvent.click(screen.getByRole('button', { name: 'Switch owner' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
    expect(router.state.location.search).toEqual({});
  });

  it('clears a non-owned task panel selection after a confirmed 404', async () => {
    vi.spyOn(taskApi, 'get').mockRejectedValue(
      Object.assign(new Error('not found'), {
        response: { status: 404 },
      })
    );
    const router = renderRoute('/tasks?task=41');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('task=41'));

    fireEvent.click(screen.getByRole('button', { name: 'Switch owner' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
    expect(router.state.location.search).toEqual({});
  });

  it('keeps the selected route when the new owner can access the task', async () => {
    vi.spyOn(taskApi, 'get').mockResolvedValue(response({ id: 41 } as TaskDetail));
    const router = renderRoute('/tasks/41');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/tasks/41'));

    fireEvent.click(screen.getByRole('button', { name: 'Switch owner' }));
    await waitFor(() => expect(taskApi.get).toHaveBeenCalledWith(41));

    expect(router.state.location.pathname).toBe('/tasks/41');
  });

  it('keeps the selected route after a server error', async () => {
    vi.spyOn(taskApi, 'get').mockRejectedValue(
      Object.assign(new Error('unavailable'), {
        response: { status: 503 },
      })
    );
    const router = renderRoute('/tasks/41');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/tasks/41'));

    fireEvent.click(screen.getByRole('button', { name: 'Switch owner' }));
    await waitFor(() => expect(taskApi.get).toHaveBeenCalledWith(41));

    expect(router.state.location.pathname).toBe('/tasks/41');
  });

  it('does not redirect after a 404 resolves for a task URL the user already left', async () => {
    const pending = deferred<AxiosResponse<TaskDetail>>();
    vi.spyOn(taskApi, 'get').mockReturnValue(pending.promise);
    const router = renderRoute('/tasks/41');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/tasks/41'));

    fireEvent.click(screen.getByRole('button', { name: 'Switch owner' }));
    await waitFor(() => expect(taskApi.get).toHaveBeenCalledWith(41));
    fireEvent.click(screen.getByRole('button', { name: 'Go to task list' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
    await act(async () => pending.reject({ response: { status: 404 } }));

    expect(router.state.location.pathname).toBe('/tasks');
  });

  it('clears an old draft blocker before the account-driven 404 fallback', async () => {
    vi.spyOn(taskApi, 'get').mockRejectedValue(
      Object.assign(new Error('not found'), { response: { status: 404 } })
    );
    const router = renderRoute('/tasks/41');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/tasks/41'));
    fireEvent.click(screen.getByRole('button', { name: 'Create dirty draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to task list' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Switch owner' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
