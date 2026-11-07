# PR #67 — Cross-Tab Authentication Review Remediation Plan

> **For Luna:** REQUIRED SUB-SKILL: `superpowers:executing-plans`, executed **inline without subagents**. Use test-first red → green → focused commits; do not change code while merely reading this plan.

**Goal:** Address the three session-transition correctness risks and the two valid CodeRabbit test findings identified during review of PR #67.

**Architecture:** Keep the existing `AuthSessionProvider` / versioned localStorage marker, `SessionOwnedTree` revision-keyed reset, and Task-owned TanStack Query caches. Fix session-loss cleanup, late lifecycle callbacks, and stale current-user responses without adding new synchronization infrastructure.

**Tech Stack:** React 19, TanStack Query v5 / Router, Axios, Vitest/RTL, Playwright, Spring Boot 4 / Java 25, Maven, Spring Session JDBC, Testcontainers.

**PR:** https://github.com/krishna916/horizon/pull/67

**Reviewed head:** `25e04055b1b310efb591d97d9ed290a63c036391` on 2026-11-07. **Recheck latest head before implementing.**

**Spec:** [Approved issue #43 design](../specs/2026-11-07-issue-43-cross-tab-session-design.md) and [original implementation plan](./2026-11-07-issue-43-cross-tab-session-implementation.md).

## Global Constraints

- Work on the current PR branch: `feat/issue-43-cross-tab-session`. No new branch, no unrelated product refactor.
- Read root `Agents.md`, `client/AGENTS.md`, `server/AGENTS.md`, and `docs/ai/INDEX.md`. Use the repository skills `align-context`, `testing-frontend`, and `testing-spring-integration`.
- Preserve approved behavior: registration signs in, login/register/logout publish an opaque marker only on success; received marker hides private UI while server identity is verified; same-owner drafts survive; a confirmed different owner or invalid session discards old drafts and blockers; 401 goes to Login, network/5xx stays hidden with Retry; selected Task 404 after account change returns to `/tasks`.
- Do not introduce BroadcastChannel, polling, another state library, extra cookies/identity storage, DB migration, or Task status field. Owner-scoped backend authorization stays unchanged.
- Already-dispatched HTTP mutations cannot be assumed reversible. The client must prevent **late cache writes and actions**, not pretend to undo server effects.
- Treat the first three findings as **code-level risks** until a deferred test proves them. Do not alter production code for an unproven speculation.
- Follow the project's UTC convention for tests: `./mvnw -Duser.timezone=UTC ...`.

## Review Focus

1. A tab holding an unsaved Task draft receives a logout marker, verifies 401, and must reach `/login` despite the Task navigation blocker (Task 1).
2. A pre-switch archive/delete/restore/undo request finishes after owner change and must not recreate A's cache entries or notices (Task 2).
3. A stale `['me']` TanStack Query request completes after successful local B login and must not replace B's identity/cache (Task 3).
4. Failed logout assertions must wait for the mutation **error state**, not just the API invocation (Task 4).
5. Registration session rotation must compare real session cookie IDs rather than `Cookie` object identity (Task 4).

## Review findings and priority

| Priority | Finding | Required outcome |
| --- | --- | --- |
| P1 — verify/fix | `AuthSessionProvider.tsx`: after `/users/me` 401, owner trust is cleared without incrementing `ownerRevision` | Drop previous owner's mounted draft/route guard, then redirect to Login without a hidden blocker |
| P1/P2 — verify/fix | `TaskLifecycleProvider.tsx`: archive, delete, restore and undo can await requests before writing cache, without owner-revision checks at every async boundary | Ignore old-owner callbacks and prevent repopulating cleared private caches |
| P1/P2 — verify/fix | `acceptLocalAuthentication()` updates `['me']` but does not cancel older TanStack Query fetches for the same key | Old A query cannot overwrite newly accepted B identity |
| P2 — fix | CodeRabbit: `AuthControllerIntegrationTest.java:121` compares distinct `Cookie` instances | Compare `getValue()`; retain old-cookie 401 and B-cookie 200 checks |
| P2 — fix | CodeRabbit: failed-logout test waits only for mock invocation | Wait for `logout.isError` then assert marker absent and A still verified |
| Triage | SonarCloud reports four new PR issues; quality gate passed | Inspect each actual rule/location; fix scope-relevant findings or document why deferred |

---

## Task 1 — Confirmed 401 must clear dirty Task blockers and navigate to Login

**Files:** Modify `client/src/user/session/AuthSessionProvider.tsx`. Test `client/src/user/session/AuthSessionProvider.test.tsx` plus `client/src/task/TasksRouteLayout.test.tsx` or a dedicated real-router regression test alongside `client/src/task/TaskSessionBoundary.test.tsx`. Modify `TaskDraftNavigationGuard.tsx` only if a real-router test proves explicit bypass/reset is needed.

**Interfaces:** Keep `AuthSessionValue`, `AuthSessionPhase` and `ownerRevision` publicly unchanged; no backend API or new product behavior.

- [ ] **1.1 Red state test:** Verify A, trigger marker/focus-driven `/users/me` 401. Assert `phase === 'unauthenticated'` and old owner tree revision changes exactly once. Cold-start 401 must not imply an already verified owner.
- [ ] **1.2 Red router test:** Mount a **real TanStack Router**, `SessionOwnedTree`, `AuthenticatedSessionBoundary` and an active dirty `TaskDraftNavigationGuard` on `/tasks?task=41` or `/tasks/41`. Trigger cross-tab marker and deferred 401. Assert private UI is hidden/inert during verification, the final URL is `/login` using replace semantics, and no concealed dirty-draft confirmation can trap navigation. Include pending save if feasible.
- [ ] **1.3 Safety test:** A network/503 failure followed by successful same-A Retry keeps the route and restores the original unsaved draft; ordinary same-A draft navigation still prompts.
- [ ] **1.4 Run red:** `cd client && npm test -- src/user/session/AuthSessionProvider.test.tsx src/task/TasksRouteLayout.test.tsx` (adjust for newly created test path). Confirm genuine behavioral failure, not missing router test setup.
- [ ] **1.5 Implement:** In the `verifySession` confirmed-401 branch, use the **last verified owner identity** (since the pending state's user ID is null) to advance `ownerRevision`, clear authenticated state/caches and release the old draft-tree blocker. The existing `SessionOwnedTree` keyed remount may be sufficient; add explicit guard bypass/reset only if needed. Preserve draft state on retryable errors; do not bump revision for a same-owner verification.
- [ ] **1.6 Green/commit:** Run focused and existing dirty-navigation regression tests. Commit `fix(auth): reset private draft context on confirmed session loss`.

## Task 2 — Prevent late Task lifecycle results from reviving previous-owner state

**Files:** Modify `client/src/task/TaskLifecycleProvider.tsx`. Extend `client/src/task/TaskLifecycleProvider.test.tsx`; consult `client/src/task/TaskCompletionSessionBoundary.test.tsx` for the existing owner-revision pattern.

**Interfaces:** Keep provider API (`run`, `undo`, `retryDelete`, `dismiss`, `stateFor` and notices). Reuse `getCurrentOwnerRevision(): number` from `client/src/user/session/sessionRuntime.ts`. Suggested private predicate: `isCurrentOperation(ownerId: number, revision: number): boolean`.

- [ ] **2.1 Red archive:** Start an A-owned archive with deferred HTTP response, switch to B, advance owner revision, unmount the old provider and remove A queries. Resolve A's response. Assert no `['tasks', A]` or `['tasks', A, 'detail', taskId]` resurrection, no A notice/undo, and no B cache mutation.
- [ ] **2.2 Red delete/undo:** Repeat with delayed soft-delete, restore/archive undo, and an error path. At least one response must settle **after query cancellation but before the cache-write stage**. Assert old notices, retry intents, and private queries stay absent.
- [ ] **2.3 Run red:** `cd client && npm test -- src/task/TaskLifecycleProvider.test.tsx`.
- [ ] **2.4 Implement:** Capture owner revision at action start; reject post-await work if revision/owner changed or old provider unmounted. Place checks **inside** `reconcileTask` and `removeDeletedTask` after `cancelQueries` and before `setQueryData` / `removeQueries` / `invalidateQueries`. Apply the same guard to `run`, `undo` and retry/notice bookkeeping. Invalidate `currentUserIdRef` on unmount; do not rely on a keyed provider remount to cancel already-running promises. Keep ordinary same-owner lifecycle logic unchanged.
- [ ] **2.5 Green/commit:** Run lifecycle tests and relevant Task regressions. Commit `fix(tasks): reject late lifecycle effects after owner change`.

## Task 3 — Cancel stale current-user Query before local authentication commit

**Files:** Modify `client/src/user/session/AuthSessionProvider.tsx`. Extend `client/src/user/session/AuthSessionProvider.test.tsx` and/or `AuthSessionMutations.test.tsx`, plus `client/src/routes/-_authenticated.test.ts` if route-loader behavior contributes. Inspect `useCurrentUser.ts` and `_authenticated.tsx` but do not automatically refactor.

**Interfaces:** Keep `acceptLocalAuthentication(user: CurrentUserResponse): void` and the `['me']` cache contract.

- [ ] **3.1 Red request-race test:** Start a deferred A-owned `useCurrentUser()` or route `fetchQuery(['me'])`. Before A responds, successfully accept B via the login/register path. Resolve stale A after B was accepted. Assert coordinator remains verified B, `queryClient.getQueryData(['me']).id === B.id`, and no A-private rendered content returns. Repeat with old request returning 401 and a subsequent fresh B check.
- [ ] **3.2 Run red:** `cd client && npm test -- src/user/session/AuthSessionProvider.test.tsx src/user/session/AuthSessionMutations.test.tsx src/routes/-_authenticated.test.ts`.
- [ ] **3.3 Implement if reproduced:** Cancel/supersede older `['me']` TanStack Query work **before** accepting B into the Query cache and updating trusted identity; retain coordinator generation/epoch guards. Verify the cancellation ordering with deferred tests; do not rely on `setQueryData` alone. Keep sender-tab login immediate and retain regular focus verification. Avoid a second global identity store.
- [ ] **3.4 Green/commit:** Run focused auth/route tests. Commit `fix(auth): prevent stale me query from overwriting local login`. If the test proves TanStack Query already suppresses stale writes in this exact case, record that evidence instead of adding redundant code.

## Task 4 — Correct the two CodeRabbit findings

**Files:** Modify `server/src/test/java/com/krishnamurti/horizon/user/web/AuthControllerIntegrationTest.java` and `client/src/user/session/AuthSessionMutations.test.tsx`. **Tests only.**

- [ ] **4.1 Session cookie:** In `shouldReplaceExistingAccountSessionOnRegistration` assert both cookies non-null and `accountBSession.getValue()` not equal to `accountASession.getValue()`. Retain B-cookie 200 and old A-cookie 401 assertions.
- [ ] **4.2 Logout mutation:** Add a test-only logout failure output based on `logout.isError`. In the rejected-logout case, wait for that state (not merely for `userApi.logout` invocation) before checking no storage marker, identity still `verified:1`, and no successful logout flag.
- [ ] **4.3 Verify:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=AuthControllerIntegrationTest test` and `cd client && npm test -- src/user/session/AuthSessionMutations.test.tsx`.
- [ ] **4.4 Commit and respond:** Commit `test(auth): tighten session rotation and failed logout assertions`. Reply to/resolve the inline CodeRabbit cookie thread; mention the separate logout test finding posted in CodeRabbit's review body. Do not treat the optional docstring coverage warning as a correctness finding.

## Task 5 — End-to-end regression, Sonar triage, and full verification

**Files:** Extend `client/e2e/cross-tab-session.spec.ts` for confirmed 401 + dirty draft; change other code/tests only if a concrete finding requires it.

- [ ] **5.1 Browser regression:** Reuse two same-origin Playwright pages and the existing mocked API harness: account A edits an unsaved Task draft; another tab logs out; A receives the marker, conceals content, receives 401 and reaches `/login` with no inaccessible dialog. Optionally cover marker-free natural expiration on focus. Do **not** substitute a mocked `useNavigate` unit test for this browser check.
- [ ] **5.2 Sonar:** Open the four actual new SonarCloud findings associated with PR #67, record rule/path/severity and fix/defer rationale for each. Fix relevant in-scope correctness/security findings, not broad style/docstring churn. The Sonar gate passing does not mean every finding is invalid.
- [ ] **5.3 Frontend gate:** `cd client && npm run verify`; `npm run test:e2e -- cross-tab-session.spec.ts --workers=1`. Run `npm run typecheck` if not already covered by verify/build.
- [ ] **5.4 Backend gate:** `cd server && ./mvnw -Duser.timezone=UTC verify`. Preserve login, registration and session-fixation coverage.
- [ ] **5.5 Final check:** `git diff --check`; review `git diff master...HEAD` for unrelated changes, no Task status/schema changes, no credentials in localStorage, no extra sync mechanism, no regressions to same-owner drafts or owner-scoped 404 routing.
- [ ] **5.6 PR handoff:** Commit E2E/test changes, record actual commands/results, Sonar dispositions and CodeRabbit closure in PR #67. Distinguish mocked Playwright evidence from any live two-account Spring Session validation; never claim tests ran if they were only inspected.

---

## Final acceptance checklist

- [ ] Verified 401 from a cross-tab logout or expiry navigates to Login despite a dirty or pending Task draft; old private content and blockers are discarded.
- [ ] 5xx/network verification failure keeps drafts inaccessible but preserved for a successful same-owner Retry.
- [ ] Late archive/delete/restore/undo results do not mutate current owner state or restore previous-owner query entries.
- [ ] Obsolete `['me']` success/401 cannot overwrite a newer accepted B session.
- [ ] Both CodeRabbit test findings fixed and validated.
- [ ] Sonar's four PR issues individually triaged; no blanket docstring-only additions.
- [ ] Targeted tests, full frontend/backend verification, and cross-tab Playwright pass with actual results reported.

**Execution:** Luna should run the tasks **inline, sequentially, without subagents**, on the current PR branch; start each with failing regression tests and make focused commits. Stop and report any genuinely conflicting product decision rather than inventing behavior. This plan itself changes **documentation only**.
