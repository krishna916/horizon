import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { useRef } from 'react';

interface TaskOverlayProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly workspaceHost: HTMLElement;
}

export function TaskOverlay({
  open,
  onClose,
  children,
  workspaceHost,
}: TaskOverlayProps): React.JSX.Element {
  const openerRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal container={workspaceHost}>
        <Dialog.Overlay
          data-testid="task-overlay-backdrop"
          className="absolute inset-0 z-40 bg-black/45"
        />
        <Dialog.Content
          aria-label="Task details"
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            openerRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = openerRef.current;
            const fallback =
              document.querySelector<HTMLElement>('[data-task-list-heading]') ??
              document.querySelector<HTMLElement>('h1');
            const canRestoreToOpener = opener?.isConnected && opener !== document.body;
            (canRestoreToOpener ? opener : fallback)?.focus();
          }}
          className="absolute inset-y-0 right-0 z-50 flex h-full max-h-full w-[min(640px,100%)] max-w-full flex-col overflow-y-auto border-l border-border bg-background shadow-2xl outline-none"
        >
          <Dialog.Title className="sr-only">Task details</Dialog.Title>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
