import { useBlocker, useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { TaskWorkspace } from './TaskWorkspace';
import { parseTaskSelection } from './taskNavigation';
import { useTasksLayout } from './TasksRouteLayout';
import type { TaskDetail } from './types';
import { cancelPendingLogoutNavigations } from '@/user/logoutNavigation';

export function TasksListPage() {
  const location = useLocation();
  const navigate = useNavigate({ from: '/tasks/' });
  const router = useRouter();
  const { listRatio, setListRatio } = useTasksLayout();
  const creationDirty = useRef(false);
  const creationSubmitting = useRef(false);
  const [isCreationSubmitting, setIsCreationSubmitting] = useState(false);
  const retainCreateDuringHistoryRestore = useRef(false);
  const skipBlocker = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () =>
      !skipBlocker.current && (creationSubmitting.current || creationDirty.current),
    enableBeforeUnload: () => creationSubmitting.current || creationDirty.current,
    withResolver: true,
  });

  const search = new URLSearchParams(location.searchStr.replace(/^\?/, ''));
  const rawTaskId = search.get('task');
  const locationSelection = parseTaskSelection(
    rawTaskId ?? undefined,
    search.get('create') === 'true'
  );
  const blockedCreateTraversal =
    blocker.status === 'blocked' &&
    creationSubmitting.current &&
    (blocker.action === 'BACK' || blocker.action === 'FORWARD') &&
    blocker.current !== undefined &&
    'create' in blocker.current.search &&
    blocker.current.search.create === true;
  const selection =
    retainCreateDuringHistoryRestore.current || blockedCreateTraversal
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
    if (retainCreateDuringHistoryRestore.current && locationSelection.kind === 'create') {
      retainCreateDuringHistoryRestore.current = false;
    }
  }, [locationSelection.kind]);

  function setCreationSubmitting(pending: boolean) {
    creationSubmitting.current = pending;
    setIsCreationSubmitting(pending);
    if (!pending && blocker.status === 'blocked') blocker.reset();
  }

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
    retainCreateDuringHistoryRestore.current = false;
    setIsCreationSubmitting(false);
    if (blocker.status === 'blocked') blocker.reset();
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
    retainCreateDuringHistoryRestore.current = false;
    if (blocker.status === 'blocked') blocker.proceed();
  }

  function keepEditing() {
    cancelPendingLogoutNavigations();
    if (blocker.status === 'blocked') {
      if (blocker.action === 'BACK' || blocker.action === 'FORWARD') {
        retainCreateDuringHistoryRestore.current = true;
      }
      blocker.reset();
    }
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
        onCreationSubmittingChange={setCreationSubmitting}
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
              keepEditing();
            }}
            className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-xl outline-none"
          >
            <Dialog.Title className="text-base font-semibold text-foreground">
              {isCreationSubmitting ? 'Creating task…' : 'Discard draft?'}
            </Dialog.Title>
            <Dialog.Description
              id="task-create-discard-description"
              className="mt-2 text-sm text-muted-foreground"
            >
              {isCreationSubmitting
                ? 'Your task is being saved. Stay here while the request finishes.'
                : 'Your task draft has unsaved changes.'}
            </Dialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              {isCreationSubmitting ? (
                <Button type="button" variant="outline" onClick={keepEditing}>
                  Stay here
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={keepEditing}>
                    Keep editing
                  </Button>
                  <Button type="button" variant="destructive" onClick={discardAndProceed}>
                    Discard draft
                  </Button>
                </>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
