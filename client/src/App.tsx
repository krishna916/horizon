import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import { ThemeProvider } from '@/components/theme-provider';
import { AuthSessionProvider } from '@/user/session/AuthSessionProvider';
import { SessionOwnedTree } from '@/app/SessionOwnedTree';

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
          <SessionOwnedTree>
            <RouterProvider router={router} />
          </SessionOwnedTree>
        </AuthSessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
