# Frontend Agent Guidelines (client/)

Vite-based single page application targeting **React 19** and **TailwindCSS v4**.

_Refer to the [Frontend Architecture Summary in ARCHITECTURE_OVERVIEW.md](file:///D:/projects/my-horizon/docs/ai/ARCHITECTURE_OVERVIEW.md#L310) for core frontend architecture standards._

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
npm run format                          # prettier --write .
npm run format:check                    # prettier --check .
npm run typecheck                       # tsc -b (type check only)
```

> **ESLint plugin installs:** `eslint-plugin-jsx-a11y` declares a peer dep ceiling of ESLint v9.
> This project uses ESLint v10. Use `npm install --legacy-peer-deps eslint-plugin-jsx-a11y` to bypass
> the false ERESOLVE conflict. The plugin is fully compatible with v10.

## Conventions

- **Feature-Oriented Structure:** Mirrors backend domains (e.g., `features/task/`, `features/note/`). Each feature owns its components, routes, forms, API clients, types, and queries.
- **shadcn/ui Components:** Add via `npx shadcn@latest add <component>`. Do not modify files in `components/ui/` manually.
- **Utility:** Use `cn()` from `@/lib/utils` for conditional class composition. Use CVA for component variants.
- **Path Alias:** `@/` maps to `./src/` (configured in `vite.config.ts` and `tsconfig.json`).
- **Direct Named Imports for React:** Always import React features directly as named imports from `'react'`. Namespace imports (`import * as React`) are prohibited by ESLint. Always separate types with `import type` (e.g., `import { useState } from 'react'; import type { ReactNode } from 'react';`).
- **Named Exports Only:** Do not use `export default` in files under `src/`. Always use named exports. (Vite/ESlint/TS config files at the project root are exempt).
- **React Fast Refresh:** When a file exports both React components and hooks/constants/route configs, React Fast Refresh will emit a warning.
  - For TanStack Router routes, `react-refresh/only-export-components` is disabled via ESLint configuration.
  - For custom hooks/providers (like `theme-provider.tsx`), add `/* eslint-disable react-refresh/only-export-components */` at the top of the file.

## Testing Conventions

- **Vitest Unit/Integration Tests**: Run `npm run test` (which executes `vitest run`). Ensure all frontend component and hook tests are passing before committing.
- **Playwright E2E Tests**: Run `npm run test:e2e` (which executes `playwright test`).
- **REQUIRED SKILL:** Use the `testing-frontend` skill for implementing mock route hooks in Vitest tests, configuring Playwright E2E authentication mocks, and using resilient test selectors.
