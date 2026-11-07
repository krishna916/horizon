import { useAuthSession } from '@/user/session/AuthSessionProvider';
import { TaskCompletionProvider } from '@/task/TaskCompletionProvider';
import type { ReactNode } from 'react';

export function SessionOwnedTree({ children }: { readonly children: ReactNode }) {
  const { ownerRevision } = useAuthSession();
  return <TaskCompletionProvider key={ownerRevision}>{children}</TaskCompletionProvider>;
}
