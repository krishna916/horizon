import { createFileRoute } from '@tanstack/react-router';
import { NotesWorkspacePage } from '@/note/NotesWorkspacePage';

export const Route = createFileRoute('/_authenticated/notes/')({
  component: NotesWorkspacePage,
});
