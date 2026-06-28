import type { ReactNode } from 'react';

interface AppContentProps {
  children: ReactNode;
}

export function AppContent({ children }: AppContentProps) {
  return <main className="flex-1 overflow-y-auto bg-background">{children}</main>;
}
