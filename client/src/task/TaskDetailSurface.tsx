import { ExternalLink, X } from 'lucide-react';
import { isAxiosError } from 'axios';
import type { JSX } from 'react';
import { useCurrentUser } from '@/user/hooks/useCurrentUser';
import { TaskDetailView } from './TaskDetailView';
import { TaskPanelShell } from './TaskPanelShell';
import { useTaskDetail } from './useTaskDetail';

interface TaskDetailSurfaceProps {
  readonly taskId: number | null;
  readonly surface: 'panel' | 'page';
  readonly onClose?: () => void;
  readonly onOpenFullPage?: () => void;
  readonly onCompletionIntent?: (taskId: number, completed: boolean) => void;
}

export function TaskDetailSurface({
  taskId,
  surface,
  onClose,
  onOpenFullPage,
  onCompletionIntent,
}: TaskDetailSurfaceProps): JSX.Element {
  const currentUser = useCurrentUser();
  const userId = currentUser.isPending || currentUser.isError ? undefined : currentUser.data?.id;
  const taskQuery = useTaskDetail(userId, taskId);
  const validTaskId = taskId !== null && Number.isSafeInteger(taskId) && taskId > 0;
  const cachedDetailView =
    validTaskId && currentUser.data && taskQuery.data && taskQuery.data.deletedAt === null ? (
      <TaskDetailView
        key={`${currentUser.data.id}:${taskQuery.data.id}`}
        task={taskQuery.data}
        userId={currentUser.data.id}
        onCompletionIntent={surface === 'panel' ? onCompletionIntent : undefined}
      />
    ) : null;

  let content: JSX.Element;
  let taskKey: string | undefined;
  if (currentUser.isPending) {
    content = <output className="text-sm text-muted-foreground">Loading task details…</output>;
  } else if (currentUser.isFetching) {
    content = (
      <div>
        <div hidden>{cachedDetailView}</div>
        <output className="text-sm text-muted-foreground">Verifying session…</output>
      </div>
    );
  } else if (currentUser.isError || !currentUser.data) {
    content = (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <p className="text-muted-foreground">
          We couldn&apos;t verify your session. Please try again.
        </p>
        <button
          type="button"
          onClick={() => void currentUser.refetch()}
          className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry session
        </button>
      </div>
    );
  } else if (!validTaskId) {
    content = <UnavailableTask />;
  } else if (taskQuery.isPending) {
    content = <output className="text-sm text-muted-foreground">Loading task details…</output>;
  } else if (taskQuery.isError) {
    if (isAxiosError(taskQuery.error) && taskQuery.error.response?.status === 404) {
      content = <UnavailableTask />;
    } else {
      content = (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p className="text-muted-foreground">
            We couldn&apos;t load this task. Please try again.
          </p>
          <button
            type="button"
            onClick={() => void taskQuery.refetch()}
            className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry task details
          </button>
        </div>
      );
    }
  } else if (!taskQuery.data || taskQuery.data.deletedAt !== null) {
    content = <UnavailableTask />;
  } else {
    taskKey = taskQuery.data.key;
    content = (
      <div>
        <div>{cachedDetailView ?? <UnavailableTask />}</div>
      </div>
    );
  }

  if (surface === 'page') {
    return (
      <div className="min-h-0">
        <div className="border-b border-border px-6 py-4 text-sm font-medium text-muted-foreground">
          {taskKey ?? 'Task details'}
        </div>
        <div className="overflow-y-auto">{content}</div>
      </div>
    );
  }

  return (
    <TaskPanelShell>
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <p className="min-w-0 truncate text-sm font-medium text-muted-foreground">
          {taskKey ?? 'Task details'}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {onOpenFullPage && (
            <button
              type="button"
              aria-label="Open full page"
              onClick={onOpenFullPage}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLink aria-hidden="true" className="size-4" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              aria-label="Close task details"
              onClick={onClose}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
    </TaskPanelShell>
  );
}

function UnavailableTask() {
  return (
    <p role="alert" className="px-6 py-7 text-sm text-muted-foreground">
      This task is unavailable.
    </p>
  );
}
