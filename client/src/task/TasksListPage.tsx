import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { TaskWorkspace } from './TaskWorkspace';
import { parseTaskSelection } from './taskNavigation';
import { useTasksLayout } from './TasksRouteLayout';

export function TasksListPage() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const selection = parseTaskSelection(search.task);
  const navigate = useNavigate({ from: '/tasks/' });
  const router = useRouter();
  const { listRatio, setListRatio } = useTasksLayout();
  const currentMarker = router.state.location.state.horizonTaskNavigation;
  const hasTrustedListOrigin =
    selection.kind === 'valid' &&
    currentMarker?.kind === 'panel-from-list' &&
    currentMarker.taskId === selection.id;

  function selectTask(taskId: number) {
    const marker =
      selection.kind === 'none'
        ? { kind: 'panel-from-list' as const, taskId }
        : hasTrustedListOrigin
          ? { kind: 'panel-from-list' as const, taskId }
          : undefined;

    void navigate({
      to: '/tasks',
      search: { task: String(taskId) },
      state: { horizonTaskNavigation: marker },
      replace: selection.kind !== 'none',
    });
  }

  function closePanel() {
    if (hasTrustedListOrigin) {
      router.history.back();
      return;
    }

    void navigate({
      to: '/tasks',
      search: { task: undefined },
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

  return (
    <TaskWorkspace
      selection={selection}
      onSelectTask={selectTask}
      onClosePanel={closePanel}
      onOpenFullPage={openFullPage}
      listRatio={listRatio}
      onListRatioChange={setListRatio}
    />
  );
}
