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
import { TaskCompletionProvider } from './TaskCompletionProvider';
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
const detailResponse = (id: number, completedAt: string | null = null): AxiosResponse<TaskDetail> =>
  ({
    data: {
      id,
      key: `TASK-${id}`,
      title: `Task ${id}`,
      priority: null,
      dueDate: null,
      inbox: false,
      completedAt,
      archivedAt: null,
      createdAt: '2026-10-18T10:00:00Z',
      updatedAt: '2026-10-18T10:00:00Z',
      description: null,
      deletedAt: null,
      checklist: [],
    },
  }) as unknown as AxiosResponse<TaskDetail>;

let registerProbeDraft: ((pending?: boolean) => void) | undefined;
let registerProbeChecklist: (() => void) | undefined;
let replaceProbeDraft: (() => void) | undefined;
let requestProbeAction:
  ((action: () => void, context?: { ownerId: number; taskId: number }) => void) | undefined;
let probeDiscard: (() => void) | undefined;
let clearProbeDraftAfterSave = false;

function DraftGuardProbe() {
  const guard = useTaskDraftGuard();
  const register = useCallback(
    (pending: boolean, save: () => Promise<boolean>, kind: 'field' | 'checklist' = 'field') =>
      guard?.register({
        id: kind === 'field' ? 'field:1:1:title' : 'checklist:1:1',
        kind,
        dirty: true,
        pending,
        save,
        discard: () => probeDiscard?.(),
      }),
    [guard]
  );
  useEffect(() => {
    let probeKind: 'field' | 'checklist' = 'field';
    function save(): Promise<boolean> {
      register(true, save, probeKind);
      return new Promise<boolean>((resolve) => {
        probeSaveResolver = (saved) => {
          if (saved && clearProbeDraftAfterSave) {
            guard?.clear(probeKind === 'field' ? 'field:1:1:title' : 'checklist:1:1');
          } else {
            register(false, save, probeKind);
          }
          resolve(saved);
        };
      });
    }
    registerProbeDraft = (pending = false) => {
      probeKind = 'field';
      register(pending, save, probeKind);
    };
    registerProbeChecklist = () => {
      probeKind = 'checklist';
      register(false, save, probeKind);
    };
    replaceProbeDraft = () => {
      guard?.clear('field:1:1:title');
      register(false, save);
    };
    requestProbeAction = (action, context) => guard?.requestAction(action, context);
    return () => {
      registerProbeDraft = undefined;
      registerProbeChecklist = undefined;
      replaceProbeDraft = undefined;
      requestProbeAction = undefined;
    };
  }, [guard, register]);
  return null;
}

let probeSaveResolver: ((saved: boolean) => void) | undefined;

function renderTasks(initialEntry: string, probe = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => (
      <TaskCompletionProvider>
        <Outlet />
      </TaskCompletionProvider>
    ),
  });
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
  const notesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notes',
    component: () => <p>Notes workspace</p>,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <p>Signed out</p>,
  });
  const routeTree = rootRoute.addChildren([
    tasksRoute.addChildren([tasksIndexRoute]),
    notesRoute,
    loginRoute,
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [initialEntry],
    }),
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  render(<RouterProvider router={router} />, { wrapper: Wrapper });
  return { router };
}

async function confirmRowDelete(taskId: number) {
  fireEvent.keyDown(
    await screen.findByRole('button', { name: `More actions for TASK-${taskId}` }),
    {
      key: 'Enter',
    }
  );
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Move to Trash' }));
}

