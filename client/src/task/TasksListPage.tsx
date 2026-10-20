import { useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { TaskWorkspace } from './TaskWorkspace';
import { parseTaskSelection } from './taskNavigation';
import { useTasksLayout } from './TasksRouteLayout';
import type { TaskDetail } from './types';
import { useTaskDraftGuard } from './TaskDraftNavigationGuard';

export function TasksListPage() {
  const location = useLocation();
  const navigate = useNavigate({ from: '/tasks/' });
  const router = useRouter();
  const { listRatio, setListRatio } = useTasksLayout();
  const creationDirty = useRef(false);
  const creationSubmitting = useRef(false);
  const [retainCreateDuringHistoryRestore, setRetainCreateDuringHistoryRestore] = useState(false);
  const draftGuard = useTaskDraftGuard();

  const search = new URLSearchParams(location.searchStr.replace(/^\?/, ''));
  const rawTaskId = search.get('task');
  const locationSelection = parseTaskSelection(
    rawTaskId ?? undefined,
    search.get('create') === 'true'
  );
  const blockedCreateTraversal = draftGuard?.blockedCreateTraversal ?? false;
  const selection =
    retainCreateDuringHistoryRestore || blockedCreateTraversal
      ? ({ kind: 'create' } as const)
      : locationSelection;
  const currentMarker = router.state.location.state.horizonTaskNavigation;
  const hasTrustedListOrigin =
    selection.kind === 'valid' &&
    currentMarker?.kind === 'panel-from-list' &&
    currentMarker.taskId === selection.id;
  const hasTrustedCreateOrigin =
    selection.kind === 'create' && currentMarker?.kind === 'creation-from-list';

  useEffect(() => {
    if (retainCreateDuringHistoryRestore && locationSelection.kind === 'create') {
      const restoreTimer = window.setTimeout(() => {
        setRetainCreateDuringHistoryRestore(false);
      }, 0);
      return () => window.clearTimeout(restoreTimer);
    }
  }, [locationSelection.kind, retainCreateDuringHistoryRestore]);

  function setCreationSubmitting(pending: boolean) {
    creationSubmitting.current = pending;
    draftGuard?.register({
      id: 'task-create',
      kind: 'create',
      dirty: creationDirty.current,
      pending,
      discard: () => {},
    });
  }

  async function navigateWithoutGuard(action: () => void | Promise<unknown>) {
    await (draftGuard?.bypass(action) ?? action());
  }

  function selectTask(taskId: number) {
    const creationFromList = selection.kind === 'create' && hasTrustedCreateOrigin;
    const marker =
      selection.kind === 'none'
        ? { kind: 'panel-from-list' as const, taskId }
        : hasTrustedListOrigin || creationFromList
          ? { kind: 'panel-from-list' as const, taskId }
          : undefined;

    void navigate({
      to: '/tasks',
      search: { task: taskId, create: undefined },
      state: { horizonTaskNavigation: marker },
      replace: selection.kind !== 'none',
    });
  }

  function openCreate() {
    if (selection.kind === 'create') return;
    const hasListOrigin = selection.kind === 'none' || hasTrustedListOrigin;
    void navigate({
      to: '/tasks',
      search: { task: undefined, create: true },
      state: {
        horizonTaskNavigation: hasListOrigin ? { kind: 'creation-from-list' as const } : undefined,
      },
      replace: selection.kind !== 'none',
    });
  }

  function closeCreate() {
    if (hasTrustedCreateOrigin && !creationDirty.current) {
      router.history.back();
      return;
    }
    void navigate({
      to: '/tasks',
      search: { task: undefined, create: undefined },
      state: { horizonTaskNavigation: undefined },
      replace: true,
    });
  }

  function closePanel() {
    if (selection.kind === 'create') {
      closeCreate();
      return;
    }
    if (hasTrustedListOrigin) {
      router.history.back();
      return;
    }

    void navigate({
      to: '/tasks',
      search: { task: undefined, create: undefined },
      state: { horizonTaskNavigation: undefined },
      replace: true,
    });
  }

  function openFullPage(taskId: number) {
    void navigate({
      to: '/tasks/$id',
      params: { id: String(taskId) },
      state: { horizonTaskNavigation: { kind: 'page-from-panel', taskId } },
    });
  }

  function cancelCreate() {
    if (creationSubmitting.current) return;
    creationDirty.current = false;
    void navigateWithoutGuard(async () => closeCreate());
  }

  function completeCreate(task: TaskDetail) {
    const marker = hasTrustedCreateOrigin
      ? { kind: 'panel-from-list' as const, taskId: task.id }
      : undefined;
    creationDirty.current = false;
    creationSubmitting.current = false;
    setRetainCreateDuringHistoryRestore(false);
    draftGuard?.register(null);
    draftGuard?.reset();
    void navigateWithoutGuard(() =>
      navigate({
        to: '/tasks',
        search: { task: task.id, create: undefined },
        state: { horizonTaskNavigation: marker },
        replace: true,
      })
    );
  }

  return (
    <>
      <TaskWorkspace
        selection={selection}
        onSelectTask={selectTask}
        onOpenCreate={openCreate}
        onClosePanel={closePanel}
        onOpenFullPage={openFullPage}
        onCreationDirtyChange={(dirty) => {
          creationDirty.current = dirty;
          draftGuard?.register({
            id: 'task-create',
            kind: 'create',
            dirty,
            pending: creationSubmitting.current,
            discard: () => {
              creationDirty.current = false;
            },
          });
        }}
        onCreationSubmittingChange={setCreationSubmitting}
        onCancelCreate={cancelCreate}
        onCreated={completeCreate}
        listRatio={listRatio}
        onListRatioChange={setListRatio}
      />
    </>
  );
}
