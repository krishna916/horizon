# Issue #43 — Cross-Tab Authentication Session Hardening Implementation Plan

> **For Luna (agentic worker):** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` **inline, task by task**. Do not delegate to subagents. Mark each checkbox as completed only after its verification passes. Read the approved design and all repository `AGENTS.md` instructions first.

**Goal:** Close issue #43's cross-tab stale-account UI window through a non-sensitive `localStorage` change signal, authoritative session verification, protected owner-scoped UI/drafts, and registration auto-login.

**Architecture:** A small user/auth session coordinator owns a versioned storage marker, verification generation, and trusted identity; the application-level authenticated boundary makes every private surface inaccessible during verification without prematurely destroying drafts. Only a confirmed identity change resets owner-scoped state. The Task feature retains responsibility for selected-task 404 fallback and draft navigation, while registration reuses the server's established login session path.

**Tech Stack:** React 19, TypeScript 6, TanStack Query 5 / Router, Axios, Vitest + React Testing Library, Playwright, Spring Boot 4.0.6, Java 25, Spring Session JDBC/PostgreSQL 17, Maven/JUnit/Testcontainers.

**Spec:** [`../specs/2026-11-07-issue-43-cross-tab-session-design.md`](../specs/2026-11-07-issue-43-cross-tab-session-design.md). Also read [issue #43](https://github.com/krishna916/horizon/issues/43) and the merged PR #42 context.

## Global Constraints

- Approved product decisions are **fixed**: registration auto-authenticates; receiving tabs auto-switch to verified identity; preserve valid routes; redirect a selected inaccessible task to `/tasks` on **confirmed 404**; hide then restore same-owner drafts or discard old-owner drafts on confirmed identity change; redirect on 401; keep a retryable neutral screen for network/5xx.
- Use **one** versioned `localStorage` marker; never persist or broadcast user IDs, credentials, session IDs, tokens, email, or operation type. No `BroadcastChannel`, periodic polling, new state library, service worker, or backend event system.
- Browser suspension limits responsiveness: protect content on marker delivery/observation and at focus/resume; do **not** claim frozen tabs execute immediately. Storage failure must not break authentication or focus verification.
- Backend resource ownership checks remain authoritative; retain `['tasks', userId]` and `['tasks', userId, 'detail', taskId]`, and the current task lifecycle's factual timestamps. No DB migration or task `status` enum.
- Respect `docs/ai/INDEX.md`, `HORIZON_CONSTITUTION.md`, `PRD-004 Tasks`, `SPEC-001 Shared Concepts`, `ENG-002`, and repository `Agents.md` / `client/AGENTS.md` / `server/AGENTS.md`. Apply `.agents/skills/align-context`, `testing-frontend`, and `testing-spring-integration`. Backend tests run with `-Duser.timezone=UTC`.
- Keep auth/application orchestration out of individual Task components; keep Task-specific navigation and draft reconciliation inside `client/src/task`. Do not restructure controllers or introduce cross-module backend imports.
- Each task: failing regression first → red run → smallest fix → green run → focused review → commit. Do not make product decisions silently; stop and ask if the approved spec does not cover a consequential case.
- Implement on the issue feature branch, not `master`. This handoff branch initially contains **only the approved spec and this plan**; no product code is implemented by the planner.

## Review Focus

1. **Out-of-order `GET /users/me` results:** a verification from epoch N must not restore identity or private DOM after epoch N+1 (Tasks 3, 4).
2. **Stale mutation outcomes:** a task request begun by A must not update B-visible state or navigate after B is verified; backend execution cannot be retroactively cancelled (Task 6).
3. **Unavailable storage:** `SecurityError`, storage disabled, null/duplicate markers, and missed events must not crash or block focus verification (Tasks 2, 3).
4. **Navigation while dirty:** account-switch and 401 redirects must bypass only obsolete A-owned blockers; normal same-account navigation must retain Save/Discard/Keep protections (Tasks 4, 6, 7).
5. **Authentication vs ownership errors:** `/me` 401 → Login; protected API 401 → private UI hidden; selected Task 404 → `/tasks` only after account switch; 5xx/network → Retry, not logout or 404 fallback (Tasks 3, 5, 7).

---

## Baseline and owner-approved scope

- Issue #43 addresses inactive-tab private UI/cached content after same-origin session replacement; it does **not** establish a server-side authorization leak.
- Current `useCurrentUser` has `staleTime: 0`, `refetchOnWindowFocus: true`, and `retry: false`. `TaskWorkspace` and `TaskDetailSurface` hide some task content during that refetch, but `AppShell`/`AppSidebar` still expose user profile information and the shared app has no proactive cross-tab signal.
- `TaskDraftNavigationGuard` can block navigation; `TasksRouteLayout` keys task lifecycle state by owner. `TaskCompletionProvider` is above the router in `App.tsx` and currently persists across identity changes.
- `UserCommandService.login()` establishes a fresh Spring session and SecurityContext; `register()` currently creates an account without creating a session. `RegisterForm` already navigates Home, so the backend behavior must be corrected.
- The approved spec reconciles PRD-004's *derived* task lifecycle views with issue #43; **no task status/state-machine change is part of this issue**.

## File ownership and interfaces

| Area | Planned files | Responsibility |
|---|---|---|
| Backend session | Modify `server/src/main/java/com/krishnamurti/horizon/user/application/UserCommandService.java`, `server/src/test/java/com/krishnamurti/horizon/user/web/AuthControllerIntegrationTest.java` | Share session establishment between successful register/login; test cookie and session replacement |
| Marker transport | Create `client/src/user/session/sessionMarker.ts`, `.test.ts` | `SESSION_MARKER_KEY`, safe `readSessionMarker(): string \| null`, `publishSessionMarker(): string \| null`; no identity payload |
| Session coordination | Create `client/src/user/session/AuthSessionProvider.tsx`, `.test.tsx` (and small `sessionRuntime.ts` only if necessary for Axios interop) | React context/hook `useAuthSession`; trust phase, latest-generation verification, local success, marker/focus listeners, retry |
| App boundary | Modify `client/src/App.tsx`, `client/src/app/layout/AppShell.tsx`, `client/src/routes/_authenticated.tsx`, `client/src/App.test.tsx` | Hide/inert entire authenticated shell during verification; reset owner-only providers on switch; prevent stale route cache granting access |
| Auth API and hooks | Modify `client/src/user/hooks/useLoginUser.ts`, `useRegisterUser.ts`, `useLogoutUser.ts`, `client/src/lib/api-client.ts`, `client/src/app/layout/AppSidebar.tsx`; tests beside owners | Publish only after successful server mutation; handle authenticated-resource 401 without treating login credential errors as global logout |
| Tasks & drafts | Modify `client/src/task/TaskDraftNavigationGuard.tsx`, `TasksRouteLayout.tsx`, `TaskWorkspace.tsx` / `TaskDetailSurface.tsx` **only where needed**, `TaskCompletionProvider.tsx` if provider remount isn't sufficient, and focused tests | Preserve drafts while temporarily hidden; reset on changed owner; prevent old mutation/draft actions |
| Task route fallback | Modify `client/src/task/TasksListPage.tsx`, `client/src/routes/_authenticated/tasks.$id.tsx` and/or `TasksRouteLayout.tsx`; add focused tests | Only after switched identity, probe selected Task under new owner; on 404 replace with clean `/tasks` |
| Browser regression | Create `client/e2e/cross-tab-session.spec.ts`; extend `client/src/task/TaskSessionBoundary.test.tsx` as necessary | Real two-page storage event behavior with deterministic mocked API; separate real-backend manual validation |

Exact layout may be adjusted to match current `master` if it has advanced; preserve these **ownership boundaries and public behavior**. Do not create a generic shared event framework for this one use case.

## Task 1 — Make successful registration establish an authenticated session

**Files:** Modify `UserCommandService.java`; test `AuthControllerIntegrationTest.java`.

**Interfaces:** Retain HTTP `POST /api/v1/auth/register` → 201 `CurrentUserResponse`, `POST /api/v1/auth/login` → 200 and existing `SESSION` cookie; no new public endpoint. Internally extract `private void establishAuthenticatedSession(User user)` (or equivalent) used by both successful paths.

- [ ] **1.1 Red tests:** Add `shouldAccessProtectedEndpointImmediatelyAfterRegistration`, `shouldReplaceExistingAccountSessionOnRegistration`, and `shouldNotSwitchSessionOnRejectedRegistration`. Assert a new `SESSION` cookie on 201, cookie works at `/api/v1/users/me`, new session replaces prior A cookie when registering B, and rejected duplicate/invalid registration does not establish B. Use unique email per new test to avoid shared Testcontainers fixture conflicts.
- [ ] **1.2 Run red:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=AuthControllerIntegrationTest test`. Expect the new registration-authentication assertions to fail on baseline; verify failures are about missing session, not database/tooling.
- [ ] **1.3 Implement:** Extract the current login session-fixation invalidation + `HttpSessionSecurityContextRepository.saveContext(...)` into a single private helper; call it after successful user/settings creation and after password validation in login. Preserve behavior for non-HTTP `register()` setup callers (`RequestContextHolder` may be null), and keep the existing response contracts, transaction boundary, and `ROLE_USER` principal (numeric user ID).
- [ ] **1.4 Green:** Re-run targeted integration class and inspect that existing login/logout/fixation tests still pass. Confirm failed registration has no newly authenticated B session.
- [ ] **1.5 Commit:** `fix(auth): authenticate newly registered users`.

