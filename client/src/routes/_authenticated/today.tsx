import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/today')({
  component: TodayPlaceholder,
});

function TodayPlaceholder() {
  return (
    <div className="p-8">
      <h2 className="text-2xl font-semibold mb-4 text-foreground">Today</h2>
      <p className="text-muted-foreground">Today Workspace (Placeholder)</p>
    </div>
  );
}
