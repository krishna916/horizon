import { useCurrentUser } from '@/user/hooks/useCurrentUser';
import { classifyTasks } from './task-view';
import { useLocalDay } from './useLocalDay';
import { TaskSection } from './TaskSection';
import { useTaskList } from './useTaskList';

export function TaskWorkspace() {
  const currentUser = useCurrentUser();
  const userId = currentUser.isPending || currentUser.isError ? undefined : currentUser.data?.id;
  const taskQuery = useTaskList(userId);
  const now = useLocalDay();

  if (currentUser.isPending || currentUser.isFetching || currentUser.isError || !currentUser.data) {
    return null;
  }

  const sections = taskQuery.data ? classifyTasks(taskQuery.data.items, now) : undefined;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-9 sm:px-8">
      <header className="mb-9">
        <h1 className="text-5xl font-medium leading-[1.15] tracking-[-0.03em] text-foreground">
          All Tasks
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Stay organized and clear the path ahead.
        </p>
      </header>

      {taskQuery.isPending ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          Loading tasks…
        </p>
      ) : taskQuery.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 py-8 text-sm">
          <p className="text-muted-foreground">
            We couldn&apos;t load your tasks. Please try again.
          </p>
          <button
            type="button"
            onClick={() => void taskQuery.refetch()}
            className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      ) : sections ? (
        <>
          <TaskSection title="Active" tasks={sections.active} now={now} />
          {sections.completed.length > 0 && (
            <TaskSection title="Completed" tasks={sections.completed} now={now} />
          )}
        </>
      ) : null}
    </div>
  );
}
