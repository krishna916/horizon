import { useBlocker, useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TaskWorkspace } from './TaskWorkspace';
import { parseTaskSelection } from './taskNavigation';
import { useTasksLayout } from './TasksRouteLayout';
import type { TaskDetail } from './types';

export function TasksListPage() {
  const location = useLocation();
  const search = new URLSearchParams(location.searchStr.replace(/^\?/, ''));
  const rawTaskId = search.get('task');
  const selection = parseTaskSelection(rawTaskId ?? undefined, search.get('create') === 'true');
  const navigate = useNavigate({ from: '/tasks/' });
  const router = useRouter();
  const { listRatio, setListRatio } = useTasksLayout();
  const currentMarker = router.state.location.state.horizonTaskNavigation;
  const [isCreationDirty, setIsCreationDirty] = useState(false);
  const skipBlocker = useRef(false);
  const hasTrustedListOrigin =
    selection.kind === 'valid' &&
    currentMarker?.kind === 'panel-from-list' &&
    currentMarker.taskId === selection.id;
  const hasTrustedCreateOrigin =
    selection.kind === 'create' && currentMarker?.kind === 'creation-from-list';
  const blocker = useBlocker({
    shouldBlockFn: () => isCreationDirty && !skipBlocker.current,
    enableBeforeUnload: isCreationDirty,
    withResolver: true,
  });

  async function navigateWithoutGuard(action: () => void | Promise<unknown>) {
    skipBlocker.current = true;
    try {
      await action();
    } finally {
      skipBlocker.current = false;
    }
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
    if (hasTrustedCreateOrigin && !isCreationDirty) {
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
    setIsCreationDirty(false);
    void navigateWithoutGuard(async () => closeCreate());
  }

  function completeCreate(task: TaskDetail) {
    const marker = hasTrustedCreateOrigin
      ? { kind: 'panel-from-list' as const, taskId: task.id }
      : undefined;
    setIsCreationDirty(false);
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
        onCreationDirtyChange={(dirty) => setIsCreationDirty(dirty)}
        onCancelCreate={cancelCreate}
        onCreated={completeCreate}
        listRatio={listRatio}
        onListRatioChange={setListRatio}
      />
      {blocker.status === 'blocked' && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/45 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="task-create-discard-title"
            aria-describedby="task-create-discard-description"
            className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-xl"
          >
            <h2 id="task-create-discard-title" className="text-base font-semibold text-foreground">
              Discard draft?
            </h2>
            <p id="task-create-discard-description" className="mt-2 text-sm text-muted-foreground">
              Your task draft has unsaved changes.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => blocker.reset()}>
                Keep editing
              </Button>
              <Button type="button" variant="destructive" onClick={() => blocker.proceed()}>
                Discard draft
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
