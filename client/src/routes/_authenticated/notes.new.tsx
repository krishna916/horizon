import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/notes/new')({
  component: NoteNewRoute,
});

function NoteNewRoute() {
  return null;
}
