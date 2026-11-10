import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/notes/$id')({
  component: NoteDetailRoute,
});

function NoteDetailRoute() {
  return null;
}
