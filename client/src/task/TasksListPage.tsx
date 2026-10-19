import { useBlocker, useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
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
  const creationDirty = useRef(false);
  const skipBlocker = useRef(false);
  const hasTrustedListOrigin =
    selection.kind === 'valid' &&
    currentMarker?.kind === 'panel-from-list' &&
    currentMarker.taskId === selection.id;
  const hasTrustedCreateOrigin =
    selection.kind === 'create' && currentMarker?.kind === 'creation-from-list';
  const blocker = useBlocker({
    shouldBlockFn: () => creationDirty.current && !skipBlocker.current,
    enableBeforeUnload: () => creationDirty.current,
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
    creationDirty.current = false;
    void navigateWithoutGuard(async () => closeCreate());
  }

  function completeCreate(task: TaskDetail) {
    const marker = hasTrustedCreateOrigin
      ? { kind: 'panel-from-list' as const, taskId: task.id }
      : undefined;
    creationDirty.current = false;
    void navigateWithoutGuard(() =>
      navigate({
        to: '/tasks',
        search: { task: task.id, create: undefined },
        state: { horizonTaskNavigation: marker },
        replace: true,
      })
    );
  }

  function discardAndProceed() {
    creationDirty.current = false;
    if (blocker.status === 'blocked') blocker.proceed();
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
        }}
        onCancelCreate={cancelCreate}
        onCreated={completeCreate}
        listRatio={listRatio}
        onListRatioChange={setListRatio}
      />
      <Dialog.Root open={blocker.status === 'blocked'}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/45" />
          <Dialog.Content
            role="alertdialog"
            aria-describedby="task-create-discard-description"
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              if (blocker.status === 'blocked') blocker.reset();
            }}
            className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-xl outline-none"
          >
            <Dialog.Title className="text-base font-semibold text-foreground">
              Discard draft?
            </Dialog.Title>
            <Dialog.Description
              id="task-create-discard-description"
              className="mt-2 text-sm text-muted-foreground"
            >
              Your task draft has unsaved changes.
            </Dialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => blocker.status === 'blocked' && blocker.reset()}
              >
                Keep editing
              </Button>
              <Button type="button" variant="destructive" onClick={discardAndProceed}>
                Discard draft
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
