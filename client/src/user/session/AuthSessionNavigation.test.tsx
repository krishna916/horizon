import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedSessionBoundary } from '@/app/layout/AuthenticatedSessionBoundary';
import { SessionOwnedTree } from '@/app/SessionOwnedTree';
import { userApi } from '../api';
import { AuthSessionProvider } from './AuthSessionProvider';
import { SESSION_MARKER_KEY } from './sessionMarker';
import { TaskDraftNavigationGuard, useTaskDraftGuard } from '@/task/TaskDraftNavigationGuard';

vi.mock('../api', () => ({ userApi: { getCurrentUser: vi.fn() } }));

function deferred<T>() {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}

function DirtyDraft() {
  const guard = useTaskDraftGuard();
  useEffect(() => {
    guard?.register({
      id: 'field:1:41:title',
      kind: 'field',
      dirty: true,
      pending: false,
      discard() {},
    });
  }, [guard]);
  return (
    <>
      <button>Unsaved task title</button>
    </>
  );
}

function RouteLocation() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return <output data-testid="route-location">{pathname}</output>;
}

describe('session loss with a dirty task draft', () => {
  it('releases the old draft blocker and reaches Login after confirmed 401', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValueOnce({
      data: { id: 1, email: 'one@example.com' },
    } as never);
    const unauthorized = deferred<never>();
    vi.mocked(userApi.getCurrentUser).mockReturnValueOnce(unauthorized.promise as never);

    const rootRoute = createRootRoute({
      component: () => (
        <>
          <RouteLocation />
          <Outlet />
        </>
      ),
    });
    const tasksRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/tasks',
      component: () => (
        <AuthenticatedSessionBoundary>
          <TaskDraftNavigationGuard>
            <DirtyDraft />
          </TaskDraftNavigationGuard>
        </AuthenticatedSessionBoundary>
      ),
    });
    const loginRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/login',
      component: () => <p>Login page</p>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([tasksRoute, loginRoute]),
      history: createMemoryHistory({ initialEntries: ['/tasks?task=41'] }),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>
          <SessionOwnedTree>
            <RouterProvider router={router} />
          </SessionOwnedTree>
        </AuthSessionProvider>
      </QueryClientProvider>
    );

    await screen.findByRole('button', { name: 'Unsaved task title' });
    act(() => {
      localStorage.setItem(SESSION_MARKER_KEY, 'logged-out');
      window.dispatchEvent(
        new StorageEvent('storage', { key: SESSION_MARKER_KEY, newValue: 'logged-out' })
      );
    });

    expect(screen.getByText(/verifying session/i)).toBeInTheDocument();
    expect(screen.getByTestId('private-content')).toHaveAttribute('inert');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await act(async () => unauthorized.reject({ response: { status: 401 } }));

    await waitFor(() => expect(screen.getByTestId('route-location')).toHaveTextContent('/login'));
    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
