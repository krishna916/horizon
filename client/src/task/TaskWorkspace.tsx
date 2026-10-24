import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useCurrentUser } from '@/user/hooks/useCurrentUser';
import { classifyTasks } from './task-view';
import { useLocalDay } from './useLocalDay';
import { TaskSection } from './TaskSection';
import { useTaskList } from './useTaskList';
import type { TaskSelection } from './taskNavigation';
import { TaskDetailSurface } from './TaskDetailSurface';
import { TaskSplitView } from './TaskSplitView';
import { TaskCreateSurface } from './TaskCreateSurface';
import { TaskPanelShell } from './TaskPanelShell';
import { Button } from '@/components/ui/button';
import type { TaskDetail } from './types';
import {
  useTaskCompletionReopenSnapshot,
  useTaskCompletionSnapshot,
} from './TaskCompletionProvider';

interface TaskWorkspaceProps {
  readonly selection?: TaskSelection;
  readonly onSelectTask?: (id: number) => void;
  readonly onOpenCreate?: () => void;
  readonly onClosePanel?: () => void;
  readonly onDeleted?: () => void;
  readonly onOpenFullPage?: (id: number) => void;
  readonly onCreationDirtyChange?: (dirty: boolean) => void;
  readonly onCreationSubmittingChange?: (pending: boolean) => void;
  readonly onCancelCreate?: () => void;
  readonly onCreated?: (task: TaskDetail) => void;
  readonly listRatio?: number;
  readonly onListRatioChange?: (ratio: number) => void;
}

