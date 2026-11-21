import { Archive, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { Dialog, DropdownMenu } from 'radix-ui';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useNoteLifecycle } from './NoteLifecycleProvider';
import type { NoteLifecycleOperation, NoteLifecycleTarget } from './types';

interface NoteLifecycleActionsProps {
  readonly target: NoteLifecycleTarget;
  readonly placement: 'card' | 'list' | 'editor';
  readonly label: string;
  readonly onExecute?: (
    operation: NoteLifecycleOperation,
    target: NoteLifecycleTarget
  ) => Promise<void>;
}

export function NoteLifecycleActions({
  target,
  placement,
  label,
  onExecute,
}: NoteLifecycleActionsProps) {
  const lifecycle = useNoteLifecycle();
  const { ownerId } = lifecycle;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [localPending, setLocalPending] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const state = lifecycle.stateFor(ownerId, target.id);
  const archived = target.archivedAt !== null;
  const operation = archived ? 'restore' : 'archive';
  const disabled = state.pending || localPending;

  function captureFocusDestination() {
    const row = triggerRef.current?.closest<HTMLElement>('[data-note-row]');
    const following = row?.nextElementSibling?.querySelector<HTMLElement>('a, button');
    const preceding = row?.previousElementSibling?.querySelector<HTMLElement>('a, button');
    const collectionControl = document.querySelector<HTMLElement>(
      '[data-note-collection-controls] button'
    );
    return following ?? preceding ?? collectionControl;
  }

  function focusAfterRemoval(destination: HTMLElement | null) {
    if (destination) requestAnimationFrame(() => destination.isConnected && destination.focus());
  }

  async function execute(action: NoteLifecycleOperation) {
    if (disabled) return;
    const focusDestination = onExecute ? null : captureFocusDestination();
    setLocalPending(true);
    try {
      if (onExecute) await onExecute(action, target);
      else if (await lifecycle.run(ownerId, target, action)) focusAfterRemoval(focusDestination);
    } finally {
      setLocalPending(false);
    }
  }

  async function confirmDelete() {
    if (disabled) return;
    const focusDestination = onExecute ? null : captureFocusDestination();
    setLocalPending(true);
    try {
      if (onExecute) {
        await onExecute('delete', target);
        setDeleteOpen(false);
      } else if (await lifecycle.run(ownerId, target, 'delete')) {
        setDeleteOpen(false);
        focusAfterRemoval(focusDestination);
      }
    } finally {
      setLocalPending(false);
    }
  }

  const actions = (
    <>
      {placement === 'editor' ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => void execute(operation)}
          >
            {archived ? (
              <RotateCcw aria-hidden="true" className="mr-2 size-4" />
            ) : (
              <Archive aria-hidden="true" className="mr-2 size-4" />
            )}
            {archived ? 'Restore from Archive' : 'Archive'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 aria-hidden="true" className="mr-2 size-4" />
            Move to Trash
          </Button>
        </div>
      ) : (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              ref={triggerRef}
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`More actions for ${label}`}
              disabled={disabled}
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
                onSelect={() => void execute(operation)}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-muted"
              >
                {archived ? 'Restore' : 'Archive'}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => setDeleteOpen(true)}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-destructive outline-none focus:bg-muted"
              >
                Move to Trash
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}

      {(disabled || state.error) && (
        <output className="sr-only" aria-live="polite">
          {disabled ? 'Saving note action…' : null}
        </output>
      )}
      {state.error && (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <p>{state.error}</p>
          {!onExecute && (
            <Button type="button" variant="outline" size="sm" onClick={state.retry}>
              Retry
            </Button>
          )}
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
              Move {label} to Trash?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              You can restore this note from the Undo message after it is moved to Trash.
            </Dialog.Description>
            {state.error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {state.error}
              </p>
            )}
            {disabled && (
              <output className="mt-3 block text-sm text-muted-foreground">
                Moving note to Trash…
              </output>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => setDeleteOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={disabled}
                onClick={() => void confirmDelete()}
              >
                {disabled ? 'Moving…' : 'Move to Trash'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );

  return placement === 'card' ? (
    <div className="absolute right-2 top-2 z-10">{actions}</div>
  ) : (
    <div className="flex shrink-0 flex-col items-end gap-1">{actions}</div>
  );
}
