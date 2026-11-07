import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import { ThemeProvider } from '@/components/theme-provider';
import { TaskCompletionProvider } from '@/task/TaskCompletionProvider';
import { AuthSessionProvider, useAuthSession } from '@/user/session/AuthSessionProvider';
import type { ReactNode } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>
          <SessionOwnedTaskCompletionProvider>
            <RouterProvider router={router} />
          </SessionOwnedTaskCompletionProvider>
        </AuthSessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function SessionOwnedTaskCompletionProvider({ children }: { readonly children: ReactNode }) {
  const { ownerRevision } = useAuthSession();
  return <TaskCompletionProvider key={ownerRevision}>{children}</TaskCompletionProvider>;
}