## Task 2 — Implement the non-sensitive storage marker transport

**Files:** Create `client/src/user/session/sessionMarker.ts` and `sessionMarker.test.ts`.

**Interfaces:** `export const SESSION_MARKER_KEY = 'horizon:auth-session-change:v1'`; `export function readSessionMarker(): string | null`; `export function publishSessionMarker(): string | null`. A successful write returns the new opaque value; inaccessible storage returns `null` (no throw). A publication is solely a notification; server remains authoritative.

- [ ] **2.1 Red tests:** `publishesDistinctOpaqueMarkersWithoutIdentity`, `ignoresStorageSecurityErrors`, `readsCurrentMarkerOrNull`. Assert sequential writes differ even within one millisecond; inspect stored value contains no email/user ID/password/token; simulate `localStorage.setItem/getItem` throwing `SecurityError` and assert graceful behavior.
- [ ] **2.2 Run red:** `cd client && npm test -- src/user/session/sessionMarker.test.ts`. Expect missing exports/test failures.
- [ ] **2.3 Implement:** Generate a collision-resistant marker (`crypto.randomUUID()` where available, safe monotonic fallback for test environments); catch storage access failures. **Do not** store authenticated user data, event type, or cookies. No backend changes.
- [ ] **2.4 Green:** Same command. Check test cleanup restores mocked storage/crypto and does not leak state across tests.
- [ ] **2.5 Commit:** `feat(auth): add storage session-change marker`.

