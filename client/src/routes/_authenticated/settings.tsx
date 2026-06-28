import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsPlaceholder,
});

function SettingsPlaceholder() {
  return (
    <div className="p-8">
      <h2 className="text-2xl font-semibold mb-4 text-foreground">Settings</h2>
      <p className="text-muted-foreground">Settings (Placeholder)</p>
    </div>
  );
}
