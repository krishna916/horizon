# PR #46 — Task Creation Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the verified PR #46 review findings without widening Horizon issue #18 or changing an owner-approved interaction silently.

**Architecture:** Keep user-scoped task creation in `client/src/task`. Make the creation form's lifecycle track authenticated ownership, decouple successful POST completion from best-effort task-list revalidation, and make the browser retry fixture model *commit then response loss*. **Owner-approved remediation (option A):** Cancel remains immediate before submission, but Cancel and all user-initiated panel dismissal/navigation are blocked while a creation POST is in flight. The existing dirty draft and immutable retry behaviors resume once that request settles.

**Tech Stack:** React 19, TypeScript 6, React Hook Form 7, TanStack Router 1.x, TanStack Query 5, Axios, Vitest/React Testing Library, Playwright, existing Java 25/Spring Boot 4/PostgreSQL 17 backend. No additional packages or new backend API.

**Spec:** `docs/superpowers/plans/2026-10-20-issue-18-task-creation.md`, `docs/design/tasks-workspace/DESIGN-SPEC.md`, PRD-004 Tasks and the six approved issue #18 decisions. Review target: [PR #46](https://github.com/krishna916/horizon/pull/46), originally examined at `efb604264bd98fa8592f33f698a338a5c0ec72f5`.

## Global Constraints

- Work **on existing PR branch** `feat/issue-18-task-creation`; don't create a second implementation branch or modify `master`.
- Confirm PR HEAD and rerun the affected tests before each code change. Fix **only still-valid issues**; note any resolved or disproven finding in the PR.
- Retain `/tasks?create=true`, create → `/tasks?task={id}` history replacement, the account-scoped query keys `['tasks', userId]` and `['tasks', userId, 'detail', task.id]`, and existing form/API contracts.
- **Approved on PR #46:** explicit **Cancel immediately discards before submission**, even when dirty; during an active creation POST, **disable Cancel and block all user-initiated panel dismissal/navigation** (X, Escape, backdrop, task selection, sidebar links, logout navigation, browser Back/Forward). This is a narrow exception to the original immediate-Cancel rule. Once POST settles, restore normal dirty dismissal/Cancel or immutable retry behavior. Native browser refresh/tab close cannot be forcibly blocked; use the platform's best-effort `beforeunload` warning without claiming cancellation of the server request.
- Preserve the request body and UUID on uncertain outcomes. Retrying the same submission must remain safe through the existing backend idempotency mechanism; no new backend code unless a concrete failed integration test proves it's necessary.
- Reuse existing test infrastructure, no global auth state store or cross-feature refactor. Test red → minimal fix → green → commit per independent task.
- Preserve existing privacy behavior when session state changes; never expose A's draft to B, but do not destroy A's draft simply because a background `/me` revalidation eventually confirms the *same* user.

## Review Focus

1. **Same-user revalidation:** a temporary `/me` fetch must not expose private form content while identity is unverified or gratuitously lose a draft after it confirms the same owner (Task 1).
2. **Owner A → B:** B must never see A's title, description, server errors or immutable recovery payload; B starts a clean form and can't submit with A's key (Task 1).
3. **POST succeeds, list GET stalls/fails:** Create resolves to detail immediately with the new `TASK-N`; background refetch errors cannot misclassify a successful create as an uncertain POST (Task 2).
4. **POST commits, HTTP response is lost:** retry uses identical key/body, returns original ID, and browser fixture has exactly one persisted task (Task 3).
5. **User attempts to leave while POST is active:** no Cancel or user-initiated dismissal/navigation succeeds while the POST is in flight; once it settles, normal navigation/retry behavior returns. Successful create must still programmatically replace the create URL with detail; auth-enforced redirects must not leak user data (Task 4).

---

## File map

