# Frontend Agent Guidelines (client/)

Vite-based single page application targeting **React 19** and **TailwindCSS v4**.

*Refer to the [Frontend Architecture Summary in ARCHITECTURE_OVERVIEW.md](file:///D:/projects/my-horizon/docs/ai/ARCHITECTURE_OVERVIEW.md#L310) for core frontend architecture standards.*

## Core Tech Stack & Libraries

- **Routing:** `TanStack Router` (via `@tanstack/react-router` and `@tanstack/router-plugin/vite`).
- **Data Fetching & Server State:** `TanStack Query` (`@tanstack/react-query`) with query cache as the single source of truth for server state.
- **HTTP Client:** `Axios` (all API requests flow through module-owned clients).
- **Forms & Validation:** `React Hook Form` and `Zod`.
- **Rich Text Editing:** `TipTap` (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`).
- **Styling:** `TailwindCSS v4` and `shadcn/ui` with `style: "radix-vega"`, `baseColor: "zinc"`.
- **React Compiler:** Enabled via `@rolldown/plugin-babel` + `reactCompilerPreset()`.

## Commands

Run these from the `client/` directory:

```bash
npm install
npm run dev                             # dev server on http://localhost:5173
npx @tanstack/router-cli generate       # generate routing tree manually (run if tsc fails)
npm run build                           # tsc -b && vite build
npm run lint                            # ESLint
```

## Conventions

- **Feature-Oriented Structure:** Mirrors backend domains (e.g., `features/task/`, `features/note/`). Each feature owns its components, routes, forms, API clients, types, and queries.
- **shadcn/ui Components:** Add via `npx shadcn@latest add <component>`. Do not modify files in `components/ui/` manually.
- **Utility:** Use `cn()` from `@/lib/utils` for conditional class composition. Use CVA for component variants.
- **Path Alias:** `@/` maps to `./src/` (configured in `vite.config.ts` and `tsconfig.json`).
- **Direct Hook Imports:** Always import React hooks (e.g., `useState`, `useEffect`, `useMemo`) directly as named imports from `'react'`. Avoid using the `React.*` namespace prefix (e.g., prefer `useState()` over `React.useState()`) to maintain style consistency.

## Testing Conventions

- **Vitest Unit/Integration Tests**: Run `npm run test` (which executes `vitest run`). Ensure all frontend component and hook tests are passing before committing.
- **Playwright E2E Tests**: Run `npm run test:e2e` (which executes `playwright test`).
- **Resilient Playwright Selectors**:
  - Prefer using name-based selectors (e.g., `page.locator('input[name="email"]')`) or robust IDs over transient placeholders or visual labels that are subject to UI/copy refactors.
  - For checkbox inputs, locate them by ID (e.g., `#agreeTerms-checkbox`) or label, and interact with them using Playwright's native `check()` method.
- **E2E Mocking**:
  - When running E2E tests without a live backend, mock security/identity APIs (e.g., `/api/v1/users/me` or `/api/v1/auth/register`) using Playwright's `page.route` to prevent unexpected redirects to the login screen.