## Task 3 — Centralize authoritative verification, generations, and recovery

**Files:** Create `client/src/user/session/AuthSessionProvider.tsx` and `.test.tsx`; add `sessionRuntime.ts` if needed for external 401 signal/epoch without a React-hook dependency. Reference the marker interface from Task 2.

**Interfaces:** Export `AuthSessionProvider({children})`, `useAuthSession()` returning `{ phase: 'verified' | 'verifying' | 'retryable-error' | 'unauthenticated'; verifiedUserId: number | null; ownerRevision: number; epoch: number; verifySession(): Promise<void>; acceptLocalAuthentication(user: CurrentUserResponse): void; acceptLocalLogout(): void; }`. `verifiedUserId` is trusted **only** when `phase === 'verified'`. Keep the API small; no exported global user store. Allow optional private runtime hooks for Axios 401 interception in Task 5.

- [ ] **3.1 Red tests:** `storageChangeHidesBeforeMeResolves`, `deduplicatesSameMarkerAndRechecksOnResume`, `sameOwnerVerificationDoesNotIncrementOwnerRevision`, `differentOwnerVerificationIncrementsOwnerRevision`, `olderVerificationCannotOverwriteNewerOne`, `networkFailureRemainsRetryable`, `retryRevalidatesAndRestoresOnlyVerifiedAccount`, `me401SetsUnauthenticated`, `storageBlockedStillVerifiesOnFocus`. Use `act()` around storage/focus event dispatch; deferred `/users/me` promises prove no old identity becomes trusted while pending.
- [ ] **3.2 Run red:** `cd client && npm test -- src/user/session/AuthSessionProvider.test.tsx`.
- [ ] **3.3 Implement:** Subscribe once at the application boundary to `storage`, `visibilitychange`, and `focus`. Compare versioned marker with last observed value and coalesce duplicate notifications. On observed change, **mark phase verifying synchronously in event turn**, advance the verification generation, cancel private in-flight queries (`['me']`, owner-scoped queries), and issue a fresh `userApi.getCurrentUser()`; do not treat `queryClient.ensureQueryData(['me'])` as authority. Check epoch/generation before committing user data or advancing owner revision. On success update `['me']`, clear old-owner private cache *only when owner changes*, and transition to verified; on 401 transition unauthenticated; on network/5xx transition retryable-error without losing draft state. Focus verification also runs without a changed marker to detect natural expiry. Avoid an infinite verification loop with TanStack Query refocus.
- [ ] **3.4 Green:** Targeted tests; assert listener cleanup and no duplicated network call for storage plus immediate focus of same marker where safe. If `useCurrentUser.refetchOnWindowFocus` duplicates the coordinator's verification, explicitly migrate ownership of focus refetch to the coordinator and update existing focus tests; **do not disable focus verification behavior**.
- [ ] **3.5 Commit:** `feat(auth): coordinate cross-tab session verification`.