| Task | Files | Responsibility |
|---|---|---|
| 1 | `client/src/task/TaskWorkspace.tsx`, `TaskCreateForm.tsx`, `TaskCreateSurface.tsx`, `TasksListPage.tsx` **only if guard ownership requires it**; existing matching `*.test.tsx` | Account-scoped draft lifetime, verification state, route dirty flag |
| 2 | `client/src/task/useCreateTask.ts`, `useCreateTask.test.tsx`; `TasksListPage.test.tsx` if needed | Successful mutation completion vs independent list revalidation |
| 3 | `client/e2e/task-create.spec.ts` | Realistic committed-but-response-lost simulated server |
| 4 | `client/src/task/TaskCreateForm.tsx`, `TaskCreateSurface.tsx`, `TaskWorkspace.tsx`, `TasksListPage.tsx`, plus matching form/router/overlay tests and `client/e2e/task-create.spec.ts` | Approved in-flight Cancel and intentional navigation lock |

### Task 1: Isolate and preserve creation drafts correctly across session changes

**Files:** Modify `client/src/task/TaskWorkspace.tsx`; `TaskCreateForm.tsx` or `TaskCreateSurface.tsx` as needed for owner-keyed lifetime; `TasksListPage.tsx` only if dirty-blocker state cannot be cleared at the existing callback boundary. Test in `client/src/task/TaskWorkspace.test.tsx`, `TaskCreateForm.test.tsx` and/or `TasksListPage.test.tsx`.

**Interfaces:** Keep `TaskCreateSurface` props `{userId, onCreated, onDirtyChange, onCancel, onDismiss}`. The creation draft and `TaskCreateRecovery.ownerId` are owned by **one verified authenticated user**. Parent dirty state is reset when a draft is discarded due to an identity change, without permitting a canceled/late response to navigate.

- [ ] **Step 1 — Write failing tests:** render create mode as A, fill title + description, optionally enter uncertain-retry mode. Change current-user query to B without leaving `?create=true`. Assert B sees none of A's title, errors, key or disabled recovery state; B can create with a *new* key and the old A request cannot navigate/cache under B. Assert route dirty blocker no longer acts on A's vanished draft.
- [ ] **Step 2 — Write revalidation tests:** enter dirty draft as A, set `/me` query to `isFetching=true` with stale A data; don't expose or allow interactions with the private form while identity is pending. After it confirms A, restore the **same** draft; if it fails or resolves to B, no draft is displayed to another user. Include a late POST response test.
- [ ] **Step 3 — Confirm RED:** from `client/`, `npm run test -- TaskWorkspace TaskCreateForm TasksListPage`; new assertions must fail on the existing behavior.
- [ ] **Step 4 — Minimal change:** scope the mounted form by authenticated `userId` (React `key`/owner-scoped subtree); guard against stale `useCurrentUser` data during `isPending`, `isFetching`, or `isError`. Keep the component **mounted but non-visible/inert** during ordinary revalidation if needed to preserve same-user drafts; re-key/reset only on a *confirmed different owner* or invalid session. Clear its parent dirty state on owner invalidation/discard. Do not rely only on `send()`'s owner comparison: that protects writes but not what B can read on screen.
- [ ] **Step 5 — GREEN + commit:** run `npm run test -- TaskWorkspace TaskCreateForm TasksListPage` and `npm run typecheck`; expect PASS. Commit `fix(tasks): isolate creation drafts across account changes`.

### Task 2: Make successful creation independent of list-refetch availability

**Files:** Modify `client/src/task/useCreateTask.ts`; test in `client/src/task/useCreateTask.test.tsx`, and relevant route integration test if needed.

**Interfaces:** Preserve `useCreateTask(userId: number)` and `createTask(payload: CreateTaskPayload, requestKey: string): Promise<TaskDetail>`. A resolved `taskApi.create` establishes creation success. Query cache reconciliation stays owner-scoped; refetch is fire-and-forget, not awaited by `mutateAsync`.

- [ ] **Step 1 — Write failing test:** resolve POST with `TaskDetail{id: 41, key:'TASK-41', inbox:false, ...}`, while mock `taskApi.list()` refetch returns a never-settling promise; call `createTask` and assert it resolves promptly to ID 41, caches one list summary and the detail, and schedules invalidation. Include a refetch-error variation that does not put the creation form into ambiguous-result recovery.
- [ ] **Step 2 — Confirm RED:** `npm run test -- useCreateTask`; expected failing assertion is mutation resolution waiting on `invalidateQueries`.
- [ ] **Step 3 — Minimal change:** retain synchronous `setQueryData` list/detail updates and user-ID guard. Start `void queryClient.invalidateQueries({queryKey:listKey, exact:true})` without `await`/returning that Promise from `onSuccess`. Do not manually fake success before the POST resolves. Keep invalidation errors observable through the list query's existing error handling, not as a create-POST failure.
- [ ] **Step 4 — GREEN + commit:** `npm run test -- useCreateTask TasksListPage` and `npm run typecheck`; expect PASS. Commit `fix(tasks): finish creation without awaiting list refresh`.

