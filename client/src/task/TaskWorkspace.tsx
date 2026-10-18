import { useCurrentUser } from '@/user/hooks/useCurrentUser';
import { classifyTasks } from './task-view';
import { useLocalDay } from './useLocalDay';
import { TaskSection } from './TaskSection';
import { useTaskList } from './useTaskList';
import type { TaskSelection } from './taskNavigation';
import { TaskDetailSurface } from './TaskDetailSurface';
import { TaskSplitView } from './TaskSplitView';

interface TaskWorkspaceProps {
  readonly selection?: TaskSelection;
  readonly onSelectTask?: (id: number) => void;
  readonly onClosePanel?: () => void;
  readonly onOpenFullPage?: (id: number) => void;
  readonly listRatio?: number;
  readonly onListRatioChange?: (ratio: number) => void;
}

export function TaskWorkspace({
  selection = { kind: 'none' },
  onSelectTask = () => {},
  onClosePanel,
  onOpenFullPage,
  listRatio = 60,
  onListRatioChange = () => {},
}: TaskWorkspaceProps = {}) {
  const currentUser = useCurrentUser();
  const userId = currentUser.isPending || currentUser.isError ? undefined : currentUser.data?.id;
  const taskQuery = useTaskList(userId);
  const now = useLocalDay();

  const sections = taskQuery.data ? classifyTasks(taskQuery.data.items, now) : undefined;
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
          onOpen={onSelectTask}
          selectedTaskId={selection.kind === 'valid' ? selection.id : null}
        />
        {sections.completed.length > 0 && (
          <TaskSection
            title="Completed"
            tasks={sections.completed}
            now={now}
            onOpen={onSelectTask}
            selectedTaskId={selection.kind === 'valid' ? selection.id : null}
          />
        )}
      </>
    );
  }

  const taskHeader = (
      <header className="mb-9">
        <h1 data-task-list-heading tabIndex={-1} className="!m-0 !text-5xl font-medium !leading-[1.15] !tracking-[-0.03em] text-foreground max-[1250px]:!text-[40px]">
          All Tasks
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Stay organized and clear the path ahead.
        </p>
      </header>
  );

  if (selection.kind !== 'none') {
    return (
      <TaskSplitView
        list={
          <div className="w-full px-6 py-9 sm:px-8">
            {taskHeader}
            {workspaceContent}
          </div>
        }
        detail={
          <div className="h-full min-h-[360px] py-9">
            <TaskDetailSurface
              taskId={selection.kind === 'valid' ? selection.id : null}
              surface="panel"
              onClose={onClosePanel}
              onOpenFullPage={
                selection.kind === 'valid' && onOpenFullPage
                  ? () => onOpenFullPage(selection.id)
                  : undefined
              }
            />
          </div>
        }
        isOpen
        listRatio={listRatio}
        onListRatioChange={onListRatioChange}
        onCloseOverlay={onClosePanel}
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
