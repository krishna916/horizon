import { createFileRoute } from '@tanstack/react-router';
import { NotesRoute } from '@/note/NotesRoute';

export const Route = createFileRoute('/_authenticated/notes')({
  component: NotesRoute,
});