### Task 3: Test the actual lost-response-after-commit scenario

**Files:** Modify `client/e2e/task-create.spec.ts` only.

**Interfaces:** Existing `installStatefulTaskApi(page, {initialTasks, failFirstPost})` stays the browser fixture entry. Make `failFirstPost` model **persist then abort reply** rather than abort-before-save; index created resources by `Idempotency-Key` so subsequent same-key requests replay the stored `TaskDetail` without another insert.

- [ ] **Step 1 — Strengthen browser assertion:** for the existing ambiguous-failure scenario, assert the fixture stores one task *after the first response is aborted*, and after retry still has exactly one matching ID/key. Assert two POST attempts have byte-equivalent body and identical UUID; success opens `/tasks?task=41` and shows the original details.
- [ ] **Step 2 — Confirm RED:** `npm run test:e2e -- task-create.spec.ts`; test should fail because current fixture aborts before state is updated.
- [ ] **Step 3 — Minimal fixture change:** on first keyed POST, record payload, allocate ID 41, add one summary/detail and map `key -> original response`; only *after* persisting, `route.abort('failed')`. On the second POST, return the recorded original result and do not append another summary. Preserve separate tests for ordinary title-only creation.
- [ ] **Step 4 — GREEN + commit:** `npm run test:e2e -- task-create.spec.ts` (Playwright browser installed); expect PASS. Commit `test(tasks): cover committed creation with lost response`.

### Task 4: Block Cancel and intentional navigation during the active POST — **owner approved: Option A**

**Approval:** On PR #46 the owner explicitly selected **Option A**: `Cancel` is immediate before submission, including dirty drafts. From request dispatch until that particular POST settles, disable `Cancel` and prevent intentional panel dismissal/navigation; after it settles, existing behavior returns. This supersedes the original plan's blanket immediate-Cancel rule **only for the in-flight interval**. Do not implement Option B or ask this question again.

**Files:** Modify `client/src/task/TaskCreateForm.tsx`, `TaskCreateSurface.tsx`, `TaskWorkspace.tsx`, `TasksListPage.tsx`; corresponding `TaskCreateForm.test.tsx`, `TasksListPage.test.tsx`, overlay tests (if present) and `client/e2e/task-create.spec.ts`.

**Interfaces:** Add an explicit `onSubmittingChange(pending: boolean): void` callback through `TaskCreateForm` → `TaskCreateSurface` → `TaskWorkspace` → `TasksListPage`. Parent router owns a synchronous in-flight ref, distinct from dirty state, used by `useBlocker`; it must not rely on an eventually-rendered `isSubmitting` flag. Reuse the existing router blocker's `reset()` and the existing success-only `navigateWithoutGuard` bypass. Keep the current `onCancel`, `onCreated`, `onDirtyChange` contracts intact.

