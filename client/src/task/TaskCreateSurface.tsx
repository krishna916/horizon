import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskPanelShell } from './TaskPanelShell';
import { TaskCreateForm } from './TaskCreateForm';
import type { TaskDetail } from './types';

interface TaskCreateSurfaceProps {
  readonly userId: number;
  readonly onCreated: (task: TaskDetail) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onCancel: () => void;
  readonly onDismiss: () => void;
}

export function TaskCreateSurface({
  userId,
  onCreated,
  onDirtyChange,
  onCancel,
  onDismiss,
}: TaskCreateSurfaceProps): React.JSX.Element {
  return (
    <TaskPanelShell ariaLabel="Create task">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <h2 className="text-sm font-medium text-foreground">Create task</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close create task"
          onClick={onDismiss}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        <TaskCreateForm
          userId={userId}
          onCreated={onCreated}
          onDirtyChange={onDirtyChange}
          onCancel={onCancel}
        />
      </div>
    </TaskPanelShell>
  );
}