## Task 4 — Protect the entire authenticated shell and reset state on owner change

**Files:** Modify `client/src/App.tsx`, `client/src/app/layout/AppShell.tsx`, `client/src/routes/_authenticated.tsx`, `client/src/App.test.tsx`; add `client/src/app/layout/AuthenticatedSessionBoundary.test.tsx` if a distinct component is warranted.

**Interfaces:** `App.tsx` mounts `AuthSessionProvider` within `QueryClientProvider`. `AppShell` consumes `useAuthSession()` and acts as the authenticated visibility boundary. Root private providers, particularly `TaskCompletionProvider`, reset on **confirmed owner change** via `ownerRevision`/identity key, not on mere marker/focus verification. Use existing router instance/navigation facilities.

- [ ] **4.1 Red tests:** `hidesSidebarEmailTasksDetailAndDraftWhileVerifying`, `preservesMountedDraftDuringSameOwnerRevalidation`, `unmountsOldOwnerScopedTreeOnConfirmedSwitch`, `invalidSessionRedirectsToLoginDespiteDirtyDraft`, `networkFailureShowsNeutralRetryWithoutRedirect`, `staleMeCacheCannotBypassRouteGuard`. Check private nodes are invisible, inert/non-interactive, not accessible to screen-reader queries; cover profile/sidebar as well as task rows.
- [ ] **4.2 Run red:** `cd client && npm test -- src/App.test.tsx src/app/layout/AuthenticatedSessionBoundary.test.tsx` (omit the second file if inlined in App tests).
- [ ] **4.3 Implement:** Keep the old authenticated tree **mounted but entirely hidden + inert** while verifying or retryable-error (so same-owner drafts survive); render a visible neutral verifying/retry/error surface outside it. On confirmed changed owner, remount owner-scoped providers and descendant routes, dropping A's React-local drafts/notices/undo state. On 401, hide immediately and replace/navigate to Login without leaving the old shell reachable. Harden `_authenticated.beforeLoad`: cached `['me']` (including stale/null values) must never grant private-route entry during untrusted session phase; revalidate or follow verified coordinator result. Preserve current route for a verified B and run route reconciliation afterward.
- [ ] **4.4 Green:** Targeted tests; check initial protected-route load, browser back/forward, and public Login/Register aren't blanked by the authenticated-only curtain. Watch for blocker timing and ensure origin tab doesn't briefly expose stale data when changing accounts.
- [ ] **4.5 Commit:** `feat(auth): gate authenticated shell by verified session`.

