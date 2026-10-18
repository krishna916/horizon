import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { TaskDetailPage } from '@/task/TaskDetailPage';
import { parseTaskSelection } from '@/task/taskNavigation';

export const Route = createFileRoute('/_authenticated/tasks/$id')({
  component: TaskDetailRoute,
});

function TaskDetailRoute() {
  const { id } = Route.useParams();
  const router = useRouter();
  const navigate = useNavigate({ from: '/tasks/$id' });
  const selection = parseTaskSelection(id);
  const trustedPanelOrigin =
    selection.kind === 'valid' &&
    router.state.location.state.horizonTaskNavigation?.kind === 'page-from-panel' &&
    router.state.location.state.horizonTaskNavigation.taskId === selection.id;

  function backToTasks() {
    if (trustedPanelOrigin) {
      router.history.back();
      return;
    }

    void navigate({
      to: '/tasks',
      search: { task: undefined },
      replace: true,
      state: { horizonTaskNavigation: undefined },
    });
  }

  return <TaskDetailPage rawId={id} onBack={backToTasks} />;
}
