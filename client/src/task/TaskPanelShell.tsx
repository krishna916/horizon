import type { ReactNode } from 'react';

interface TaskPanelShellProps {
  readonly children: ReactNode;
  readonly ariaLabel?: string;
}

export function TaskPanelShell({ children, ariaLabel = 'Task details' }: TaskPanelShellProps) {
  return (
    <section
      aria-label={ariaLabel}
      className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border bg-background"
    >
      {children}
    </section>
  );
}