## Task 5 — Publish only successful local auth operations; handle protected 401

**Files:** Modify `client/src/user/hooks/useLoginUser.ts`, `useRegisterUser.ts`, `useLogoutUser.ts`, `client/src/lib/api-client.ts`, `client/src/app/layout/AppSidebar.tsx`, and their existing tests or new focused tests in `client/src/user/`.

**Interfaces:** On mutation success, hooks call `acceptLocalAuthentication(user)` or `acceptLocalLogout()` and **then** `publishSessionMarker()`. Failed mutations never publish. Axios response interceptor signals an invalid session for **protected requests** only (not a rejected `/auth/login`, `/auth/register` or a task `404`), guarded by request epoch so an old A 401 cannot sign out verified B.

- [ ] **5.1 Red tests:** `successfulLoginAndRegistrationPublishOneMarkerEach`, `successfulLogoutPublishesAfterServer204`, `failedAuthDoesNotPublish`, `login401DoesNotGlobalLogout`, `protectedTask401HidesShellAndRedirects`, `staleOldEpoch401DoesNotLogoutNewUser`, `logoutBlockedByDraftNeverCallsServerOrPublishes`, `storageWriteErrorDoesNotRejectSuccessfulAuth`. Use distinct marker values and assert mutation/request order.
- [ ] **5.2 Run red:** `cd client && npm test -- src/user src/App.test.tsx` (or list the exact new test filenames if needed).
- [ ] **5.3 Implement:** Wire all three hooks to the coordinator; synchronize originating tab query state and owner revision even though it won't receive its own storage event. Keep failed logout behavior intelligible; the existing Sidebar navigates to Login before posting logout, subject to a dirty-draft blocker—do not announce on attempted navigation, only after the server response succeeds. Add a small Axios interceptor at the shared client boundary (or equivalent single hook) for protected-resource 401, ignoring stale-epoch responses and unauthenticated public-auth errors. Do not broadcast on passive expiry unless explicitly desired by approved design (it is not).
- [ ] **5.4 Green:** Targeted auth/frontend tests. Verify successful registration from the frontend reaches Home with a real server session (not merely mocked `/me`).
- [ ] **5.5 Commit:** `feat(auth): announce successful local auth changes`.

## Task 6 — Preserve then discard Task drafts safely; close late-write races

**Files:** Modify `client/src/task/TaskDraftNavigationGuard.tsx`, `TasksRouteLayout.tsx`, `TaskWorkspace.tsx` / `TaskDetailSurface.tsx` **only if required**, `TaskCompletionProvider.tsx` and Task mutation hooks selectively if a late result can affect the newly verified owner; tests `client/src/task/TaskSessionBoundary.test.tsx`, `TaskDraftNavigationGuard.test.tsx` (create if absent) and relevant existing mutation tests.

**Interfaces:** Use `useAuthSession().phase`, `.verifiedUserId`, `.ownerRevision`, `.epoch`. Preserve existing normal-edit `TaskDraftRegistration` semantics and `bypass(action)`; add a narrowly scoped `resetForSessionChange()` (or equivalent) to drop registrations, queued actions, save-failure UI and navigation blockers **only when identity changes**. Do not permit old-owner `save`, `discard`, undo, retry, or completion callbacks after epoch invalidation.

