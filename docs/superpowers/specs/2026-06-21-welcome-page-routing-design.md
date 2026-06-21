# Design Spec: Welcome to Horizon Router Integration

This document outlines the changes to replace the default Vite template page with the Horizon welcome page by integrating `@tanstack/react-router` and `@tanstack/react-query`.

## Requirements

1. Remove the default Vite home page structure from `App.tsx` (the counter, logos, and external links).
2. Wire up `@tanstack/react-router` so that the index route (`/`) defined in `routes/index.tsx` is rendered.
3. Wire up `@tanstack/react-query`'s `QueryClientProvider` to ensure server state management is globally available.
4. Update the test suite (`App.test.tsx`) to match the new welcome screen.

## Proposed Changes

### 1. `client/src/App.tsx`

Replace the default implementation with the Router and Query client providers.

```tsx
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'

// Initialize the QueryClient for server state management
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
})

// Initialize the TanStack Router
const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
```

### 2. `client/src/App.test.tsx`

We need to update the test to render the integrated routing structure. Since TanStack Router is asynchronous, we can either test the home page component directly or mock/render the router. The simplest robust option is to verify that the welcome message "Welcome to Horizon" is successfully rendered.

```tsx
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'

test('renders App and checks welcome heading', async () => {
  const queryClient = new QueryClient()
  const router = createRouter({ routeTree, context: { queryClient } })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  const heading = await screen.findByRole('heading', { name: /Welcome to Horizon/i, level: 1 })
  expect(heading).toBeInTheDocument()
})
```

## Self-Review Checklist

- **Placeholder scan**: None.
- **Internal consistency**: The architecture aligns exactly with `client/AGENTS.md` guidelines.
- **Scope check**: The scope is extremely focused on the setup of Router and Query Client providers.
- **Ambiguity check**: Clear distinction of where providers are configured vs. where the page itself is rendered (defined in `routes/index.tsx`).