describe('TasksListPage', () => {
  afterEach(() => {
    clearProbeDraftAfterSave = false;
    probeDiscard = undefined;
    vi.restoreAllMocks();
  });

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

  it('keeps same-task completion writes serialized across logout and reauthentication', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    let finishComplete!: (response: AxiosResponse<TaskDetail>) => void;
    let finishReopen!: (response: AxiosResponse<TaskDetail>) => void;
    const completeSpy = vi
      .spyOn(taskApi, 'complete')
      .mockImplementation(() => new Promise((resolve) => (finishComplete = resolve)));
    const reopenSpy = vi
      .spyOn(taskApi, 'reopen')
      .mockImplementation(() => new Promise((resolve) => (finishReopen = resolve)));
    const { router } = renderTasks('/tasks');

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete TASK-1' }));
    await waitFor(() => expect(completeSpy).toHaveBeenCalledTimes(1));
    await act(async () => router.navigate({ to: '/login' }));
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
    await act(async () =>
      router.navigate({ to: '/tasks', search: { task: undefined, create: undefined } })
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Reopen TASK-1' }));

    expect(reopenSpy).not.toHaveBeenCalled();
    await act(async () => finishComplete(detailResponse(1, '2026-10-22T10:00:00Z')));
    await waitFor(() => expect(reopenSpy).toHaveBeenCalledTimes(1));
    await act(async () => finishReopen(detailResponse(1)));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Complete TASK-1' })).toBeInTheDocument()
    );
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

  it('archiveTaskBWhileArchiveTaskAIsPendingIsNotDropped', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(
      response([task(1, 'First task'), task(2, 'Second task')]) as never
    );
    let resolveFirst!: (value: AxiosResponse<TaskDetail>) => void;
    let resolveSecond!: (value: AxiosResponse<TaskDetail>) => void;
    const archiveSpy = vi.spyOn(taskApi, 'archive').mockImplementation(
      (id) =>
        new Promise((resolve) => {
          if (id === 1) resolveFirst = resolve;
          else resolveSecond = resolve;
        })
    );
    renderTasks('/tasks');
    await screen.findByRole('button', { name: 'More actions for TASK-1' });

    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for TASK-1' }), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(archiveSpy).toHaveBeenCalledWith(1));

    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for TASK-2' }), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(archiveSpy).toHaveBeenCalledWith(2));
    expect(archiveSpy).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('Archiving task…')).toHaveLength(2);

    await act(async () =>
      resolveFirst({
        ...detailResponse(1),
        data: { ...detailResponse(1).data, archivedAt: '2026-10-24' },
      })
    );
    await act(async () =>
      resolveSecond({
        ...detailResponse(2),
        data: { ...detailResponse(2).data, archivedAt: '2026-10-24' },
      })
    );
  });

  it('queuedDirtyActionRunsExactlyOnceAfterSaveAndDoesNotBlockOtherTask', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(
      response([task(1, 'First task'), task(2, 'Second task')]) as never
    );
    vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
    let resolveSecond!: (value: AxiosResponse<TaskDetail>) => void;
    const archiveSpy = vi.spyOn(taskApi, 'archive').mockImplementation((id) =>
      id === 2
        ? new Promise((resolve) => (resolveSecond = resolve))
        : Promise.resolve({
            data: { ...detailResponse(1).data, archivedAt: '2026-10-24' },
          } as never)
    );
    const updateSpy = vi.spyOn(taskApi, 'update').mockImplementation(
      async (id, patch) =>
        ({
          data: { ...detailResponse(id).data, ...patch },
        }) as never
    );
    const { router } = renderTasks('/tasks?task=1');
    await screen.findByRole('button', { name: 'Task title: Task 1' });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Task title: Task 1' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Saved title' },
    });

    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for TASK-2' }), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(archiveSpy).toHaveBeenCalledWith(2));

    fireEvent.click(screen.getByRole('button', { name: 'Archive task' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(1, { title: 'Saved title' }));
    await waitFor(() => expect(archiveSpy).toHaveBeenCalledWith(1));
    expect(archiveSpy).toHaveBeenCalledTimes(2);

    await act(async () =>
      resolveSecond({
        ...detailResponse(2),
        data: { ...detailResponse(2).data, archivedAt: '2026-10-24' },
      })
    );
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 1 }));
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

  it('queues an explicit action behind the draft dialog and runs it after Save succeeds', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    renderTasks('/tasks', true);
    await screen.findByRole('button', { name: 'Open TASK-1: First task' });
    clearProbeDraftAfterSave = true;
    act(() => registerProbeDraft?.());
    const action = vi.fn();
    act(() => requestProbeAction?.(action));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(probeSaveResolver).toBeDefined());
    act(() => requestProbeAction?.(action));
    await act(async () => probeSaveResolver?.(true));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it('does not run a queued action when Save fails and cancels it when keeping editing', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    renderTasks('/tasks', true);
    await screen.findByRole('button', { name: 'Open TASK-1: First task' });
    act(() => registerProbeDraft?.());
    const action = vi.fn();
    act(() => requestProbeAction?.(action));

    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(probeSaveResolver).toBeDefined());
    await act(async () => probeSaveResolver?.(false));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('discards the registered draft before running the queued action', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    renderTasks('/tasks', true);
    await screen.findByRole('button', { name: 'Open TASK-1: First task' });
    const order: string[] = [];
    probeDiscard = () => order.push('discard');
    act(() => {
      registerProbeDraft?.();
      requestProbeAction?.(() => order.push('action'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard and continue' }));
    expect(order).toEqual(['discard', 'action']);
    probeDiscard = undefined;
  });

  it('uses the same Save and continue gate for a checklist draft', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    renderTasks('/tasks', true);
    await screen.findByRole('button', { name: 'Open TASK-1: First task' });
    act(() => registerProbeChecklist?.());
    const action = vi.fn();
    act(() => requestProbeAction?.(action));

    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(probeSaveResolver).toBeDefined());
    await act(async () => probeSaveResolver?.(true));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it('keeps an explicit action queued during a pending save and cancels it on Stay here', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    renderTasks('/tasks', true);
    await screen.findByRole('button', { name: 'Open TASK-1: First task' });
    act(() => registerProbeDraft?.(true));
    const action = vi.fn();
    act(() => requestProbeAction?.(action));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Saving field…');
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('drops a queued action when the guarded draft context is replaced', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    renderTasks('/tasks', true);
    await screen.findByRole('button', { name: 'Open TASK-1: First task' });
    act(() => registerProbeDraft?.());
    const action = vi.fn();
    act(() => requestProbeAction?.(action));

    act(() => replaceProbeDraft?.());
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not discard a draft for a different task when an action is requested', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'First task')]) as never);
    renderTasks('/tasks', true);
    await screen.findByRole('button', { name: 'Open TASK-1: First task' });
    act(() => registerProbeDraft?.());
    const action = vi.fn();

    act(() => requestProbeAction?.(action, { ownerId: 1, taskId: 2 }));

    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('saves a dirty title before archiving that same task from its detail header', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'Task 1')]) as never);
    vi.spyOn(taskApi, 'get').mockResolvedValue(detailResponse(1));
    const updatedTask = { ...detailResponse(1).data, title: 'Saved title' };
    const updateSpy = vi.spyOn(taskApi, 'update').mockResolvedValue({ data: updatedTask } as never);
    const archiveSpy = vi.spyOn(taskApi, 'archive').mockResolvedValue({
      data: { ...updatedTask, archivedAt: '2026-10-24T12:00:00Z' },
    } as never);
    renderTasks('/tasks?task=1');

    fireEvent.doubleClick(await screen.findByRole('button', { name: 'Task title: Task 1' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Saved title' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Archive task' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('unsaved changes');
    expect(archiveSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(1, { title: 'Saved title' }));
    await waitFor(() => expect(archiveSpy).toHaveBeenCalledWith(1));
    expect(await screen.findByRole('button', { name: 'Restore task' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Saved title' })).toBeInTheDocument();
  });

  it('replaces the panel selection with the Tasks list after confirmed soft-delete', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'Task 1')]) as never);
    vi.spyOn(taskApi, 'get').mockResolvedValue(detailResponse(1));
    const deleteSpy = vi
      .spyOn(taskApi, 'softDelete')
      .mockResolvedValue({ data: undefined } as never);
    const { router } = renderTasks('/tasks');

    fireEvent.click(await screen.findByRole('button', { name: 'Open TASK-1: Task 1' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 1 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Trash' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Move TASK-1 to Trash?');
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(1));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(router.state.location.pathname).toBe('/tasks');
    expect(screen.getByText('TASK-1 moved to Trash')).toBeInTheDocument();
    await act(async () => router.history.back());
    expect(router.state.location.pathname).toBe('/tasks');
  });

  it('deletingSelectedTaskFromRowClosesItsDetailSelection', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'Task 1')]) as never);
    vi.spyOn(taskApi, 'get').mockResolvedValue(detailResponse(1));
    const deleteSpy = vi
      .spyOn(taskApi, 'softDelete')
      .mockResolvedValue({ data: undefined } as never);
    const { router } = renderTasks('/tasks?task=1');

    await confirmRowDelete(1);

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(1));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(screen.queryByRole('region', { name: 'Task details' })).not.toBeInTheDocument();
  });

  it('deletingDifferentRowKeepsCurrentDetailOpen', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(
      response([task(1, 'Task 1'), task(2, 'Task 2')]) as never
    );
    vi.spyOn(taskApi, 'get').mockResolvedValue(detailResponse(1));
    const deleteSpy = vi
      .spyOn(taskApi, 'softDelete')
      .mockResolvedValue({ data: undefined } as never);
    const { router } = renderTasks('/tasks?task=1');

    await confirmRowDelete(2);

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(2));
    expect(router.state.location.search).toEqual({ task: 1 });
    expect(screen.getByRole('heading', { name: 'Task 1' })).toBeInTheDocument();
  });

  it('keeps the selected detail open when row deletion is cancelled or fails', async () => {
    vi.spyOn(taskApi, 'list').mockResolvedValue(response([task(1, 'Task 1')]) as never);
    vi.spyOn(taskApi, 'get').mockResolvedValue(detailResponse(1));
    const deleteSpy = vi.spyOn(taskApi, 'softDelete').mockRejectedValue(new Error('network'));
    const { router } = renderTasks('/tasks?task=1');

    fireEvent.keyDown(await screen.findByRole('button', { name: 'More actions for TASK-1' }), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Trash' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(router.state.location.search).toEqual({ task: 1 });
    expect(deleteSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for TASK-1' }), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Trash' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Trash' }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(1));
    expect(router.state.location.search).toEqual({ task: 1 });
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

  it.each(['task switch', 'panel close', 'sidebar route'] as const)(
    'continues the original %s destination once after a deferred field save',
    async (destination) => {
      vi.spyOn(taskApi, 'list').mockResolvedValue(
        response([task(1, 'First task'), task(2, 'Second task')]) as never
      );
      vi.spyOn(taskApi, 'get').mockImplementation(async (id) => detailResponse(id));
      let resolveUpdate!: () => void;
      const updateSpy = vi.spyOn(taskApi, 'update').mockImplementation(
        (id, patch) =>
          new Promise((resolve) => {
            resolveUpdate = () =>
              resolve({
                ...detailResponse(id),
                data: { ...detailResponse(id).data, ...patch },
              });
          })
      );
      const { router } = renderTasks('/tasks?task=1');
      const initialHistoryLength = router.history.length;
      fireEvent.doubleClick(await screen.findByRole('button', { name: 'Task title: Task 1' }));
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Saved title' } });

      if (destination === 'task switch') {
        fireEvent.click(await screen.findByRole('button', { name: 'Open TASK-2: Second task' }));
      } else if (destination === 'panel close') {
        fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));
      } else if (destination === 'sidebar route') {
        act(() => {
          void router.navigate({ to: '/notes' });
        });
      }

      fireEvent.click(await screen.findByRole('button', { name: 'Save and continue' }));
      expect(await screen.findByRole('alertdialog')).toHaveTextContent('Saving field…');
      expect(updateSpy).toHaveBeenCalledTimes(1);
      await act(async () => resolveUpdate());

      if (destination === 'task switch') {
        await waitFor(() => expect(router.state.location.search).toEqual({ task: 2 }));
      } else if (destination === 'panel close') {
        await waitFor(() => expect(router.state.location.search).toEqual({}));
      } else {
        await waitFor(() => expect(router.state.location.pathname).toBe('/notes'));
      }
      expect(router.history.length).toBe(
        initialHistoryLength + (destination === 'sidebar route' ? 1 : 0)
      );
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(updateSpy).toHaveBeenCalledTimes(1);
    }
  );

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
        checklist: [],
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
