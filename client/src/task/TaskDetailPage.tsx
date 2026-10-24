import { ArrowLeft } from 'lucide-react';
import { parseTaskSelection } from './taskNavigation';
import { TaskDetailSurface } from './TaskDetailSurface';

interface TaskDetailPageProps {
  readonly rawId: string;
  readonly onBack: () => void;
  readonly onDeleted: () => void;
}

export function TaskDetailPage({
  rawId,
  onBack,
  onDeleted,
}: TaskDetailPageProps): React.JSX.Element {
  const selection = parseTaskSelection(rawId);
  const taskId = selection.kind === 'valid' ? selection.id : null;

  return (
    <div className="mx-auto w-full max-w-[740px] px-6 py-9 sm:px-8">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to Tasks
      </button>
      <TaskDetailSurface taskId={taskId} surface="page" onDeleted={onDeleted} />
    </div>
  );
}
