import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import type { AnyRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userApi } from '@/user/api';
import { taskApi } from './api';
import { useTaskLifecycle } from './TaskLifecycleProvider';
import { TaskCompletionProvider } from './TaskCompletionProvider';
import { TaskDraftNavigationGuard } from './TaskDraftNavigationGuard';
import { useTasksLayout, TasksRouteLayout } from './TasksRouteLayout';
import type { TaskDetail, TaskSummary } from './types';
import { useEffect, useState } from 'react';
import { TaskDetailView } from './TaskDetailView';

const lifecycleTask: TaskSummary = {
  id: 91,
  key: 'TASK-91',
  title: 'Lifecycle test task',
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-24T10:00:00Z',
  updatedAt: '2026-10-24T10:00:00Z',
};
const retryTask: TaskSummary = { ...lifecycleTask, id: 92, key: 'TASK-92' };
const descriptionTask: TaskDetail = {
  ...lifecycleTask,
  description: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original notes.' }] }],
  },
  deletedAt: null,
  checklist: [],
};

function DescriptionGuardProbe() {
  const navigate = useNavigate();
  return (
    <>
      <TaskCompletionProvider>
        <TaskDetailView task={descriptionTask} userId={1} />
      </TaskCompletionProvider>
      <button type="button" onClick={() => void navigate({ to: '/notes' })}>
        Open notes
      </button>
    </>
  );
}

function DescriptionGuardLayout() {
  return (
    <TaskDraftNavigationGuard>
      <Outlet />
    </TaskDraftNavigationGuard>
  );
}

function LifecycleProbe() {
  const lifecycle = useTaskLifecycle();
  const queryClient = useQueryClient();
  const [userLoaded, setUserLoaded] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [revalidationFinished, setRevalidationFinished] = useState(false);
  async function revalidate() {
    setVerifying(true);
    await queryClient.refetchQueries({ queryKey: ['me'], exact: true });
    setRevalidationFinished(true);
    setVerifying(false);
  }
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe(() => {
        setUserLoaded(Boolean(queryClient.getQueryData(['me'])));
      }),
    [queryClient]
  );
  return (
    <div>
      {verifying && <span>Verifying session…</span>}
      {revalidationFinished && <span>Revalidation finished</span>}
      <button
        disabled={!userLoaded}
        onClick={() => void lifecycle.run(1, lifecycleTask, 'archive')}
      >
        Archive test task
      </button>
      <button disabled={!userLoaded} onClick={() => void lifecycle.run(1, retryTask, 'delete')}>
        Create retry test notice
      </button>
      <button onClick={() => void revalidate()}>Revalidate session</button>
      <button onClick={() => void lifecycle.undo(lifecycle.notices[0]?.id ?? '')}>
        Try old Undo
      </button>
    </div>
  );
}

function RatioProbe() {
  const { listRatio, setListRatio } = useTasksLayout();
  return (
    <div>
      <span>List ratio: {listRatio}</span>
      <button onClick={() => setListRatio(67)}>Set list ratio</button>
    </div>
  );
}

function TaskViewProbe() {
  const { viewState, setViewState } = useTasksLayout();
  const navigate = useNavigate();
  const router = useRouter();
  return (
    <div>
      <output data-testid="task-view-state">{JSON.stringify(viewState)}</output>
      <output data-testid="route-location">Route: {router.state.location.pathname}</output>
      <button
        onClick={() =>
          setViewState({
            showCompletedHistory: true,
            showArchivedTasks: true,
            expanded: { Active: true, Completed: false, Archived: false },
            sortMode: 'priority-highest',
          })
        }
      >
        Set task view
      </button>
      <button
        onClick={() => void navigate({ to: '/tasks', search: { task: 123, create: undefined } })}
      >
        Open task panel
      </button>
      <button onClick={() => void navigate({ to: '/tasks/$id', params: { id: '123' } })}>
        Open full page
      </button>
      <button
        onClick={() =>
          void navigate({ to: '/tasks', search: { task: undefined, create: undefined } })
        }
      >
        Back to task list
      </button>
      <button onClick={() => void navigate({ to: '/notes' })}>Leave Tasks</button>
    </div>
  );
}

function OtherWorkspaceProbe() {
  const navigate = useNavigate();
  return (
    <>
      <p>Other workspace</p>
      <button
        onClick={() =>
          void navigate({ to: '/tasks', search: { task: undefined, create: undefined } })
        }
      >
        Return to Tasks
      </button>
    </>
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
    component: () => (
      <>
        <RatioProbe />
        <LifecycleProbe />
        <TaskViewProbe />
      </>
    ),
  });
  const taskPageRoute = createRoute({
    getParentRoute: () => tasksRoute,
    path: '$id',
    component: TaskViewProbe,
  });
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notes',
    component: OtherWorkspaceProbe,
  });
  const routeTree = rootRoute.addChildren([
    tasksRoute.addChildren([tasksIndexRoute, taskPageRoute]),
    otherRoute,
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  return router;
}

function createDescriptionRouter() {
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
    errorComponent: ({ error }) => <pre>{error.message}</pre>,
  });
  const tasksRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/tasks',
    component: DescriptionGuardLayout,
  });
  const detailRoute = createRoute({
    getParentRoute: () => tasksRoute,
    path: '/',
    component: DescriptionGuardProbe,
  });
  const notesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notes',
    component: () => <p>Other workspace</p>,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([tasksRoute.addChildren([detailRoute]), notesRoute]),
    history: createMemoryHistory({ initialEntries: ['/tasks'] }),
  });
}

