import type { ReactNode } from 'react';

interface TaskPanelShellProps {
  readonly children: ReactNode;
}

export function TaskPanelShell({ children }: TaskPanelShellProps) {
  return (
    <section
      aria-label="Task details"
      className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border bg-background"
    >
      {children}
    </section>
  );
}