- [ ] **Step 1 — Write failing form tests:** before first valid submit, even dirty `Cancel` calls `onCancel` immediately. With a deferred `createTask` Promise, `Cancel` is disabled, the pending callback reports `true` on dispatch, and no `onCancel` callback occurs. After a known 400 or ambiguous network failure, pending becomes `false`; the original form correction or immutable `Retry creation` state remains available, and Cancel is once again immediate (subject only to the preexisting dirty navigation contract).
- [ ] **Step 2 — Write failing route/overlay tests:** while the deferred POST is pending, X, Escape, overlay backdrop, switching a task, sidebar navigation/sign out, and browser Back/Forward do not leave `/tasks?create=true`, unmount the form, or offer **Discard draft** as an escape. A blocked navigation may show a neutral **Creating task…** / **Stay here** explanation; it must never have **Discard draft** or a `proceed()` action while pending. Verify the original attempted navigation is not automatically performed after POST failure. After settling, dirty navigation uses the existing **Keep editing / Discard draft** flow and its original-destination continuation.
- [ ] **Step 3 — Write failing completion tests:** a resolved successful POST still fires `onCreated` exactly once and replaces `?create=true` with `?task={id}` even though pending-lock was active. Blocked-navigation dialogs cannot remain stuck over task detail. A pending network error releases the lock and offers the immutable same-key retry, which locks navigation again while that retry POST is running. Test that ownership/security invalidation still hides old account data and isn't indefinitely trapped by the UX lock.
- [ ] **Step 4 — Confirm RED:** from `client/`, run `npm run test -- TaskCreateForm TasksListPage TaskWorkspace TaskOverlay`; new assertions must fail for the currently enabled Cancel/dirty-discard path. Add a targeted Playwright navigation case to the existing `task-create.spec.ts` browser flow and verify it fails before changing production code.
- [ ] **Step 5 — Implement minimal lock:** in the form, call `onSubmittingChange(true)` **synchronously before** awaiting the POST and `onSubmittingChange(false)` on settle/cleanup; disable footer Cancel during the pending interval (and keep duplicate Create/Retry prevention). In the route, `useBlocker` checks the in-flight ref first, even if the form is not dirty; block and `reset()` attempted navigation rather than letting a discard confirmation `proceed()`. Protect X, Escape, overlay backdrop and normal in-app navigation through the same guard; avoid separate event-specific navigation logic. On success, use the existing **internal success-only** guard bypass to navigate to detail, and clear pending/blocked state. Retain native `beforeunload` confirmation as best effort for browser-level unload; it cannot guarantee the tab remains open. Do not add HTTP cancellation or imply the backend task can be rolled back.
- [ ] **Step 6 — Verify GREEN and commit:** run `npm run test -- TaskCreateForm TasksListPage TaskWorkspace TaskOverlay`, `npm run test:e2e -- task-create.spec.ts`, and `npm run typecheck`. Expect PASS. Commit `fix(tasks): block dismissal during active creation request`.

### Task 5: Full verification and PR handoff

**Files:** No production file required. Update the PR description or add an evidence comment.

**Interfaces:** PR #46 remains open until approval and tests. No database migration or new backend dependency is expected for this review remediation.

- [ ] **Step 1:** Review the diff and original plan; verify all four findings are addressed, or document why a finding was not applicable. Confirm Task 4 implements the owner-approved Option A, including route/overlay navigation lock and successful-create bypass.
- [ ] **Step 2:** From `client/`, run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run test:e2e`. Expected PASS; do not substitute unit tests for browser tests.
- [ ] **Step 3:** Since backend behavior is unchanged, validate existing PR backend CI remains green (`server/./mvnw verify -Duser.timezone=UTC` when relevant), particularly its concurrent same-key test. Do not claim local backend results not executed.
- [ ] **Step 4:** Put test outputs, each finding's resolution and any remaining limitations in PR #46. Request an independent review; keep issue #18 open until PR merge.

## Acceptance gate

- [ ] No Account A draft, retry key, server error or cache state appears in Account B's creation view.
- [ ] Same-account session revalidation does not needlessly erase dirty input.
- [ ] Created task immediately opens detail after a successful POST regardless of slow/unavailable list refresh.
- [ ] Browser fixture proves **committed POST + lost response + idempotent replay** with exactly one task.
- [ ] **Approved Option A:** Cancel remains immediate before POST; during POST, Cancel is disabled and every user-initiated panel dismissal/navigation is blocked; after settled response, normal Cancel/dirty-confirmation or immutable Retry state resumes. Successful creation still opens detail and forced security handling cannot leak drafts.
- [ ] All affected unit/router/browser tests and PR-required quality checks pass.

## Luna handoff

Work directly on `feat/issue-18-task-creation`, then follow **superpowers:executing-plans** or **superpowers:subagent-driven-development**, and **superpowers:test-driven-development** for each task. First verify the live code and review comments; don't blindly implement an invalid finding. **Owner approval for Task 4 Option A has been obtained**; Luna may implement all Tasks 1–5 without a further product decision. Commit each fix separately and summarize verification in PR #46. Ask only if a genuinely new product ambiguity arises.

**Planning only:** This file contains remediation instructions; it does not change application code or assert new tests have passed.
