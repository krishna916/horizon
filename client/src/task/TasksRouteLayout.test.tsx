import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
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

describe('TasksRouteLayout', () => {
  it.each(['/tasks', '/tasks?task=123'])('renders its nested index at %s', async (entry) => {
    const router = createTestRouter(entry);
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('List ratio: 60')).toBeInTheDocument();
  });

  it('retains ratio across child rerenders and resets after leaving Tasks', async () => {
    const router = createTestRouter('/tasks');
    render(<RouterProvider router={router} />);

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
