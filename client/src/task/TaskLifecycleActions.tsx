import { Archive, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { Dialog, DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTaskDraftGuard } from './TaskDraftNavigationGuard';
import { useTaskLifecycle } from './TaskLifecycleProvider';
import type { TaskSummary } from './types';

interface TaskLifecycleActionsProps {
  readonly task: TaskSummary;
  readonly userId: number;
  readonly placement: 'row' | 'header';
  readonly onDeleted?: () => void;
}

export function TaskLifecycleActions({
  task,
  userId,
  placement,
  onDeleted,
}: TaskLifecycleActionsProps) {
  const lifecycle = useTaskLifecycle();
  const draftGuard = useTaskDraftGuard();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const state = lifecycle.stateFor(userId, task.id);
  const archived = task.archivedAt !== null;
  const operation = archived ? 'restore' : 'archive';
  const actionContext = { ownerId: userId, taskId: task.id };

  function requestLifecycleAction() {
    if (draftGuard) {
      draftGuard.requestAction(async () => {
        await lifecycle.run(userId, task, operation);
      }, actionContext);
    } else {
      void lifecycle.run(userId, task, operation);
    }
  }

  function requestDelete() {
    if (draftGuard) draftGuard.requestAction(() => setDeleteOpen(true), actionContext);
    else setDeleteOpen(true);
  }

  async function confirmDelete() {
    const deleted = await lifecycle.run(userId, task, 'delete');
    if (deleted) {
      setDeleteOpen(false);
      onDeleted?.();
    }
  }

  const archiveButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={archived ? 'Restore task' : 'Archive task'}
      disabled={state.pending}
      onClick={requestLifecycleAction}
      className="shrink-0"
    >
      {archived ? (
        <RotateCcw aria-hidden="true" className="size-4" />
      ) : (
        <Archive aria-hidden="true" className="size-4" />
      )}
    </Button>
  );

  const deleteButton = (
    <Button
      type="button"
      variant="ghost"
      size={placement === 'header' ? 'icon' : 'sm'}
      aria-label={placement === 'header' ? 'Move to Trash' : undefined}
      disabled={state.pending}
      onClick={requestDelete}
      className="shrink-0"
    >
      {placement === 'header' ? (
        <Trash2 aria-hidden="true" className="size-4" />
      ) : (
        <span>Move to Trash</span>
      )}
    </Button>
  );

  return (
    <>
      {placement === 'row' ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`More actions for ${task.key}`}
              disabled={state.pending}
              className="size-8 shrink-0"
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-40 rounded-md border border-border bg-background p-1 text-sm text-foreground shadow-md"
            >
              <DropdownMenu.Item
                onSelect={requestLifecycleAction}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-muted"
              >
                {archived ? 'Restore' : 'Archive'}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={requestDelete}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-destructive outline-none focus:bg-muted"
              >
                Move to Trash
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          {archiveButton}
          {deleteButton}
        </div>
      )}

      {(state.pending || state.error) && (
        <div className="sr-only" aria-live="polite">
          {state.pending ? (operation === 'archive' ? 'Archiving task…' : 'Restoring task…') : null}
        </div>
      )}
      {state.error && (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <p>{state.error}</p>
          <Button type="button" variant="outline" size="sm" onClick={state.retry}>
            Retry
          </Button>
        </div>
      )}

      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/45" />
          <Dialog.Content
            role="alertdialog"
            className="fixed left-1/2 top-1/2 z-[111] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-xl outline-none"
          >
            <Dialog.Title className="text-base font-semibold text-foreground">
              Move {task.key} to Trash?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              You can restore this task from the Undo message after it is moved to Trash.
            </Dialog.Description>
            {state.error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {state.error}
              </p>
            )}
            {state.pending && (
              <output className="mt-3 block text-sm text-muted-foreground">
                Moving task to Trash…
              </output>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={state.pending}
                onClick={() => void confirmDelete()}
              >
                {state.pending ? 'Moving…' : 'Move to Trash'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
