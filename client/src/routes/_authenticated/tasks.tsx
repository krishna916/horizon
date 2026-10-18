import { createFileRoute } from '@tanstack/react-router';
import { TaskWorkspace } from '@/task/TaskWorkspace';

export const Route = createFileRoute('/_authenticated/tasks')({
  component: TaskWorkspace,
});
