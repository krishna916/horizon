---
name: testing-frontend
description: Use when writing, modifying, or debugging frontend unit, integration, or E2E tests (Vitest, Playwright), especially when mocking TanStack Router, stubbing auth sessions, handling network redirects, or locating UI components.
---

# Testing Frontend

## Overview
Guidelines and recipes for mocking routing, managing authentication redirects, and selecting DOM elements in React client tests using Vitest and Playwright.

## When to Use
- Writing Vitest component/hook tests for components that depend on `@tanstack/react-router`.
- Writing Playwright E2E tests that need mock responses for user state or auth endpoints.
- Resolving DOM querying or interaction failures in integration/E2E test files.

## Core Patterns

### 1. Mocking TanStack Router in Vitest
In Vitest component tests, rendering components that contain a `<Link>` component without a full `<RouterProvider>` context will throw a routing exception. Always stub `Link` when mocking `@tanstack/react-router`.

#### Vitest Router Mock Recipe
```typescript
import { vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => vi.fn().mockReturnValue({}),
  useSearch: () => vi.fn().mockReturnValue({}),
  // Always mock Link as a simple anchor to prevent routing context errors
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
```

---

### 2. Mocking Authentication in Playwright E2E Tests
To test features in a frontend-only workspace or without a running backend environment, mock the identity and credentials APIs. This prevents the routing layers from redirecting the browser to the login screen.

#### Playwright Auth Mock Recipe
```typescript
import { test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Mock current user API to pretend we are logged in
  await page.route('**/api/v1/users/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        email: 'user@example.com',
      }),
    });
  });
});
```

---

### 3. Resilient Playwright Locators
Avoid using unstable visual labels, text strings, or raw styling selectors that are prone to copy or UI changes.

- **Prefer IDs and attributes:**
  - Target input fields using name-based selectors (e.g., `page.locator('input[name="email"]')`) or robust HTML IDs (e.g., `page.locator('#agree-checkbox')`).
- **Checkbox Interactions:**
  - Locate the checkbox input (by ID or label) and check/uncheck it using Playwright's native `.check()` or `.uncheck()` method instead of clicking.

---

## Common Mistakes & Red Flags

| Excuse / Mistake | Reality |
| :--- | :--- |
| Importing `importOriginal` to mock router | The actual router components (like `Link`) will still call hooks internally and throw routing context errors. Always stub them. |
| Using `.click()` on checkboxes | Checkboxes can have complex styling overlays. Playwright's `.check()` handles visibility and state check reliably. |
| Not mocking `/api/v1/users/me` | The router's root `beforeLoad` check will fail and automatically redirect the page to `/login`. |