function renderRouter(router: AnyRouter, setupUserMock = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (setupUserMock && !vi.isMockFunction(userApi.getCurrentUser)) {
    vi.spyOn(userApi, 'getCurrentUser').mockResolvedValue({
      data: { id: 1, email: 'tasks@example.com' },
    } as never);
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('TasksRouteLayout', () => {
  afterEach(() => vi.restoreAllMocks());

  function mockLifecycleActions() {
    vi.spyOn(taskApi, 'archive').mockResolvedValue({
      data: {
        ...lifecycleTask,
        archivedAt: '2026-10-24T11:00:00Z',
        description: null,
        deletedAt: null,
        checklist: [],
      },
    } as never);
    return vi.spyOn(taskApi, 'softDelete').mockRejectedValue(new Error('network'));
  }

  it('sortModeDefaultsToNewest', async () => {
    renderRouter(createTestRouter('/tasks'));

    const state = await screen.findByTestId('task-view-state');
    expect(JSON.parse(state.textContent ?? '{}').sortMode).toBe('newest');
  });

  it('sortModeResetsAfterLeavingTasks', async () => {
    renderRouter(createTestRouter('/tasks'));
    fireEvent.click(await screen.findByRole('button', { name: 'Set task view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave Tasks' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Return to Tasks' }));

    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('task-view-state').textContent ?? '{}').sortMode).toBe(
        'newest'
      )
    );
  });

  it('registers the rich description with the existing navigation guard', async () => {
    const updateSpy = vi
      .spyOn(taskApi, 'update')
      .mockResolvedValue({ data: descriptionTask } as never);
    renderRouter(createDescriptionRouter());
    await screen.findByRole('heading', { name: 'Lifecycle test task' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit task description' }));
    const editor = await screen.findByLabelText('Task description editor');
    fireEvent.keyDown(editor, { key: 'a', ctrlKey: true });
    fireEvent.paste(editor, {
      clipboardData: {
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? 'Changed notes.' : ''),
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open notes' }));
    });

    const guard = await screen.findByRole('alertdialog');
    expect(guard).toHaveTextContent('Your task draft has unsaved changes.');
    expect(updateSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith(91, {
      description: expect.objectContaining({
        content: [
          expect.objectContaining({
            content: [expect.objectContaining({ text: 'Changed notes.' })],
          }),
        ],
      }),
    });
    expect(await screen.findByText('Other workspace')).toBeInTheDocument();
  });

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

  it('preserves visibility and collapse state across panel and full-page routes, then resets outside Tasks', async () => {
    const router = createTestRouter('/tasks');
    renderRouter(router);
    const defaults = {
      showCompletedHistory: false,
      showArchivedTasks: false,
      expanded: { Active: true, Completed: true, Archived: true },
      sortMode: 'newest',
    };

    expect(await screen.findByTestId('task-view-state')).toHaveTextContent(
      JSON.stringify(defaults)
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Archive test task' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set task view' }));
    const selectedView = {
      showCompletedHistory: true,
      showArchivedTasks: true,
      expanded: { Active: true, Completed: false, Archived: false },
      sortMode: 'priority-highest',
    };
    expect(screen.getByTestId('task-view-state')).toHaveTextContent(JSON.stringify(selectedView));

    fireEvent.click(screen.getByRole('button', { name: 'Open task panel' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 123 }));
    expect(screen.getByTestId('task-view-state')).toHaveTextContent(JSON.stringify(selectedView));

    fireEvent.click(screen.getByRole('button', { name: 'Open full page' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks/123'));
    expect(screen.getByTestId('route-location')).toHaveTextContent('Route: /tasks/123');
    expect(screen.getByTestId('task-view-state')).toHaveTextContent(JSON.stringify(selectedView));
    fireEvent.click(screen.getByRole('button', { name: 'Back to task list' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
    expect(screen.getByTestId('task-view-state')).toHaveTextContent(JSON.stringify(selectedView));

    await act(async () => router.navigate({ to: '/notes' }));
    expect(await screen.findByText('Other workspace')).toBeInTheDocument();
    await act(async () =>
      router.navigate({ to: '/tasks', search: { task: undefined, create: undefined } })
    );
    await waitFor(() =>
      expect(screen.getByTestId('task-view-state')).toHaveTextContent(JSON.stringify(defaults))
    );
  });

  it('resets visibility and collapse state when the authenticated account changes', async () => {
    const currentUserSpy = vi
      .spyOn(userApi, 'getCurrentUser')
      .mockResolvedValueOnce({ data: { id: 1, email: 'tasks@example.com' } } as never)
      .mockResolvedValueOnce({ data: { id: 2, email: 'other@example.com' } } as never);
    renderRouter(createTestRouter('/tasks'));

    await screen.findByTestId('task-view-state');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Archive test task' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set task view' }));
    expect(screen.getByTestId('task-view-state')).toHaveTextContent('"showCompletedHistory":true');
    expect(screen.getByTestId('task-view-state')).toHaveTextContent(
      '"sortMode":"priority-highest"'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Revalidate session' }));
    await waitFor(() => expect(currentUserSpy).toHaveBeenCalledTimes(2));

    await waitFor(() =>
      expect(screen.getByTestId('task-view-state')).toHaveTextContent(
        JSON.stringify({
          showCompletedHistory: false,
          showArchivedTasks: false,
          expanded: { Active: true, Completed: true, Archived: true },
          sortMode: 'newest',
        })
      )
    );
  });

  it('hides an existing notice during same-owner verification and restores it after success', async () => {
    let resolveRevalidation!: (value: { data: { id: number; email: string } }) => void;
    vi.spyOn(userApi, 'getCurrentUser')
      .mockResolvedValueOnce({ data: { id: 1, email: 'tasks@example.com' } } as never)
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveRevalidation = resolve)) as never
      );
    const deleteSpy = mockLifecycleActions();
    const restoreSpy = vi.spyOn(taskApi, 'restoreArchive');
    const router = createTestRouter('/tasks');
    renderRouter(router);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Archive test task' })).toBeEnabled()
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Archive test task' }));
    expect(await screen.findByText('TASK-91 archived')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create retry test notice' }));
    expect(await screen.findByText("Couldn't confirm moving TASK-92 to Trash")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revalidate session' }));
    await waitFor(() => expect(userApi.getCurrentUser).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Verifying session…')).toBeInTheDocument();
    expect(screen.queryByText('TASK-91 archived')).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't confirm moving TASK-92 to Trash")).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo TASK-91 archive' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry delete for TASK-92' })
    ).not.toBeInTheDocument();
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(restoreSpy).not.toHaveBeenCalled();

    await act(async () => resolveRevalidation({ data: { id: 1, email: 'tasks@example.com' } }));
    expect(await screen.findByText('TASK-91 archived')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry delete for TASK-92' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo TASK-91 archive' })).toBeInTheDocument();
  });

  it('clears old notices after account change or failed session verification', async () => {
    let resolveSwitch!: (value: { data: { id: number; email: string } }) => void;
    const currentUserSpy = vi
      .spyOn(userApi, 'getCurrentUser')
      .mockResolvedValueOnce({ data: { id: 1, email: 'tasks@example.com' } } as never)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSwitch = resolve)) as never)
      .mockResolvedValue({ data: { id: 2, email: 'other@example.com' } } as never);
    mockLifecycleActions();
    const router = createTestRouter('/tasks');
    renderRouter(router);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Archive test task' })).toBeEnabled()
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Archive test task' }));
    expect(await screen.findByText('TASK-91 archived')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create retry test notice' }));
    expect(await screen.findByText("Couldn't confirm moving TASK-92 to Trash")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revalidate session' }));
    await waitFor(() => expect(currentUserSpy).toHaveBeenCalledTimes(2));
    await act(async () => resolveSwitch({ data: { id: 2, email: 'other@example.com' } }));
    expect(screen.queryByText('TASK-91 archived')).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't confirm moving TASK-92 to Trash")).not.toBeInTheDocument();
    await act(async () => router.navigate({ to: '/notes' }));
    await act(async () =>
      router.navigate({ to: '/tasks', search: { task: undefined, create: undefined } })
    );
    expect(screen.queryByText('TASK-91 archived')).not.toBeInTheDocument();
  });

  it('clears old notices after failed verification and does not restore them on recovery', async () => {
    const currentUserSpy = vi
      .spyOn(userApi, 'getCurrentUser')
      .mockResolvedValueOnce({ data: { id: 1, email: 'tasks@example.com' } } as never)
      .mockRejectedValueOnce(new Error('session expired'))
      .mockResolvedValueOnce({ data: { id: 1, email: 'tasks@example.com' } } as never);
    mockLifecycleActions();
    renderRouter(createTestRouter('/tasks'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Archive test task' })).toBeEnabled()
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Archive test task' }));
    expect(await screen.findByText('TASK-91 archived')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create retry test notice' }));
    expect(await screen.findByText("Couldn't confirm moving TASK-92 to Trash")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revalidate session' }));
    await waitFor(() => expect(currentUserSpy).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText('TASK-91 archived')).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't confirm moving TASK-92 to Trash")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revalidate session' }));
    await waitFor(() => expect(currentUserSpy).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('List ratio: 60')).toBeInTheDocument();
    expect(screen.queryByText('TASK-91 archived')).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't confirm moving TASK-92 to Trash")).not.toBeInTheDocument();
  });
});
