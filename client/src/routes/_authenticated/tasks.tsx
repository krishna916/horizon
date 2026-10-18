import { createFileRoute } from '@tanstack/react-router';
import { TasksRouteLayout } from '@/task/TasksRouteLayout';

export const Route = createFileRoute('/_authenticated/tasks')({
  component: TasksRouteLayout,
});