export function TaskWorkspace({
  selection = { kind: 'none' },
  onSelectTask = () => {},
  onOpenCreate = () => {},
  onClosePanel,
  onDeleted,
  onOpenFullPage,
  onCreationDirtyChange = () => {},
  onCreationSubmittingChange = () => {},
  onCancelCreate = () => {},
  onCreated = () => {},
  listRatio = 60,
  onListRatioChange = () => {},
}: TaskWorkspaceProps = {}) {
  const currentUser = useCurrentUser();
  const userId = currentUser.isPending || currentUser.isError ? undefined : currentUser.data?.id;
  const verifiedUserId = useRef<number | undefined>(undefined);
  const taskQuery = useTaskList(userId);
  const now = useLocalDay();
  const [retention, setRetention] = useState<{
    ownerId: number | undefined;
    completionReopenRevisions: Map<number, number>;
  }>({ ownerId: undefined, completionReopenRevisions: new Map() });
  const completionSnapshot = useTaskCompletionSnapshot(userId ?? 0);
  const reopenRevisionSnapshot = useTaskCompletionReopenSnapshot(userId ?? 0);
  if (retention.ownerId !== userId) {
    setRetention({ ownerId: userId, completionReopenRevisions: new Map() });
  }
  const retainedCompletedIds = new Set(
    retention.ownerId === userId
      ? [...retention.completionReopenRevisions]
          .filter(([taskId, revision]) => revision === (reopenRevisionSnapshot.get(taskId) ?? 0))
          .map(([taskId]) => taskId)
      : []
  );

  useLayoutEffect(() => {
    if (currentUser.isError) {
      if (verifiedUserId.current !== undefined) {
        onCreationDirtyChange(false);
        onCreationSubmittingChange(false);
      }
      verifiedUserId.current = undefined;
      return;
    }

    if (currentUser.isPending || currentUser.isFetching || userId === undefined) return;

    if (verifiedUserId.current !== undefined && verifiedUserId.current !== userId) {
      onCreationDirtyChange(false);
      onCreationSubmittingChange(false);
    }
    verifiedUserId.current = userId;
  }, [
    currentUser.isError,
    currentUser.isFetching,
    currentUser.isPending,
    onCreationDirtyChange,
    onCreationSubmittingChange,
    userId,
  ]);

  const sections = taskQuery.data
    ? classifyTasks(taskQuery.data.items, now, retainedCompletedIds, completionSnapshot)
    : undefined;

  const onCompletionIntent = useCallback(
    (taskId: number, completed: boolean) => {
      setRetention((current) => {
        const completionReopenRevisions =
          current.ownerId === userId
            ? new Map(current.completionReopenRevisions)
            : new Map<number, number>();
        if (completed && sections?.active.some((task) => task.id === taskId)) {
          completionReopenRevisions.set(taskId, reopenRevisionSnapshot.get(taskId) ?? 0);
        }
        return { ownerId: userId, completionReopenRevisions };
      });
    },
    [reopenRevisionSnapshot, sections, userId]
  );
  const handleRowDeleted = useCallback(
    (taskId: number) => {
      if (selection.kind === 'valid' && selection.id === taskId) onDeleted?.();
    },
    [onDeleted, selection]
  );
  let workspaceContent;

  if (currentUser.isPending) {
    workspaceContent = (
      <output className="py-8 text-sm text-muted-foreground">Loading your Tasks workspace…</output>
    );
  } else if (currentUser.isFetching) {
    workspaceContent = (
      <output className="py-8 text-sm text-muted-foreground">Verifying session…</output>
    );
  } else if (currentUser.isError || !currentUser.data) {
    workspaceContent = (
      <div role="alert" className="flex flex-wrap items-center gap-3 py-8 text-sm">
        <p className="text-muted-foreground">
          We couldn&apos;t verify your session. Please try again.
        </p>
        <button
          type="button"
          onClick={() => void currentUser.refetch()}
          className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry
        </button>
      </div>
    );
  } else if (taskQuery.isPending) {
    workspaceContent = (
      <output className="py-8 text-sm text-muted-foreground">Loading tasks…</output>
    );
  } else if (taskQuery.isError) {
    workspaceContent = (
      <div role="alert" className="flex flex-wrap items-center gap-3 py-8 text-sm">
        <p className="text-muted-foreground">We couldn&apos;t load your tasks. Please try again.</p>
        <button
          type="button"
          onClick={() => void taskQuery.refetch()}
          className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry
        </button>
      </div>
    );
  } else if (sections) {
    workspaceContent = (
      <>
        <TaskSection
          title="Active"
          tasks={sections.active}
          now={now}
          userId={userId ?? 0}
          onCompletionIntent={onCompletionIntent}
          onOpen={onSelectTask}
          onDeleted={handleRowDeleted}
          selectedTaskId={selection.kind === 'valid' ? selection.id : null}
        />
        {sections.completed.length > 0 && (
          <TaskSection
            title="Completed"
            tasks={sections.completed}
            now={now}
            userId={userId ?? 0}
            onCompletionIntent={onCompletionIntent}
            onOpen={onSelectTask}
            onDeleted={handleRowDeleted}
            selectedTaskId={selection.kind === 'valid' ? selection.id : null}
          />
        )}
      </>
    );
  }

  const taskHeader = (
    <header className="mb-9 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1
          data-task-list-heading
          tabIndex={-1}
          className="!m-0 !text-5xl font-medium !leading-[1.15] !tracking-[-0.03em] text-foreground max-[1250px]:!text-[40px]"
        >
          All Tasks
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Stay organized and clear the path ahead.
        </p>
      </div>
      <Button type="button" onClick={onOpenCreate}>
        Add a task to Active…
      </Button>
    </header>
  );

  if (selection.kind !== 'none') {
    const taskPanel =
      selection.kind === 'create' ? (
        userId !== undefined ? (
          <>
            <div hidden={currentUser.isFetching}>
              <TaskCreateSurface
                key={userId}
                userId={userId}
                onCreated={onCreated}
                onDirtyChange={onCreationDirtyChange}
                onSubmittingChange={onCreationSubmittingChange}
                onCancel={onCancelCreate}
                onDismiss={onClosePanel ?? (() => {})}
              />
            </div>
            {currentUser.isFetching && (
              <TaskPanelShell ariaLabel="Create task">
                <div className="flex h-full items-center px-6">
                  <output className="text-sm text-muted-foreground">Verifying your session…</output>
                </div>
              </TaskPanelShell>
            )}
          </>
        ) : (
          <TaskPanelShell ariaLabel="Create task">
            <div className="flex h-full items-center px-6">
              <output className="text-sm text-muted-foreground">Verifying your session…</output>
            </div>
          </TaskPanelShell>
        )
      ) : (
        <TaskDetailSurface
          taskId={selection.kind === 'valid' ? selection.id : null}
          surface="panel"
          onClose={onClosePanel}
          onDeleted={onDeleted ?? onClosePanel}
          onCompletionIntent={onCompletionIntent}
          onOpenFullPage={
            selection.kind === 'valid' && onOpenFullPage
              ? () => onOpenFullPage(selection.id)
              : undefined
          }
        />
      );

    return (
      <TaskSplitView
        list={
          <div className="w-full px-6 py-9 sm:px-8">
            {taskHeader}
            {workspaceContent}
          </div>
        }
        detail={<div className="h-full min-h-[360px] py-9">{taskPanel}</div>}
        isOpen
        listRatio={listRatio}
        onListRatioChange={onListRatioChange}
        onCloseOverlay={onClosePanel}
        overlayLabel={selection.kind === 'create' ? 'Create task' : 'Task details'}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-9 sm:px-8">
      {taskHeader}
      {workspaceContent}
    </div>
  );
}
