import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/notes')({
  component: NotesPlaceholder,
});

function NotesPlaceholder() {
  return (
    <div className="p-8">
      <h2 className="text-2xl font-semibold mb-4 text-foreground">Notes</h2>
      <p className="text-muted-foreground">Notes (Placeholder)</p>
    </div>
  );
}
