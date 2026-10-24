import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userApi } from '@/user/api';
import { useTasksLayout, TasksRouteLayout } from './TasksRouteLayout';

function RatioProbe() {
  const { listRatio, setListRatio } = useTasksLayout();
  return (
    <div>
      <span>List ratio: {listRatio}</span>
      <button onClick={() => setListRatio(67)}>Set list ratio</button>
    </div>
  );
}

function createTestRouter(initialEntry: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const tasksRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/tasks',
    component: TasksRouteLayout,
  });
  const tasksIndexRoute = createRoute({
    getParentRoute: () => tasksRoute,
    path: '/',
    component: RatioProbe,
  });
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notes',
    component: () => <p>Other workspace</p>,
  });
  const routeTree = rootRoute.addChildren([tasksRoute.addChildren([tasksIndexRoute]), otherRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  return router;
}

function renderRouter(router: ReturnType<typeof createTestRouter>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(userApi, 'getCurrentUser').mockResolvedValue({
    data: { id: 1, email: 'tasks@example.com' },
  } as never);
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('TasksRouteLayout', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['/tasks', '/tasks?task=123'])('renders its nested index at %s', async (entry) => {
    const router = createTestRouter(entry);
    renderRouter(router);

    expect(await screen.findByText('List ratio: 60')).toBeInTheDocument();
  });

  it('retains ratio across child rerenders and resets after leaving Tasks', async () => {
    const router = createTestRouter('/tasks');
    renderRouter(router);

    fireEvent.click(await screen.findByRole('button', { name: 'Set list ratio' }));
    expect(screen.getByText('List ratio: 67')).toBeInTheDocument();

    await act(async () => {
      await router.navigate({ to: '/notes' });
    });
    expect(await screen.findByText('Other workspace')).toBeInTheDocument();

    await act(async () => {
      await router.navigate({ to: '/tasks', search: { task: undefined, create: undefined } });
    });
    await waitFor(() => expect(screen.getByText('List ratio: 60')).toBeInTheDocument());
  });
});
