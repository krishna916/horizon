import { createFileRoute } from '@tanstack/react-router';
import { TasksListPage } from '@/task/TasksListPage';

export const Route = createFileRoute('/_authenticated/tasks/')({
  validateSearch: (search: Record<string, unknown>) => ({
    task:
      typeof search.task === 'string' || typeof search.task === 'number' ? search.task : undefined,
  }),
  component: TasksListPage,
});