- [ ] **6.1 Red tests:** `dirtyDraftIsHiddenButPreservedOnSameOwner`, `dirtyDraftIsDiscardedOnConfirmedDifferentOwner`, `pendingSaveCannotReviveOldOwnerState`, `queuedNavigationAndUndoAreClearedOnOwnerSwitch`, `sameOwnerNavigationGuardStillPrompts`, `oldCompletionResponseCannotPopulateNewOwnerCache`. Include creation forms, field/checklist edits and task-detail TipTap content; distinguish hidden from unmounted on same-owner.
- [ ] **6.2 Run red:** `cd client && npm test -- src/task/TaskSessionBoundary.test.tsx src/task/TaskDraftNavigationGuard.test.tsx` (or actual test names found/created). Confirm failures are assertions about session transition.
- [ ] **6.3 Implement:** Rely on root authenticated tree concealment during pending verification and owner-keyed remount on changed identity to discard local drafts. Use draft guard's existing `bypass` only for **session-driven** redirects, never routine navigation; remove obsolete queued actions and blockers on owner change. Cancel private queries and purge A's cached `['tasks', ...]` and `['tags', ...]` when switching. Add epoch + owner guards to asynchronous Task callbacks where necessary to prevent late UI/cache writes; don't pretend an already-sent mutation is rolled back server-side. Remove `hidden` old-detail DOM retention only if it defeats the root privacy gate; avoid unrelated editing rewrites.
- [ ] **6.4 Green:** Run focused Task tests and regression of ordinary dirty navigation/undo. Confirm same-owner 5xx Retry preserves draft; A→B discards it; B never sees A's profile or task editors.
- [ ] **6.5 Commit:** `fix(tasks): isolate drafts and pending effects across account switches`.

## Task 7 — Reconcile inaccessible selected-task URLs after a verified account switch

**Files:** Modify `client/src/task/TasksRouteLayout.tsx`, `client/src/task/TasksListPage.tsx`, `client/src/routes/_authenticated/tasks.$id.tsx` **only where needed**; create `client/src/task/TaskSessionRouteReconciler.tsx` if it prevents duplicate 404 handling; add tests `client/src/task/TaskSessionRouteReconciler.test.tsx` / existing route tests.

**Interfaces:** Observe **confirmed ownerRevision change** with the selected URL; use `useTaskDetail`'s existing owner-scoped key or `queryClient.fetchQuery` with **the same key and queryFn**, not a second backend contract. If new owner's selected-task request yields Axios 404, replace URL with `/tasks`, clear `task`/`create` search and `horizonTaskNavigation`; on success keep route; on 5xx/network retain route + Retry. Guard asynchronous redirects by current owner revision **and current URL**.

- [ ] **7.1 Red tests:** `accountSwitchOnTaskPage404ReplacesWithList`, `accountSwitchOnTaskPanel404ClearsTaskSearch`, `accountSwitchWithAccessibleTaskPreservesRoute`, `task5xxKeepsSelectionAndRetry`, `outdated404AfterFurtherNavigationDoesNotRedirect`, `ordinaryTask404RetainsExistingUnavailableBehavior`, `oldDraftBlockerDoesNotPreventAccountDrivenFallback`.
- [ ] **7.2 Run red:** `cd client && npm test -- src/task/TaskSessionRouteReconciler.test.tsx` (or the exact existing route test file if inlined).
- [ ] **7.3 Implement:** Add one Task-owned reconciliation effect that starts **only after an account switch has been verified** and only for an active Task selection. Check `parseTaskSelection`, ignore invalid task IDs; if the active route is a creation view, preserve the route but reset A’s form to a new empty B-owned draft, and use `replace: true` rather than `history.back` to avoid returning to A's task URL. A 401 is routed through session invalidation (Task 5), never treated as owner 404. Ensure only the latest epoch/URL owns navigation.
- [ ] **7.4 Green:** Targeted tests + `TaskSessionBoundary.test.tsx` and existing Task navigation tests. Validate full-page route and query-param panel, including browser back behavior.
- [ ] **7.5 Commit:** `fix(tasks): reconcile selected task after account switch`.

