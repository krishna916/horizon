import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback, useEffect } from 'react';
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
import { useTaskDraftGuard } from './TaskDraftNavigationGuard';
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

let registerProbeDraft: (() => void) | undefined;
let replaceProbeDraft: (() => void) | undefined;

function DraftGuardProbe() {
  const guard = useTaskDraftGuard();
  const register = useCallback(
    (pending: boolean, save: () => Promise<boolean>) =>
      guard?.register({
        id: 'field:probe:1:title',
        kind: 'field',
        dirty: true,
        pending,
        save,
        discard: () => undefined,
      }),
    [guard]
  );
  useEffect(() => {
    function save(): Promise<boolean> {
      register(true, save);
      return new Promise<boolean>((resolve) => (probeSaveResolver = resolve));
    }
    registerProbeDraft = () => register(false, save);
    replaceProbeDraft = () => {
      guard?.clear('field:probe:1:title');
      register(false, save);
    };
    return () => {
      registerProbeDraft = undefined;
      replaceProbeDraft = undefined;
    };
  }, [guard, register]);
  return null;
}

let probeSaveResolver: ((saved: boolean) => void) | undefined;

function renderTasks(initialEntry: string, probe = false) {
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
      create: search.create === true || search.create === 'true' ? true : undefined,
    }),
    component: () => (
      <>
        <TasksListPage />
        {probe && <DraftGuardProbe />}
      </>
    ),
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

  it('pushes URL-backed creation from the list and supports Back and Forward', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    const { router } = renderTasks('/tasks');

    fireEvent.click(await screen.findByRole('button', { name: 'Add a task to Active…' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ create: true }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' }));

    await act(async () => router.history.back());
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    await act(async () => router.history.forward());
    await waitFor(() => expect(router.state.location.search).toEqual({ create: true }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  });

  it('opens a direct create URL and gives a valid task selection precedence', async () => {
    const getSpy = vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    const { router } = renderTasks('/tasks?task=1&create=true');

    expect(await screen.findByRole('button', { name: 'Open TASK-1: First task' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(1));
    expect(screen.queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument();
    expect(router.state.location.search).toEqual({ task: 1, create: true });
  });

  it('guards dirty X dismissal and resumes the original destination after Discard draft', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    const { router } = renderTasks('/tasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a task to Active…' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ create: true }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Unsaved draft' } });

    fireEvent.click(screen.getByRole('button', { name: 'Close create task' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(router.state.location.search).toEqual({ create: true });
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Unsaved draft');

    fireEvent.click(screen.getByRole('button', { name: 'Close create task' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard draft' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(screen.queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument();
  });

  it('blocks task navigation during a create POST and restores the dirty guard after failure', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(
      response([task(1, 'First task'), task(2, 'Second task')]) as never
    );
    let rejectCreate!: (error: Error) => void;
    let resolveRetry!: (response: AxiosResponse<TaskDetail>) => void;
    const createSpy = vi
      .spyOn(taskApi, 'create')
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectCreate = reject)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveRetry = resolve)));
    vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    const { router } = renderTasks('/tasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a task to Active…' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ create: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Pending task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(taskApi.create).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('button', { name: 'Open TASK-2: Second task' }));
    const pendingDialog = await screen.findByRole('alertdialog');
    expect(pendingDialog).toHaveTextContent('Creating task…');
    expect(pendingDialog).toHaveTextContent('Stay here');
    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument();
    expect(router.state.location.search).toEqual({ create: true });

    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await act(async () => rejectCreate(new Error('socket closed')));
    expect(await screen.findByRole('button', { name: 'Retry creation' })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ create: true });

    fireEvent.click(screen.getByRole('button', { name: 'Open TASK-2: Second task' }));
    expect(await screen.findByRole('button', { name: 'Discard draft' })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ create: true });

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry creation' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Open TASK-2: Second task' }));
    const retryDialog = await screen.findByRole('alertdialog');
    expect(retryDialog).toHaveTextContent('Creating task…');
    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    await act(async () => resolveRetry(detailResponse(41)));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 41 }));
    expect(await screen.findByRole('heading', { name: 'Task 41' })).toBeInTheDocument();
  });

  it('explicit Cancel discards immediately without showing the guard', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    const { router } = renderTasks('/tasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a task to Active…' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ create: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Discard this draft' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('direct create URLs have no trusted list origin and close back to the list', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    const { router } = renderTasks('/tasks?create=true');

    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Close create task' }));

    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(screen.queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument();
  });

  it('switches an open detail panel to creation by replacing its selection', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    const { router } = renderTasks('/tasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Open TASK-1: First task' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 1 }));
    const historyLength = router.history.length;

    fireEvent.click(screen.getByRole('button', { name: 'Add a task to Active…' }));

    await waitFor(() => expect(router.state.location.search).toEqual({ create: true }));
    expect(router.history.length).toBe(historyLength);
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  });

  it('discards a dirty draft and follows the selected task destination', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(
      response([task(1, 'First task'), task(2, 'Second task')]) as never
    );
    const getSpy = vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    const { router } = renderTasks('/tasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a task to Active…' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ create: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Unsaved draft' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open TASK-2: Second task' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard draft' }));

    await waitFor(() => expect(router.state.location.search).toEqual({ task: 2 }));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(2));
  });

  it('blocks a dirty field edit and saves it before following the selected task destination', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(
      response([task(1, 'First task'), task(2, 'Second task')]) as never
    );
    vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    const updateSpy = vi.spyOn(taskApi, 'update').mockImplementation(
      async (id, patch) =>
        ({
          data: { ...detailResponse(id).data, ...patch },
        }) as never
    );
    const { router } = renderTasks('/tasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Open TASK-1: First task' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 1 }));
    fireEvent.doubleClick(await screen.findByRole('button', { name: 'Task title: Task 1' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed first task' } });

    fireEvent.click(screen.getByRole('button', { name: 'Open TASK-2: Second task' }));

    await screen.findByRole('alertdialog');
    expect(screen.getByRole('group', { name: 'Draft actions' })).toHaveClass('flex-wrap');
    expect(router.state.location.search).toEqual({ task: 1 });
    expect(screen.getByLabelText('Title')).toHaveValue('Renamed first task');
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Discard and continue' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(1, { title: 'Renamed first task' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 2 }));
    expect(await screen.findByRole('button', { name: 'Open TASK-1: First task' })).toBeVisible();
  });

  it('discards a field draft or keeps editing without losing the original destination', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(
      response([task(1, 'First task'), task(2, 'Second task')]) as never
    );
    vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    const updateSpy = vi.spyOn(taskApi, 'update');
    const { router } = renderTasks('/tasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Open TASK-1: First task' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 1 }));
    fireEvent.doubleClick(await screen.findByRole('button', { name: 'Task title: Task 1' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Discard this title' } });

    fireEvent.click(screen.getByRole('button', { name: 'Open TASK-2: Second task' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(router.state.location.search).toEqual({ task: 1 });
    expect(screen.getByLabelText('Title')).toHaveValue('Discard this title');

    fireEvent.click(screen.getByRole('button', { name: 'Open TASK-2: Second task' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Discard and continue' }));

    await waitFor(() => expect(router.state.location.search).toEqual({ task: 2 }));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Open TASK-1: First task' })).toBeVisible();
  });

  it('keeps navigation blocked while a field save is pending', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(
      response([task(1, 'First task'), task(2, 'Second task')]) as never
    );
    vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    let resolveUpdate!: (value: AxiosResponse<TaskDetail>) => void;
    vi.spyOn(taskApi, 'update').mockImplementation(
      () => new Promise((resolve) => (resolveUpdate = resolve))
    );
    const { router } = renderTasks('/tasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Open TASK-1: First task' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 1 }));
    fireEvent.doubleClick(await screen.findByRole('button', { name: 'Task title: Task 1' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Saving title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open TASK-2: Second task' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and continue' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Saving field…');
    expect(router.state.location.search).toEqual({ task: 1 });
    expect(screen.queryByRole('button', { name: 'Save and continue' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    act(() => {
      void router.navigate({ to: '/tasks', search: { task: 2, create: undefined } });
    });
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Saving field…');
    await act(async () => resolveUpdate(detailResponse(1)));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 1 }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Open TASK-2: Second task' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 2 }));
  });

  it('does not clear a re-registered draft with the same ID when an old save settles', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    const { router } = renderTasks('/tasks', true);
    const taskButton = await screen.findByRole('button', { name: 'Open TASK-1: First task' });
    act(() => registerProbeDraft?.());
    fireEvent.click(taskButton);
    fireEvent.click(await screen.findByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Saving field…');

    act(() => replaceProbeDraft?.());
    await act(async () => probeSaveResolver?.(true));

    fireEvent.click(screen.getByRole('button', { name: 'Open TASK-1: First task' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Your task draft has unsaved changes.'
    );
    expect(router.state.location.search).toEqual({});
  });

  it('replaces the creation history entry with detail after success', async () => {
    const createSpy = vi.spyOn(taskApi, 'create').mockResolvedValue({
      data: {
        id: 10,
        key: 'TASK-10',
        title: 'Created from route',
        priority: null,
        dueDate: null,
        inbox: false,
        completedAt: null,
        archivedAt: null,
        createdAt: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z',
        description: null,
        deletedAt: null,
      },
    } as never);
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    const { router } = renderTasks('/tasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a task to Active…' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ create: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Created from route' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(router.state.location.search).toEqual({ task: 10 }));
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/i);
    await act(async () => router.history.back());
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });
});