## Task 8 — Cross-tab browser proof and full regression gate

**Files:** Create `client/e2e/cross-tab-session.spec.ts`; update narrowly affected test fixtures; add a short verification note to the PR/issue handoff (not a new product spec).

**Interfaces:** Use two **same-origin** Playwright `Page`s in the same `BrowserContext` to share localStorage/cookies. For deterministic mocks, use per-page API response handlers and deferred `/me`; distinguish mock proof from a real Spring Session test. No extra Playwright dependency.

- [ ] **8.1 Red E2E:** `switchesAuthenticatedTabFromAToBWithoutPrivateFlash`, `receivingTabHidesAOnLogout`, `recoversMissedMarkerOnFocus`, `keepsRouteAndRetriesMe5xx`, `redirectsOnMe401`, and `fallsBackFromNonOwnedSelectedTask`. Assert A task title, details, sidebar email, and drafts disappear **before** releasing deferred `/me`; after resolve only B appears. A blocked/frozen tab might not run events until resumed; write assertions for actual browser semantics.
- [ ] **8.2 Run red:** `cd client && npm run test:e2e -- cross-tab-session.spec.ts`. Document any unavailable browser setup; install Chromium via `npm run test:e2e:install` if permitted.
- [ ] **8.3 Implement/test harness:** Mock API requests consistently using `.agents/skills/testing-frontend`; ensure two tabs share the real storage event even when HTTP is mocked. Where environment allows, additionally test two actual registered accounts against running Spring Boot/Postgres; record if this **live** reproduction could not run and do not present mocked output as real session verification.
- [ ] **8.4 Full verification (from `client/`):** `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run test:e2e -- cross-tab-session.spec.ts`, and preferably `npm run verify` if coverage environment permits. From `server/`: `./mvnw -Duser.timezone=UTC test`, then repository-required `./mvnw -Duser.timezone=UTC verify` if practical. Run `git diff --check` and inspect changed file scope. Record commands and actual results in the PR/issue handoff.
- [ ] **8.5 Review and commit:** Confirm no user/account information in storage marker; no stale private UI/keyboard/AT access; owner-scoped caches only; failed auth never broadcasts; no new task `status`; no unrelated refactor. Commit `test(auth): cover cross-tab account transitions` after green. Open a PR referencing #43, and have Luna summarize tradeoffs, limitations and tests without claiming certainty about suspended-tab execution.

---

## Final acceptance checklist for Luna

- [ ] Registration 201 produces usable new Spring Session; rejected registration does not swap account.
- [ ] Successful login/registration/logout publishes exactly one opaque marker; failure publishes none; sender updates locally.
- [ ] Receiver immediately conceals the **entire** authenticated shell on observed marker and verifies identity from server; no stale `['me']` cache shortcut.
- [ ] Same-owner verification restores existing draft; changed-owner verification resets old drafts, blockers, completion/notice state and private caches.
- [ ] Rapid events, late `/me`, late Task query/mutation, and old 401 cannot re-expose previous-owner content.
- [ ] Expired session → Login; network/5xx → neutral Retry, no forced logout.
- [ ] Selected task 404 after owner change replaces both page and panel URLs with `/tasks`; valid other routes remain.
- [ ] Focus/resume handles missed signals; storage exceptions are non-fatal; no guarantee is claimed for frozen tabs.
- [ ] CI-equivalent frontend/backend verification recorded, with mocked-vs-live E2E explicitly separated.

## Execution handoff

1. Begin by reading the **approved design** and this plan on the issue feature branch. Use `superpowers:executing-plans` **inline**; no subagents.
2. At each task, follow TDD and commit separately. Preserve existing behavior except the owner-approved changes; escalate genuine spec/code conflicts rather than introducing new product rules.
3. Implement product code **only after the owner reviews this plan**. The planning work creates docs and issue handoff, not the feature implementation.